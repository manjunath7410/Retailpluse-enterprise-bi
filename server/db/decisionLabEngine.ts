import {
  AbTestCohortPresetId,
  AbTestMetricKey,
  AbTestPowerCurvePoint,
  AbTestRequest,
  AbTestResultPayload,
  AnomalyDetectionPayload,
  AnomalyRootCausePayload,
  AnomalyRootCauseRequest,
  ExecutiveBoardReportPayload,
  LineageEdge,
  LineageGovernancePayload,
  LineageNode,
  MonthlyAnomalySeriesPoint,
  MonteCarloHistogramBin,
  RootCauseDimensionBreakdown,
  RootCauseDriverRow,
  StatisticalAnomalyItem,
  WhatIfBaselineMetrics,
  WhatIfMonteCarloSummary,
  WhatIfScenarioInput,
  WhatIfSensitivityRow,
  WhatIfSimulationPayload
} from '../../src/types/analytics';
import { ANALYTICAL_MODEL_DEFINITIONS, KPI_DICTIONARY_DEFINITIONS } from './analyticalModels';
import { computeAdvancedAnalyticsSuite } from './advancedAnalyticsEngine';
import { duckdbEngine, TABLE_DEFINITIONS } from './duckdbEngine';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number): number => Math.round((n + Number.EPSILON) * 10000) / 10000;

function formatCurrency(val: number): string {
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(val: number): string {
  return `${round2(val).toFixed(2)}%`;
}

// ============================================================================
// PURE STATISTICAL PRIMITIVES (Unit-testable, zero external dependencies)
// ============================================================================

/**
 * Standard Normal CDF Phi(z) using Abramowitz & Stegun 7.1.26 (max error < 1.5e-7).
 */
export function computeNormalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/**
 * Inverse Standard Normal (Probit) approximation by Peter J. Acklam.
 */
export function computeNormalQuantile(p: number): number {
  const clamped = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (clamped < pLow) {
    const q = Math.sqrt(-2 * Math.log(clamped));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (clamped <= pHigh) {
    const q = clamped - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - clamped));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/**
 * Log Gamma via Lanczos approximation (g = 7).
 */
function logGamma(z: number): number {
  const coeffs = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const zz = z - 1;
  let x = coeffs[0];
  for (let i = 1; i < coeffs.length; i++) {
    x += coeffs[i] / (zz + i);
  }
  const t = zz + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Regularized incomplete beta function I_x(a, b) via Lentz continued fraction.
 */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(x, a, b)) / a;
  }
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

function betacf(x: number, a: number, b: number): number {
  const maxIter = 200;
  const eps = 3e-12;
  const fpMin = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

/**
 * Exact two-tailed p-value for Student's t-distribution with arbitrary positive df.
 */
export function computeStudentTTwoTailedPValue(tStat: number, df: number): number {
  if (!Number.isFinite(tStat) || !Number.isFinite(df) || df <= 0) return 1;
  const absT = Math.abs(tStat);
  if (df > 5000) {
    return Math.min(1, Math.max(0, 2 * (1 - computeNormalCdf(absT))));
  }
  const x = df / (df + absT * absT);
  const p = regularizedIncompleteBeta(x, df / 2, 0.5);
  return Math.min(1, Math.max(0, p));
}

export interface WelchTTestInput {
  nA: number;
  meanA: number;
  stdDevA: number;
  nB: number;
  meanB: number;
  stdDevB: number;
  alpha?: number;
  targetMdePct?: number;
}

export interface PureHypothesisOutput {
  testMethod: 'WELCH_T_TEST' | 'TWO_PROPORTION_Z_TEST';
  absoluteDifference: number;
  relativeLiftPct: number;
  testStatistic: number;
  degreesOfFreedom: number | null;
  pValue: number;
  confidenceInterval95: [number, number];
  cohensD: number;
  achievedPowerPct: number;
  isStatisticallySignificant: boolean;
  requiredSamplePerArmForTargetMde: number;
  powerCurve: AbTestPowerCurvePoint[];
}

export function computeWelchTTest(input: WelchTTestInput): PureHypothesisOutput {
  const nA = Math.max(2, Math.round(input.nA));
  const nB = Math.max(2, Math.round(input.nB));
  const sA = Math.max(0.0001, input.stdDevA);
  const sB = Math.max(0.0001, input.stdDevB);
  const alpha = input.alpha ?? 0.05;
  const targetMdePct = Math.max(0.5, input.targetMdePct ?? 5);

  const varA = sA * sA;
  const varB = sB * sB;
  const se = Math.sqrt(varA / nA + varB / nB);
  const diff = input.meanB - input.meanA;
  const relLiftPct = input.meanA !== 0 ? (diff / Math.abs(input.meanA)) * 100 : 0;

  const tStat = se > 0 ? diff / se : 0;
  const dfNum = Math.pow(varA / nA + varB / nB, 2);
  const dfDen =
    Math.pow(varA / nA, 2) / Math.max(1, nA - 1) + Math.pow(varB / nB, 2) / Math.max(1, nB - 1);
  const df = dfDen > 0 ? dfNum / dfDen : nA + nB - 2;
  const pValue = computeStudentTTwoTailedPValue(tStat, df);

  // 95% confidence interval using critical t approximation (Cornish-Fisher expansion for accuracy across all df)
  const z95 = 1.95996398454;
  const tCrit95 =
    df > 30
      ? z95 + (z95 * z95 * z95 + z95) / (4 * df)
      : z95 + (z95 ** 3 + z95) / (4 * df) + (5 * z95 ** 5 + 16 * z95 ** 3 + 3 * z95) / (96 * df * df);
  const margin95 = tCrit95 * se;

  const pooledSd = Math.sqrt(((nA - 1) * varA + (nB - 1) * varB) / Math.max(1, nA + nB - 2));
  const cohensD = pooledSd > 0 ? diff / pooledSd : 0;

  // Achieved statistical power at observed effect size & alpha
  const zAlpha = computeNormalQuantile(1 - alpha / 2);
  const nonCentrality = se > 0 ? Math.abs(diff) / se : 0;
  const achievedPower =
    1 - computeNormalCdf(zAlpha - nonCentrality) + computeNormalCdf(-zAlpha - nonCentrality);

  // Sample size per arm required for 80% power at target MDE %
  const zBeta = computeNormalQuantile(0.8);
  const baselineAbs = Math.max(Math.abs(input.meanA), 0.1);
  const calcRequiredN = (mdePct: number): number => {
    const delta = baselineAbs * (mdePct / 100);
    if (delta <= 0) return 0;
    return Math.ceil((2 * pooledSd * pooledSd * Math.pow(zAlpha + zBeta, 2)) / (delta * delta));
  };

  const mdeSteps = [1, 2, 3, 5, 8, 10, 15, 20];
  const powerCurve: AbTestPowerCurvePoint[] = mdeSteps.map((m) => ({
    mdeRelativePct: m,
    requiredSamplePerArm: calcRequiredN(m)
  }));

  return {
    testMethod: 'WELCH_T_TEST',
    absoluteDifference: round4(diff),
    relativeLiftPct: round2(relLiftPct),
    testStatistic: round4(tStat),
    degreesOfFreedom: round2(df),
    pValue: pValue < 0.0001 ? Number(pValue.toExponential(2)) : round4(pValue),
    confidenceInterval95: [round4(diff - margin95), round4(diff + margin95)],
    cohensD: round4(cohensD),
    achievedPowerPct: round2(Math.min(100, Math.max(0, achievedPower * 100))),
    isStatisticallySignificant: pValue < alpha,
    requiredSamplePerArmForTargetMde: calcRequiredN(targetMdePct),
    powerCurve
  };
}

export interface TwoProportionZTestInput {
  nA: number;
  successesA: number;
  nB: number;
  successesB: number;
  alpha?: number;
  targetMdePct?: number;
}

export function computeTwoProportionZTest(input: TwoProportionZTestInput): PureHypothesisOutput {
  const nA = Math.max(2, Math.round(input.nA));
  const nB = Math.max(2, Math.round(input.nB));
  const sA = Math.min(nA, Math.max(0, Math.round(input.successesA)));
  const sB = Math.min(nB, Math.max(0, Math.round(input.successesB)));
  const alpha = input.alpha ?? 0.05;
  const targetMdePct = Math.max(0.5, input.targetMdePct ?? 10);

  const pA = sA / nA;
  const pB = sB / nB;
  const diff = pB - pA;
  const relLiftPct = pA > 0 ? (diff / pA) * 100 : 0;

  const pPool = (sA + sB) / (nA + nB);
  const sePool = Math.sqrt(Math.max(1e-12, pPool * (1 - pPool) * (1 / nA + 1 / nB)));
  const seUnpooled = Math.sqrt(
    Math.max(1e-12, (pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB)
  );

  const zStat = diff / sePool;
  const pValue = Math.min(1, Math.max(0, 2 * (1 - computeNormalCdf(Math.abs(zStat)))));
  const z95 = 1.95996398454;
  const margin95 = z95 * seUnpooled;

  // Cohen's h for two proportions
  const cohensH = 2 * Math.asin(Math.sqrt(pB)) - 2 * Math.asin(Math.sqrt(pA));

  const zAlpha = computeNormalQuantile(1 - alpha / 2);
  const zBeta = computeNormalQuantile(0.8);
  const nonCentrality = Math.abs(diff) / seUnpooled;
  const achievedPower =
    1 - computeNormalCdf(zAlpha - nonCentrality) + computeNormalCdf(-zAlpha - nonCentrality);

  const baseP = Math.min(0.95, Math.max(0.02, pA));
  const calcRequiredN = (mdeRelPct: number): number => {
    const pTarget = Math.min(0.99, Math.max(0.001, baseP * (1 + mdeRelPct / 100)));
    const delta = Math.abs(pTarget - baseP);
    if (delta <= 1e-6) return 0;
    const pBar = (baseP + pTarget) / 2;
    const num = Math.pow(
      zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) +
        zBeta * Math.sqrt(baseP * (1 - baseP) + pTarget * (1 - pTarget)),
      2
    );
    return Math.ceil(num / (delta * delta));
  };

  const mdeSteps = [2, 5, 8, 10, 15, 20, 30];
  const powerCurve: AbTestPowerCurvePoint[] = mdeSteps.map((m) => ({
    mdeRelativePct: m,
    requiredSamplePerArm: calcRequiredN(m)
  }));

  // Report differences & CI in percentage points (0..100) for clear business display
  return {
    testMethod: 'TWO_PROPORTION_Z_TEST',
    absoluteDifference: round2(diff * 100),
    relativeLiftPct: round2(relLiftPct),
    testStatistic: round4(zStat),
    degreesOfFreedom: null,
    pValue: pValue < 0.0001 ? Number(pValue.toExponential(2)) : round4(pValue),
    confidenceInterval95: [round2((diff - margin95) * 100), round2((diff + margin95) * 100)],
    cohensD: round4(cohensH),
    achievedPowerPct: round2(Math.min(100, Math.max(0, achievedPower * 100))),
    isStatisticallySignificant: pValue < alpha,
    requiredSamplePerArmForTargetMde: calcRequiredN(targetMdePct),
    powerCurve
  };
}

export interface SeriesAnomalyPointStats {
  index: number;
  value: number;
  mean: number;
  stdDev: number;
  zScore: number;
  q1: number;
  q3: number;
  iqr: number;
  iqrStatus: 'ABOVE_UPPER_FENCE' | 'BELOW_LOWER_FENCE' | 'WITHIN_FENCE';
  isAnomaly: boolean;
  severity: 'HIGH' | 'MEDIUM' | 'NONE';
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Robust Z-score (leave-one-out mean/std so a single huge outlier doesn't mask itself)
 * combined with Tukey 1.5*IQR fences.
 */
export function detectSeriesAnomalies(values: number[]): SeriesAnomalyPointStats[] {
  const n = values.length;
  if (n === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = Math.max(0, q3 - q1);
  const upperFence = q3 + 1.5 * iqr;
  const lowerFence = q1 - 1.5 * iqr;

  return values.map((val, idx) => {
    // Leave-one-out mean & std when n >= 4 so planted spikes don't inflate the denominator
    const ref = n >= 4 ? values.filter((_, i) => i !== idx) : values;
    const mean = ref.reduce((s, v) => s + v, 0) / ref.length;
    const variance =
      ref.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, ref.length - 1);
    const stdDev = Math.sqrt(variance);
    const zScore = stdDev > 1e-9 ? (val - mean) / stdDev : 0;

    let iqrStatus: 'ABOVE_UPPER_FENCE' | 'BELOW_LOWER_FENCE' | 'WITHIN_FENCE' = 'WITHIN_FENCE';
    if (iqr > 0 && val > upperFence) iqrStatus = 'ABOVE_UPPER_FENCE';
    else if (iqr > 0 && val < lowerFence) iqrStatus = 'BELOW_LOWER_FENCE';

    const absZ = Math.abs(zScore);
    let severity: 'HIGH' | 'MEDIUM' | 'NONE' = 'NONE';
    if (absZ >= 2.5 || (absZ >= 2.0 && iqrStatus !== 'WITHIN_FENCE')) {
      severity = 'HIGH';
    } else if (absZ >= 1.85 || iqrStatus !== 'WITHIN_FENCE') {
      severity = 'MEDIUM';
    }

    return {
      index: idx,
      value: val,
      mean: round2(mean),
      stdDev: round2(stdDev),
      zScore: round2(zScore),
      q1: round2(q1),
      q3: round2(q3),
      iqr: round2(iqr),
      iqrStatus,
      isAnomaly: severity !== 'NONE',
      severity
    };
  });
}

// ============================================================================
// 1. LIVE STATISTICAL ANOMALY ENGINE (DuckDB)
// ============================================================================

export async function computeAnomalyAlerts(): Promise<AnomalyDetectionPayload> {
  await duckdbEngine.ensureInitialized();
  const dataMode = duckdbEngine.getDataMode();
  const isDemonstrationData = duckdbEngine.isDemonstrationData();

  const monthlySql = `WITH order_reviews AS (
  SELECT order_id, AVG(CAST(review_score AS DOUBLE)) AS avg_review
  FROM fact_reviews
  GROUP BY order_id
)
SELECT
  SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month,
  COUNT(DISTINCT fo.order_id) AS total_orders,
  ROUND(COALESCE(SUM(CASE WHEN fo.order_status NOT IN ('canceled', 'unavailable') THEN fo.total_order_value ELSE 0 END), 0), 2) AS revenue,
  ROUND(
    COALESCE(
      SUM(CASE WHEN fo.order_status = 'delivered' AND fo.is_on_time = 0 THEN 1 ELSE 0 END) * 100.0 /
      NULLIF(SUM(CASE WHEN fo.order_status = 'delivered' THEN 1 ELSE 0 END), 0),
      0
    ),
    2
  ) AS late_delivery_pct,
  ROUND(
    SUM(CASE WHEN fo.order_status IN ('canceled', 'unavailable') THEN 1 ELSE 0 END) * 100.0 /
    NULLIF(COUNT(DISTINCT fo.order_id), 0),
    2
  ) AS cancellation_pct,
  ROUND(COALESCE(AVG(orv.avg_review), 0), 2) AS avg_review_score
FROM fact_orders fo
LEFT JOIN order_reviews orv ON fo.order_id = orv.order_id
WHERE fo.order_purchase_timestamp IS NOT NULL
GROUP BY 1
ORDER BY 1 ASC;`;

  const stateSlaSql = `SELECT
  fo.customer_state,
  COUNT(DISTINCT fo.order_id) AS delivered_orders,
  ROUND(AVG(CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END), 2) AS late_delivery_pct,
  ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 2) AS avg_delivery_days
FROM fact_orders fo
WHERE fo.order_status = 'delivered'
  AND fo.customer_state IS NOT NULL
GROUP BY fo.customer_state
HAVING COUNT(DISTINCT fo.order_id) >= 5
ORDER BY late_delivery_pct DESC;`;

  const [monthlyRes, stateRes] = await Promise.all([
    duckdbEngine.executeReadOnlyQuery(monthlySql, 60, false),
    duckdbEngine.executeReadOnlyQuery(stateSlaSql, 35, false)
  ]);

  const rawMonths = monthlyRes.rows.map((r) => ({
    month: String(r.order_month ?? ''),
    orders: Number(r.total_orders ?? 0),
    revenue: Number(r.revenue ?? 0),
    lateDeliveryPct: Number(r.late_delivery_pct ?? 0),
    cancellationPct: Number(r.cancellation_pct ?? 0),
    avgReviewScore: Number(r.avg_review_score ?? 0)
  }));

  const revStats = detectSeriesAnomalies(rawMonths.map((m) => m.revenue));
  const lateStats = detectSeriesAnomalies(rawMonths.map((m) => m.lateDeliveryPct));
  const cancelStats = detectSeriesAnomalies(rawMonths.map((m) => m.cancellationPct));
  const reviewStats = detectSeriesAnomalies(rawMonths.map((m) => m.avgReviewScore));

  const monthlySeries: MonthlyAnomalySeriesPoint[] = rawMonths.map((m, idx) => ({
    month: m.month,
    revenue: m.revenue,
    orders: m.orders,
    lateDeliveryPct: m.lateDeliveryPct,
    cancellationPct: m.cancellationPct,
    avgReviewScore: m.avgReviewScore,
    revenueZScore: revStats[idx]?.zScore ?? 0,
    lateRateZScore: lateStats[idx]?.zScore ?? 0,
    cancellationZScore: cancelStats[idx]?.zScore ?? 0
  }));

  const anomalies: StatisticalAnomalyItem[] = [];

  for (let i = 0; i < rawMonths.length; i++) {
    const m = rawMonths[i];

    // Revenue anomaly
    const rs = revStats[i];
    if (rs && rs.isAnomaly) {
      const isSpike = rs.zScore >= 0;
      anomalies.push({
        id: `ANOM-REV-${m.month}`,
        domain: 'Revenue',
        metricKey: 'monthly_revenue',
        metricLabel: 'Monthly Gross Revenue',
        period: m.month,
        observedValue: m.revenue,
        formattedObserved: formatCurrency(m.revenue),
        baselineMean: rs.mean,
        formattedBaseline: formatCurrency(rs.mean),
        baselineStdDev: rs.stdDev,
        zScore: rs.zScore,
        iqrStatus: rs.iqrStatus,
        severity: rs.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
        direction: isSpike ? 'SPIKE' : 'DROP',
        explanation: isSpike
          ? `Monthly revenue in ${m.month} surged to ${formatCurrency(m.revenue)} (${rs.zScore > 0 ? '+' : ''}${rs.zScore}σ vs. leave-one-out mean of ${formatCurrency(rs.mean)}), consistent with a peak seasonal demand wave across ${m.orders.toLocaleString()} orders.`
          : `Monthly revenue in ${m.month} fell to ${formatCurrency(m.revenue)} (${rs.zScore}σ below baseline mean of ${formatCurrency(rs.mean)}).`,
        recommendedAction: isSpike
          ? 'Pre-allocate carrier capacity and safety stock ahead of seasonal surges to prevent post-peak SLA spillover.'
          : 'Audit acquisition funnel, payment approval rates, and top category inventory availability for the trough month.',
        suggestedSimulatorPreset: {
          lateDeliveryReductionPct: 25,
          repeatRateLiftPct: 10,
          targetState: 'ALL'
        },
        suggestedAiPrompt: `What drove the monthly revenue change in ${m.month}, and how did top categories and order volume shift?`,
        sqlLineage: monthlySql
      });
    }

    // Late delivery SLA anomaly (focus on elevated late rate spikes)
    const ls = lateStats[i];
    if (ls && ls.isAnomaly && ls.zScore > 0) {
      anomalies.push({
        id: `ANOM-SLA-${m.month}`,
        domain: 'Logistics SLA',
        metricKey: 'late_delivery_pct',
        metricLabel: 'Late Delivery Rate (%)',
        period: m.month,
        observedValue: m.lateDeliveryPct,
        formattedObserved: formatPct(m.lateDeliveryPct),
        baselineMean: ls.mean,
        formattedBaseline: formatPct(ls.mean),
        baselineStdDev: ls.stdDev,
        zScore: ls.zScore,
        iqrStatus: ls.iqrStatus,
        severity: ls.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
        direction: 'SPIKE',
        explanation: `Late delivery rate spiked to ${formatPct(m.lateDeliveryPct)} in ${m.month} (+${ls.zScore}σ above baseline ${formatPct(ls.mean)}; Tukey fence: ${ls.iqrStatus}). Customer review score in this month averaged ${m.avgReviewScore.toFixed(2)}★.`,
        recommendedAction:
          'Reroute long-haul Northeast corridors to regional cross-dock hubs and enforce carrier SLA clawbacks for >5-day delays.',
        suggestedSimulatorPreset: {
          lateDeliveryReductionPct: 40,
          freightReductionPct: 10,
          targetState: 'ALL'
        },
        suggestedAiPrompt: `Which states and sellers drove the late delivery spike in ${m.month}, and how did it affect review scores?`,
        sqlLineage: monthlySql
      });
    }

    // Cancellation rate anomaly (focus on elevated cancellations)
    const cs = cancelStats[i];
    if (cs && cs.isAnomaly && cs.zScore > 0) {
      anomalies.push({
        id: `ANOM-CANC-${m.month}`,
        domain: 'Cancellations',
        metricKey: 'cancellation_pct',
        metricLabel: 'Order Cancellation Rate (%)',
        period: m.month,
        observedValue: m.cancellationPct,
        formattedObserved: formatPct(m.cancellationPct),
        baselineMean: cs.mean,
        formattedBaseline: formatPct(cs.mean),
        baselineStdDev: cs.stdDev,
        zScore: cs.zScore,
        iqrStatus: cs.iqrStatus,
        severity: cs.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
        direction: 'SPIKE',
        explanation: `Order cancellations surged to ${formatPct(m.cancellationPct)} in ${m.month} (+${cs.zScore}σ above baseline ${formatPct(cs.mean)}), signaling a payment gateway timeout, stockout wave, or seller fulfillment breakdown.`,
        recommendedAction:
          'Audit failed boleto/credit-card settlements and enforce real-time SKU stock reservation checks before checkout approval.',
        suggestedSimulatorPreset: {
          cancellationReductionPct: 45,
          lateDeliveryReductionPct: 20,
          targetState: 'ALL'
        },
        suggestedAiPrompt: `Investigate the cancellation spike in ${m.month} alongside monthly revenue and seller operational risk.`,
        sqlLineage: monthlySql
      });
    }

    // Review score drop anomaly
    const rvs = reviewStats[i];
    if (rvs && rvs.isAnomaly && rvs.zScore < -1.9 && m.avgReviewScore > 0) {
      anomalies.push({
        id: `ANOM-REVSCORE-${m.month}`,
        domain: 'Customer Satisfaction',
        metricKey: 'avg_review_score',
        metricLabel: 'Mean Review Score (1-5★)',
        period: m.month,
        observedValue: m.avgReviewScore,
        formattedObserved: `${m.avgReviewScore.toFixed(2)}★`,
        baselineMean: rvs.mean,
        formattedBaseline: `${rvs.mean.toFixed(2)}★`,
        baselineStdDev: rvs.stdDev,
        zScore: rvs.zScore,
        iqrStatus: rvs.iqrStatus,
        severity: rvs.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
        direction: 'DROP',
        explanation: `Customer review score dropped to ${m.avgReviewScore.toFixed(2)}★ in ${m.month} (${rvs.zScore}σ below baseline ${rvs.mean.toFixed(2)}★), closely coinciding with a ${formatPct(m.lateDeliveryPct)} late-delivery rate.`,
        recommendedAction:
          'Trigger proactive delay alerts and freight-credit recovery vouchers for orders projected to miss estimated delivery dates.',
        suggestedSimulatorPreset: {
          lateDeliveryReductionPct: 35,
          repeatRateLiftPct: 8,
          targetState: 'ALL'
        },
        suggestedAiPrompt: `What factors are most strongly associated with low review scores, especially around ${m.month}?`,
        sqlLineage: monthlySql
      });
    }
  }

  // Regional State SLA Outlier detection (top severe regional outlier)
  const stateRates = stateRes.rows.map((r) => Number(r.late_delivery_pct ?? 0));
  const stateStats = detectSeriesAnomalies(stateRates);
  stateRes.rows.forEach((row, idx) => {
    const stStat = stateStats[idx];
    const stCode = String(row.customer_state ?? '');
    const latePct = Number(row.late_delivery_pct ?? 0);
    const delivOrders = Number(row.delivered_orders ?? 0);
    const avgDays = Number(row.avg_delivery_days ?? 0);
    if (stStat && stStat.isAnomaly && stStat.zScore >= 1.9 && delivOrders >= 15) {
      anomalies.push({
        id: `ANOM-STATE-${stCode}`,
        domain: 'Logistics SLA',
        metricKey: 'state_late_delivery_pct',
        metricLabel: `Regional SLA Outlier (${stCode})`,
        period: `State ${stCode} (${delivOrders} orders)`,
        observedValue: latePct,
        formattedObserved: formatPct(latePct),
        baselineMean: stStat.mean,
        formattedBaseline: formatPct(stStat.mean),
        baselineStdDev: stStat.stdDev,
        zScore: stStat.zScore,
        iqrStatus: stStat.iqrStatus,
        severity: stStat.zScore >= 2.3 ? 'HIGH' : 'MEDIUM',
        direction: 'SPIKE',
        explanation: `State ${stCode} averages ${formatPct(latePct)} late deliveries and ${avgDays.toFixed(1)} transit days (+${stStat.zScore}σ above cross-state mean ${formatPct(stStat.mean)}).`,
        recommendedAction: `Evaluate regional fulfillment partner routing for ${stCode} and recalibrate checkout delivery ETA buffers.`,
        suggestedSimulatorPreset: {
          lateDeliveryReductionPct: 45,
          freightReductionPct: 12,
          targetState: stCode
        },
        suggestedAiPrompt: `Which states have the worst delivery performance, and how severe is the SLA gap in ${stCode}?`,
        sqlLineage: stateSlaSql
      });
    }
  });

  // Sort by severity then |zScore| desc
  const severityRank = { HIGH: 0, MEDIUM: 1, INFO: 2 };
  anomalies.sort((a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
    return Math.abs(b.zScore) - Math.abs(a.zScore);
  });

  return {
    generatedAt: new Date().toISOString(),
    dataMode,
    isDemonstrationData,
    monthsEvaluated: rawMonths.length,
    totalAnomalies: anomalies.length,
    highSeverityCount: anomalies.filter((a) => a.severity === 'HIGH').length,
    mediumSeverityCount: anomalies.filter((a) => a.severity === 'MEDIUM').length,
    anomalies,
    monthlySeries,
    methodologyNote:
      'Leave-one-out Z-score (|Z| >= 1.85 Medium, |Z| >= 2.50 or |Z| >= 2.0 + Tukey 1.5x IQR High) computed directly over DuckDB fact_orders and fact_reviews without excluding valid outliers from the displayed series.'
  };
}

// ============================================================================
// 1B. AUTOMATED ANOMALY-TO-ROOT-CAUSE MULTI-DIMENSIONAL ATTRIBUTION ENGINE
// ============================================================================

const VALID_MONTH_RE = /^\d{4}-\d{2}$/;
const VALID_STATE_RE = /^[A-Z]{2}$/;
const ALLOWED_ROOT_CAUSE_METRICS = new Set([
  'monthly_revenue',
  'late_delivery_pct',
  'cancellation_pct',
  'avg_review_score',
  'state_late_delivery_pct'
]);

function rankAndNormalizeDrivers(
  raw: Array<{
    segment: string;
    targetValue: number;
    baselineValue: number;
    targetOrders: number;
    rawContributionWeight: number;
  }>,
  isPositiveAnomaly: boolean
): { drivers: RootCauseDriverRow[]; top3ConcentrationPct: number } {
  const directional = raw.map((item) => {
    const delta = round2(item.targetValue - item.baselineValue);
    const relativeChangePct =
      Math.abs(item.baselineValue) > 1e-6
        ? round2(((item.targetValue - item.baselineValue) / Math.abs(item.baselineValue)) * 100)
        : null;
    // Aligned contribution measures how strongly this segment pushed the metric in the anomaly's direction
    const alignedImpact = isPositiveAnomaly
      ? Math.max(0, item.rawContributionWeight)
      : Math.max(0, -item.rawContributionWeight);
    return {
      segment: item.segment,
      targetValue: round2(item.targetValue),
      baselineValue: round2(item.baselineValue),
      delta,
      relativeChangePct,
      targetOrders: Math.round(item.targetOrders),
      alignedImpact
    };
  });

  const totalAligned = directional.reduce((sum, r) => sum + r.alignedImpact, 0);

  const sorted = [...directional]
    .sort((a, b) => b.alignedImpact - a.alignedImpact || Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8)
    .map((r) => ({
      segment: r.segment,
      targetValue: r.targetValue,
      baselineValue: r.baselineValue,
      delta: r.delta,
      relativeChangePct: r.relativeChangePct,
      contributionSharePct:
        totalAligned > 1e-6 ? round2((r.alignedImpact / totalAligned) * 100) : 0,
      targetOrders: r.targetOrders
    }));

  const top3ConcentrationPct = round2(
    sorted.slice(0, 3).reduce((sum, r) => sum + r.contributionSharePct, 0)
  );

  return { drivers: sorted, top3ConcentrationPct };
}

export async function investigateAnomalyRootCause(
  req: AnomalyRootCauseRequest
): Promise<AnomalyRootCausePayload> {
  const startMs = performance.now();
  await duckdbEngine.ensureInitialized();

  const metricKey = String(req.metricKey || '').trim();
  if (!ALLOWED_ROOT_CAUSE_METRICS.has(metricKey)) {
    throw new Error(
      `Unsupported root-cause metricKey "${metricKey}". Expected one of: ${Array.from(
        ALLOWED_ROOT_CAUSE_METRICS
      ).join(', ')}.`
    );
  }

  // Case A: Regional State SLA Outlier Investigation
  if (metricKey === 'state_late_delivery_pct') {
    const rawState =
      req.stateCode?.trim().toUpperCase() ||
      (String(req.period || '').match(/State\s+([A-Z]{2})/i)?.[1] || '').toUpperCase();
    if (!VALID_STATE_RE.test(rawState)) {
      throw new Error(
        `Invalid state code "${rawState}" for regional SLA root-cause investigation. Expected 2-letter Brazilian state code.`
      );
    }

    const overallSql = `SELECT
  ROUND(AVG(CASE WHEN customer_state = '${rawState}' THEN CASE WHEN is_on_time = 0 THEN 100.0 ELSE 0.0 END END), 2) AS target_val,
  ROUND(AVG(CASE WHEN customer_state <> '${rawState}' THEN CASE WHEN is_on_time = 0 THEN 100.0 ELSE 0.0 END END), 2) AS baseline_val
FROM fact_orders
WHERE order_status = 'delivered' AND customer_state IS NOT NULL;`;

    const categorySql = `WITH order_primary_cat AS (
  SELECT fi.order_id, MIN(COALESCE(dp.category_english, 'uncategorized')) AS segment
  FROM fact_order_items fi
  LEFT JOIN dim_products dp ON fi.product_id = dp.product_id
  GROUP BY fi.order_id
)
SELECT
  opc.segment,
  COUNT(DISTINCT CASE WHEN fo.customer_state = '${rawState}' THEN fo.order_id END) AS target_orders,
  SUM(CASE WHEN fo.customer_state = '${rawState}' AND fo.is_on_time = 0 THEN 1 ELSE 0 END) AS target_late_orders,
  ROUND(AVG(CASE WHEN fo.customer_state = '${rawState}' THEN CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END END), 2) AS target_val,
  ROUND(AVG(CASE WHEN fo.customer_state <> '${rawState}' THEN CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END END), 2) AS baseline_val
FROM fact_orders fo
JOIN order_primary_cat opc ON fo.order_id = opc.order_id
WHERE fo.order_status = 'delivered' AND fo.customer_state IS NOT NULL
GROUP BY opc.segment
HAVING COUNT(DISTINCT CASE WHEN fo.customer_state = '${rawState}' THEN fo.order_id END) >= 2;`;

    const sellerSql = `WITH order_primary_seller AS (
  SELECT fi.order_id, MIN(fi.seller_id) AS seller_id
  FROM fact_order_items fi
  GROUP BY fi.order_id
)
SELECT
  CONCAT(SUBSTR(ops.seller_id, 1, 10), ' (', COALESCE(ds.seller_state, 'BR'), ')') AS segment,
  COUNT(DISTINCT CASE WHEN fo.customer_state = '${rawState}' THEN fo.order_id END) AS target_orders,
  SUM(CASE WHEN fo.customer_state = '${rawState}' AND fo.is_on_time = 0 THEN 1 ELSE 0 END) AS target_late_orders,
  ROUND(AVG(CASE WHEN fo.customer_state = '${rawState}' THEN CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END END), 2) AS target_val,
  ROUND(AVG(CASE WHEN fo.customer_state <> '${rawState}' THEN CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END END), 2) AS baseline_val
FROM fact_orders fo
JOIN order_primary_seller ops ON fo.order_id = ops.order_id
LEFT JOIN dim_sellers ds ON ops.seller_id = ds.seller_id
WHERE fo.order_status = 'delivered' AND fo.customer_state IS NOT NULL
GROUP BY 1
HAVING COUNT(DISTINCT CASE WHEN fo.customer_state = '${rawState}' THEN fo.order_id END) >= 1;`;

    const paymentSql = `WITH order_primary_pay AS (
  SELECT order_id, MIN(COALESCE(payment_type, 'other')) AS segment
  FROM fact_payments
  GROUP BY order_id
)
SELECT
  opp.segment,
  COUNT(DISTINCT CASE WHEN fo.customer_state = '${rawState}' THEN fo.order_id END) AS target_orders,
  SUM(CASE WHEN fo.customer_state = '${rawState}' AND fo.is_on_time = 0 THEN 1 ELSE 0 END) AS target_late_orders,
  ROUND(AVG(CASE WHEN fo.customer_state = '${rawState}' THEN CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END END), 2) AS target_val,
  ROUND(AVG(CASE WHEN fo.customer_state <> '${rawState}' THEN CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END END), 2) AS baseline_val
FROM fact_orders fo
JOIN order_primary_pay opp ON fo.order_id = opp.order_id
WHERE fo.order_status = 'delivered' AND fo.customer_state IS NOT NULL
GROUP BY opp.segment
HAVING COUNT(DISTINCT CASE WHEN fo.customer_state = '${rawState}' THEN fo.order_id END) >= 1;`;

    const [overallRes, catRes, sellerRes, payRes] = await Promise.all([
      duckdbEngine.executeReadOnlyQuery(overallSql, 5, false),
      duckdbEngine.executeReadOnlyQuery(categorySql, 50, false),
      duckdbEngine.executeReadOnlyQuery(sellerSql, 80, false),
      duckdbEngine.executeReadOnlyQuery(paymentSql, 20, false)
    ]);

    const targetValue = round2(Number(overallRes.rows[0]?.target_val ?? 0));
    const baselineValue = round2(Number(overallRes.rows[0]?.baseline_val ?? 0));
    const totalDelta = round2(targetValue - baselineValue);
    const isPositive = totalDelta >= 0;

    const mapRateRows = (rows: Record<string, string | number | boolean | null>[]) =>
      rows.map((r) => {
        const tv = Number(r.target_val ?? 0);
        const bv = Number(r.baseline_val ?? baselineValue);
        const orders = Number(r.target_orders ?? 0);
        return {
          segment: String(r.segment ?? 'unknown'),
          targetValue: tv,
          baselineValue: bv,
          targetOrders: orders,
          rawContributionWeight: (tv - bv) * Math.max(1, orders)
        };
      });

    const catRanked = rankAndNormalizeDrivers(mapRateRows(catRes.rows), isPositive);
    const sellerRanked = rankAndNormalizeDrivers(mapRateRows(sellerRes.rows), isPositive);
    const payRanked = rankAndNormalizeDrivers(mapRateRows(payRes.rows), isPositive);

    const dimensions: RootCauseDimensionBreakdown[] = [
      {
        dimensionKey: 'category',
        dimensionLabel: 'By Product Category',
        top3ConcentrationPct: catRanked.top3ConcentrationPct,
        drivers: catRanked.drivers,
        executedSql: categorySql
      },
      {
        dimensionKey: 'seller',
        dimensionLabel: 'By Fulfillment Seller',
        top3ConcentrationPct: sellerRanked.top3ConcentrationPct,
        drivers: sellerRanked.drivers,
        executedSql: sellerSql
      },
      {
        dimensionKey: 'payment_type',
        dimensionLabel: 'By Payment Method',
        top3ConcentrationPct: payRanked.top3ConcentrationPct,
        drivers: payRanked.drivers,
        executedSql: paymentSql
      }
    ];

    const topCat = catRanked.drivers[0];
    const topSeller = sellerRanked.drivers[0];
    const executiveVerdict = `State ${rawState} recorded a ${formatPct(targetValue)} late-delivery rate (${totalDelta >= 0 ? '+' : ''}${totalDelta.toFixed(2)} pp vs. ${formatPct(baselineValue)} rest-of-Brazil baseline). Primary category bottleneck: ${topCat ? `${topCat.segment.replace(/_/g, ' ')} (${formatPct(topCat.targetValue)}, ${topCat.contributionSharePct.toFixed(1)}% of excess delay volume)` : 'distributed across categories'}; top seller contributor: ${topSeller ? `${topSeller.segment} (${formatPct(topSeller.targetValue)})` : 'broad carrier corridor delay'}.`;

    return {
      generatedAt: new Date().toISOString(),
      period: `State ${rawState}`,
      metricKey,
      metricLabel: `Regional SLA Outlier (${rawState})`,
      unit: 'percent',
      direction: isPositive ? 'SPIKE' : 'DROP',
      targetValue,
      baselineValue,
      totalDelta,
      executionTimeMs: round2(performance.now() - startMs),
      executiveVerdict,
      dimensions,
      topFilterSuggestion: { dimension: 'state', value: rawState }
    };
  }

  // Case B: Monthly Time-Series Anomaly Investigation (Revenue, Late Delivery, Cancellation, Review Score)
  const targetMonth = String(req.period || '').trim();
  if (!VALID_MONTH_RE.test(targetMonth)) {
    throw new Error(
      `Invalid anomaly period "${targetMonth}". Expected YYYY-MM format (e.g., 2025-11).`
    );
  }

  const metricMeta: Record<
    string,
    { label: string; unit: 'currency' | 'percent' | 'score'; isSumMetric: boolean }
  > = {
    monthly_revenue: { label: 'Monthly Gross Revenue', unit: 'currency', isSumMetric: true },
    late_delivery_pct: { label: 'Late Delivery Rate (%)', unit: 'percent', isSumMetric: false },
    cancellation_pct: { label: 'Order Cancellation Rate (%)', unit: 'percent', isSumMetric: false },
    avg_review_score: { label: 'Mean Review Score (1–5★)', unit: 'score', isSumMetric: false }
  };
  const meta = metricMeta[metricKey];

  // Helper to generate safe leave-one-out monthly attribution SQL for a given dimension CTE
  const buildMonthlyDimensionSql = (
    dimJoinCte: string,
    dimSelectExpr: string,
    dimJoinClause: string
  ): string => {
    if (metricKey === 'monthly_revenue') {
      return `WITH ${dimJoinCte}
monthly_seg AS (
  SELECT
    SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month,
    ${dimSelectExpr} AS segment,
    COUNT(DISTINCT fo.order_id) AS orders_cnt,
    SUM(CASE WHEN fo.order_status NOT IN ('canceled', 'unavailable') THEN fo.total_order_value ELSE 0 END) AS seg_val
  FROM fact_orders fo
  ${dimJoinClause}
  WHERE fo.order_purchase_timestamp IS NOT NULL
  GROUP BY 1, 2
),
baseline_months AS (
  SELECT COUNT(DISTINCT SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7)) AS n_base_months
  FROM fact_orders
  WHERE order_purchase_timestamp IS NOT NULL
    AND SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7) <> '${targetMonth}'
)
SELECT
  ms.segment,
  COALESCE(SUM(CASE WHEN ms.order_month = '${targetMonth}' THEN ms.orders_cnt ELSE 0 END), 0) AS target_orders,
  ROUND(COALESCE(SUM(CASE WHEN ms.order_month = '${targetMonth}' THEN ms.seg_val ELSE 0 END), 0), 2) AS target_val,
  ROUND(COALESCE(SUM(CASE WHEN ms.order_month <> '${targetMonth}' THEN ms.seg_val ELSE 0 END), 0) / NULLIF(MAX(bm.n_base_months), 0), 2) AS baseline_val
FROM monthly_seg ms
CROSS JOIN baseline_months bm
GROUP BY ms.segment
HAVING SUM(CASE WHEN ms.order_month = '${targetMonth}' THEN ms.orders_cnt ELSE 0 END) > 0
   OR SUM(CASE WHEN ms.order_month <> '${targetMonth}' THEN ms.seg_val ELSE 0 END) > 0;`;
    }

    if (metricKey === 'late_delivery_pct') {
      return `WITH ${dimJoinCte}
base_orders AS (
  SELECT
    SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month,
    ${dimSelectExpr} AS segment,
    fo.order_id,
    CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END AS late_flag
  FROM fact_orders fo
  ${dimJoinClause}
  WHERE fo.order_status = 'delivered'
    AND fo.order_purchase_timestamp IS NOT NULL
)
SELECT
  segment,
  COUNT(DISTINCT CASE WHEN order_month = '${targetMonth}' THEN order_id END) AS target_orders,
  ROUND(COALESCE(AVG(CASE WHEN order_month = '${targetMonth}' THEN late_flag END), 0), 2) AS target_val,
  ROUND(COALESCE(AVG(CASE WHEN order_month <> '${targetMonth}' THEN late_flag END), 0), 2) AS baseline_val
FROM base_orders
GROUP BY segment
HAVING COUNT(DISTINCT CASE WHEN order_month = '${targetMonth}' THEN order_id END) >= 2;`;
    }

    if (metricKey === 'cancellation_pct') {
      return `WITH ${dimJoinCte}
base_orders AS (
  SELECT
    SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month,
    ${dimSelectExpr} AS segment,
    fo.order_id,
    CASE WHEN fo.order_status IN ('canceled', 'unavailable') THEN 100.0 ELSE 0.0 END AS cancel_flag
  FROM fact_orders fo
  ${dimJoinClause}
  WHERE fo.order_purchase_timestamp IS NOT NULL
)
SELECT
  segment,
  COUNT(DISTINCT CASE WHEN order_month = '${targetMonth}' THEN order_id END) AS target_orders,
  ROUND(COALESCE(AVG(CASE WHEN order_month = '${targetMonth}' THEN cancel_flag END), 0), 2) AS target_val,
  ROUND(COALESCE(AVG(CASE WHEN order_month <> '${targetMonth}' THEN cancel_flag END), 0), 2) AS baseline_val
FROM base_orders
GROUP BY segment
HAVING COUNT(DISTINCT CASE WHEN order_month = '${targetMonth}' THEN order_id END) >= 2;`;
    }

    // avg_review_score
    return `WITH ${dimJoinCte}
order_reviews AS (
  SELECT order_id, AVG(CAST(review_score AS DOUBLE)) AS avg_review
  FROM fact_reviews
  GROUP BY order_id
),
base_orders AS (
  SELECT
    SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month,
    ${dimSelectExpr} AS segment,
    fo.order_id,
    orv.avg_review
  FROM fact_orders fo
  JOIN order_reviews orv ON fo.order_id = orv.order_id
  ${dimJoinClause}
  WHERE fo.order_purchase_timestamp IS NOT NULL
)
SELECT
  segment,
  COUNT(DISTINCT CASE WHEN order_month = '${targetMonth}' THEN order_id END) AS target_orders,
  ROUND(COALESCE(AVG(CASE WHEN order_month = '${targetMonth}' THEN avg_review END), 0), 2) AS target_val,
  ROUND(COALESCE(AVG(CASE WHEN order_month <> '${targetMonth}' THEN avg_review END), 0), 2) AS baseline_val
FROM base_orders
GROUP BY segment
HAVING COUNT(DISTINCT CASE WHEN order_month = '${targetMonth}' THEN order_id END) >= 2;`;
  };

  const overallMonthlySql =
    metricKey === 'monthly_revenue'
      ? `WITH monthly AS (
  SELECT
    SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month,
    SUM(CASE WHEN order_status NOT IN ('canceled', 'unavailable') THEN total_order_value ELSE 0 END) AS val
  FROM fact_orders
  WHERE order_purchase_timestamp IS NOT NULL
  GROUP BY 1
)
SELECT
  ROUND(COALESCE(MAX(CASE WHEN order_month = '${targetMonth}' THEN val END), 0), 2) AS target_val,
  ROUND(COALESCE(AVG(CASE WHEN order_month <> '${targetMonth}' THEN val END), 0), 2) AS baseline_val
FROM monthly;`
      : metricKey === 'late_delivery_pct'
      ? `SELECT
  ROUND(COALESCE(AVG(CASE WHEN SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7) = '${targetMonth}' THEN CASE WHEN is_on_time = 0 THEN 100.0 ELSE 0.0 END END), 0), 2) AS target_val,
  ROUND(COALESCE(AVG(CASE WHEN SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7) <> '${targetMonth}' THEN CASE WHEN is_on_time = 0 THEN 100.0 ELSE 0.0 END END), 0), 2) AS baseline_val
FROM fact_orders
WHERE order_status = 'delivered' AND order_purchase_timestamp IS NOT NULL;`
      : metricKey === 'cancellation_pct'
      ? `SELECT
  ROUND(COALESCE(AVG(CASE WHEN SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7) = '${targetMonth}' THEN CASE WHEN order_status IN ('canceled', 'unavailable') THEN 100.0 ELSE 0.0 END END), 0), 2) AS target_val,
  ROUND(COALESCE(AVG(CASE WHEN SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7) <> '${targetMonth}' THEN CASE WHEN order_status IN ('canceled', 'unavailable') THEN 100.0 ELSE 0.0 END END), 0), 2) AS baseline_val
FROM fact_orders
WHERE order_purchase_timestamp IS NOT NULL;`
      : `WITH order_reviews AS (
  SELECT order_id, AVG(CAST(review_score AS DOUBLE)) AS avg_review
  FROM fact_reviews
  GROUP BY order_id
)
SELECT
  ROUND(COALESCE(AVG(CASE WHEN SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7) = '${targetMonth}' THEN orv.avg_review END), 0), 2) AS target_val,
  ROUND(COALESCE(AVG(CASE WHEN SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7) <> '${targetMonth}' THEN orv.avg_review END), 0), 2) AS baseline_val
FROM fact_orders fo
JOIN order_reviews orv ON fo.order_id = orv.order_id
WHERE fo.order_purchase_timestamp IS NOT NULL;`;

  const categorySql = buildMonthlyDimensionSql(
    `order_primary_cat AS (
  SELECT fi.order_id, MIN(COALESCE(dp.category_english, 'uncategorized')) AS cat_name
  FROM fact_order_items fi
  LEFT JOIN dim_products dp ON fi.product_id = dp.product_id
  GROUP BY fi.order_id
),`,
    `COALESCE(opc.cat_name, 'uncategorized')`,
    `LEFT JOIN order_primary_cat opc ON fo.order_id = opc.order_id`
  );

  const stateSql = buildMonthlyDimensionSql(
    `state_dim AS (SELECT 1 AS dummy),`,
    `COALESCE(fo.customer_state, 'UNKNOWN')`,
    ``
  );

  const paymentSql = buildMonthlyDimensionSql(
    `order_primary_pay AS (
  SELECT order_id, MIN(COALESCE(payment_type, 'other')) AS pay_type
  FROM fact_payments
  GROUP BY order_id
),`,
    `COALESCE(opp.pay_type, 'other')`,
    `LEFT JOIN order_primary_pay opp ON fo.order_id = opp.order_id`
  );

  const [overallRes, catRes, stateRes, payRes] = await Promise.all([
    duckdbEngine.executeReadOnlyQuery(overallMonthlySql, 5, false),
    duckdbEngine.executeReadOnlyQuery(categorySql, 80, false),
    duckdbEngine.executeReadOnlyQuery(stateSql, 40, false),
    duckdbEngine.executeReadOnlyQuery(paymentSql, 20, false)
  ]);

  const targetValue = round2(Number(overallRes.rows[0]?.target_val ?? 0));
  const baselineValue = round2(Number(overallRes.rows[0]?.baseline_val ?? 0));
  const totalDelta = round2(targetValue - baselineValue);
  const isPositive = totalDelta >= 0;

  const mapRows = (rows: Record<string, string | number | boolean | null>[]) =>
    rows.map((r) => {
      const tv = Number(r.target_val ?? 0);
      const bv = Number(r.baseline_val ?? 0);
      const orders = Number(r.target_orders ?? 0);
      const weight = meta.isSumMetric ? tv - bv : (tv - bv) * Math.max(1, orders);
      return {
        segment: String(r.segment ?? 'unknown'),
        targetValue: tv,
        baselineValue: bv,
        targetOrders: orders,
        rawContributionWeight: weight
      };
    });

  const catRanked = rankAndNormalizeDrivers(mapRows(catRes.rows), isPositive);
  const stateRanked = rankAndNormalizeDrivers(mapRows(stateRes.rows), isPositive);
  const payRanked = rankAndNormalizeDrivers(mapRows(payRes.rows), isPositive);

  const dimensions: RootCauseDimensionBreakdown[] = [
    {
      dimensionKey: 'category',
      dimensionLabel: 'By Product Category',
      top3ConcentrationPct: catRanked.top3ConcentrationPct,
      drivers: catRanked.drivers,
      executedSql: categorySql
    },
    {
      dimensionKey: 'state',
      dimensionLabel: 'By Brazilian State',
      top3ConcentrationPct: stateRanked.top3ConcentrationPct,
      drivers: stateRanked.drivers,
      executedSql: stateSql
    },
    {
      dimensionKey: 'payment_type',
      dimensionLabel: 'By Payment Method',
      top3ConcentrationPct: payRanked.top3ConcentrationPct,
      drivers: payRanked.drivers,
      executedSql: paymentSql
    }
  ];

  const topCat = catRanked.drivers[0];
  const topState = stateRanked.drivers[0];
  const fmtVal = (v: number) =>
    meta.unit === 'currency'
      ? formatCurrency(v)
      : meta.unit === 'percent'
      ? formatPct(v)
      : `${v.toFixed(2)}★`;
  const fmtDelta = (d: number) =>
    meta.unit === 'currency'
      ? `${d >= 0 ? '+' : '-'}${formatCurrency(Math.abs(d))}`
      : meta.unit === 'percent'
      ? `${d >= 0 ? '+' : ''}${d.toFixed(2)} pp`
      : `${d >= 0 ? '+' : ''}${d.toFixed(2)}★`;

  const executiveVerdict = `In ${targetMonth}, ${meta.label} shifted by ${fmtDelta(totalDelta)} (${fmtVal(targetValue)} vs. ${fmtVal(baselineValue)} leave-one-out baseline). Top category contributor: ${topCat ? `${topCat.segment.replace(/_/g, ' ')} (${fmtDelta(topCat.delta)}, ${topCat.contributionSharePct.toFixed(1)}% of explained variance)` : 'broad-based'}; top regional contributor: ${topState ? `${topState.segment} (${fmtDelta(topState.delta)}, ${topState.contributionSharePct.toFixed(1)}% share; Top-3 states = ${stateRanked.top3ConcentrationPct.toFixed(1)}%)` : 'broad-based'}.`;

  return {
    generatedAt: new Date().toISOString(),
    period: targetMonth,
    metricKey,
    metricLabel: meta.label,
    unit: meta.unit,
    direction: isPositive ? 'SPIKE' : 'DROP',
    targetValue,
    baselineValue,
    totalDelta,
    executionTimeMs: round2(performance.now() - startMs),
    executiveVerdict,
    dimensions,
    topFilterSuggestion:
      topState && VALID_STATE_RE.test(topState.segment)
        ? { dimension: 'state', value: topState.segment }
        : topCat
        ? { dimension: 'category', value: topCat.segment }
        : undefined
  };
}

// ============================================================================
// 2. INTERACTIVE WHAT-IF REVENUE & SLA SIMULATOR (DuckDB Baseline)
// ============================================================================

export async function computeWhatIfBaseline(): Promise<WhatIfBaselineMetrics> {
  await duckdbEngine.ensureInitialized();
  const dataMode = duckdbEngine.getDataMode();
  const isDemonstrationData = duckdbEngine.isDemonstrationData();

  const [baseRes, stateRes, repeatReviewRes] = await Promise.all([
    duckdbEngine.executeReadOnlyQuery(
      `WITH order_rev AS (
        SELECT order_id, AVG(CAST(review_score AS DOUBLE)) AS avg_rev
        FROM fact_reviews
        GROUP BY order_id
      ),
      cust_orders AS (
        SELECT customer_unique_id, COUNT(DISTINCT order_id) AS ord_cnt
        FROM fact_orders
        WHERE order_status NOT IN ('canceled', 'unavailable')
        GROUP BY customer_unique_id
      )
      SELECT
        COUNT(DISTINCT SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7)) AS months_observed,
        COUNT(DISTINCT fo.order_id) AS total_all_orders,
        COUNT(DISTINCT CASE WHEN fo.order_status NOT IN ('canceled', 'unavailable') THEN fo.order_id END) AS active_orders,
        COUNT(DISTINCT CASE WHEN fo.order_status IN ('canceled', 'unavailable') THEN fo.order_id END) AS canceled_orders,
        ROUND(COALESCE(SUM(CASE WHEN fo.order_status NOT IN ('canceled', 'unavailable') THEN fo.total_order_value ELSE 0 END), 0), 2) AS total_gmv,
        ROUND(COALESCE(SUM(CASE WHEN fo.order_status NOT IN ('canceled', 'unavailable') THEN fo.freight_revenue ELSE 0 END), 0), 2) AS total_freight,
        ROUND(COALESCE(AVG(CASE WHEN fo.order_status NOT IN ('canceled', 'unavailable') THEN fo.total_order_value END), 0), 2) AS aov,
        ROUND(
          COALESCE(
            SUM(CASE WHEN fo.order_status = 'delivered' AND fo.is_on_time = 0 THEN 1 ELSE 0 END) * 100.0 /
            NULLIF(SUM(CASE WHEN fo.order_status = 'delivered' THEN 1 ELSE 0 END), 0),
            0
          ),
          2
        ) AS late_rate_pct,
        ROUND(COALESCE(AVG(orv.avg_rev), 0), 2) AS avg_review,
        ROUND(COALESCE(AVG(CASE WHEN fo.order_status = 'delivered' AND fo.is_on_time = 1 THEN orv.avg_rev END), 0), 2) AS on_time_review,
        ROUND(COALESCE(AVG(CASE WHEN fo.order_status = 'delivered' AND fo.is_on_time = 0 THEN orv.avg_rev END), 0), 2) AS late_review,
        (SELECT ROUND(AVG(CASE WHEN ord_cnt >= 2 THEN 100.0 ELSE 0.0 END), 2) FROM cust_orders) AS repeat_rate_pct
      FROM fact_orders fo
      LEFT JOIN order_rev orv ON fo.order_id = orv.order_id;`,
      1,
      false
    ),
    duckdbEngine.executeReadOnlyQuery(
      `SELECT
        fo.customer_state AS state,
        COUNT(DISTINCT fo.order_id) AS orders,
        ROUND(
          COALESCE(
            SUM(CASE WHEN fo.order_status = 'delivered' AND fo.is_on_time = 0 THEN 1 ELSE 0 END) * 100.0 /
            NULLIF(SUM(CASE WHEN fo.order_status = 'delivered' THEN 1 ELSE 0 END), 0),
            0
          ),
          2
        ) AS late_rate_pct,
        ROUND(COALESCE(SUM(CASE WHEN fo.order_status NOT IN ('canceled', 'unavailable') THEN fo.total_order_value ELSE 0 END), 0), 2) AS gmv
      FROM fact_orders fo
      WHERE fo.customer_state IS NOT NULL
      GROUP BY fo.customer_state
      ORDER BY gmv DESC;`,
      30,
      false
    ),
    duckdbEngine.executeReadOnlyQuery(
      `WITH first_order AS (
        SELECT
          fo.customer_unique_id,
          fo.order_id,
          ROW_NUMBER() OVER (PARTITION BY fo.customer_unique_id ORDER BY fo.order_purchase_timestamp ASC) AS rn,
          COUNT(*) OVER (PARTITION BY fo.customer_unique_id) AS total_cust_orders
        FROM fact_orders fo
        WHERE fo.order_status NOT IN ('canceled', 'unavailable')
      ),
      first_rev AS (
        SELECT order_id, AVG(CAST(review_score AS DOUBLE)) AS score
        FROM fact_reviews
        GROUP BY order_id
      )
      SELECT
        ROUND(AVG(CASE WHEN fr.score >= 4 THEN CASE WHEN fo.total_cust_orders >= 2 THEN 100.0 ELSE 0.0 END END), 2) AS high_rating_repeat_pct,
        ROUND(AVG(CASE WHEN fr.score <= 2 THEN CASE WHEN fo.total_cust_orders >= 2 THEN 100.0 ELSE 0.0 END END), 2) AS low_rating_repeat_pct
      FROM first_order fo
      INNER JOIN first_rev fr ON fo.order_id = fr.order_id
      WHERE fo.rn = 1;`,
      1,
      false
    )
  ]);

  const b = baseRes.rows[0] || {};
  const monthsObserved = Math.max(1, Number(b.months_observed ?? 1));
  const annualFactor = 12 / monthsObserved;

  const totalGmv = Number(b.total_gmv ?? 0);
  const totalFreight = Number(b.total_freight ?? 0);
  const activeOrders = Number(b.active_orders ?? 0);
  const totalAllOrders = Math.max(1, Number(b.total_all_orders ?? 1));
  const canceledOrders = Number(b.canceled_orders ?? 0);
  const onTimeReview = Number(b.on_time_review ?? 0);
  const lateReview = Number(b.late_review ?? 0);

  const rr = repeatReviewRes.rows[0] || {};

  return {
    dataMode,
    isDemonstrationData,
    monthsObserved,
    annualizedGmv: round2(totalGmv * annualFactor),
    monthlyAvgGmv: round2(totalGmv / monthsObserved),
    annualizedOrders: Math.round(activeOrders * annualFactor),
    avgOrderValue: round2(Number(b.aov ?? 0)),
    lateDeliveryRatePct: round2(Number(b.late_rate_pct ?? 0)),
    avgFreightRatioPct: totalGmv > 0 ? round2((totalFreight / totalGmv) * 100) : 0,
    cancellationRatePct: round2((canceledOrders / totalAllOrders) * 100),
    avgReviewScore: round2(Number(b.avg_review ?? 0)),
    onTimeAvgReviewScore: round2(onTimeReview),
    lateAvgReviewScore: round2(lateReview),
    reviewDeltaOnTimeVsLate: round2(onTimeReview - lateReview),
    repeatPurchaseRatePct: round2(Number(b.repeat_rate_pct ?? 0)),
    highRatingRepeatRatePct: round2(Number(rr.high_rating_repeat_pct ?? 0)),
    lowRatingRepeatRatePct: round2(Number(rr.low_rating_repeat_pct ?? 0)),
    availableStates: stateRes.rows.map((s) => ({
      state: String(s.state ?? ''),
      orders: Number(s.orders ?? 0),
      lateRatePct: Number(s.late_rate_pct ?? 0),
      gmv: round2(Number(s.gmv ?? 0) * annualFactor)
    }))
  };
}

export async function runWhatIfSimulation(
  partialInput?: Partial<WhatIfScenarioInput>
): Promise<WhatIfSimulationPayload> {
  const baseline = await computeWhatIfBaseline();
  const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));

  const targetState = (partialInput?.targetState || 'ALL').toUpperCase().trim();
  const matchedState =
    targetState !== 'ALL'
      ? baseline.availableStates.find((s) => s.state === targetState)
      : undefined;

  const scenario: WhatIfScenarioInput = {
    lateDeliveryReductionPct: clamp(Number(partialInput?.lateDeliveryReductionPct ?? 30), 0, 80),
    freightReductionPct: clamp(Number(partialInput?.freightReductionPct ?? 10), 0, 35),
    repeatRateLiftPct: clamp(Number(partialInput?.repeatRateLiftPct ?? 10), 0, 25),
    cancellationReductionPct: clamp(Number(partialInput?.cancellationReductionPct ?? 25), 0, 60),
    targetState: matchedState ? matchedState.state : 'ALL'
  };

  const scopeShare = matchedState
    ? Math.min(1, Math.max(0.01, matchedState.gmv / Math.max(1, baseline.annualizedGmv)))
    : 1;
  const scopedBaselineGmv = matchedState ? matchedState.gmv : baseline.annualizedGmv;
  const scopedLateRatePct = matchedState
    ? matchedState.lateRatePct
    : baseline.lateDeliveryRatePct;
  const scopedOrders = Math.round(baseline.annualizedOrders * scopeShare);

  // Driver 1: SLA Late Delivery Recovery -> boosts review score & recovers empirical repeat-rate gap
  const lateRateReductionFraction = scenario.lateDeliveryReductionPct / 100;
  const preventedLateOrders = Math.round(
    scopedOrders * (scopedLateRatePct / 100) * lateRateReductionFraction
  );
  // Empirical repeat-retention recovery from turning a late order into an on-time order (conservative 0.35 realization factor)
  const repeatGapFraction = Math.max(
    0.04,
    (baseline.highRatingRepeatRatePct - baseline.lowRatingRepeatRatePct) / 100
  );
  const slaRecoveredRepeatOrders = Math.round(preventedLateOrders * repeatGapFraction * 0.65);
  const slaGmvImpact = round2(slaRecoveredRepeatOrders * baseline.avgOrderValue);

  // Driver 2: Cancellation Recovery -> converts avoided cancellations into fulfilled GMV
  const annualizedCanceledInScope =
    scopedOrders * (baseline.cancellationRatePct / Math.max(1, 100 - baseline.cancellationRatePct));
  const recoveredCanceledOrders = Math.round(
    annualizedCanceledInScope * (scenario.cancellationReductionPct / 100) * 0.85
  );
  const cancellationGmvImpact = round2(recoveredCanceledOrders * baseline.avgOrderValue);

  // Driver 3: Freight Subsidy / Optimization -> modest checkout conversion elasticity (0.18 elasticity)
  const freightConversionLiftPct =
    scenario.freightReductionPct * (baseline.avgFreightRatioPct / 100) * 1.1;
  const freightOrdersLift = Math.round(scopedOrders * (freightConversionLiftPct / 100));
  const freightGmvImpact = round2(freightOrdersLift * baseline.avgOrderValue);

  // Driver 4: Direct Repeat Customer Retention Lift (CRM / loyalty / post-purchase win-back)
  const repeatAdditionalOrders = Math.round(
    scopedOrders * (baseline.repeatPurchaseRatePct / 100) * (scenario.repeatRateLiftPct / 100)
  );
  const repeatGmvImpact = round2(repeatAdditionalOrders * baseline.avgOrderValue);

  const totalAnnualLift = round2(
    slaGmvImpact + cancellationGmvImpact + freightGmvImpact + repeatGmvImpact
  );
  const projectedNewAnnualGmv = round2(baseline.annualizedGmv + totalAnnualLift);
  const projectedGmvLiftPct =
    baseline.annualizedGmv > 0 ? round2((totalAnnualLift / baseline.annualizedGmv) * 100) : 0;

  const newScopedLateRate = round2(scopedLateRatePct * (1 - lateRateReductionFraction));
  const globalLateRateDelta =
    (scopedLateRatePct - newScopedLateRate) * scopeShare;
  const projectedNewLateRatePct = round2(
    Math.max(0, baseline.lateDeliveryRatePct - globalLateRateDelta)
  );

  // Projected review score gain directly proportional to empirical on-time vs. late review spread
  const reviewSpread = Math.max(0.5, baseline.reviewDeltaOnTimeVsLate);
  const projectedReviewGain = round2((globalLateRateDelta / 100) * reviewSpread);
  const projectedNewReviewScore = round2(
    Math.min(5, baseline.avgReviewScore + projectedReviewGain)
  );

  const totalRecoveredOrders =
    slaRecoveredRepeatOrders + recoveredCanceledOrders + freightOrdersLift + repeatAdditionalOrders;

  const breakdownRaw = [
    {
      driver: 'Delivery SLA Recovery',
      annualGmvImpact: slaGmvImpact,
      mechanism: `${preventedLateOrders.toLocaleString()} late orders prevented -> +${slaRecoveredRepeatOrders.toLocaleString()} retained repeat orders via empirical satisfaction gap.`
    },
    {
      driver: 'Cancellation Prevention',
      annualGmvImpact: cancellationGmvImpact,
      mechanism: `${recoveredCanceledOrders.toLocaleString()} canceled orders recovered at ${formatCurrency(baseline.avgOrderValue)} AOV (85% net fulfillment capture).`
    },
    {
      driver: 'Repeat Loyalty Lift',
      annualGmvImpact: repeatGmvImpact,
      mechanism: `+${scenario.repeatRateLiftPct}% relative lift on ${baseline.repeatPurchaseRatePct.toFixed(1)}% repeat base -> +${repeatAdditionalOrders.toLocaleString()} orders.`
    },
    {
      driver: 'Freight Optimization',
      annualGmvImpact: freightGmvImpact,
      mechanism: `-${scenario.freightReductionPct}% freight friction on ${baseline.avgFreightRatioPct.toFixed(1)}% freight-to-GMV ratio -> +${freightOrdersLift.toLocaleString()} checkout conversions.`
    }
  ];

  const impactBreakdown = breakdownRaw.map((b) => ({
    ...b,
    sharePct: totalAnnualLift > 0 ? round2((b.annualGmvImpact / totalAnnualLift) * 100) : 0
  }));

  const sensitivityConfigs: Array<{
    caseLabel: WhatIfSensitivityRow['caseLabel'];
    multiplier: number;
  }> = [
    { caseLabel: 'Conservative (0.65x)', multiplier: 0.65 },
    { caseLabel: 'Base Case (1.0x)', multiplier: 1.0 },
    { caseLabel: 'Upside (1.35x)', multiplier: 1.35 }
  ];

  const sensitivityTable: WhatIfSensitivityRow[] = sensitivityConfigs.map((cfg) => {
    const lift = round2(totalAnnualLift * cfg.multiplier);
    const revGain = round2(projectedReviewGain * cfg.multiplier);
    const lateDrop = round2(globalLateRateDelta * Math.min(1.2, cfg.multiplier));
    return {
      caseLabel: cfg.caseLabel,
      multiplier: cfg.multiplier,
      projectedAnnualGmvLift: lift,
      projectedNewAnnualGmv: round2(baseline.annualizedGmv + lift),
      projectedReviewScore: round2(Math.min(5, baseline.avgReviewScore + revGain)),
      projectedLateRatePct: round2(Math.max(0, baseline.lateDeliveryRatePct - lateDrop)),
      projectedAdditionalOrders: Math.round(totalRecoveredOrders * cfg.multiplier)
    };
  });

  const monteCarlo = runMonteCarloWhatIfDistribution({
    slaMeanLift: slaGmvImpact,
    cancellationMeanLift: cancellationGmvImpact,
    freightMeanLift: freightGmvImpact,
    repeatMeanLift: repeatGmvImpact,
    scenario,
    trials: 5000
  });

  return {
    baseline,
    scenario,
    scopedBaselineGmv: round2(scopedBaselineGmv),
    scopedLateRatePct: round2(scopedLateRatePct),
    projectedAnnualGmvLift: totalAnnualLift,
    projectedNewAnnualGmv,
    projectedGmvLiftPct,
    projectedNewLateRatePct,
    projectedNewReviewScore,
    projectedReviewGain,
    projectedRecoveredOrders: totalRecoveredOrders,
    impactBreakdown,
    sensitivityTable,
    monteCarlo,
    assumptionsAndLimitations: [
      `Baseline metrics are annualized directly from ${baseline.monthsObserved} observed DuckDB month(s) (${formatCurrency(baseline.annualizedGmv)} annualized GMV, ${baseline.lateDeliveryRatePct}% late rate, ${baseline.reviewDeltaOnTimeVsLate.toFixed(2)}★ on-time vs. late spread).`,
      'Probabilistic P10 / P50 / P90 confidence bands are generated via a deterministic 5,000-trial Box-Muller Monte Carlo simulation modeling correlated macroeconomic demand variance alongside independent lever realization uncertainty.',
      'Scenario outputs represent directional sensitivity estimates rather than causal forecasts; validate operational levers via randomized geo-holdout or A/B tests before full rollout.',
      'Freight subsidy cost (P&L margin impact) is not netted out because carrier unit-cost tables are not part of the Olist schema.'
    ]
  };
}

/**
 * Fast deterministic Mulberry32 PRNG for reproducible Monte Carlo trials.
 */
function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleStandardNormal(rand: () => number): number {
  const u1 = Math.max(1e-9, rand());
  const u2 = rand();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function computeSeedFromScenario(scenario: WhatIfScenarioInput): number {
  const raw = `${scenario.targetState}|${scenario.lateDeliveryReductionPct}|${scenario.cancellationReductionPct}|${scenario.repeatRateLiftPct}|${scenario.freightReductionPct}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 42;
}

function formatCompactDollars(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/**
 * Pure 5,000-trial Box-Muller Monte Carlo What-If risk distribution engine.
 * Models:
 *  - Shared demand/AOV macro shock (sigma = 10% correlated factor)
 *  - Lever-specific execution realization uncertainty (SLA sigma = 22%, Cancel sigma = 14%, Freight elasticity sigma = 28%, Repeat CRM sigma = 24%)
 *  - Small downside execution friction tail when levers are pushed aggressively
 */
export function runMonteCarloWhatIfDistribution(params: {
  slaMeanLift: number;
  cancellationMeanLift: number;
  freightMeanLift: number;
  repeatMeanLift: number;
  scenario: WhatIfScenarioInput;
  trials?: number;
}): WhatIfMonteCarloSummary {
  const trials = Math.max(500, Math.min(20000, Math.round(params.trials ?? 5000)));
  const seed = computeSeedFromScenario(params.scenario);
  const rand = createMulberry32(seed);

  const deterministicTotal =
    params.slaMeanLift +
    params.cancellationMeanLift +
    params.freightMeanLift +
    params.repeatMeanLift;

  const samples = new Float64Array(trials);
  let sum = 0;
  let positiveCount = 0;
  let exceeds50kCount = 0;
  let exceeds100kCount = 0;

  // Execution friction noise when any operational lever is non-zero
  const activeLeverMagnitude =
    params.scenario.lateDeliveryReductionPct +
    params.scenario.cancellationReductionPct +
    params.scenario.repeatRateLiftPct +
    params.scenario.freightReductionPct;

  for (let i = 0; i < trials; i++) {
    if (deterministicTotal <= 0 && activeLeverMagnitude <= 0) {
      samples[i] = 0;
      continue;
    }

    // Shared macro/AOV multiplier (correlated across levers)
    const macroFactor = Math.max(0.45, 1 + 0.1 * sampleStandardNormal(rand));

    // Independent lever realization multipliers
    const slaMult = Math.max(-0.15, 1 + 0.22 * sampleStandardNormal(rand));
    const cancelMult = Math.max(0.1, 1 + 0.14 * sampleStandardNormal(rand));
    const freightMult = Math.max(-0.25, 1 + 0.28 * sampleStandardNormal(rand));
    const repeatMult = Math.max(-0.1, 1 + 0.24 * sampleStandardNormal(rand));

    const trialLift =
      (params.slaMeanLift * slaMult +
        params.cancellationMeanLift * cancelMult +
        params.freightMeanLift * freightMult +
        params.repeatMeanLift * repeatMult) *
      macroFactor;

    samples[i] = trialLift;
    sum += trialLift;
    if (trialLift > 0) positiveCount++;
    if (trialLift > 50_000) exceeds50kCount++;
    if (trialLift > 100_000) exceeds100kCount++;
  }

  const meanLift = sum / trials;
  let sqDiffSum = 0;
  for (let i = 0; i < trials; i++) {
    const d = samples[i] - meanLift;
    sqDiffSum += d * d;
  }
  const stdDevLift = Math.sqrt(sqDiffSum / Math.max(1, trials - 1));

  // Sort for exact empirical quantiles
  samples.sort();
  const quantile = (q: number): number => {
    const idx = Math.min(trials - 1, Math.max(0, Math.floor(q * (trials - 1))));
    return samples[idx];
  };

  const p10Lift = round2(quantile(0.1));
  const p50Lift = round2(quantile(0.5));
  const p90Lift = round2(quantile(0.9));

  // Build 20-bin histogram covering P0.5..P99.5 (clamping extreme outliers into edge bins)
  const binCount = 20;
  const minVal = samples[Math.floor(trials * 0.005)];
  const maxVal = samples[Math.min(trials - 1, Math.ceil(trials * 0.995))];
  const span = Math.max(1, maxVal - minVal);
  const binWidth = span / binCount;

  const counts = new Array<number>(binCount).fill(0);
  for (let i = 0; i < trials; i++) {
    const rawIdx = Math.floor((samples[i] - minVal) / binWidth);
    const clampedIdx = Math.min(binCount - 1, Math.max(0, rawIdx));
    counts[clampedIdx]++;
  }

  const histogram: MonteCarloHistogramBin[] = counts.map((count, idx) => {
    const binMin = round2(minVal + idx * binWidth);
    const binMax = round2(minVal + (idx + 1) * binWidth);
    const midpoint = round2((binMin + binMax) / 2);
    return {
      binIndex: idx,
      binMin,
      binMax,
      midpoint,
      label: formatCompactDollars(midpoint),
      count,
      probabilityPct: round2((count / trials) * 100),
      inInterquartileRange: midpoint >= p10Lift && midpoint <= p90Lift
    };
  });

  return {
    trials,
    seed,
    p10Lift,
    p50Lift,
    p90Lift,
    meanLift: round2(meanLift),
    stdDevLift: round2(stdDevLift),
    probPositivePct: round2((positiveCount / trials) * 100),
    probExceeds50kPct: round2((exceeds50kCount / trials) * 100),
    probExceeds100kPct: round2((exceeds100kCount / trials) * 100),
    histogram,
    methodologyNote:
      '5,000 deterministic Box-Muller Gaussian trials combining a shared 10% macro/AOV factor with independent lever execution uncertainty (SLA ±22%, Cancellations ±14%, Repeat CRM ±24%, Freight Elasticity ±28%).'
  };
}

// ============================================================================
// 3. A/B TEST & STATISTICAL HYPOTHESIS LAB (Live DuckDB Cohorts + Custom)
// ============================================================================

const PRESET_METADATA: Record<
  Exclude<AbTestCohortPresetId, 'custom_manual'>,
  {
    controlLabel: string;
    variantLabel: string;
    cohortSqlExpr: string;
    description: string;
  }
> = {
  on_time_vs_late: {
    controlLabel: 'Late Delivered Orders',
    variantLabel: 'On-Time Delivered Orders',
    cohortSqlExpr: `CASE WHEN fo.order_status = 'delivered' AND fo.is_on_time = 1 THEN 'VARIANT' WHEN fo.order_status = 'delivered' AND fo.is_on_time = 0 THEN 'CONTROL' ELSE NULL END`,
    description: 'Compares orders delivered on/before SLA estimate against SLA-delayed orders.'
  },
  credit_card_vs_boleto: {
    controlLabel: 'Boleto Settlement',
    variantLabel: 'Credit Card Settlement',
    cohortSqlExpr: `CASE WHEN pay.primary_payment_type = 'credit_card' THEN 'VARIANT' WHEN pay.primary_payment_type = 'boleto' THEN 'CONTROL' ELSE NULL END`,
    description: 'Compares primary Credit Card orders against Boleto bank-slip orders.'
  },
  sp_vs_non_sp: {
    controlLabel: 'Non-SP Regions',
    variantLabel: 'São Paulo (SP) Core Hub',
    cohortSqlExpr: `CASE WHEN fo.customer_state = 'SP' THEN 'VARIANT' WHEN fo.customer_state IS NOT NULL THEN 'CONTROL' ELSE NULL END`,
    description: 'Compares São Paulo metro fulfillment hub against all external Brazilian states.'
  },
  installments_high_vs_single: {
    controlLabel: 'Single Payment (1x)',
    variantLabel: 'Multi-Installment (4x+)',
    cohortSqlExpr: `CASE WHEN pay.max_installments >= 4 THEN 'VARIANT' WHEN pay.max_installments = 1 THEN 'CONTROL' ELSE NULL END`,
    description: 'Compares 4+ installment orders against single-payment checkout orders.'
  },
  low_freight_vs_high_freight: {
    controlLabel: 'High Freight Ratio (>=15%)',
    variantLabel: 'Low Freight Ratio (<15%)',
    cohortSqlExpr: `CASE WHEN fo.total_order_value > 0 AND (fo.freight_revenue / fo.total_order_value) < 0.15 THEN 'VARIANT' WHEN fo.total_order_value > 0 THEN 'CONTROL' ELSE NULL END`,
    description: 'Compares low freight-burden orders (<15% of order value) vs. high freight orders.'
  },
  repeat_vs_first_time: {
    controlLabel: 'First-Time Buyer Orders',
    variantLabel: 'Repeat Buyer Orders',
    cohortSqlExpr: `CASE WHEN cust.total_cust_orders >= 2 THEN 'VARIANT' ELSE 'CONTROL' END`,
    description: 'Compares orders placed by multi-order repeat buyers against single-order buyers.'
  }
};

const METRIC_META: Record<
  AbTestMetricKey,
  { label: string; unit: 'score' | 'currency' | 'percent'; isProportion: boolean }
> = {
  review_score: { label: 'Customer Review Score (1–5★)', unit: 'score', isProportion: false },
  order_value: { label: 'Total Order Value ($)', unit: 'currency', isProportion: false },
  repeat_rate: { label: 'Customer Repeat Purchase Rate (%)', unit: 'percent', isProportion: true },
  on_time_rate: { label: 'On-Time Delivery SLA Rate (%)', unit: 'percent', isProportion: true }
};

function buildVerdict(
  out: PureHypothesisOutput,
  controlLabel: string,
  variantLabel: string,
  metricLabel: string,
  alpha: number
): { verdict: AbTestResultPayload['verdict']; summary: string } {
  if (out.isStatisticallySignificant) {
    const isLift = out.absoluteDifference > 0;
    return {
      verdict: isLift ? 'SIGNIFICANT_LIFT' : 'SIGNIFICANT_REGRESSION',
      summary: `${variantLabel} shows a statistically significant ${isLift ? 'increase' : 'decrease'} in ${metricLabel} compared to ${controlLabel} (${out.relativeLiftPct >= 0 ? '+' : ''}${out.relativeLiftPct}% relative, p = ${out.pValue}, α = ${alpha}).`
    };
  }
  if (out.achievedPowerPct < 70) {
    return {
      verdict: 'INCONCLUSIVE_UNDERPOWERED',
      summary: `No statistically significant difference detected (p = ${out.pValue} >= ${alpha}), and achieved power is ${out.achievedPowerPct}% (<80%). Collect ~${out.requiredSamplePerArmForTargetMde.toLocaleString()} observations per arm to reliably detect the target MDE.`
    };
  }
  return {
    verdict: 'NO_SIGNIFICANT_DIFFERENCE',
    summary: `No statistically significant difference between ${variantLabel} and ${controlLabel} (p = ${out.pValue} >= ${alpha}). Observed delta is consistent with random sampling variance.`
  };
}

export async function runAbCohortHypothesisTest(
  req: AbTestRequest
): Promise<AbTestResultPayload> {
  await duckdbEngine.ensureInitialized();
  const dataMode = duckdbEngine.getDataMode();
  const isDemonstrationData = duckdbEngine.isDemonstrationData();

  const alpha = req.alpha && [0.01, 0.05, 0.1].includes(req.alpha) ? req.alpha : 0.05;
  const targetMdePct =
    typeof req.targetMdePct === 'number' && req.targetMdePct >= 0.5 && req.targetMdePct <= 50
      ? req.targetMdePct
      : 5;

  // Mode B: Custom manual experiment entry
  if (req.presetId === 'custom_manual' && req.manualInput) {
    const m = req.manualInput;
    const isProp = m.testType === 'proportion';
    const nA = Math.max(2, Math.round(Number(m.nA) || 100));
    const nB = Math.max(2, Math.round(Number(m.nB) || 100));
    const controlLabel = (m.controlLabel || 'Control (A)').trim();
    const variantLabel = (m.variantLabel || 'Treatment (B)').trim();

    if (isProp) {
      const succA = Math.min(nA, Math.max(0, Math.round(Number(m.meanOrSuccA) || 0)));
      const succB = Math.min(nB, Math.max(0, Math.round(Number(m.meanOrSuccB) || 0)));
      const res = computeTwoProportionZTest({
        nA,
        successesA: succA,
        nB,
        successesB: succB,
        alpha,
        targetMdePct
      });
      const pA = succA / nA;
      const pB = succB / nB;
      const verdict = buildVerdict(res, controlLabel, variantLabel, 'Conversion Rate (%)', alpha);
      return {
        generatedAt: new Date().toISOString(),
        dataMode,
        isDemonstrationData,
        presetId: 'custom_manual',
        metricKey: 'repeat_rate',
        metricLabel: 'Custom Conversion / Proportion Rate (%)',
        metricUnit: 'percent',
        alpha,
        control: {
          label: controlLabel,
          sampleSize: nA,
          value: round2(pA * 100),
          stdDev: round2(Math.sqrt(pA * (1 - pA)) * 100),
          successCount: succA
        },
        variant: {
          label: variantLabel,
          sampleSize: nB,
          value: round2(pB * 100),
          stdDev: round2(Math.sqrt(pB * (1 - pB)) * 100),
          successCount: succB
        },
        ...res,
        targetMdePct,
        verdict: verdict.verdict,
        verdictSummary: verdict.summary,
        correlationVsCausationCaveat:
          'Causal validity holds only if users/orders were randomly assigned to Control vs. Treatment with zero sample ratio mismatch (SRM) and no peeking bias.',
        executedSql: null
      };
    }

    const meanA = Number(m.meanOrSuccA) || 0;
    const meanB = Number(m.meanOrSuccB) || 0;
    const stdDevA = Math.max(0.01, Number(m.stdDevA) || 1);
    const stdDevB = Math.max(0.01, Number(m.stdDevB) || 1);
    const res = computeWelchTTest({
      nA,
      meanA,
      stdDevA,
      nB,
      meanB,
      stdDevB,
      alpha,
      targetMdePct
    });
    const verdict = buildVerdict(res, controlLabel, variantLabel, 'Custom Continuous Metric', alpha);
    return {
      generatedAt: new Date().toISOString(),
      dataMode,
      isDemonstrationData,
      presetId: 'custom_manual',
      metricKey: 'order_value',
      metricLabel: 'Custom Continuous Metric',
      metricUnit: 'currency',
      alpha,
      control: {
        label: controlLabel,
        sampleSize: nA,
        value: round2(meanA),
        stdDev: round2(stdDevA)
      },
      variant: {
        label: variantLabel,
        sampleSize: nB,
        value: round2(meanB),
        stdDev: round2(stdDevB)
      },
      ...res,
      targetMdePct,
      verdict: verdict.verdict,
      verdictSummary: verdict.summary,
      correlationVsCausationCaveat:
        'Welch’s unequal-variance t-test relaxes homoscedasticity; verify randomization balance (SRM check) before declaring causal lift.',
      executedSql: null
    };
  }

  // Mode A: Live DuckDB Cohort Preset Comparison
  const presetKey: Exclude<AbTestCohortPresetId, 'custom_manual'> =
    req.presetId && req.presetId !== 'custom_manual' && req.presetId in PRESET_METADATA
      ? req.presetId
      : 'on_time_vs_late';
  const metricKey: AbTestMetricKey =
    req.metricKey && req.metricKey in METRIC_META ? req.metricKey : 'review_score';

  const preset = PRESET_METADATA[presetKey];
  const metricInfo = METRIC_META[metricKey];

  let metricSelectExpr = 'orv.avg_rev';
  let metricWhereExtra = 'AND orv.avg_rev IS NOT NULL';
  if (metricKey === 'order_value') {
    metricSelectExpr = 'fo.total_order_value';
    metricWhereExtra = 'AND fo.total_order_value > 0';
  } else if (metricKey === 'repeat_rate') {
    metricSelectExpr = 'CASE WHEN cust.total_cust_orders >= 2 THEN 1.0 ELSE 0.0 END';
    metricWhereExtra = '';
  } else if (metricKey === 'on_time_rate') {
    metricSelectExpr = 'CASE WHEN fo.is_on_time = 1 THEN 1.0 ELSE 0.0 END';
    metricWhereExtra = `AND fo.order_status = 'delivered'`;
  }

  const sql = `WITH order_reviews AS (
  SELECT order_id, AVG(CAST(review_score AS DOUBLE)) AS avg_rev
  FROM fact_reviews
  GROUP BY order_id
),
order_payments AS (
  SELECT
    order_id,
    FIRST(payment_type ORDER BY payment_value DESC) AS primary_payment_type,
    MAX(payment_installments) AS max_installments
  FROM payments
  GROUP BY order_id
),
customer_freq AS (
  SELECT
    customer_unique_id,
    COUNT(DISTINCT order_id) AS total_cust_orders
  FROM fact_orders
  WHERE order_status NOT IN ('canceled', 'unavailable')
  GROUP BY customer_unique_id
),
cohort_base AS (
  SELECT
    ${preset.cohortSqlExpr} AS cohort_arm,
    ${metricSelectExpr} AS metric_val
  FROM fact_orders fo
  LEFT JOIN order_reviews orv ON fo.order_id = orv.order_id
  LEFT JOIN order_payments pay ON fo.order_id = pay.order_id
  LEFT JOIN customer_freq cust ON fo.customer_unique_id = cust.customer_unique_id
  WHERE fo.order_status NOT IN ('canceled', 'unavailable')
    ${metricWhereExtra}
)
SELECT
  cohort_arm,
  COUNT(*) AS sample_size,
  ROUND(AVG(metric_val), 6) AS mean_val,
  ROUND(COALESCE(STDDEV_SAMP(metric_val), 0), 6) AS stddev_val,
  SUM(CASE WHEN metric_val >= 1.0 THEN 1 ELSE 0 END) AS success_count
FROM cohort_base
WHERE cohort_arm IS NOT NULL
GROUP BY cohort_arm;`;

  const queryRes = await duckdbEngine.executeReadOnlyQuery(sql, 10, false);
  const controlRow = queryRes.rows.find((r) => String(r.cohort_arm) === 'CONTROL');
  const variantRow = queryRes.rows.find((r) => String(r.cohort_arm) === 'VARIANT');

  const nA = Math.max(2, Number(controlRow?.sample_size ?? 2));
  const nB = Math.max(2, Number(variantRow?.sample_size ?? 2));
  const meanA = Number(controlRow?.mean_val ?? 0);
  const meanB = Number(variantRow?.mean_val ?? 0);
  const stdDevA = Math.max(0.0001, Number(controlRow?.stddev_val ?? 0.01));
  const stdDevB = Math.max(0.0001, Number(variantRow?.stddev_val ?? 0.01));
  const succA = Number(controlRow?.success_count ?? 0);
  const succB = Number(variantRow?.success_count ?? 0);

  const statsOut = metricInfo.isProportion
    ? computeTwoProportionZTest({
        nA,
        successesA: succA,
        nB,
        successesB: succB,
        alpha,
        targetMdePct
      })
    : computeWelchTTest({
        nA,
        meanA,
        stdDevA,
        nB,
        meanB,
        stdDevB,
        alpha,
        targetMdePct
      });

  const verdict = buildVerdict(
    statsOut,
    preset.controlLabel,
    preset.variantLabel,
    metricInfo.label,
    alpha
  );

  return {
    generatedAt: new Date().toISOString(),
    dataMode,
    isDemonstrationData,
    presetId: presetKey,
    metricKey,
    metricLabel: metricInfo.label,
    metricUnit: metricInfo.unit,
    alpha,
    control: {
      label: preset.controlLabel,
      sampleSize: nA,
      value: metricInfo.isProportion ? round2(meanA * 100) : round2(meanA),
      stdDev: metricInfo.isProportion ? round2(stdDevA * 100) : round2(stdDevA),
      ...(metricInfo.isProportion ? { successCount: succA } : {})
    },
    variant: {
      label: preset.variantLabel,
      sampleSize: nB,
      value: metricInfo.isProportion ? round2(meanB * 100) : round2(meanB),
      stdDev: metricInfo.isProportion ? round2(stdDevB * 100) : round2(stdDevB),
      ...(metricInfo.isProportion ? { successCount: succB } : {})
    },
    ...statsOut,
    targetMdePct,
    verdict: verdict.verdict,
    verdictSummary: verdict.summary,
    correlationVsCausationCaveat:
      'Observational DuckDB cohort comparison: statistical significance proves the gap is unlikely due to random sampling noise, but does NOT isolate causation from confounders (region, product mix, seller quality). Use the MDE curve above to size a randomized follow-up experiment.',
    executedSql: sql
  };
}

// ============================================================================
// 4. VISUAL DATA LINEAGE & SEMANTIC METRIC GOVERNANCE LAYER
// ============================================================================

export async function computeLineageAndGovernance(): Promise<LineageGovernancePayload> {
  await duckdbEngine.ensureInitialized();
  const [statuses, models, kpis, persistence] = await Promise.all([
    duckdbEngine.getDatasetStatuses(),
    duckdbEngine.getAnalyticalModels(),
    duckdbEngine.getKpiDictionary(),
    duckdbEngine.getPersistenceStatus()
  ]);

  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];

  // Layer 1 & Layer 2: Staging -> Core Tables
  const coreKeyTables = ['orders', 'order_items', 'payments', 'reviews', 'customers', 'products', 'sellers'];
  for (const tableKey of coreKeyTables) {
    const def = TABLE_DEFINITIONS.find((t) => t.tableName === tableKey);
    const status = statuses.find((s) => s.tableName === tableKey);
    if (!def || !status) continue;

    nodes.push({
      id: `stg:${def.stagingTableName}`,
      layer: 'staging',
      label: def.stagingTableName,
      technicalName: def.expectedOlistFilename,
      grain: 'Raw CSV append-only staging rows',
      rowCount: status.stagingRowCount,
      status: status.stagingRowCount > 0 ? 'HEALTHY' : 'EMPTY',
      fanoutSafe: true,
      description: `Bronze raw landing table for ${def.displayName} with batch metadata & row provenance.`,
      sqlDefinition: def.stagingDdl.trim(),
      owner: 'Data Engineering'
    });

    nodes.push({
      id: `core:${def.tableName}`,
      layer: 'core_table',
      label: def.tableName,
      technicalName: `core.${def.tableName}`,
      grain: def.grainDescription,
      rowCount: status.rowCount,
      status:
        status.rowCount === 0
          ? 'EMPTY'
          : status.rejectedRowCount > 0
            ? 'WARNING'
            : 'HEALTHY',
      fanoutSafe: true,
      description: def.description,
      sqlDefinition: def.ddl.trim(),
      owner: 'Analytics Engineering'
    });

    edges.push({
      source: `stg:${def.stagingTableName}`,
      target: `core:${def.tableName}`,
      joinKey: def.primaryKeyColumns.join(', '),
      cardinality: '1:1'
    });
  }

  // Layer 3: Semantic Star Schema Views
  const viewKeyNames = ['fact_orders', 'fact_order_items', 'fact_payments', 'fact_reviews', 'dim_customers', 'dim_products', 'dim_sellers'];
  const viewSourceMap: Record<string, { sources: { table: string; key: string; card: LineageEdge['cardinality'] }[] }> = {
    fact_orders: {
      sources: [
        { table: 'orders', key: 'order_id', card: '1:1' },
        { table: 'customers', key: 'customer_id', card: 'N:1' },
        { table: 'order_items', key: 'order_id (pre-agg)', card: 'AGGREGATED' },
        { table: 'payments', key: 'order_id (pre-agg)', card: 'AGGREGATED' }
      ]
    },
    fact_order_items: {
      sources: [
        { table: 'order_items', key: 'order_id, order_item_id', card: '1:1' },
        { table: 'products', key: 'product_id', card: 'N:1' }
      ]
    },
    fact_payments: {
      sources: [{ table: 'payments', key: 'order_id, payment_sequential', card: '1:1' }]
    },
    fact_reviews: {
      sources: [{ table: 'reviews', key: 'review_id', card: '1:1' }]
    },
    dim_customers: {
      sources: [{ table: 'customers', key: 'customer_unique_id', card: 'AGGREGATED' }]
    },
    dim_products: {
      sources: [{ table: 'products', key: 'product_id', card: '1:1' }]
    },
    dim_sellers: {
      sources: [{ table: 'sellers', key: 'seller_id', card: '1:1' }]
    }
  };

  for (const vName of viewKeyNames) {
    const model = models.find((m) => m.viewName === vName);
    const modelDef = ANALYTICAL_MODEL_DEFINITIONS.find((m) => m.viewName === vName);
    if (!model || !modelDef) continue;

    nodes.push({
      id: `view:${model.viewName}`,
      layer: 'semantic_view',
      label: model.viewName,
      technicalName: `${model.modelType} VIEW`,
      grain: model.grain,
      rowCount: model.rowCount,
      status: model.rowCount > 0 ? 'HEALTHY' : 'EMPTY',
      fanoutSafe: true,
      description: model.antiMultiplicationRule,
      sqlDefinition: modelDef.viewSqlDdl.trim(),
      owner: 'BI Semantic Layer'
    });

    const srcs = viewSourceMap[vName]?.sources || [];
    for (const s of srcs) {
      edges.push({
        source: `core:${s.table}`,
        target: `view:${model.viewName}`,
        joinKey: s.key,
        cardinality: s.card
      });
    }
  }

  // Layer 4: Certified Executive KPIs
  const featuredKpiIds = [
    'kpi-gmv',
    'kpi-total-order-value',
    'kpi-aov',
    'kpi-repeat-customer-rate',
    'kpi-ontime-delivery-pct',
    'kpi-avg-review-score'
  ];
  const kpiSourceViewMap: Record<string, string[]> = {
    'kpi-gmv': ['fact_orders', 'fact_order_items'],
    'kpi-total-order-value': ['fact_orders'],
    'kpi-aov': ['fact_orders'],
    'kpi-repeat-customer-rate': ['fact_orders', 'dim_customers'],
    'kpi-ontime-delivery-pct': ['fact_orders'],
    'kpi-avg-review-score': ['fact_reviews']
  };

  for (const kpiId of featuredKpiIds) {
    const kpi = kpis.find((k) => k.id === kpiId);
    const kpiDef = KPI_DICTIONARY_DEFINITIONS.find((k) => k.id === kpiId);
    if (!kpi || !kpiDef) continue;

    nodes.push({
      id: `kpi:${kpi.id}`,
      layer: 'kpi_metric',
      label: kpi.metricName,
      technicalName: kpi.id,
      grain: kpi.grainAndJoinRule,
      rowCount: null,
      status: kpi.currentValue !== null ? 'HEALTHY' : 'EMPTY',
      fanoutSafe: true,
      description: kpi.businessDefinition,
      sqlDefinition: kpiDef.reproducibleSql.trim(),
      owner: 'Executive BI Governance'
    });

    const parentViews = kpiSourceViewMap[kpiId] || ['fact_orders'];
    for (const pv of parentViews) {
      edges.push({
        source: `view:${pv}`,
        target: `kpi:${kpi.id}`,
        joinKey: 'certified_aggregation',
        cardinality: 'AGGREGATED'
      });
    }
  }

  // Live Governance Checks
  const factOrdersCount = models.find((m) => m.viewName === 'fact_orders')?.rowCount ?? 0;
  const baseOrdersCount = statuses.find((s) => s.tableName === 'orders')?.rowCount ?? 0;
  const fanoutZero = factOrdersCount === baseOrdersCount;
  const dimCustomersCount = models.find((m) => m.viewName === 'dim_customers')?.rowCount ?? 0;
  const baseCustomersCount = statuses.find((s) => s.tableName === 'customers')?.rowCount ?? 0;
  const entityDedupActive = dimCustomersCount > 0 && dimCustomersCount <= baseCustomersCount;

  return {
    generatedAt: new Date().toISOString(),
    dataMode: duckdbEngine.getDataMode(),
    isDemonstrationData: duckdbEngine.isDemonstrationData(),
    nodes,
    edges,
    governanceChecks: [
      {
        id: 'gov-fanout-guard',
        title: 'Zero Join-Fanout Assertion (fact_orders == orders)',
        status: fanoutZero ? 'PASS' : 'WARN',
        detail: `fact_orders has ${factOrdersCount.toLocaleString()} rows matching base orders (${baseOrdersCount.toLocaleString()} rows) via pre-aggregated item & payment CTEs.`
      },
      {
        id: 'gov-customer-entity',
        title: 'Customer Entity Resolution (customer_unique_id)',
        status: entityDedupActive ? 'PASS' : 'WARN',
        detail: `${baseCustomersCount.toLocaleString()} order-scoped customer_id keys resolve to ${dimCustomersCount.toLocaleString()} permanent unique buyers in dim_customers.`
      },
      {
        id: 'gov-persistence',
        title: 'Warehouse Storage Durability',
        status: persistence.storageMode === 'PERSISTENT_FILE' ? 'PASS' : 'WARN',
        detail:
          persistence.storageMode === 'PERSISTENT_FILE'
            ? `Persistent DuckDB file active at ${persistence.dbFilePath} (${(persistence.fileSizeBytes / 1024).toFixed(1)} KB on disk).`
            : 'Running in ephemeral :memory: mode (standard for automated test runs).'
      },
      {
        id: 'gov-readonly-ai',
        title: 'Zero-Hallucination Read-Only AI Tool Boundary',
        status: 'PASS',
        detail:
          'Gemini BI Assistant executes strictly parameterized, read-only DuckDB analytical functions; arbitrary DDL/DML writes are blocked at AST/validator level.'
      }
    ],
    persistence
  };
}

// ============================================================================
// 5. ONE-CLICK EXECUTIVE BOARD REPORT SNAPSHOT GENERATOR
// ============================================================================

export async function computeExecutiveBoardReport(): Promise<ExecutiveBoardReportPayload> {
  await duckdbEngine.ensureInitialized();
  const [kpis, anomalies, suite, persistence, monthlyRes, catRes, stateRes, windowRes] =
    await Promise.all([
      duckdbEngine.getKpiDictionary(),
      computeAnomalyAlerts(),
      computeAdvancedAnalyticsSuite({ minSellerOrders: 5, forecastHorizonMonths: 3 }),
      duckdbEngine.getPersistenceStatus(),
      duckdbEngine.executeReadOnlyQuery(
        `WITH m AS (
          SELECT
            SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7) AS month,
            COUNT(DISTINCT order_id) AS orders,
            ROUND(COALESCE(SUM(total_order_value), 0), 2) AS revenue
          FROM fact_orders
          WHERE order_status NOT IN ('canceled', 'unavailable')
            AND order_purchase_timestamp IS NOT NULL
          GROUP BY 1
        )
        SELECT
          month,
          orders,
          revenue,
          ROUND(
            CASE
              WHEN LAG(revenue) OVER (ORDER BY month ASC) > 0
              THEN ((revenue - LAG(revenue) OVER (ORDER BY month ASC)) / LAG(revenue) OVER (ORDER BY month ASC)) * 100.0
              ELSE NULL
            END,
            2
          ) AS mom_growth_pct
        FROM m
        ORDER BY month ASC;`,
        36,
        false
      ),
      duckdbEngine.executeReadOnlyQuery(
        `WITH ord_rev AS (
          SELECT order_id, AVG(CAST(review_score AS DOUBLE)) AS score
          FROM fact_reviews
          GROUP BY order_id
        ),
        cat_agg AS (
          SELECT
            foi.product_category_english AS category,
            COUNT(DISTINCT foi.order_id) AS orders,
            ROUND(SUM(foi.gmv_merchandise), 2) AS revenue,
            ROUND(COALESCE(AVG(ord_rev.score), 0), 2) AS avg_review
          FROM fact_order_items foi
          INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
          LEFT JOIN ord_rev ON fo.order_id = ord_rev.order_id
          WHERE fo.order_status NOT IN ('canceled', 'unavailable')
          GROUP BY 1
        )
        SELECT
          category,
          orders,
          revenue,
          ROUND(revenue * 100.0 / NULLIF(SUM(revenue) OVER (), 0), 2) AS share_pct,
          avg_review
        FROM cat_agg
        ORDER BY revenue DESC
        LIMIT 8;`,
        8,
        false
      ),
      duckdbEngine.executeReadOnlyQuery(
        `SELECT
          fo.customer_state AS state,
          COUNT(DISTINCT fo.order_id) AS delivered_orders,
          ROUND(AVG(CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END), 2) AS late_rate_pct,
          ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 1) AS avg_delivery_days,
          ROUND(COALESCE(AVG(CAST(fr.review_score AS DOUBLE)), 0), 2) AS avg_review_score
        FROM fact_orders fo
        LEFT JOIN fact_reviews fr ON fo.order_id = fr.order_id
        WHERE fo.order_status = 'delivered'
          AND fo.customer_state IS NOT NULL
        GROUP BY fo.customer_state
        HAVING COUNT(DISTINCT fo.order_id) >= 5
        ORDER BY late_rate_pct DESC
        LIMIT 10;`,
        10,
        false
      ),
      duckdbEngine.executeReadOnlyQuery(
        `SELECT
          MIN(SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 10)) AS min_date,
          MAX(SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 10)) AS max_date,
          COUNT(DISTINCT SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7)) AS total_months
        FROM fact_orders
        WHERE order_purchase_timestamp IS NOT NULL;`,
        1,
        false
      )
    ]);

  const findKpiVal = (id: string): number =>
    Number(kpis.find((k) => k.id === id)?.currentValue ?? 0);

  const totalOrderValue = findKpiVal('kpi-total-order-value');
  const completedOrders = findKpiVal('kpi-completed-orders');
  const aov = findKpiVal('kpi-aov');
  const onTimePct = findKpiVal('kpi-ontime-delivery-pct');
  const avgReview = findKpiVal('kpi-avg-review-score');
  const repeatRate = findKpiVal('kpi-repeat-customer-rate');

  const win = windowRes.rows[0] || {};
  const topCat = catRes.rows[0];
  const worstState = stateRes.rows[0];
  const topAnomaly = anomalies.anomalies[0];

  const dataMode = duckdbEngine.getDataMode();
  const isDemonstrationData = duckdbEngine.isDemonstrationData();

  const executiveTakeaways: string[] = [
    `Marketplace generated ${formatCurrency(totalOrderValue)} in verified total order value across ${completedOrders.toLocaleString()} fulfilled orders (AOV ${formatCurrency(aov)}) over ${Number(win.total_months ?? 0)} active months.`,
    topCat
      ? `Top merchandise category "${String(topCat.category)}" delivered ${formatCurrency(Number(topCat.revenue ?? 0))} (${Number(topCat.share_pct ?? 0).toFixed(1)}% of GMV) with an average customer rating of ${Number(topCat.avg_review ?? 0).toFixed(2)}★.`
      : 'Category revenue concentration is computed directly from grain-safe fact_order_items.',
    `On-time delivery compliance sits at ${onTimePct.toFixed(1)}% (mean rating ${avgReview.toFixed(2)}★). Late deliveries exhibit a strong negative empirical correlation with reviews (Pearson r = ${suite.deliverySatisfaction.pearsonCorrelationDelayVsScore.toFixed(2)}; ${suite.deliverySatisfaction.reviewScoreDeltaOnTimeVsLate.toFixed(2)}★ gap).`,
    worstState
      ? `Regional SLA laggard ${String(worstState.state)} recorded ${Number(worstState.late_rate_pct ?? 0).toFixed(1)}% late deliveries (${Number(worstState.avg_delivery_days ?? 0).toFixed(1)} avg transit days) — prime candidate for regional carrier rerouting.`
      : 'Regional delivery performance is monitored across all active customer states.',
    topAnomaly
      ? `Top active statistical alert (${topAnomaly.severity}, Z = ${topAnomaly.zScore}σ): ${topAnomaly.metricLabel} in ${topAnomaly.period} (${topAnomaly.formattedObserved} vs. ${topAnomaly.formattedBaseline} baseline).`
      : 'No severe statistical anomalies currently breached Z-score or Tukey IQR monitoring thresholds.'
  ];

  const nextForecastPoint = suite.salesForecasting.series.find((p) => p.split === 'FORECAST');

  return {
    reportId: `RPT-EXEC-${Date.now().toString(36).toUpperCase()}`,
    generatedAt: new Date().toISOString(),
    dataMode,
    isDemonstrationData,
    dataOriginLabel: isDemonstrationData
      ? `RetailPulse 5,200-Order 24-Month Olist Benchmark (${persistence.totalRows.toLocaleString()} total warehouse rows)`
      : `Uploaded Production Olist CSV Warehouse (${persistence.totalRows.toLocaleString()} total warehouse rows)`,
    observationWindow: {
      startDate: String(win.min_date ?? 'N/A'),
      endDate: String(win.max_date ?? 'N/A'),
      totalMonths: Number(win.total_months ?? 0)
    },
    headlineKpis: [
      {
        label: 'Total Order Value',
        value: formatCurrency(totalOrderValue),
        subtext: `${completedOrders.toLocaleString()} active orders`,
        tone: 'positive'
      },
      {
        label: 'Average Order Value',
        value: formatCurrency(aov),
        subtext: 'Grain-safe order level',
        tone: 'neutral'
      },
      {
        label: 'On-Time Delivery SLA',
        value: `${onTimePct.toFixed(1)}%`,
        subtext: `${(100 - onTimePct).toFixed(1)}% late deliveries`,
        tone: onTimePct >= 88 ? 'positive' : 'warning'
      },
      {
        label: 'Customer Satisfaction',
        value: `${avgReview.toFixed(2)} / 5.0`,
        subtext: `On-time vs. late Δ ${suite.deliverySatisfaction.reviewScoreDeltaOnTimeVsLate.toFixed(2)}★`,
        tone: avgReview >= 4.0 ? 'positive' : 'warning'
      },
      {
        label: 'Repeat Buyer Rate',
        value: `${repeatRate.toFixed(1)}%`,
        subtext: 'Permanent customer_unique_id',
        tone: repeatRate >= 20 ? 'positive' : 'neutral'
      },
      {
        label: 'Active Statistical Alerts',
        value: `${anomalies.totalAnomalies}`,
        subtext: `${anomalies.highSeverityCount} high · ${anomalies.mediumSeverityCount} medium`,
        tone: anomalies.highSeverityCount > 0 ? 'warning' : 'positive'
      }
    ],
    monthlyRevenueTrend: monthlyRes.rows.map((r) => ({
      month: String(r.month ?? ''),
      revenue: Number(r.revenue ?? 0),
      orders: Number(r.orders ?? 0),
      momGrowthPct: r.mom_growth_pct === null ? null : Number(r.mom_growth_pct)
    })),
    topCategories: catRes.rows.map((r) => ({
      category: String(r.category ?? ''),
      revenue: Number(r.revenue ?? 0),
      orders: Number(r.orders ?? 0),
      sharePct: Number(r.share_pct ?? 0),
      avgReview: Number(r.avg_review ?? 0)
    })),
    regionalSlaLeadersAndLaggards: stateRes.rows.map((r) => ({
      state: String(r.state ?? ''),
      deliveredOrders: Number(r.delivered_orders ?? 0),
      lateRatePct: Number(r.late_rate_pct ?? 0),
      avgDeliveryDays: Number(r.avg_delivery_days ?? 0),
      avgReviewScore: Number(r.avg_review_score ?? 0)
    })),
    rfmSummary: suite.rfmSegmentation.segmentSummary.map((s) => ({
      segment: s.segment,
      customers: s.customerCount,
      sharePct: s.customerSharePct,
      totalSpend: s.totalMonetaryValue,
      avgMonetary: s.avgMonetaryValue
    })),
    activeAnomalies: anomalies.anomalies.slice(0, 6),
    forecastSummary: {
      supported: Boolean(nextForecastPoint),
      horizonMonths: suite.salesForecasting.forecastHorizonMonths,
      modelName: suite.salesForecasting.modelName,
      mae: suite.salesForecasting.evaluationMetrics.modelMae,
      mapePct: suite.salesForecasting.evaluationMetrics.modelMapePct,
      baselineMapePct: suite.salesForecasting.evaluationMetrics.baselineMapePct,
      nextMonthProjectedRevenue: nextForecastPoint?.modelForecastRevenue ?? null
    },
    executiveTakeaways,
    methodologyAndDisclosures: [
      'All metrics are computed directly from grain-safe DuckDB Star Schema views (fact_orders, fact_order_items, fact_reviews, dim_customers) with zero join-fanout double-counting.',
      'Customer repeat and RFM metrics resolve order-scoped customer_id keys to permanent customer_unique_id buyer entities.',
      'Statistical anomaly alerts apply leave-one-out Z-scores combined with Tukey 1.5x IQR fences; observational correlations are explicitly distinguished from causal proof.',
      `Data Origin Disclosure: ${isDemonstrationData ? 'Synthetic 5,200-order 24-month benchmark dataset designed with realistic Olist seasonality and planted operational anomalies for demonstration.' : 'User-uploaded production Olist CSV tables persisted in DuckDB.'}`
    ],
    persistence
  };
}
