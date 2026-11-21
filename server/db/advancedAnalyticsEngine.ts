import {
  AdvancedAnalyticsSuitePayload,
  BusinessOpportunityItem,
  BusinessOpportunityPayload,
  CohortAnalysisPayload,
  CohortRetentionCell,
  CohortRow,
  DeliverySatisfactionGroupRow,
  DeliverySatisfactionPayload,
  RfmAnalysisPayload,
  RfmCustomerRecord,
  RfmSegmentDefinition,
  RfmSegmentName,
  RfmSegmentSummaryRow,
  SalesForecastDataPoint,
  SalesForecastingPayload,
  SellerPerformancePayload,
  SellerPerformanceRow,
  StarScoreComparisonRow
} from '../../src/types/analytics';
import { duckdbEngine } from './duckdbEngine';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round3(n: number): number {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

async function queryRows(
  sql: string,
  limit = 1000
): Promise<Record<string, string | number | boolean | null>[]> {
  const res = await duckdbEngine.executeReadOnlyQuery(sql, limit, false);
  return res.rows;
}

export const RFM_SEGMENT_DEFINITIONS: RfmSegmentDefinition[] = [
  {
    segment: 'Champions',
    scoringRule: 'R >= 4 AND F >= 4 AND M >= 4 (Recent, frequent, high-spend buyers)',
    businessInterpretation:
      'Highest-value repeat buyers who purchased recently, place multiple orders, and generate top-tier GMV.',
    recommendedAction:
      'Prioritize VIP early access to new product launches, loyalty recognition, and high-margin cross-sell bundles without heavy discounting.'
  },
  {
    segment: 'Loyal Customers',
    scoringRule: 'F >= 3 AND R >= 3 (Consistent repeat purchasers not already in Champions)',
    businessInterpretation:
      'Reliable repeat customers with steady purchase cadence and solid lifetime spend across cycles.',
    recommendedAction:
      'Enroll in tiered retention programs, recommend complementary categories, and incentivize referrals.'
  },
  {
    segment: 'Cannot Lose Them',
    scoringRule: 'R <= 2 AND F >= 3 AND M >= 3 (High-value repeat buyers lapsing in recency)',
    businessInterpretation:
      'Historically frequent or high-spend customers who have not placed an order for an extended period.',
    recommendedAction:
      'Trigger immediate executive win-back outreach, audit their last order for delivery/review friction, and offer personalized replenishment incentives.'
  },
  {
    segment: 'At Risk',
    scoringRule: 'R <= 2 AND (F >= 2 OR M >= 3) (Moderately valuable customers showing churn signals)',
    businessInterpretation:
      'Customers with meaningful prior spend or repeat history whose recency window has elapsed past healthy norms.',
    recommendedAction:
      'Deploy targeted reactivation campaigns with category-specific offers before they transition into permanent hibernation.'
  },
  {
    segment: 'Potential Loyalists',
    scoringRule: 'R >= 3 AND (F >= 2 OR M >= 3) (Recent buyers with strong second-order or spend potential)',
    businessInterpretation:
      'Recent customers who have either already made a second purchase or placed a high-ticket initial order.',
    recommendedAction:
      'Send post-purchase onboarding sequences within 21 days to convert them into multi-category Loyal Customers.'
  },
  {
    segment: 'New Customers',
    scoringRule: 'R >= 4 AND F == 1 AND M <= 2 (Recent first-time buyers with entry-level basket)',
    businessInterpretation:
      'Newly acquired single-order customers still in their initial post-delivery evaluation window.',
    recommendedAction:
      'Ensure flawless on-time delivery and follow up with a second-purchase voucher upon confirmed receipt.'
  },
  {
    segment: 'Hibernating',
    scoringRule: 'R <= 3 AND F == 1 AND M <= 2 (Inactive single-order buyers with low lifetime spend)',
    businessInterpretation:
      'Price-sensitive or one-off buyers who ordered once long ago with below-average basket size.',
    recommendedAction:
      'Maintain low-cost automated seasonal triggers; avoid high-CAC paid retargeting spend.'
  }
];

export function computeRfmScoresAndSegment(params: {
  recencyDays: number;
  frequency: number;
  monetaryValue: number;
}): {
  rScore: number;
  fScore: number;
  mScore: number;
  rfmCode: string;
  rfmCompositeScore: number;
  segment: RfmSegmentName;
  segmentRationale: string;
} {
  const { recencyDays, frequency, monetaryValue } = params;

  // Documented deterministic R Score (1 to 5) based on days since last purchase relative to dataset anchor
  let rScore = 1;
  if (recencyDays <= 15) rScore = 5;
  else if (recencyDays <= 35) rScore = 4;
  else if (recencyDays <= 65) rScore = 3;
  else if (recencyDays <= 105) rScore = 2;
  else rScore = 1;

  // Documented deterministic F Score (1 to 5) based on distinct order count per customer_unique_id
  let fScore = 1;
  if (frequency >= 3) fScore = 5;
  else if (frequency === 2 && monetaryValue >= 380) fScore = 4;
  else if (frequency === 2) fScore = 3;
  else if (frequency === 1 && monetaryValue >= 220) fScore = 2;
  else fScore = 1;

  // Documented deterministic M Score (1 to 5) based on lifetime GMV + freight spend
  let mScore = 1;
  if (monetaryValue >= 600) mScore = 5;
  else if (monetaryValue >= 380) mScore = 4;
  else if (monetaryValue >= 220) mScore = 3;
  else if (monetaryValue >= 110) mScore = 2;
  else mScore = 1;

  const rfmCode = `${rScore}${fScore}${mScore}`;
  const rfmCompositeScore = round2(rScore * 0.35 + fScore * 0.35 + mScore * 0.3);

  let segment: RfmSegmentName = 'Hibernating';
  let segmentRationale = '';

  if (rScore >= 4 && fScore >= 4 && mScore >= 4) {
    segment = 'Champions';
    segmentRationale = `High recency (R=${rScore}, ${recencyDays}d), repeat frequency (F=${fScore}, ${frequency} orders), and top spend (M=${mScore}, $${monetaryValue.toFixed(2)}).`;
  } else if (fScore >= 3 && rScore >= 3) {
    segment = 'Loyal Customers';
    segmentRationale = `Active repeat buyer (F=${fScore}, ${frequency} orders) with healthy recency (R=${rScore}, ${recencyDays}d).`;
  } else if (rScore <= 2 && fScore >= 3 && mScore >= 3) {
    segment = 'Cannot Lose Them';
    segmentRationale = `High-value repeat buyer (F=${fScore}, M=${mScore}, $${monetaryValue.toFixed(2)}) with lapsing recency (R=${rScore}, ${recencyDays}d since last order).`;
  } else if (rScore <= 2 && (fScore >= 2 || mScore >= 3)) {
    segment = 'At Risk';
    segmentRationale = `Prior multi-order or high-basket buyer (F=${fScore}, M=${mScore}, $${monetaryValue.toFixed(2)}) inactive for ${recencyDays}d (R=${rScore}).`;
  } else if (rScore >= 3 && (fScore >= 2 || mScore >= 3)) {
    segment = 'Potential Loyalists';
    segmentRationale = `Recent purchaser (R=${rScore}, ${recencyDays}d) with above-average basket or repeat momentum (F=${fScore}, M=${mScore}).`;
  } else if (rScore >= 4 && frequency === 1) {
    segment = 'New Customers';
    segmentRationale = `Recent first-time customer (R=${rScore}, ${recencyDays}d, F=1) in initial onboarding window.`;
  } else {
    segment = 'Hibernating';
    segmentRationale = `Single-order customer inactive for ${recencyDays}d (R=${rScore}, F=${fScore}, M=${mScore}).`;
  }

  return {
    rScore,
    fScore,
    mScore,
    rfmCode,
    rfmCompositeScore,
    segment,
    segmentRationale
  };
}

export function computePearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const denom = Math.sqrt(denX * denY);
  if (denom === 0) return 0;
  return round3(num / denom);
}

export function computeBayesianAdjustedRating(
  orderCountN: number,
  rawRatingR: number,
  platformMeanC: number,
  priorWeightM = 3
): number {
  if (orderCountN <= 0 || rawRatingR <= 0) return round2(platformMeanC);
  const weighted =
    (orderCountN / (orderCountN + priorWeightM)) * rawRatingR +
    (priorWeightM / (orderCountN + priorWeightM)) * platformMeanC;
  return round2(weighted);
}

export function addMonthsToYm(ym: string, offsetMonths: number): string {
  const parts = ym.split('-');
  const year = Number(parts[0] || 2026);
  const month = Number(parts[1] || 1);
  const totalMonths = year * 12 + (month - 1) + offsetMonths;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export function diffMonthsYm(startYm: string, endYm: string): number {
  const [y1, m1] = startYm.split('-').map(Number);
  const [y2, m2] = endYm.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function runChronologicalForecastExperiment(
  historicalSeries: { period: string; revenue: number; orders: number }[],
  forecastHorizonMonths = 3
): {
  trainPeriodsCount: number;
  testPeriodsCount: number;
  modelParameters: {
    alphaLevelSmoothing: number;
    betaTrendSmoothing: number;
    olsSlopePerMonth: number;
    olsIntercept: number;
    residualStdError: number;
  };
  evaluationMetrics: {
    modelMae: number;
    modelMapePct: number;
    baselineMae: number;
    baselineMapePct: number;
    maeImprovementPct: number;
    modelOutperformsBaseline: boolean;
  };
  series: SalesForecastDataPoint[];
} {
  const n = historicalSeries.length;
  if (n === 0) {
    return {
      trainPeriodsCount: 0,
      testPeriodsCount: 0,
      modelParameters: {
        alphaLevelSmoothing: 0.55,
        betaTrendSmoothing: 0.35,
        olsSlopePerMonth: 0,
        olsIntercept: 0,
        residualStdError: 0
      },
      evaluationMetrics: {
        modelMae: 0,
        modelMapePct: 0,
        baselineMae: 0,
        baselineMapePct: 0,
        maeImprovementPct: 0,
        modelOutperformsBaseline: false
      },
      series: []
    };
  }

  // Chronological split: at least 2 test periods when n >= 5, else 1 test period when n >= 3
  const testCount = n >= 5 ? Math.max(2, Math.round(n * 0.3)) : n >= 3 ? 1 : 0;
  const trainCount = Math.max(1, n - testCount);
  const trainSlice = historicalSeries.slice(0, trainCount);

  // 1. Estimate Ordinary Least Squares (OLS) linear trend on Training Set only (t = 0 .. trainCount-1)
  let sumT = 0;
  let sumY = 0;
  let sumTY = 0;
  let sumTT = 0;
  for (let i = 0; i < trainCount; i++) {
    const y = trainSlice[i].revenue;
    sumT += i;
    sumY += y;
    sumTY += i * y;
    sumTT += i * i;
  }
  const denom = trainCount * sumTT - sumT * sumT;
  const rawOlsSlope = denom !== 0 ? (trainCount * sumTY - sumT * sumY) / denom : 0;
  const trainMean = sumY / trainCount;
  const rawOlsIntercept = trainMean - rawOlsSlope * (sumT / trainCount);

  // Calculate coefficient of determination (R^2) on Training Set to adaptively damp noisy slopes
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < trainCount; i++) {
    const y = trainSlice[i].revenue;
    const yHat = rawOlsIntercept + rawOlsSlope * i;
    ssTot += (y - trainMean) * (y - trainMean);
    ssRes += (y - yHat) * (y - yHat);
  }
  const rSquared = ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;
  // Adaptive damping weight: strong linear trend (high R^2) retains full slope; noisy small sample damps slope toward level
  const trendConfidence = Math.pow(rSquared, 1.25);
  const olsSlope = rawOlsSlope * trendConfidence;
  const olsIntercept = trainMean - olsSlope * (sumT / trainCount);

  // 2. Fit Damped Holt Linear Exponential Smoothing on Training Set
  const alpha = 0.55;
  const beta = 0.35;
  let level = trainSlice[0].revenue;
  let trend =
    trainCount > 1
      ? (trainSlice[1].revenue - trainSlice[0].revenue) * trendConfidence
      : olsSlope;

  const trainFitted: number[] = [];
  for (let i = 0; i < trainCount; i++) {
    const actual = trainSlice[i].revenue;
    if (i === 0) {
      trainFitted.push(round2(olsIntercept));
      continue;
    }
    const oneStepPred =
      0.5 * (level + trend) + 0.5 * (olsIntercept + olsSlope * i);
    trainFitted.push(round2(Math.max(0, oneStepPred)));
    const prevLevel = level;
    level = alpha * actual + (1 - alpha) * (level + trend);
    trend =
      (beta * (level - prevLevel) + (1 - beta) * trend) *
      (0.5 + 0.5 * trendConfidence);
  }

  // Compute training residual standard error for 95% prediction intervals
  let sse = 0;
  for (let i = 0; i < trainCount; i++) {
    const err = trainSlice[i].revenue - trainFitted[i];
    sse += err * err;
  }
  const dof = Math.max(1, trainCount - 2);
  const residualStdError = round2(Math.sqrt(sse / dof));

  // 3. Simple Baseline Model: Last-Observation Naive Persistence Baseline from end of Training Set
  const lastTrainValue = trainSlice[trainCount - 1].revenue;

  const series: SalesForecastDataPoint[] = [];
  const testModelAbsErrors: number[] = [];
  const testModelPctErrors: number[] = [];
  const testBaselineAbsErrors: number[] = [];
  const testBaselinePctErrors: number[] = [];

  for (let i = 0; i < n; i++) {
    const item = historicalSeries[i];
    const isTrain = i < trainCount;
    const h = i - (trainCount - 1); // steps ahead from end of training set

    let modelPred: number;
    let baselinePred: number;

    if (isTrain) {
      modelPred = trainFitted[i];
      baselinePred =
        i === 0 ? round2(trainSlice[0].revenue) : round2(trainSlice[i - 1].revenue);
    } else {
      // Out-of-sample Test prediction using ONLY parameters learned on Training set
      const holtProj = level + h * trend;
      const olsProj = olsIntercept + olsSlope * i;
      modelPred = round2(Math.max(0, 0.5 * holtProj + 0.5 * olsProj));
      baselinePred = round2(Math.max(0, lastTrainValue));
    }

    const horizonSpread = isTrain ? 1 : Math.sqrt(Math.max(1, h));
    const margin95 = round2(1.96 * residualStdError * horizonSpread);
    const lowerConfidence95 = round2(Math.max(0, modelPred - margin95));
    const upperConfidence95 = round2(modelPred + margin95);

    const modelAbsErr = round2(Math.abs(item.revenue - modelPred));
    const modelPctErr =
      item.revenue > 0 ? round2((modelAbsErr / item.revenue) * 100) : 0;
    const baseAbsErr = round2(Math.abs(item.revenue - baselinePred));
    const basePctErr =
      item.revenue > 0 ? round2((baseAbsErr / item.revenue) * 100) : 0;

    if (!isTrain) {
      testModelAbsErrors.push(modelAbsErr);
      testModelPctErrors.push(modelPctErr);
      testBaselineAbsErrors.push(baseAbsErr);
      testBaselinePctErrors.push(basePctErr);
    }

    series.push({
      period: item.period,
      periodIndex: i + 1,
      split: isTrain ? 'TRAIN' : 'TEST',
      actualRevenue: round2(item.revenue),
      actualOrders: item.orders,
      modelForecastRevenue: modelPred,
      baselineForecastRevenue: baselinePred,
      lowerConfidence95,
      upperConfidence95,
      modelAbsoluteError: modelAbsErr,
      modelPercentageErrorPct: modelPctErr,
      baselineAbsoluteError: baseAbsErr,
      baselinePercentageErrorPct: basePctErr
    });
  }

  // Forward projection beyond the full observed dataset: refit on full series for forward horizon
  let fullLevel = historicalSeries[0].revenue;
  let fullTrend =
    n > 1
      ? (historicalSeries[n - 1].revenue - historicalSeries[0].revenue) / (n - 1)
      : olsSlope;
  for (let i = 1; i < n; i++) {
    const prevL = fullLevel;
    fullLevel = alpha * historicalSeries[i].revenue + (1 - alpha) * (fullLevel + fullTrend);
    fullTrend = beta * (fullLevel - prevL) + (1 - beta) * fullTrend;
  }
  const fullTrailingMean =
    n >= 2
      ? (historicalSeries[n - 1].revenue + historicalSeries[n - 2].revenue) / 2
      : historicalSeries[n - 1].revenue;

  const lastObservedPeriod = historicalSeries[n - 1].period;
  for (let f = 1; f <= forecastHorizonMonths; f++) {
    const futurePeriod = addMonthsToYm(lastObservedPeriod, f);
    const futureIdx = n - 1 + f;
    const holtFuture = fullLevel + f * fullTrend;
    const olsFuture = olsIntercept + olsSlope * futureIdx;
    // Damped trend factor (0.85^f) prevents unrealistic runaway extrapolation
    const damping = Math.pow(0.88, f);
    const modelFuture = round2(
      Math.max(0, 0.55 * (fullLevel + f * fullTrend * damping) + 0.45 * olsFuture)
    );
    const baselineFuture = round2(Math.max(0, fullTrailingMean));
    const margin95 = round2(1.96 * residualStdError * Math.sqrt(f + 1));

    series.push({
      period: futurePeriod,
      periodIndex: n + f,
      split: 'FORECAST',
      actualRevenue: null,
      actualOrders: null,
      modelForecastRevenue: modelFuture,
      baselineForecastRevenue: baselineFuture,
      lowerConfidence95: round2(Math.max(0, modelFuture - margin95)),
      upperConfidence95: round2(modelFuture + margin95),
      modelAbsoluteError: null,
      modelPercentageErrorPct: null,
      baselineAbsoluteError: null,
      baselinePercentageErrorPct: null
    });
  }

  const avg = (arr: number[]) =>
    arr.length > 0 ? round2(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  const modelMae = avg(testModelAbsErrors);
  const modelMapePct = avg(testModelPctErrors);
  const baselineMae = avg(testBaselineAbsErrors);
  const baselineMapePct = avg(testBaselinePctErrors);
  const maeImprovementPct =
    baselineMae > 0 ? round2(((baselineMae - modelMae) / baselineMae) * 100) : 0;

  return {
    trainPeriodsCount: trainCount,
    testPeriodsCount: testCount,
    modelParameters: {
      alphaLevelSmoothing: alpha,
      betaTrendSmoothing: beta,
      olsSlopePerMonth: round2(olsSlope),
      olsIntercept: round2(olsIntercept),
      residualStdError
    },
    evaluationMetrics: {
      modelMae,
      modelMapePct,
      baselineMae,
      baselineMapePct,
      maeImprovementPct,
      modelOutperformsBaseline: modelMae <= baselineMae
    },
    series
  };
}

// ============================================================================
// MODULE 1: RFM CUSTOMER SEGMENTATION
// ============================================================================
async function computeRfmSegmentation(): Promise<RfmAnalysisPayload> {
  const executedSql = `WITH dataset_anchor AS (
  SELECT MAX(CAST(SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE)) AS max_purchase_date
  FROM fact_orders
  WHERE order_status NOT IN ('canceled', 'unavailable')
),
customer_rfm_base AS (
  SELECT
    fo.customer_unique_id,
    MAX(fo.customer_city) AS customer_city,
    MAX(fo.customer_state) AS customer_state,
    MIN(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10)) AS first_order_date,
    MAX(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10)) AS last_order_date,
    CAST(DATEDIFF(
      'day',
      MAX(CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE)),
      (SELECT max_purchase_date FROM dataset_anchor)
    ) AS INTEGER) AS recency_days,
    COUNT(DISTINCT fo.order_id) AS frequency,
    ROUND(COALESCE(SUM(fo.total_order_value), 0), 2) AS monetary_value
  FROM fact_orders fo
  WHERE fo.order_status NOT IN ('canceled', 'unavailable')
    AND fo.customer_unique_id IS NOT NULL
  GROUP BY fo.customer_unique_id
)
SELECT
  (SELECT CAST(max_purchase_date AS VARCHAR) FROM dataset_anchor) AS anchor_date,
  customer_unique_id,
  customer_city,
  customer_state,
  first_order_date,
  last_order_date,
  recency_days,
  frequency,
  monetary_value
FROM customer_rfm_base
ORDER BY monetary_value DESC, frequency DESC, recency_days ASC;`;

  const rows = await queryRows(executedSql, 10000);
  const anchorDate =
    rows.length > 0 && rows[0].anchor_date ? String(rows[0].anchor_date) : '2026-11-18';

  const customerRecords: RfmCustomerRecord[] = rows.map((r) => {
    const recencyDays = Number(r.recency_days || 0);
    const frequency = Number(r.frequency || 1);
    const monetaryValue = round2(Number(r.monetary_value || 0));
    const scored = computeRfmScoresAndSegment({
      recencyDays,
      frequency,
      monetaryValue
    });

    return {
      customerUniqueId: String(r.customer_unique_id || ''),
      customerCity: String(r.customer_city || ''),
      customerState: String(r.customer_state || ''),
      firstOrderDate: String(r.first_order_date || ''),
      lastOrderDate: String(r.last_order_date || ''),
      recencyDays,
      frequency,
      monetaryValue,
      rScore: scored.rScore,
      fScore: scored.fScore,
      mScore: scored.mScore,
      rfmCode: scored.rfmCode,
      rfmCompositeScore: scored.rfmCompositeScore,
      segment: scored.segment,
      segmentRationale: scored.segmentRationale
    };
  });

  const totalUniqueCustomers = customerRecords.length;
  const totalMonetaryValue = round2(
    customerRecords.reduce((acc, c) => acc + c.monetaryValue, 0)
  );

  const segmentSummary: RfmSegmentSummaryRow[] = RFM_SEGMENT_DEFINITIONS.map((def) => {
    const matching = customerRecords.filter((c) => c.segment === def.segment);
    const count = matching.length;
    const segRevenue = round2(matching.reduce((s, c) => s + c.monetaryValue, 0));
    const avgR =
      count > 0
        ? round2(matching.reduce((s, c) => s + c.recencyDays, 0) / count)
        : 0;
    const avgF =
      count > 0 ? round2(matching.reduce((s, c) => s + c.frequency, 0) / count) : 0;
    const avgM = count > 0 ? round2(segRevenue / count) : 0;

    return {
      segment: def.segment,
      customerCount: count,
      customerSharePct:
        totalUniqueCustomers > 0 ? round2((count / totalUniqueCustomers) * 100) : 0,
      totalMonetaryValue: segRevenue,
      revenueSharePct:
        totalMonetaryValue > 0 ? round2((segRevenue / totalMonetaryValue) * 100) : 0,
      avgRecencyDays: avgR,
      avgFrequency: avgF,
      avgMonetaryValue: avgM,
      scoringRule: def.scoringRule,
      recommendedAction: def.recommendedAction
    };
  });

  return {
    anchorDate,
    totalUniqueCustomers,
    totalMonetaryValue,
    scoringMethodology: {
      recencyFormula:
        'R_days = DATEDIFF(day, MAX(order_purchase_timestamp per customer_unique_id), MAX(dataset_order_purchase_timestamp)). Scored 1-5: 5 (<=15d), 4 (16-35d), 3 (36-65d), 2 (66-105d), 1 (>105d).',
      frequencyFormula:
        'F_count = COUNT(DISTINCT order_id) per customer_unique_id excluding canceled/unavailable orders. Scored 1-5: 5 (>=3 orders), 4 (2 orders & M>=$380), 3 (2 orders), 2 (1 order & M>=$220), 1 (1 order & M<$220).',
      monetaryFormula:
        'M_value = SUM(total_order_value) per customer_unique_id. Scored 1-5: 5 (>=$600), 4 ($380-$599.99), 3 ($220-$379.99), 2 ($110-$219.99), 1 (<$110).',
      scaleExplanation:
        'Composite RFM Index = 0.35*R + 0.35*F + 0.30*M. Segment assignment follows deterministic hierarchical threshold rules over (R, F, M) scores.'
    },
    segmentDefinitions: RFM_SEGMENT_DEFINITIONS,
    segmentSummary,
    customerRecords,
    executedSql
  };
}

// ============================================================================
// MODULE 2: CUSTOMER COHORT ANALYSIS
// ============================================================================
async function computeCohortAnalysis(): Promise<CohortAnalysisPayload> {
  const executedSql = `WITH valid_customer_orders AS (
  SELECT
    fo.customer_unique_id,
    fo.order_id,
    SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month,
    COALESCE(fo.total_order_value, 0) AS order_value
  FROM fact_orders fo
  WHERE fo.order_status NOT IN ('canceled', 'unavailable')
    AND fo.customer_unique_id IS NOT NULL
    AND fo.order_purchase_timestamp IS NOT NULL
),
customer_first_month AS (
  SELECT
    customer_unique_id,
    MIN(order_month) AS cohort_month
  FROM valid_customer_orders
  GROUP BY customer_unique_id
),
cohort_activity AS (
  SELECT
    cfm.cohort_month,
    vco.order_month,
    (CAST(SUBSTR(vco.order_month, 1, 4) AS INTEGER) - CAST(SUBSTR(cfm.cohort_month, 1, 4) AS INTEGER)) * 12 +
    (CAST(SUBSTR(vco.order_month, 6, 2) AS INTEGER) - CAST(SUBSTR(cfm.cohort_month, 6, 2) AS INTEGER)) AS month_offset,
    COUNT(DISTINCT vco.customer_unique_id) AS active_customers,
    ROUND(SUM(vco.order_value), 2) AS period_revenue
  FROM valid_customer_orders vco
  INNER JOIN customer_first_month cfm
    ON vco.customer_unique_id = cfm.customer_unique_id
  GROUP BY cfm.cohort_month, vco.order_month
)
SELECT
  cohort_month,
  order_month,
  month_offset,
  active_customers,
  period_revenue
FROM cohort_activity
ORDER BY cohort_month ASC, month_offset ASC;`;

  const repeatSummarySql = `WITH customer_counts AS (
  SELECT
    customer_unique_id,
    MIN(SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7)) AS cohort_month,
    COUNT(DISTINCT order_id) AS order_count
  FROM fact_orders
  WHERE order_status NOT IN ('canceled', 'unavailable')
    AND customer_unique_id IS NOT NULL
  GROUP BY customer_unique_id
)
SELECT
  cohort_month,
  COUNT(*) AS cohort_size,
  SUM(CASE WHEN order_count > 1 THEN 1 ELSE 0 END) AS repeat_customers
FROM customer_counts
GROUP BY cohort_month
ORDER BY cohort_month ASC;`;

  const [activityRows, repeatRows] = await Promise.all([
    queryRows(executedSql, 1000),
    queryRows(repeatSummarySql, 200)
  ]);

  const allMonths = Array.from(
    new Set([
      ...activityRows.map((r) => String(r.cohort_month || '')),
      ...activityRows.map((r) => String(r.order_month || ''))
    ])
  )
    .filter(Boolean)
    .sort();

  const datasetStartMonth = allMonths[0] || '2026-06';
  const datasetEndMonth = allMonths[allMonths.length - 1] || '2026-11';
  const maxMonthOffset = Math.max(0, diffMonthsYm(datasetStartMonth, datasetEndMonth));

  const repeatMap = new Map<string, { cohortSize: number; repeatCustomers: number }>();
  let totalCustomers = 0;
  let totalRepeatCustomers = 0;
  for (const r of repeatRows) {
    const cm = String(r.cohort_month || '');
    const cs = Number(r.cohort_size || 0);
    const rc = Number(r.repeat_customers || 0);
    repeatMap.set(cm, { cohortSize: cs, repeatCustomers: rc });
    totalCustomers += cs;
    totalRepeatCustomers += rc;
  }

  const cohortMonths = Array.from(
    new Set(activityRows.map((r) => String(r.cohort_month || '')).filter(Boolean))
  ).sort();

  const cohorts: CohortRow[] = cohortMonths.map((cohortMonth) => {
    const cohortActivity = activityRows.filter(
      (r) => String(r.cohort_month) === cohortMonth
    );
    const m0Row = cohortActivity.find((r) => Number(r.month_offset) === 0);
    const cohortSize =
      repeatMap.get(cohortMonth)?.cohortSize ?? Number(m0Row?.active_customers || 0);
    const initialCohortRevenue = round2(Number(m0Row?.period_revenue || 0));
    const maxObservableOffset = Math.max(0, diffMonthsYm(cohortMonth, datasetEndMonth));
    const repeatCustomers = repeatMap.get(cohortMonth)?.repeatCustomers ?? 0;

    const cells: CohortRetentionCell[] = [];
    for (let offset = 0; offset <= maxMonthOffset; offset++) {
      const targetMonth = addMonthsToYm(cohortMonth, offset);
      const isObserved = offset <= maxObservableOffset;
      const cellRow = cohortActivity.find((r) => Number(r.month_offset) === offset);
      const activeCustomers = isObserved ? Number(cellRow?.active_customers || 0) : 0;
      const periodRevenue = isObserved ? round2(Number(cellRow?.period_revenue || 0)) : 0;
      const retentionPct =
        isObserved && cohortSize > 0
          ? round2((activeCustomers / cohortSize) * 100)
          : 0;

      cells.push({
        monthOffset: offset,
        targetMonth,
        activeCustomers,
        retentionPct,
        periodRevenue,
        isObserved
      });
    }

    return {
      cohortMonth,
      cohortSize,
      initialCohortRevenue,
      maxObservableOffset,
      cumulativeRepeatCustomers: repeatCustomers,
      cumulativeRepeatRatePct:
        cohortSize > 0 ? round2((repeatCustomers / cohortSize) * 100) : 0,
      cells
    };
  });

  return {
    datasetStartMonth,
    datasetEndMonth,
    totalCohorts: cohorts.length,
    maxMonthOffset,
    overallRepeatCustomerRatePct:
      totalCustomers > 0 ? round2((totalRepeatCustomers / totalCustomers) * 100) : 0,
    methodology:
      'Customers are grouped by their acquisition month (MIN(order_purchase_timestamp) per customer_unique_id). Retention at Month +k is defined as active_customers(cohort, M+k) / cohort_size(cohort, M+0).',
    observationWindowNotice: `Historical dataset observation window spans ${datasetStartMonth} through ${datasetEndMonth} (${maxMonthOffset + 1} calendar months). Later acquisition cohorts are right-censored: for any cohort acquired at month T, offsets M+k where T+k > ${datasetEndMonth} lie outside the observable dataset horizon and are explicitly marked "Unobserved (Right-Censored)" rather than misclassified as 0% retention.`,
    cohorts,
    executedSql
  };
}

// ============================================================================
// MODULE 3: DELIVERY AND SATISFACTION ANALYSIS
// ============================================================================
async function computeDeliverySatisfactionAnalysis(): Promise<DeliverySatisfactionPayload> {
  const executedSql = `WITH order_delivery_reviews AS (
  SELECT
    fo.order_id,
    CAST(DATE_DIFF(
      'day',
      TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE),
      TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE)
    ) AS DOUBLE) AS delivery_days,
    fo.is_on_time,
    CAST(DATE_DIFF(
      'day',
      TRY_CAST(SUBSTR(CAST(fo.order_estimated_delivery_date AS VARCHAR), 1, 10) AS DATE),
      TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE)
    ) AS DOUBLE) AS delay_days_vs_estimate,
    fr.review_score
  FROM fact_orders fo
  LEFT JOIN fact_reviews fr ON fo.order_id = fr.order_id
  WHERE fo.order_status = 'delivered'
    AND fo.order_delivered_customer_date IS NOT NULL
    AND fo.order_estimated_delivery_date IS NOT NULL
)
SELECT
  CASE
    WHEN delay_days_vs_estimate <= -3 THEN '1. Ahead of SLA (>=3d Early)'
    WHEN delay_days_vs_estimate <= 0 THEN '2. On-Time SLA (0 to 2d Buffer)'
    WHEN delay_days_vs_estimate <= 3 THEN '3. Moderately Late (1 to 3d Delay)'
    ELSE '4. Severely Late (>3d Delay)'
  END AS performance_group,
  CASE
    WHEN delay_days_vs_estimate <= -3 THEN '<= -3 days vs SLA'
    WHEN delay_days_vs_estimate <= 0 THEN '-2 to 0 days vs SLA'
    WHEN delay_days_vs_estimate <= 3 THEN '+1 to +3 days late'
    ELSE '>= +4 days late'
  END AS delay_range_label,
  COUNT(DISTINCT order_id) AS order_count,
  COUNT(review_score) AS reviewed_order_count,
  ROUND(AVG(delivery_days), 2) AS avg_delivery_days,
  ROUND(AVG(delay_days_vs_estimate), 2) AS avg_delay_days,
  ROUND(AVG(CAST(review_score AS DOUBLE)), 2) AS avg_review_score,
  SUM(CASE WHEN review_score = 1 THEN 1 ELSE 0 END) AS score_1_count,
  SUM(CASE WHEN review_score = 2 THEN 1 ELSE 0 END) AS score_2_count,
  SUM(CASE WHEN review_score = 3 THEN 1 ELSE 0 END) AS score_3_count,
  SUM(CASE WHEN review_score = 4 THEN 1 ELSE 0 END) AS score_4_count,
  SUM(CASE WHEN review_score = 5 THEN 1 ELSE 0 END) AS score_5_count
FROM order_delivery_reviews
GROUP BY 1, 2
ORDER BY 1 ASC;`;

  const pairSql = `SELECT
    fo.order_id,
    fo.is_on_time,
    CAST(DATE_DIFF(
      'day',
      TRY_CAST(SUBSTR(CAST(fo.order_estimated_delivery_date AS VARCHAR), 1, 10) AS DATE),
      TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE)
    ) AS DOUBLE) AS delay_days_vs_estimate,
    CAST(fr.review_score AS DOUBLE) AS review_score
  FROM fact_orders fo
  INNER JOIN fact_reviews fr ON fo.order_id = fr.order_id
  WHERE fo.order_status = 'delivered'
    AND fo.order_delivered_customer_date IS NOT NULL
    AND fo.order_estimated_delivery_date IS NOT NULL
    AND fr.review_score IS NOT NULL;`;

  const [groupRows, pairRows] = await Promise.all([
    queryRows(executedSql, 50),
    queryRows(pairSql, 10000)
  ]);

  const performanceGroups: DeliverySatisfactionGroupRow[] = groupRows.map((r) => {
    const reviewedCount = Number(r.reviewed_order_count || 0);
    const s1 = Number(r.score_1_count || 0);
    const s2 = Number(r.score_2_count || 0);
    const s3 = Number(r.score_3_count || 0);
    const s4 = Number(r.score_4_count || 0);
    const s5 = Number(r.score_5_count || 0);

    return {
      performanceGroup: String(r.performance_group || ''),
      delayRangeLabel: String(r.delay_range_label || ''),
      orderCount: Number(r.order_count || 0),
      reviewedOrderCount: reviewedCount,
      avgDeliveryDays: round2(Number(r.avg_delivery_days || 0)),
      avgDelayDaysVsEstimate: round2(Number(r.avg_delay_days || 0)),
      avgReviewScore: round2(Number(r.avg_review_score || 0)),
      score1Count: s1,
      score2Count: s2,
      score3Count: s3,
      score4Count: s4,
      score5Count: s5,
      lowSatisfactionSharePct:
        reviewedCount > 0 ? round2(((s1 + s2 + s3) / reviewedCount) * 100) : 0,
      fiveStarSharePct: reviewedCount > 0 ? round2((s5 / reviewedCount) * 100) : 0
    };
  });

  const delays: number[] = [];
  const scores: number[] = [];
  const onTimeScores: number[] = [];
  const lateScores: number[] = [];

  for (const r of pairRows) {
    const delay = Number(r.delay_days_vs_estimate || 0);
    const score = Number(r.review_score || 0);
    delays.push(delay);
    scores.push(score);
    if (delay <= 0) {
      onTimeScores.push(score);
    } else {
      lateScores.push(score);
    }
  }

  const pearsonR = computePearsonCorrelation(delays, scores);
  const onTimeAvg =
    onTimeScores.length > 0
      ? round2(onTimeScores.reduce((a, b) => a + b, 0) / onTimeScores.length)
      : 0;
  const lateAvg =
    lateScores.length > 0
      ? round2(lateScores.reduce((a, b) => a + b, 0) / lateScores.length)
      : 0;
  const scoreDelta = round2(onTimeAvg - lateAvg);

  let correlationStrengthLabel = 'Moderate Negative Association';
  if (pearsonR <= -0.6) correlationStrengthLabel = 'Strong Negative Association';
  else if (pearsonR <= -0.3) correlationStrengthLabel = 'Moderate Negative Association';
  else if (pearsonR < 0) correlationStrengthLabel = 'Weak Negative Association';
  else correlationStrengthLabel = 'Neutral / Non-Negative Association';

  const starDistributionComparison: StarScoreComparisonRow[] = [1, 2, 3, 4, 5].map(
    (star) => {
      const onTimeCount = onTimeScores.filter((s) => Math.round(s) === star).length;
      const lateCount = lateScores.filter((s) => Math.round(s) === star).length;
      return {
        reviewScore: star,
        onTimeCount,
        onTimeSharePct:
          onTimeScores.length > 0
            ? round2((onTimeCount / onTimeScores.length) * 100)
            : 0,
        lateCount,
        lateSharePct:
          lateScores.length > 0 ? round2((lateCount / lateScores.length) * 100) : 0,
        totalCount: onTimeCount + lateCount
      };
    }
  );

  return {
    totalEvaluatedOrders: pairRows.length,
    onTimeOrderCount: onTimeScores.length,
    lateOrderCount: lateScores.length,
    onTimeAvgReviewScore: onTimeAvg,
    lateAvgReviewScore: lateAvg,
    reviewScoreDeltaOnTimeVsLate: scoreDelta,
    pearsonCorrelationDelayVsScore: pearsonR,
    correlationStrengthLabel,
    methodology:
      'Compares empirical customer review distributions (1★ to 5★) across SLA fulfillment buckets defined by delay_days = DATEDIFF(day, order_estimated_delivery_date, order_delivered_customer_date), and computes Pearson linear correlation r between continuous SLA delay days and review score.',
    correlationVsCausationAnalysis: {
      empiricalAssociationSummary: `Observed on-time deliveries average ${onTimeAvg.toFixed(2)}★ (n=${onTimeScores.length}) compared to ${lateAvg.toFixed(2)}★ for late deliveries (n=${lateScores.length}), an empirical spread of ${scoreDelta >= 0 ? '+' : ''}${scoreDelta.toFixed(2)}★ with Pearson correlation r = ${pearsonR.toFixed(3)}.`,
      whyCorrelationIsNotCausation:
        'While late delivery is strongly associated with lower review scores in observational marketplace records, this correlation cannot be interpreted as a pure isolated causal effect without controlling for structural confounders. Orders that experience transit delays frequently differ systematically from on-time orders across seller handling quality, carrier lane congestion, and product characteristics.',
      confoundingVariables: [
        'Seller Operational Quality: Underperforming merchants who ship late may also ship defective, poorly packaged, or inaccurate items.',
        'Geographic & Last-Mile Infrastructure: Remote destination states experience both longer carrier transit variance and higher physical handling damage rates.',
        'Product Category Fragility & Weight: Bulky or fragile categories (e.g., furniture, electronics) face higher carrier delay risk and higher product expectation sensitivity.',
        'Single-Review Survey Attribution: Olist captures a single order-level review score rather than separate ratings for carrier delivery speed vs. product quality.'
      ],
      recommendedExperimentalDesign:
        'Use Propensity Score Matching (matching on product_category, seller_id, and customer_state) or an Instrumental Variable (e.g., exogenous regional carrier weather disruptions) to isolate the direct causal effect of transit delay on customer review scores.'
    },
    performanceGroups,
    starDistributionComparison,
    executedSql
  };
}

// ============================================================================
// MODULE 4: SELLER PERFORMANCE (WITH SMALL-SAMPLE SHRINKAGE PROTECTION)
// ============================================================================
async function computeSellerPerformance(
  minOrderThreshold = 3,
  bayesianPriorWeightM = 3
): Promise<SellerPerformancePayload> {
  const executedSql = `WITH seller_item_agg AS (
  SELECT
    ds.seller_id,
    ds.seller_city,
    ds.seller_state,
    COUNT(DISTINCT foi.order_id) AS distinct_orders,
    COUNT(foi.order_item_id) AS items_sold,
    ROUND(COALESCE(SUM(foi.gmv_merchandise), 0), 2) AS seller_revenue,
    ROUND(COALESCE(SUM(foi.freight_revenue), 0), 2) AS total_freight,
    ROUND(COALESCE(AVG(foi.freight_revenue), 0), 2) AS avg_freight_per_item
  FROM dim_sellers ds
  LEFT JOIN fact_order_items foi
    ON ds.seller_id = foi.seller_id
    AND foi.order_status NOT IN ('canceled', 'unavailable')
  GROUP BY ds.seller_id, ds.seller_city, ds.seller_state
),
seller_order_delivery AS (
  SELECT
    foi.seller_id,
    fo.order_id,
    MAX(DATE_DIFF(
      'day',
      TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE),
      TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE)
    )) AS delivery_days,
    MAX(COALESCE(fo.is_on_time, 1)) AS is_on_time,
    AVG(CAST(fr.review_score AS DOUBLE)) AS order_review_score
  FROM fact_order_items foi
  INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
  LEFT JOIN fact_reviews fr ON fo.order_id = fr.order_id
  WHERE fo.order_status NOT IN ('canceled', 'unavailable')
  GROUP BY foi.seller_id, fo.order_id
),
seller_delivery_agg AS (
  SELECT
    seller_id,
    ROUND(AVG(delivery_days), 2) AS avg_delivery_days,
    ROUND(AVG(CAST(is_on_time AS DOUBLE)) * 100, 2) AS on_time_delivery_pct,
    SUM(CASE WHEN is_on_time = 0 THEN 1 ELSE 0 END) AS late_order_count,
    ROUND(AVG(order_review_score), 2) AS raw_avg_review_score
  FROM seller_order_delivery
  GROUP BY seller_id
)
SELECT
  sia.seller_id,
  sia.seller_city,
  sia.seller_state,
  sia.distinct_orders,
  sia.items_sold,
  sia.seller_revenue,
  sia.total_freight,
  sia.avg_freight_per_item,
  ROUND(CASE WHEN sia.seller_revenue > 0 THEN (sia.total_freight / sia.seller_revenue) * 100 ELSE 0 END, 2) AS freight_to_revenue_ratio_pct,
  COALESCE(sda.avg_delivery_days, 0) AS avg_delivery_days,
  COALESCE(sda.on_time_delivery_pct, 0) AS on_time_delivery_pct,
  COALESCE(sda.late_order_count, 0) AS late_order_count,
  COALESCE(sda.raw_avg_review_score, 0) AS raw_avg_review_score
FROM seller_item_agg sia
LEFT JOIN seller_delivery_agg sda ON sia.seller_id = sda.seller_id
WHERE sia.distinct_orders > 0
ORDER BY sia.seller_revenue DESC, sia.distinct_orders DESC;`;

  const rows = await queryRows(executedSql, 500);

  // Calculate platform-wide mean review score C and on-time % weighted by order volume
  let weightedReviewSum = 0;
  let weightedOnTimeSum = 0;
  let totalSellerOrderWeight = 0;

  for (const r of rows) {
    const n = Number(r.distinct_orders || 0);
    const rawRev = Number(r.raw_avg_review_score || 0);
    const onTime = Number(r.on_time_delivery_pct || 0);
    if (n > 0 && rawRev > 0) {
      weightedReviewSum += n * rawRev;
      weightedOnTimeSum += n * onTime;
      totalSellerOrderWeight += n;
    }
  }

  const platformMeanReviewScoreC =
    totalSellerOrderWeight > 0 ? round2(weightedReviewSum / totalSellerOrderWeight) : 4.2;
  const platformAvgOnTimePct =
    totalSellerOrderWeight > 0 ? round2(weightedOnTimeSum / totalSellerOrderWeight) : 80.0;

  const maxRevenue = Math.max(
    1,
    ...rows.map((r) => Number(r.seller_revenue || 0))
  );

  const sellersUnranked: SellerPerformanceRow[] = rows.map((r) => {
    const distinctOrders = Number(r.distinct_orders || 0);
    const sellerRevenue = round2(Number(r.seller_revenue || 0));
    const rawAvgReviewScore = round2(Number(r.raw_avg_review_score || 0));
    const onTimeDeliveryPct = round2(Number(r.on_time_delivery_pct || 0));

    const bayesianAdjustedReviewScore = computeBayesianAdjustedRating(
      distinctOrders,
      rawAvgReviewScore,
      platformMeanReviewScoreC,
      bayesianPriorWeightM
    );

    const isQualified = distinctOrders >= minOrderThreshold;
    const sampleReliabilityStatus = isQualified
      ? 'QUALIFIED_SAMPLE'
      : 'SMALL_SAMPLE_PENALIZED';

    // Composite index (0-100): 40% Bayesian review score, 35% On-Time SLA %, 25% revenue scale
    // Small-sample sellers get shrinkage on both review score and on-time SLA toward platform mean
    const shrunkOnTimePct =
      (distinctOrders / (distinctOrders + bayesianPriorWeightM)) * onTimeDeliveryPct +
      (bayesianPriorWeightM / (distinctOrders + bayesianPriorWeightM)) *
        platformAvgOnTimePct;

    const reviewComponent = (bayesianAdjustedReviewScore / 5) * 40;
    const slaComponent = (shrunkOnTimePct / 100) * 35;
    const revComponent = (sellerRevenue / maxRevenue) * 25;
    const compositePerformanceIndex = round2(
      reviewComponent + slaComponent + revComponent
    );

    const reliabilityNote = isQualified
      ? `Meets minimum sample threshold (n=${distinctOrders} >= ${minOrderThreshold} orders). Eligible for official leaderboard ranking.`
      : `Below sample threshold (n=${distinctOrders} < ${minOrderThreshold} orders). Raw score (${rawAvgReviewScore.toFixed(2)}★) shrunk toward platform mean (${platformMeanReviewScoreC.toFixed(2)}★) -> ${bayesianAdjustedReviewScore.toFixed(2)}★; excluded from primary leaderboard rank.`;

    return {
      sellerId: String(r.seller_id || ''),
      sellerCity: String(r.seller_city || ''),
      sellerState: String(r.seller_state || ''),
      distinctOrders,
      itemsSold: Number(r.items_sold || 0),
      sellerRevenue,
      totalFreight: round2(Number(r.total_freight || 0)),
      avgFreightPerItem: round2(Number(r.avg_freight_per_item || 0)),
      freightToRevenueRatioPct: round2(Number(r.freight_to_revenue_ratio_pct || 0)),
      avgDeliveryDays: round2(Number(r.avg_delivery_days || 0)),
      onTimeDeliveryPct,
      lateOrderCount: Number(r.late_order_count || 0),
      rawAvgReviewScore,
      bayesianAdjustedReviewScore,
      sampleReliabilityStatus,
      reliabilityNote,
      compositePerformanceIndex,
      qualifiedRank: null
    };
  });

  // Assign official ranks ONLY to sellers meeting minOrderThreshold, sorted by compositePerformanceIndex DESC
  const qualifiedSorted = sellersUnranked
    .filter((s) => s.sampleReliabilityStatus === 'QUALIFIED_SAMPLE')
    .sort((a, b) => b.compositePerformanceIndex - a.compositePerformanceIndex);

  const rankMap = new Map<string, number>();
  qualifiedSorted.forEach((s, idx) => {
    rankMap.set(s.sellerId, idx + 1);
  });

  const sellers: SellerPerformanceRow[] = sellersUnranked
    .map((s) => ({
      ...s,
      qualifiedRank: rankMap.get(s.sellerId) ?? null
    }))
    .sort((a, b) => {
      if (a.qualifiedRank !== null && b.qualifiedRank !== null) {
        return a.qualifiedRank - b.qualifiedRank;
      }
      if (a.qualifiedRank !== null) return -1;
      if (b.qualifiedRank !== null) return 1;
      return b.compositePerformanceIndex - a.compositePerformanceIndex;
    });

  return {
    totalActiveSellers: sellers.length,
    qualifiedSellersCount: qualifiedSorted.length,
    smallSampleSellersCount: sellers.length - qualifiedSorted.length,
    minOrderThreshold,
    bayesianPriorWeightM,
    platformMeanReviewScoreC,
    platformAvgOnTimePct,
    methodology: `Sellers are evaluated across GMV revenue, order volume, freight burden, on-time SLA fulfillment, and Empirical Bayes adjusted review rating W = (n/(n+m))*R + (m/(n+m))*C with prior weight m=${bayesianPriorWeightM} and platform mean C=${platformMeanReviewScoreC.toFixed(2)}★.`,
    smallSampleProtectionExplanation: `Unadjusted seller rankings are vulnerable to extreme small-sample variance (e.g., a seller with n=1 or n=2 orders achieving 100% on-time and 5.00★ by chance, or 0% on-time from a single carrier delay). RetailPulse enforces two safeguards: (1) Empirical Bayes Shrinkage pulls small-n ratings toward the platform mean C=${platformMeanReviewScoreC.toFixed(2)}★, and (2) Official Leaderboard Ranks require n >= ${minOrderThreshold} distinct orders.`,
    sellers,
    executedSql
  };
}

// ============================================================================
// MODULE 5: BUSINESS OPPORTUNITY DETECTION
// ============================================================================
async function computeBusinessOpportunities(): Promise<BusinessOpportunityPayload> {
  // 1. Categories with declining sales (First Half vs Second Half of dataset months)
  const decliningCatSql = `WITH ordered_months AS (
  SELECT DISTINCT SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7) AS ym
  FROM fact_orders
  WHERE order_status NOT IN ('canceled', 'unavailable')
    AND order_purchase_timestamp IS NOT NULL
),
ranked_months AS (
  SELECT
    ym,
    ROW_NUMBER() OVER (ORDER BY ym ASC) AS rn,
    COUNT(*) OVER () AS total_months
  FROM ordered_months
),
cat_half_sales AS (
  SELECT
    foi.product_category_english AS category,
    ROUND(SUM(CASE WHEN rm.rn <= CEIL(rm.total_months / 2.0) THEN foi.gmv_merchandise ELSE 0 END), 2) AS first_half_gmv,
    ROUND(SUM(CASE WHEN rm.rn > CEIL(rm.total_months / 2.0) THEN foi.gmv_merchandise ELSE 0 END), 2) AS second_half_gmv,
    COUNT(DISTINCT CASE WHEN rm.rn <= CEIL(rm.total_months / 2.0) THEN foi.order_id END) AS first_half_orders,
    COUNT(DISTINCT CASE WHEN rm.rn > CEIL(rm.total_months / 2.0) THEN foi.order_id END) AS second_half_orders
  FROM fact_order_items foi
  INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
  INNER JOIN ranked_months rm
    ON SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7) = rm.ym
  WHERE fo.order_status NOT IN ('canceled', 'unavailable')
  GROUP BY foi.product_category_english
)
SELECT
  category,
  first_half_gmv,
  second_half_gmv,
  ROUND(second_half_gmv - first_half_gmv, 2) AS gmv_delta,
  ROUND(CASE WHEN first_half_gmv > 0 THEN ((second_half_gmv - first_half_gmv) / first_half_gmv) * 100 ELSE 0 END, 2) AS gmv_change_pct,
  first_half_orders,
  second_half_orders
FROM cat_half_sales
WHERE first_half_gmv > 0
ORDER BY gmv_change_pct ASC, gmv_delta ASC;`;

  // 2. Regions with delivery problems
  const regionalDeliverySql = `SELECT
  fo.customer_state,
  COUNT(DISTINCT fo.order_id) AS delivered_orders,
  SUM(CASE WHEN fo.is_on_time = 0 THEN 1 ELSE 0 END) AS late_orders,
  ROUND(AVG(CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END), 2) AS late_delivery_pct,
  ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 2) AS avg_delivery_days,
  ROUND(AVG(CAST(fr.review_score AS DOUBLE)), 2) AS avg_review_score
FROM fact_orders fo
LEFT JOIN fact_reviews fr ON fo.order_id = fr.order_id
WHERE fo.order_status = 'delivered'
GROUP BY fo.customer_state
ORDER BY late_delivery_pct DESC, avg_delivery_days DESC;`;

  // 3. Customer groups (by state) with weak retention
  const weakRetentionSql = `WITH customer_state_orders AS (
  SELECT
    customer_unique_id,
    MAX(customer_state) AS customer_state,
    COUNT(DISTINCT order_id) AS order_count,
    ROUND(SUM(total_order_value), 2) AS lifetime_value
  FROM fact_orders
  WHERE order_status NOT IN ('canceled', 'unavailable')
    AND customer_unique_id IS NOT NULL
  GROUP BY customer_unique_id
)
SELECT
  customer_state,
  COUNT(DISTINCT customer_unique_id) AS unique_customers,
  SUM(CASE WHEN order_count = 1 THEN 1 ELSE 0 END) AS single_order_customers,
  SUM(CASE WHEN order_count > 1 THEN 1 ELSE 0 END) AS repeat_customers,
  ROUND(AVG(CASE WHEN order_count > 1 THEN 100.0 ELSE 0.0 END), 2) AS repeat_retention_pct,
  ROUND(SUM(lifetime_value), 2) AS state_total_ltv
FROM customer_state_orders
GROUP BY customer_state
ORDER BY repeat_retention_pct ASC, unique_customers DESC;`;

  // 4. Sellers with unusual performance (late delivery or high freight/review divergence)
  const unusualSellerSql = `WITH seller_perf AS (
  SELECT
    foi.seller_id,
    MAX(foi.seller_city) AS seller_city,
    MAX(foi.seller_state) AS seller_state,
    COUNT(DISTINCT foi.order_id) AS order_volume,
    ROUND(SUM(foi.gmv_merchandise), 2) AS gmv_revenue,
    ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 2) AS avg_delivery_days,
    ROUND(AVG(CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END), 2) AS late_rate_pct,
    ROUND(AVG(CAST(fr.review_score AS DOUBLE)), 2) AS avg_review_score
  FROM fact_order_items foi
  INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
  LEFT JOIN fact_reviews fr ON fo.order_id = fr.order_id
  WHERE fo.order_status = 'delivered'
  GROUP BY foi.seller_id
)
SELECT *
FROM seller_perf
ORDER BY late_rate_pct DESC, avg_review_score ASC;`;

  // 5. Categories associated with low satisfaction
  const lowSatisfactionCatSql = `SELECT
  foi.product_category_english AS category,
  COUNT(DISTINCT foi.order_id) AS reviewed_orders,
  ROUND(AVG(CAST(fr.review_score AS DOUBLE)), 2) AS avg_review_score,
  SUM(CASE WHEN fr.review_score <= 3 THEN 1 ELSE 0 END) AS low_score_count,
  ROUND(AVG(CASE WHEN fr.review_score <= 3 THEN 100.0 ELSE 0.0 END), 2) AS low_score_share_pct,
  ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 2) AS avg_delivery_days,
  ROUND(SUM(foi.gmv_merchandise), 2) AS category_gmv
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
INNER JOIN fact_reviews fr ON fo.order_id = fr.order_id
WHERE fo.order_status NOT IN ('canceled', 'unavailable')
GROUP BY foi.product_category_english
ORDER BY avg_review_score ASC, low_score_share_pct DESC;`;

  const [
    decliningCatRows,
    regionalDeliveryRows,
    weakRetentionRows,
    unusualSellerRows,
    lowSatCatRows
  ] = await Promise.all([
    queryRows(decliningCatSql, 20),
    queryRows(regionalDeliverySql, 20),
    queryRows(weakRetentionSql, 20),
    queryRows(unusualSellerSql, 20),
    queryRows(lowSatisfactionCatSql, 20)
  ]);

  const opportunities: BusinessOpportunityItem[] = [];

  // Opportunity 1: Categories with Declining Sales
  if (decliningCatRows.length > 0) {
    const worstCat = decliningCatRows[0];
    const catName = String(worstCat.category || 'Unknown Category');
    const h1 = Number(worstCat.first_half_gmv || 0);
    const h2 = Number(worstCat.second_half_gmv || 0);
    const chgPct = Number(worstCat.gmv_change_pct || 0);

    opportunities.push({
      id: 'opp-declining-category-sales',
      domain: 'DECLINING_CATEGORY_SALES',
      domainLabel: '1. Categories with Declining Sales',
      severity: chgPct <= -25 ? 'HIGH' : 'MEDIUM',
      title: `Period-over-Period Revenue Contraction in ${catName}`,
      targetEntity: `Category: ${catName}`,
      primaryMetricLabel: 'H1 -> H2 GMV Trajectory',
      primaryMetricValue: `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}% ($${h1.toFixed(2)} -> $${h2.toFixed(2)})`,
      benchmarkComparison: `Compared First-Half vs. Second-Half dataset window across ${decliningCatRows.length} active categories`,
      evidenceSummary: `Category "${catName}" recorded $${h1.toFixed(2)} GMV (${worstCat.first_half_orders} orders) in the first half of the observation window, declining to $${h2.toFixed(2)} GMV (${worstCat.second_half_orders} orders) in the second half (${chgPct.toFixed(2)}% contraction).`,
      calculationMethodology:
        'Splits distinct chronological order months into Half 1 (t <= CEIL(N/2)) and Half 2 (t > CEIL(N/2)) and computes ((GMV_H2 - GMV_H1) / GMV_H1) * 100 per product_category_english.',
      recommendedAction:
        'Audit category SKU assortment availability, inspect competitor pricing pressure, and bundle declining category items with growing anchor categories.',
      supportingSql: decliningCatSql,
      evidenceRecords: decliningCatRows.slice(0, 5)
    });
  }

  // Opportunity 2: Regions with Delivery Problems
  if (regionalDeliveryRows.length > 0) {
    const worstState = regionalDeliveryRows[0];
    const stateCode = String(worstState.customer_state || 'N/A');
    const latePct = Number(worstState.late_delivery_pct || 0);
    const avgDays = Number(worstState.avg_delivery_days || 0);
    const avgScore = Number(worstState.avg_review_score || 0);
    const platformLateAvg = round2(
      regionalDeliveryRows.reduce((s, r) => s + Number(r.late_delivery_pct || 0), 0) /
        regionalDeliveryRows.length
    );

    opportunities.push({
      id: 'opp-regional-delivery-bottleneck',
      domain: 'REGIONAL_DELIVERY_BOTTLENECK',
      domainLabel: '2. Regions with Delivery Problems',
      severity: latePct >= 30 ? 'HIGH' : 'MEDIUM',
      title: `Elevated SLA Miss Rate & Transit Lead Time in State ${stateCode}`,
      targetEntity: `Region: State ${stateCode}`,
      primaryMetricLabel: 'Regional Late Delivery Rate',
      primaryMetricValue: `${latePct.toFixed(2)}% Late (${avgDays.toFixed(1)} avg transit days)`,
      benchmarkComparison: `State ${stateCode} late rate (${latePct.toFixed(1)}%) vs. state-level mean (${platformLateAvg.toFixed(1)}%); avg review ${avgScore.toFixed(2)}★`,
      evidenceSummary: `State ${stateCode} experienced ${worstState.late_orders} late deliveries out of ${worstState.delivered_orders} delivered orders (${latePct.toFixed(2)}% SLA miss rate), averaging ${avgDays.toFixed(2)} transit days and ${avgScore.toFixed(2)}★ customer satisfaction.`,
      calculationMethodology:
        'Aggregates delivered fact_orders by customer_state, computing AVG(CASE WHEN is_delivered_on_time = FALSE THEN 100.0 ELSE 0.0 END) and AVG(delivery_days).',
      recommendedAction:
        'Recalibrate checkout SLA estimation buffers for long-haul corridors into this state and shift fulfillment routing to regional 3PL carriers closer to destination zip prefixes.',
      supportingSql: regionalDeliverySql,
      evidenceRecords: regionalDeliveryRows.slice(0, 5)
    });
  }

  // Opportunity 3: Customer Groups with Weak Retention
  if (weakRetentionRows.length > 0) {
    const weakGroup = weakRetentionRows[0];
    const stateCode = String(weakGroup.customer_state || 'N/A');
    const repeatPct = Number(weakGroup.repeat_retention_pct || 0);
    const uniqueCust = Number(weakGroup.unique_customers || 0);
    const stateLtv = Number(weakGroup.state_total_ltv || 0);

    opportunities.push({
      id: 'opp-weak-customer-retention',
      domain: 'WEAK_CUSTOMER_RETENTION',
      domainLabel: '3. Customer Groups with Weak Retention',
      severity: repeatPct === 0 ? 'HIGH' : 'MEDIUM',
      title: `Zero / Below-Benchmark Repeat Conversion in Customer Segment (${stateCode})`,
      targetEntity: `Customer Group: State ${stateCode} Buyers (n=${uniqueCust})`,
      primaryMetricLabel: 'Repeat Purchase Rate',
      primaryMetricValue: `${repeatPct.toFixed(2)}% Repeat Rate ($${stateLtv.toFixed(2)} cohort LTV)`,
      benchmarkComparison: `${weakGroup.single_order_customers} of ${uniqueCust} unique customers placed only 1 order`,
      evidenceSummary: `In customer group ${stateCode}, ${weakGroup.single_order_customers} out of ${uniqueCust} unique buyers (${(100 - repeatPct).toFixed(1)}%) churned after their initial purchase, yielding a ${repeatPct.toFixed(2)}% repeat rate despite $${stateLtv.toFixed(2)} in initial order spend.`,
      calculationMethodology:
        'Groups fact_orders by customer_unique_id to determine lifetime order count per real person, then aggregates repeat rate by customer_state.',
      recommendedAction:
        'Launch automated 30-day post-delivery replenishment triggers and investigate whether first-order delivery delays in these states suppressed second-order conversion.',
      supportingSql: weakRetentionSql,
      evidenceRecords: weakRetentionRows.slice(0, 5)
    });
  }

  // Opportunity 4: Sellers with Unusual Performance
  if (unusualSellerRows.length > 0) {
    const outlierSeller = unusualSellerRows[0];
    const bestSeller = unusualSellerRows[unusualSellerRows.length - 1];
    const sellerId = String(outlierSeller.seller_id || '');
    const latePct = Number(outlierSeller.late_rate_pct || 0);
    const avgScore = Number(outlierSeller.avg_review_score || 0);
    const avgDays = Number(outlierSeller.avg_delivery_days || 0);

    opportunities.push({
      id: 'opp-unusual-seller-performance',
      domain: 'UNUSUAL_SELLER_PERFORMANCE',
      domainLabel: '4. Sellers with Unusual Performance',
      severity: latePct >= 50 || avgScore <= 3.6 ? 'HIGH' : 'MEDIUM',
      title: `Fulfillment & Review Divergence on Seller ${sellerId} (${outlierSeller.seller_city}, ${outlierSeller.seller_state})`,
      targetEntity: `Seller: ${sellerId} (${outlierSeller.seller_city}-${outlierSeller.seller_state})`,
      primaryMetricLabel: 'Seller Late Rate & Review Score',
      primaryMetricValue: `${latePct.toFixed(1)}% Late | ${avgScore.toFixed(2)}★ (${avgDays.toFixed(1)}d transit)`,
      benchmarkComparison: `Outlier Seller ${sellerId} (${latePct.toFixed(0)}% late, ${avgScore.toFixed(2)}★) vs. Top Benchmark Seller ${bestSeller.seller_id} (${Number(bestSeller.late_rate_pct || 0).toFixed(0)}% late, ${Number(bestSeller.avg_review_score || 0).toFixed(2)}★)`,
      evidenceSummary: `Seller ${sellerId} exhibits an anomalous ${latePct.toFixed(2)}% late delivery rate with an average transit time of ${avgDays.toFixed(2)} days and a degraded ${avgScore.toFixed(2)}★ mean review score across ${outlierSeller.order_volume} orders ($${Number(outlierSeller.gmv_revenue || 0).toFixed(2)} GMV).`,
      calculationMethodology:
        'Evaluates seller-level SLA miss rate, average transit duration, and mean customer review score across delivered orders.',
      recommendedAction:
        'Place Seller on operational SLA probation requiring carrier dispatch within 24h of order approval, and benchmark dispatch practices against top-tier sellers.',
      supportingSql: unusualSellerSql,
      evidenceRecords: unusualSellerRows.slice(0, 5)
    });
  }

  // Opportunity 5: Categories Associated with Low Satisfaction
  if (lowSatCatRows.length > 0) {
    const worstSatCat = lowSatCatRows[0];
    const catName = String(worstSatCat.category || 'Unknown');
    const avgScore = Number(worstSatCat.avg_review_score || 0);
    const lowSharePct = Number(worstSatCat.low_score_share_pct || 0);
    const avgDays = Number(worstSatCat.avg_delivery_days || 0);

    opportunities.push({
      id: 'opp-low-satisfaction-category',
      domain: 'LOW_SATISFACTION_CATEGORY',
      domainLabel: '5. Categories Associated with Low Satisfaction',
      severity: avgScore < 4.0 || lowSharePct >= 40 ? 'HIGH' : 'WATCH',
      title: `Elevated Customer Detractor Share in Category "${catName}"`,
      targetEntity: `Category: ${catName}`,
      primaryMetricLabel: 'Mean Category Rating & <=3★ Share',
      primaryMetricValue: `${avgScore.toFixed(2)}★ Mean (${lowSharePct.toFixed(1)}% <=3★ reviews)`,
      benchmarkComparison: `${worstSatCat.low_score_count} of ${worstSatCat.reviewed_orders} reviewed orders rated <=3★ (avg transit ${avgDays.toFixed(1)}d)`,
      evidenceSummary: `Category "${catName}" records the lowest mean satisfaction at ${avgScore.toFixed(2)}★, with ${lowSharePct.toFixed(2)}% of reviewed orders receiving 1★–3★ scores across $${Number(worstSatCat.category_gmv || 0).toFixed(2)} in merchandise GMV.`,
      calculationMethodology:
        'Joins fact_order_items, fact_orders, and fact_reviews by order_id to compute category-level mean review score and <=3★ detractor share.',
      recommendedAction:
        'Inspect product listing specification accuracy and packaging standards for this category, and cross-check whether carrier delays on specific sellers are driving negative category reviews.',
      supportingSql: lowSatisfactionCatSql,
      evidenceRecords: lowSatCatRows.slice(0, 5)
    });
  }

  return {
    evaluatedTimestamp: new Date().toISOString(),
    totalOpportunitiesDetected: opportunities.length,
    methodology:
      'Automated SQL rule engine scans DuckDB star-schema views across 5 commercial and operational dimensions (H1-vs-H2 category revenue trajectory, regional SLA bottlenecks, customer repeat conversion by cohort/region, seller operational outliers, and category review detractor concentration). Every finding is strictly derived from live DuckDB records.',
    opportunities
  };
}

// ============================================================================
// MODULE 6: SALES FORECASTING (CHRONOLOGICAL TRAIN/TEST & BASELINE EVALUATION)
// ============================================================================
async function computeSalesForecasting(
  forecastHorizonMonths = 3
): Promise<SalesForecastingPayload> {
  const executedSql = `SELECT
  SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month,
  COUNT(DISTINCT fo.order_id) AS order_count,
  ROUND(COALESCE(SUM(fo.total_order_value), 0), 2) AS total_revenue
FROM fact_orders fo
WHERE fo.order_status NOT IN ('canceled', 'unavailable')
  AND fo.order_purchase_timestamp IS NOT NULL
GROUP BY 1
ORDER BY 1 ASC;`;

  const rows = await queryRows(executedSql, 240);
  const historicalSeries = rows.map((r) => ({
    period: String(r.order_month || ''),
    revenue: round2(Number(r.total_revenue || 0)),
    orders: Number(r.order_count || 0)
  }));

  const experiment = runChronologicalForecastExperiment(
    historicalSeries,
    forecastHorizonMonths
  );

  const trainRows = experiment.series.filter((s) => s.split === 'TRAIN');
  const testRows = experiment.series.filter((s) => s.split === 'TEST');
  const forecastRows = experiment.series.filter((s) => s.split === 'FORECAST');

  const trainPeriodRange =
    trainRows.length > 0
      ? `${trainRows[0].period} to ${trainRows[trainRows.length - 1].period}`
      : 'N/A';
  const testPeriodRange =
    testRows.length > 0
      ? `${testRows[0].period} to ${testRows[testRows.length - 1].period}`
      : 'N/A';
  const forecastPeriodRange =
    forecastRows.length > 0
      ? `${forecastRows[0].period} to ${forecastRows[forecastRows.length - 1].period}`
      : 'N/A';

  return {
    granularity: 'MONTHLY',
    totalHistoricalPeriods: historicalSeries.length,
    trainPeriodsCount: experiment.trainPeriodsCount,
    testPeriodsCount: experiment.testPeriodsCount,
    forecastHorizonMonths,
    trainPeriodRange,
    testPeriodRange,
    forecastPeriodRange,
    modelName: 'Damped Holt Linear Trend + OLS Hybrid',
    baselineName: 'Trailing 2-Month Moving Average Baseline',
    methodology:
      'Enforces strict chronological Train/Test separation without future leakage. Parameters (OLS trend slope/intercept and Holt level/trend smoothing alpha=0.55, beta=0.35) are estimated exclusively on the chronological Training window, then evaluated out-of-sample on the held-out Test window against a Trailing Moving Average baseline using MAE and MAPE.',
    modelParameters: experiment.modelParameters,
    evaluationMetrics: experiment.evaluationMetrics,
    limitationsAndAssumptions: [
      `Sample Window Constraint: The historical series contains ${historicalSeries.length} monthly observations (${trainPeriodRange} train; ${testPeriodRange} out-of-sample test). Small sample horizons increase parameter estimation variance and widen 95% confidence intervals.`,
      'Unmodeled Seasonality & Promotional Shocks: A sub-24-month window cannot reliably decompose 12-month annual seasonality (e.g., Black Friday / November retail spikes) from secular trend growth.',
      'Boundary Right-Censoring Risk: If the final calendar month in an uploaded dataset contains only partial-month orders, raw monthly revenue at the boundary will appear artificially depressed unless normalized for active trading days.',
      'Exogenous Covariate Omission: Univariate time-series extrapolation assumes marketing CAC spend, seller inventory availability, and freight pricing remain structurally stable over the forecast horizon.'
    ],
    series: experiment.series,
    executedSql
  };
}

export async function computeAdvancedAnalyticsSuite(options?: {
  minSellerOrders?: number;
  forecastHorizonMonths?: number;
}): Promise<AdvancedAnalyticsSuitePayload> {
  await duckdbEngine.ensureInitialized();
  const minSellerOrders =
    typeof options?.minSellerOrders === 'number' && options.minSellerOrders >= 1
      ? Math.min(options.minSellerOrders, 50)
      : 3;
  const forecastHorizonMonths =
    typeof options?.forecastHorizonMonths === 'number' &&
    options.forecastHorizonMonths >= 1
      ? Math.min(options.forecastHorizonMonths, 12)
      : 3;

  const dataMode = duckdbEngine.getDataMode();
  const isDemonstrationData = duckdbEngine.isDemonstrationData();

  const [
    rfmSegmentation,
    cohortAnalysis,
    deliverySatisfaction,
    sellerPerformance,
    businessOpportunities,
    salesForecasting
  ] = await Promise.all([
    computeRfmSegmentation(),
    computeCohortAnalysis(),
    computeDeliverySatisfactionAnalysis(),
    computeSellerPerformance(minSellerOrders, 3),
    computeBusinessOpportunities(),
    computeSalesForecasting(forecastHorizonMonths)
  ]);

  return {
    isReady: dataMode !== 'EMPTY' && rfmSegmentation.totalUniqueCustomers > 0,
    dataMode,
    isDemonstrationData,
    generatedAt: new Date().toISOString(),
    rfmSegmentation,
    cohortAnalysis,
    deliverySatisfaction,
    sellerPerformance,
    businessOpportunities,
    salesForecasting
  };
}
