import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Code2,
  FlaskConical,
  GitBranch,
  RefreshCw,
  RotateCcw,
  Sliders,
  TrendingUp,
  X
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  AbTestCohortPresetId,
  AbTestMetricKey,
  AbTestResultPayload,
  AnomalyDetectionPayload,
  AnomalyRootCausePayload,
  StatisticalAnomalyItem,
  WhatIfScenarioInput,
  WhatIfSimulationPayload
} from '../types/analytics';
import { apiClient } from '../services/apiClient';
import { usePlatform } from '../context/PlatformContext';
import { DataStateBanner } from '../components/ui/DataStateBanner';

type DecisionTab = 'anomalies' | 'simulator' | 'ab-lab';

const DEFAULT_SCENARIO: WhatIfScenarioInput = {
  lateDeliveryReductionPct: 35,
  freightReductionPct: 10,
  repeatRateLiftPct: 10,
  cancellationReductionPct: 30,
  targetState: 'ALL'
};

const COHORT_PRESETS: { id: Exclude<AbTestCohortPresetId, 'custom_manual'>; label: string; detail: string }[] = [
  {
    id: 'on_time_vs_late',
    label: 'On-Time vs. Late Delivery',
    detail: 'Delivered on/before SLA estimate vs. SLA-delayed orders'
  },
  {
    id: 'credit_card_vs_boleto',
    label: 'Credit Card vs. Boleto',
    detail: 'Primary credit card settlement vs. boleto bank slip'
  },
  {
    id: 'sp_vs_non_sp',
    label: 'São Paulo (SP) vs. Non-SP',
    detail: 'Core Southeast hub vs. all external Brazilian states'
  },
  {
    id: 'installments_high_vs_single',
    label: '4x+ Installments vs. 1x Single',
    detail: 'Multi-installment checkout vs. single-payment orders'
  },
  {
    id: 'low_freight_vs_high_freight',
    label: 'Low Freight (<15%) vs. High Freight',
    detail: 'Orders with freight below vs. above 15% of order value'
  },
  {
    id: 'repeat_vs_first_time',
    label: 'Repeat vs. First-Time Buyers',
    detail: 'Multi-order customer_unique_id buyers vs. single-order buyers'
  }
];

const METRIC_OPTIONS: { id: AbTestMetricKey; label: string }[] = [
  { id: 'review_score', label: 'Review Score (1–5★)' },
  { id: 'order_value', label: 'Total Order Value ($)' },
  { id: 'repeat_rate', label: 'Repeat Purchase Rate (%)' },
  { id: 'on_time_rate', label: 'On-Time Delivery Rate (%)' }
];

function formatMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function formatMoneyPrecise(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const DecisionLabPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { totalRows, dataMode, updateDashboardFilters } = usePlatform();

  const initialTab = (searchParams.get('tab') as DecisionTab) || 'anomalies';
  const [activeTab, setActiveTab] = useState<DecisionTab>(
    ['anomalies', 'simulator', 'ab-lab'].includes(initialTab) ? initialTab : 'anomalies'
  );

  // Tab 1: Anomaly Alerts + Automated Root-Cause Attribution state
  const [anomalyData, setAnomalyData] = useState<AnomalyDetectionPayload | null>(null);
  const [anomalyLoading, setAnomalyLoading] = useState<boolean>(true);
  const [anomalyError, setAnomalyError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>('ALL');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [expandedSqlId, setExpandedSqlId] = useState<string | null>(null);
  const [rootCauseByAnomalyId, setRootCauseByAnomalyId] = useState<
    Record<string, AnomalyRootCausePayload>
  >({});
  const [rootCauseLoadingId, setRootCauseLoadingId] = useState<string | null>(null);
  const [rootCauseErrorById, setRootCauseErrorById] = useState<Record<string, string>>({});
  const [activeRcaDimById, setActiveRcaDimById] = useState<Record<string, string>>({});
  const [showRcaSqlById, setShowRcaSqlById] = useState<Record<string, boolean>>({});

  // Tab 2: What-If Simulator state
  const [scenario, setScenario] = useState<WhatIfScenarioInput>(() => ({
    lateDeliveryReductionPct: Number(searchParams.get('lateReduction')) || DEFAULT_SCENARIO.lateDeliveryReductionPct,
    freightReductionPct: Number(searchParams.get('freightReduction')) || DEFAULT_SCENARIO.freightReductionPct,
    repeatRateLiftPct: Number(searchParams.get('repeatLift')) || DEFAULT_SCENARIO.repeatRateLiftPct,
    cancellationReductionPct: Number(searchParams.get('cancelReduction')) || DEFAULT_SCENARIO.cancellationReductionPct,
    targetState: searchParams.get('state') || DEFAULT_SCENARIO.targetState
  }));
  const [simPayload, setSimPayload] = useState<WhatIfSimulationPayload | null>(null);
  const [simLoading, setSimLoading] = useState<boolean>(false);
  const [simError, setSimError] = useState<string | null>(null);

  // Tab 3: A/B Hypothesis Lab state
  const [abMode, setAbMode] = useState<'duckdb' | 'custom'>('duckdb');
  const [presetId, setPresetId] = useState<Exclude<AbTestCohortPresetId, 'custom_manual'>>('on_time_vs_late');
  const [metricKey, setMetricKey] = useState<AbTestMetricKey>('review_score');
  const [alpha, setAlpha] = useState<number>(0.05);
  const [targetMdePct, setTargetMdePct] = useState<number>(5);
  const [manualTestType, setManualTestType] = useState<'continuous' | 'proportion'>('proportion');
  const [manualControlLabel, setManualControlLabel] = useState('Control Checkout (A)');
  const [manualVariantLabel, setManualVariantLabel] = useState('Fast-ETA Checkout (B)');
  const [manualNA, setManualNA] = useState<number>(2500);
  const [manualValA, setManualValA] = useState<number>(575);
  const [manualSdA, setManualSdA] = useState<number>(48);
  const [manualNB, setManualNB] = useState<number>(2500);
  const [manualValB, setManualValB] = useState<number>(642);
  const [manualSdB, setManualSdB] = useState<number>(46);
  const [abResult, setAbResult] = useState<AbTestResultPayload | null>(null);
  const [abLoading, setAbLoading] = useState<boolean>(false);
  const [abError, setAbError] = useState<string | null>(null);
  const [showAbSql, setShowAbSql] = useState<boolean>(false);

  const switchTab = (next: DecisionTab) => {
    setActiveTab(next);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
  };

  // Load Anomalies
  const loadAnomalies = useCallback(async () => {
    setAnomalyLoading(true);
    setAnomalyError(null);
    try {
      const res = await apiClient.getStatisticalAnomalies();
      if (res.data) setAnomalyData(res.data);
    } catch (err) {
      setAnomalyError(err instanceof Error ? err.message : 'Failed to load anomaly alerts.');
    } finally {
      setAnomalyLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAnomalies();
    setRootCauseByAnomalyId({});
    setRootCauseErrorById({});
  }, [loadAnomalies, totalRows, dataMode]);

  const handleInvestigateRootCause = async (item: StatisticalAnomalyItem) => {
    // Toggle collapse if already open
    if (rootCauseByAnomalyId[item.id]) {
      setRootCauseByAnomalyId((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      return;
    }

    setRootCauseLoadingId(item.id);
    setRootCauseErrorById((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });

    try {
      const stateCode =
        item.metricKey === 'state_late_delivery_pct'
          ? item.suggestedSimulatorPreset?.targetState
          : undefined;
      const res = await apiClient.investigateAnomalyRootCause({
        period: item.period,
        metricKey: item.metricKey,
        stateCode
      });
      if (res.data) {
        setRootCauseByAnomalyId((prev) => ({ ...prev, [item.id]: res.data! }));
        const firstDim = res.data.dimensions[0]?.dimensionKey || 'category';
        setActiveRcaDimById((prev) => ({ ...prev, [item.id]: firstDim }));
      }
    } catch (err) {
      setRootCauseErrorById((prev) => ({
        ...prev,
        [item.id]:
          err instanceof Error ? err.message : 'Automated root-cause attribution failed.'
      }));
    } finally {
      setRootCauseLoadingId((prev) => (prev === item.id ? null : prev));
    }
  };

  const handleSliceDashboardFromDriver = (
    dimension: 'state' | 'category',
    value: string
  ) => {
    if (dimension === 'state') {
      updateDashboardFilters({ state: value });
    } else {
      updateDashboardFilters({ category: value });
    }
    navigate('/dashboards');
  };

  // Run What-If Simulation (debounced cleanly on slider change)
  const runSimulation = useCallback(async (input: WhatIfScenarioInput) => {
    setSimLoading(true);
    setSimError(null);
    try {
      const res = await apiClient.runWhatIfSimulation(input);
      if (res.data) setSimPayload(res.data);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Failed to run simulation.');
    } finally {
      setSimLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void runSimulation(scenario);
    }, 120);
    return () => clearTimeout(timer);
  }, [scenario, runSimulation, totalRows, dataMode]);

  // Run A/B Hypothesis Test
  const executeAbTest = useCallback(async () => {
    setAbLoading(true);
    setAbError(null);
    try {
      const res =
        abMode === 'duckdb'
          ? await apiClient.runAbHypothesisTest({
              presetId,
              metricKey,
              alpha,
              targetMdePct
            })
          : await apiClient.runAbHypothesisTest({
              presetId: 'custom_manual',
              metricKey: manualTestType === 'proportion' ? 'repeat_rate' : 'order_value',
              alpha,
              targetMdePct,
              manualInput: {
                testType: manualTestType,
                controlLabel: manualControlLabel,
                variantLabel: manualVariantLabel,
                nA: manualNA,
                meanOrSuccA: manualValA,
                stdDevA: manualSdA,
                nB: manualNB,
                meanOrSuccB: manualValB,
                stdDevB: manualSdB
              }
            });
      if (res.data) setAbResult(res.data);
    } catch (err) {
      setAbError(err instanceof Error ? err.message : 'Failed to execute hypothesis test.');
    } finally {
      setAbLoading(false);
    }
  }, [
    abMode,
    presetId,
    metricKey,
    alpha,
    targetMdePct,
    manualTestType,
    manualControlLabel,
    manualVariantLabel,
    manualNA,
    manualValA,
    manualSdA,
    manualNB,
    manualValB,
    manualSdB
  ]);

  useEffect(() => {
    if (abMode === 'duckdb') {
      void executeAbTest();
    }
  }, [abMode, presetId, metricKey, alpha, targetMdePct, totalRows, dataMode, executeAbTest]);

  const filteredAnomalies = useMemo(() => {
    if (!anomalyData) return [];
    return anomalyData.anomalies.filter((a) => {
      if (domainFilter !== 'ALL' && a.domain !== domainFilter) return false;
      if (severityFilter !== 'ALL' && a.severity !== severityFilter) return false;
      return true;
    });
  }, [anomalyData, domainFilter, severityFilter]);

  const handleSimulateFromAnomaly = (item: StatisticalAnomalyItem) => {
    const preset = item.suggestedSimulatorPreset || {};
    setScenario((prev) => ({
      ...prev,
      lateDeliveryReductionPct: preset.lateDeliveryReductionPct ?? prev.lateDeliveryReductionPct,
      freightReductionPct: preset.freightReductionPct ?? prev.freightReductionPct,
      repeatRateLiftPct: preset.repeatRateLiftPct ?? prev.repeatRateLiftPct,
      cancellationReductionPct: preset.cancellationReductionPct ?? prev.cancellationReductionPct,
      targetState: preset.targetState ?? 'ALL'
    }));
    switchTab('simulator');
  };

  const handleAskGeminiAboutAnomaly = (prompt: string) => {
    navigate(`/business-insights?prompt=${encodeURIComponent(prompt)}`);
  };

  const formatAbMetric = (val: number, unit: 'score' | 'currency' | 'percent') => {
    if (unit === 'currency') return formatMoneyPrecise(val);
    if (unit === 'percent') return `${val.toFixed(2)}%`;
    return `${val.toFixed(2)}★`;
  };

  return (
    <div className="space-y-6">
      <DataStateBanner />

      {/* Header + Segmented Mode Switcher */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--rp-ink)] tracking-tight">
            Decision Intelligence Lab
          </h1>
          <p className="text-xs text-[var(--rp-ink-muted)] mt-1">
            Automated Z-score &amp; IQR anomaly detection, DuckDB-grounded What-If revenue simulation, and frequentist A/B hypothesis testing.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Decision Lab workspaces"
          className="inline-flex items-center gap-1 p-1 rounded-full bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'anomalies'}
            onClick={() => switchTab('anomalies')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'anomalies'
                ? 'bg-[var(--rp-primary)] text-white shadow-xs'
                : 'text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Anomaly Alerts</span>
            {anomalyData && anomalyData.totalAnomalies > 0 && (
              <span className="font-mono tabular-nums opacity-90">
                ({anomalyData.totalAnomalies})
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'simulator'}
            onClick={() => switchTab('simulator')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'simulator'
                ? 'bg-[var(--rp-primary)] text-white shadow-xs'
                : 'text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>What-If Simulator</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ab-lab'}
            onClick={() => switchTab('ab-lab')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'ab-lab'
                ? 'bg-[var(--rp-primary)] text-white shadow-xs'
                : 'text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)]'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>A/B Hypothesis Lab</span>
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: STATISTICAL ANOMALY ALERTS                                     */}
      {/* ===================================================================== */}
      {activeTab === 'anomalies' && (
        <div className="space-y-5">
          {anomalyError && (
            <div className="p-4 rounded-xl bg-[var(--rp-surface)] border border-[#D93025]/40 text-xs text-[#D93025]">
              {anomalyError}
            </div>
          )}

          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="studio-card rounded-xl p-4">
              <div className="text-xs text-[var(--rp-ink-muted)]">Months Monitored</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--rp-ink)] mt-1">
                {anomalyLoading ? '—' : anomalyData?.monthsEvaluated ?? 0}
              </div>
              <div className="text-[11px] text-[var(--rp-ink-muted)] mt-0.5">
                Leave-one-out Z-score + Tukey IQR
              </div>
            </div>

            <div className="studio-card rounded-xl p-4">
              <div className="text-xs text-[var(--rp-ink-muted)]">Active Statistical Alerts</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--rp-primary)] mt-1">
                {anomalyLoading ? '—' : anomalyData?.totalAnomalies ?? 0}
              </div>
              <div className="text-[11px] text-[var(--rp-ink-muted)] mt-0.5">
                Revenue · SLA · Cancellations · Reviews
              </div>
            </div>

            <div className="studio-card rounded-xl p-4">
              <div className="text-xs text-[var(--rp-ink-muted)]">High-Severity Outliers</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[#D93025] mt-1">
                {anomalyLoading ? '—' : anomalyData?.highSeverityCount ?? 0}
              </div>
              <div className="text-[11px] text-[var(--rp-ink-muted)] mt-0.5">
                |Z| &ge; 2.5σ or IQR fence breach
              </div>
            </div>

            <div className="studio-card rounded-xl p-4">
              <div className="text-xs text-[var(--rp-ink-muted)]">Medium-Severity Watch</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[#E37400] mt-1">
                {anomalyLoading ? '—' : anomalyData?.mediumSeverityCount ?? 0}
              </div>
              <div className="text-[11px] text-[var(--rp-ink-muted)] mt-0.5">
                1.85σ &le; |Z| &lt; 2.50σ
              </div>
            </div>
          </div>

          {/* Monthly Anomaly Trajectory Chart */}
          {anomalyData && anomalyData.monthlySeries.length > 0 && (
            <div className="studio-card rounded-xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-sm font-bold text-[var(--rp-ink)]">
                    24-Month Revenue, Late-Delivery SLA &amp; Cancellation Anomaly Monitor
                  </h2>
                  <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5">
                    Bars show monthly revenue ($); red/amber lines track Late Delivery (%) and Cancellation (%) spikes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadAnomalies()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--rp-ink-secondary)] hover:text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${anomalyLoading ? 'animate-spin' : ''}`} />
                  <span>Re-Scan Warehouse</span>
                </button>
              </div>

              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={anomalyData.monthlySeries}
                    margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--rp-border)" opacity={0.7} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: 'var(--rp-ink-muted)' }}
                      tickMargin={8}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: 'var(--rp-ink-muted)' }}
                      tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11, fill: 'var(--rp-ink-muted)' }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--rp-surface)',
                        borderColor: 'var(--rp-border)',
                        borderRadius: '10px',
                        fontSize: '12px',
                        color: 'var(--rp-ink)'
                      }}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="revenue"
                      name="Monthly Revenue ($)"
                      radius={[4, 4, 0, 0]}
                    >
                      {anomalyData.monthlySeries.map((pt) => {
                        const isRevAnomaly = Math.abs(pt.revenueZScore) >= 1.85;
                        return (
                          <Cell
                            key={pt.month}
                            fill={isRevAnomaly ? '#1A73E8' : 'rgba(66, 133, 244, 0.35)'}
                          />
                        );
                      })}
                    </Bar>
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="lateDeliveryPct"
                      name="Late Delivery (%)"
                      stroke="#EA4335"
                      strokeWidth={2.2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="cancellationPct"
                      name="Cancellation (%)"
                      stroke="#F9AB00"
                      strokeWidth={2}
                      dot={{ r: 2.5 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Filter Controls + Alert Feed */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {['ALL', 'Revenue', 'Logistics SLA', 'Cancellations', 'Customer Satisfaction'].map(
                (dom) => (
                  <button
                    key={dom}
                    type="button"
                    onClick={() => setDomainFilter(dom)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                      domainFilter === dom
                        ? 'bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)] border-[var(--rp-primary)]'
                        : 'bg-[var(--rp-surface)] text-[var(--rp-ink-muted)] border-[var(--rp-border)] hover:text-[var(--rp-ink)]'
                    }`}
                  >
                    {dom === 'ALL' ? 'All Domains' : dom}
                  </button>
                )
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {['ALL', 'HIGH', 'MEDIUM'].map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverityFilter(sev)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    severityFilter === sev
                      ? 'bg-[var(--rp-primary)] text-white border-[var(--rp-primary)]'
                      : 'bg-[var(--rp-surface)] text-[var(--rp-ink-muted)] border-[var(--rp-border)] hover:text-[var(--rp-ink)]'
                  }`}
                >
                  {sev === 'ALL' ? 'All Severities' : sev}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredAnomalies.length === 0 && !anomalyLoading && (
              <div className="studio-card rounded-xl p-6 text-center text-xs text-[var(--rp-ink-muted)]">
                No anomalies matched the current domain and severity filter.
              </div>
            )}

            {filteredAnomalies.map((item) => {
              const isHigh = item.severity === 'HIGH';
              const showSql = expandedSqlId === item.id;
              const rca = rootCauseByAnomalyId[item.id];
              const isInvestigating = rootCauseLoadingId === item.id;
              const rcaError = rootCauseErrorById[item.id];
              const activeDimKey =
                activeRcaDimById[item.id] || rca?.dimensions[0]?.dimensionKey || 'category';
              const activeDimension =
                rca?.dimensions.find((d) => d.dimensionKey === activeDimKey) ||
                rca?.dimensions[0];

              const formatRcaVal = (val: number, unit: AnomalyRootCausePayload['unit']) =>
                unit === 'currency'
                  ? formatMoneyPrecise(val)
                  : unit === 'percent'
                  ? `${val.toFixed(2)}%`
                  : `${val.toFixed(2)}★`;

              const formatRcaDelta = (delta: number, unit: AnomalyRootCausePayload['unit']) =>
                unit === 'currency'
                  ? `${delta >= 0 ? '+' : '-'}${formatMoney(Math.abs(delta))}`
                  : unit === 'percent'
                  ? `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} pp`
                  : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}★`;

              return (
                <div key={item.id} className="studio-card rounded-xl p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1 max-w-3xl">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`font-mono font-bold ${
                            isHigh ? 'text-[#D93025]' : 'text-[#E37400]'
                          }`}
                        >
                          {item.severity}
                        </span>
                        <span className="text-[var(--rp-ink-muted)]">·</span>
                        <span className="font-semibold text-[var(--rp-ink)]">{item.domain}</span>
                        <span className="text-[var(--rp-ink-muted)]">·</span>
                        <span className="font-mono text-[var(--rp-primary)]">{item.period}</span>
                        <span className="text-[var(--rp-ink-muted)]">·</span>
                        <span className="font-mono tabular-nums text-[var(--rp-ink-muted)]">
                          Z = {item.zScore > 0 ? '+' : ''}
                          {item.zScore}σ · {item.iqrStatus.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-[var(--rp-ink)]">
                        {item.metricLabel}: {item.formattedObserved}{' '}
                        <span className="font-normal text-[var(--rp-ink-muted)]">
                          (baseline {item.formattedBaseline})
                        </span>
                      </h3>
                      <p className="text-xs text-[var(--rp-ink-secondary)] leading-relaxed">
                        {item.explanation}
                      </p>
                      <p className="text-xs text-[var(--rp-ink-muted)]">
                        <span className="font-semibold text-[var(--rp-ink)]">Recommended action:</span>{' '}
                        {item.recommendedAction}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleInvestigateRootCause(item)}
                        disabled={isInvestigating}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                          rca
                            ? 'bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)] border border-[var(--rp-primary)]'
                            : 'text-white bg-[var(--rp-primary)] hover:bg-[var(--rp-primary-hover)]'
                        }`}
                      >
                        <GitBranch className={`w-3.5 h-3.5 ${isInvestigating ? 'animate-pulse' : ''}`} />
                        <span>
                          {isInvestigating
                            ? 'Analyzing DuckDB...'
                            : rca
                            ? 'Hide Root Cause'
                            : 'Auto-Investigate'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSimulateFromAnomaly(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Sliders className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                        <span>Simulate Fix</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAskGeminiAboutAnomaly(item.suggestedAiPrompt)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <BrainCircuit className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                        <span>Ask Gemini AI</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setExpandedSqlId(showSql ? null : item.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] border border-[var(--rp-border)] cursor-pointer"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        <span>{showSql ? 'Hide SQL' : 'SQL'}</span>
                      </button>
                    </div>
                  </div>

                  {rcaError && (
                    <div className="p-3 rounded-lg bg-[#FCE8E6] dark:bg-red-950/50 border border-[#EA4335]/35 text-xs text-[#A50E0E] dark:text-red-200">
                      {rcaError}
                    </div>
                  )}

                  {/* Automated Multi-Dimensional Root-Cause Attribution Panel */}
                  {rca && activeDimension && (
                    <div className="mt-2 pt-4 border-t border-[var(--rp-border)] space-y-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1 max-w-3xl">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[var(--rp-primary)] font-semibold uppercase tracking-wider">
                            <GitBranch className="w-3.5 h-3.5" />
                            <span>Automated DuckDB Root-Cause Attribution</span>
                            <span className="text-[var(--rp-ink-muted)] font-normal normal-case">
                              · {rca.executionTimeMs.toFixed(1)} ms · 3 dimensions scanned
                            </span>
                          </div>
                          <p className="text-xs text-[var(--rp-ink)] leading-relaxed">
                            {rca.executiveVerdict}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {rca.topFilterSuggestion && (
                            <button
                              type="button"
                              onClick={() =>
                                handleSliceDashboardFromDriver(
                                  rca.topFilterSuggestion!.dimension,
                                  rca.topFilterSuggestion!.value
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--rp-primary-ink)] bg-[var(--rp-primary-soft)] hover:opacity-90 transition-opacity cursor-pointer"
                            >
                              <span>
                                Slice Dashboards ({rca.topFilterSuggestion.value})
                              </span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleInvestigateRootCause(item)}
                            aria-label="Close root cause attribution"
                            className="p-1.5 text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] rounded-lg hover:bg-[var(--rp-surface-subtle)] cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Dimension Tabs + Concentration Summary */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {rca.dimensions.map((dim) => {
                            const isDimActive = dim.dimensionKey === activeDimension.dimensionKey;
                            return (
                              <button
                                key={dim.dimensionKey}
                                type="button"
                                onClick={() =>
                                  setActiveRcaDimById((prev) => ({
                                    ...prev,
                                    [item.id]: dim.dimensionKey
                                  }))
                                }
                                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                                  isDimActive
                                    ? 'bg-[var(--rp-primary-soft)] border-[var(--rp-primary)] text-[var(--rp-primary-ink)] font-semibold'
                                    : 'bg-[var(--rp-surface-subtle)] border-[var(--rp-border)] text-[var(--rp-ink-secondary)] hover:text-[var(--rp-ink)]'
                                }`}
                              >
                                {dim.dimensionLabel}
                              </button>
                            );
                          })}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--rp-ink-muted)]">
                          <span>
                            Top-3 concentration:{' '}
                            <strong className="text-[var(--rp-ink)] tabular-nums">
                              {activeDimension.top3ConcentrationPct.toFixed(1)}%
                            </strong>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setShowRcaSqlById((prev) => ({
                                ...prev,
                                [item.id]: !prev[item.id]
                              }))
                            }
                            className="inline-flex items-center gap-1 text-[var(--rp-primary)] hover:underline cursor-pointer"
                          >
                            <Code2 className="w-3 h-3" />
                            <span>{showRcaSqlById[item.id] ? 'Hide Attribution SQL' : 'Attribution SQL'}</span>
                          </button>
                        </div>
                      </div>

                      {showRcaSqlById[item.id] && (
                        <pre className="code-surface rounded-lg p-3 text-[11px] font-mono overflow-x-auto leading-relaxed">
                          {activeDimension.executedSql}
                        </pre>
                      )}

                      {/* Ranked Contribution Table with Inline Share Bars */}
                      <div className="overflow-x-auto border border-[var(--rp-border)] rounded-xl">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-[var(--rp-surface-subtle)]">
                            <tr className="border-b border-[var(--rp-border)] text-[var(--rp-ink-muted)]">
                              <th className="py-2 px-3 font-semibold">Driver Segment</th>
                              <th className="py-2 px-3 font-semibold text-right">Target</th>
                              <th className="py-2 px-3 font-semibold text-right">Baseline Avg</th>
                              <th className="py-2 px-3 font-semibold text-right">Delta (Δ)</th>
                              <th className="py-2 px-3 font-semibold text-right">Orders</th>
                              <th className="py-2 px-3 font-semibold w-44">Variance Share</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--rp-border)]">
                            {activeDimension.drivers.map((drv) => {
                              const barWidth = Math.min(100, Math.max(2, drv.contributionSharePct));
                              const isPositiveDelta = drv.delta >= 0;
                              return (
                                <tr
                                  key={drv.segment}
                                  className="hover:bg-[var(--rp-surface-subtle)] transition-colors"
                                >
                                  <td className="py-2 px-3 font-medium text-[var(--rp-ink)]">
                                    {drv.segment.replace(/_/g, ' ')}
                                  </td>
                                  <td className="py-2 px-3 font-mono tabular-nums text-right text-[var(--rp-ink)]">
                                    {formatRcaVal(drv.targetValue, rca.unit)}
                                  </td>
                                  <td className="py-2 px-3 font-mono tabular-nums text-right text-[var(--rp-ink-muted)]">
                                    {formatRcaVal(drv.baselineValue, rca.unit)}
                                  </td>
                                  <td
                                    className={`py-2 px-3 font-mono tabular-nums text-right font-semibold ${
                                      rca.metricKey === 'monthly_revenue'
                                        ? isPositiveDelta
                                          ? 'text-[#137333] dark:text-emerald-400'
                                          : 'text-[#D93025] dark:text-red-400'
                                        : isPositiveDelta
                                        ? 'text-[#D93025] dark:text-red-400'
                                        : 'text-[#137333] dark:text-emerald-400'
                                    }`}
                                  >
                                    {formatRcaDelta(drv.delta, rca.unit)}
                                  </td>
                                  <td className="py-2 px-3 font-mono tabular-nums text-right text-[var(--rp-ink-muted)]">
                                    {drv.targetOrders.toLocaleString()}
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 h-1.5 rounded-full bg-[var(--rp-surface-subtle)] overflow-hidden">
                                        <div
                                          className="h-full rounded-full bg-[var(--rp-primary)]"
                                          style={{ width: `${barWidth}%` }}
                                        />
                                      </div>
                                      <span className="font-mono tabular-nums text-[11px] text-[var(--rp-ink)] w-11 text-right">
                                        {drv.contributionSharePct.toFixed(1)}%
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {showSql && (
                    <pre className="code-surface rounded-lg p-3.5 text-[11px] font-mono overflow-x-auto leading-relaxed">
                      {item.sqlLineage}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>

          {anomalyData && (
            <p className="text-[11px] text-[var(--rp-ink-muted)]">
              Methodology: {anomalyData.methodologyNote}
            </p>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: INTERACTIVE WHAT-IF REVENUE & SLA SIMULATOR                    */}
      {/* ===================================================================== */}
      {activeTab === 'simulator' && (
        <div className="space-y-5">
          {simError && (
            <div className="p-4 rounded-xl bg-[var(--rp-surface)] border border-[#D93025]/40 text-xs text-[#D93025]">
              {simError}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            {/* Left Column: Operational Lever Controls */}
            <div className="xl:col-span-5 studio-card rounded-xl p-5 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-[var(--rp-ink)]">
                    Operational Scenario Levers
                  </h2>
                  <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5">
                    Anchored to live DuckDB annualized baseline metrics.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setScenario(DEFAULT_SCENARIO)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>

              {/* Target State Selector */}
              <div className="space-y-1.5">
                <label
                  htmlFor="sim-target-state"
                  className="block text-xs font-semibold text-[var(--rp-ink-secondary)]"
                >
                  Geographic Rollout Scope
                </label>
                <select
                  id="sim-target-state"
                  value={scenario.targetState}
                  onChange={(e) => setScenario((p) => ({ ...p, targetState: e.target.value }))}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                >
                  <option value="ALL">All Brazil Marketplace (100% GMV Scope)</option>
                  {(simPayload?.baseline.availableStates || []).map((st) => (
                    <option key={st.state} value={st.state}>
                      State {st.state} — {st.orders.toLocaleString()} orders · {st.lateRatePct}% late
                    </option>
                  ))}
                </select>
              </div>

              {/* Slider 1 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="slider-late" className="font-semibold text-[var(--rp-ink)]">
                    Late Delivery Reduction
                  </label>
                  <span className="font-mono font-bold tabular-nums text-[var(--rp-primary)]">
                    -{scenario.lateDeliveryReductionPct}%
                  </span>
                </div>
                <input
                  id="slider-late"
                  type="range"
                  min={0}
                  max={80}
                  step={5}
                  value={scenario.lateDeliveryReductionPct}
                  onChange={(e) =>
                    setScenario((p) => ({
                      ...p,
                      lateDeliveryReductionPct: Number(e.target.value)
                    }))
                  }
                  className="w-full accent-[var(--rp-primary)] cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-[var(--rp-ink-muted)]">
                  <span>0% (No SLA change)</span>
                  <span>80% (Cross-dock reroute)</span>
                </div>
              </div>

              {/* Slider 2 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="slider-cancel" className="font-semibold text-[var(--rp-ink)]">
                    Cancellation Rate Reduction
                  </label>
                  <span className="font-mono font-bold tabular-nums text-[#1E8E3E]">
                    -{scenario.cancellationReductionPct}%
                  </span>
                </div>
                <input
                  id="slider-cancel"
                  type="range"
                  min={0}
                  max={60}
                  step={5}
                  value={scenario.cancellationReductionPct}
                  onChange={(e) =>
                    setScenario((p) => ({
                      ...p,
                      cancellationReductionPct: Number(e.target.value)
                    }))
                  }
                  className="w-full accent-[#1E8E3E] cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-[var(--rp-ink-muted)]">
                  <span>0%</span>
                  <span>60% (Real-time stock + payment retry)</span>
                </div>
              </div>

              {/* Slider 3 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="slider-repeat" className="font-semibold text-[var(--rp-ink)]">
                    Repeat Buyer Conversion Lift
                  </label>
                  <span className="font-mono font-bold tabular-nums text-[#9334E6]">
                    +{scenario.repeatRateLiftPct}%
                  </span>
                </div>
                <input
                  id="slider-repeat"
                  type="range"
                  min={0}
                  max={25}
                  step={1}
                  value={scenario.repeatRateLiftPct}
                  onChange={(e) =>
                    setScenario((p) => ({ ...p, repeatRateLiftPct: Number(e.target.value) }))
                  }
                  className="w-full accent-[#9334E6] cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-[var(--rp-ink-muted)]">
                  <span>0%</span>
                  <span>+25% (CRM win-back &amp; loyalty)</span>
                </div>
              </div>

              {/* Slider 4 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="slider-freight" className="font-semibold text-[var(--rp-ink)]">
                    Freight Friction Optimization
                  </label>
                  <span className="font-mono font-bold tabular-nums text-[#E37400]">
                    -{scenario.freightReductionPct}%
                  </span>
                </div>
                <input
                  id="slider-freight"
                  type="range"
                  min={0}
                  max={35}
                  step={1}
                  value={scenario.freightReductionPct}
                  onChange={(e) =>
                    setScenario((p) => ({ ...p, freightReductionPct: Number(e.target.value) }))
                  }
                  className="w-full accent-[#E37400] cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-[var(--rp-ink-muted)]">
                  <span>0%</span>
                  <span>-35% (Free-shipping threshold / regional hubs)</span>
                </div>
              </div>

              {simPayload && (
                <div className="pt-4 border-t border-[var(--rp-border)] text-[11px] text-[var(--rp-ink-muted)] space-y-1">
                  <div className="font-semibold text-[var(--rp-ink-secondary)]">
                    Live DuckDB Baseline ({simPayload.baseline.monthsObserved}m observed)
                  </div>
                  <div className="font-mono tabular-nums">
                    Annualized GMV: {formatMoney(simPayload.baseline.annualizedGmv)} · AOV:{' '}
                    {formatMoneyPrecise(simPayload.baseline.avgOrderValue)}
                  </div>
                  <div className="font-mono tabular-nums">
                    Late SLA: {simPayload.baseline.lateDeliveryRatePct}% · Avg Review:{' '}
                    {simPayload.baseline.avgReviewScore.toFixed(2)}★ · On-Time vs Late Δ:{' '}
                    {simPayload.baseline.reviewDeltaOnTimeVsLate.toFixed(2)}★
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Projected Impact Output & Sensitivity Table */}
            <div className="xl:col-span-7 space-y-5">
              {/* Projected Outcome KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="studio-card rounded-xl p-4">
                  <div className="text-xs text-[var(--rp-ink-muted)]">Projected Annual GMV Lift</div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-[#1E8E3E] mt-1">
                    {simPayload ? `+${formatMoney(simPayload.projectedAnnualGmvLift)}` : '—'}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[var(--rp-ink-muted)] mt-0.5">
                    {simPayload
                      ? `+${simPayload.projectedGmvLiftPct.toFixed(2)}% -> ${formatMoney(simPayload.projectedNewAnnualGmv)}`
                      : 'Calculating...'}
                  </div>
                </div>

                <div className="studio-card rounded-xl p-4">
                  <div className="text-xs text-[var(--rp-ink-muted)]">Projected Late SLA Rate</div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-[var(--rp-primary)] mt-1">
                    {simPayload ? `${simPayload.projectedNewLateRatePct.toFixed(2)}%` : '—'}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[var(--rp-ink-muted)] mt-0.5">
                    {simPayload
                      ? `Down from ${simPayload.baseline.lateDeliveryRatePct.toFixed(2)}% baseline`
                      : ''}
                  </div>
                </div>

                <div className="studio-card rounded-xl p-4">
                  <div className="text-xs text-[var(--rp-ink-muted)]">Projected Review Score</div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-[var(--rp-ink)] mt-1">
                    {simPayload ? `${simPayload.projectedNewReviewScore.toFixed(2)}★` : '—'}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#1E8E3E] mt-0.5">
                    {simPayload
                      ? `+${simPayload.projectedReviewGain.toFixed(2)}★ · +${simPayload.projectedRecoveredOrders.toLocaleString()} orders`
                      : ''}
                  </div>
                </div>
              </div>

              {/* Driver Breakdown Chart */}
              {simPayload && (
                <div className="studio-card rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-[var(--rp-ink)]">
                      Incremental Annual GMV by Operational Lever
                    </h3>
                    {simLoading && (
                      <span className="text-[11px] text-[var(--rp-ink-muted)] font-mono">
                        Updating...
                      </span>
                    )}
                  </div>
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={simPayload.impactBreakdown}
                        layout="vertical"
                        margin={{ top: 4, right: 24, left: 20, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--rp-border)" opacity={0.6} />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 11, fill: 'var(--rp-ink-muted)' }}
                          tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`}
                        />
                        <YAxis
                          type="category"
                          dataKey="driver"
                          width={150}
                          tick={{ fontSize: 11, fill: 'var(--rp-ink-secondary)' }}
                        />
                        <Tooltip
                          formatter={(value: unknown) => [formatMoneyPrecise(Number(value)), 'Annual GMV Impact']}
                          contentStyle={{
                            backgroundColor: 'var(--rp-surface)',
                            borderColor: 'var(--rp-border)',
                            borderRadius: '10px',
                            fontSize: '12px',
                            color: 'var(--rp-ink)'
                          }}
                        />
                        <Bar dataKey="annualGmvImpact" radius={[0, 6, 6, 0]}>
                          {simPayload.impactBreakdown.map((entry, idx) => {
                            const fills = ['#1A73E8', '#1E8E3E', '#9334E6', '#F9AB00'];
                            return <Cell key={entry.driver} fill={fills[idx % fills.length]} />;
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-3 pt-3 border-t border-[var(--rp-border)] space-y-1.5">
                    {simPayload.impactBreakdown.map((row) => (
                      <div
                        key={row.driver}
                        className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                      >
                        <span className="font-semibold text-[var(--rp-ink)]">{row.driver}</span>
                        <span className="text-[var(--rp-ink-muted)] flex-1 min-w-[200px]">
                          {row.mechanism}
                        </span>
                        <span className="font-mono font-semibold tabular-nums text-[var(--rp-ink)]">
                          +{formatMoney(row.annualGmvImpact)} ({row.sharePct}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Probabilistic Monte Carlo Risk Distribution (5,000 Trials) */}
              {simPayload?.monteCarlo && (() => {
                const mc = simPayload.monteCarlo;
                const findNearestBinLabel = (target: number): string | undefined => {
                  if (!mc.histogram.length) return undefined;
                  let best = mc.histogram[0];
                  let bestDist = Math.abs(best.midpoint - target);
                  for (const b of mc.histogram) {
                    const dist = Math.abs(b.midpoint - target);
                    if (dist < bestDist) {
                      best = b;
                      bestDist = dist;
                    }
                  }
                  return best.label;
                };
                const p10Label = findNearestBinLabel(mc.p10Lift);
                const p50Label = findNearestBinLabel(mc.p50Lift);
                const p90Label = findNearestBinLabel(mc.p90Lift);

                return (
                  <div className="studio-card rounded-xl p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-[var(--rp-ink)]">
                          Monte Carlo Risk Distribution ({mc.trials.toLocaleString()} Trials)
                        </h3>
                        <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5">
                          Empirical P10 / P50 / P90 annual GMV lift confidence bands under correlated demand &amp; execution variance.
                        </p>
                      </div>
                      <div className="text-right font-mono tabular-nums text-[11px] text-[var(--rp-ink-muted)]">
                        <div>Mean: {formatMoney(mc.meanLift)}</div>
                        <div>StdDev: ±{formatMoney(mc.stdDevLift)}</div>
                      </div>
                    </div>

                    {/* P10 / P50 / P90 Quantile Strip */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-lg p-3 bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)]">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#E37400]">
                          P10 Downside (10th %ile)
                        </div>
                        <div className="text-lg font-bold font-mono tabular-nums text-[var(--rp-ink)] mt-0.5">
                          +{formatMoney(mc.p10Lift)}
                        </div>
                        <div className="text-[11px] text-[var(--rp-ink-muted)]">
                          90% chance lift exceeds this floor
                        </div>
                      </div>

                      <div className="rounded-lg p-3 bg-[var(--rp-primary-soft)]/50 border border-[var(--rp-primary)]/30">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--rp-primary)]">
                          P50 Median Expected
                        </div>
                        <div className="text-lg font-bold font-mono tabular-nums text-[var(--rp-ink)] mt-0.5">
                          +{formatMoney(mc.p50Lift)}
                        </div>
                        <div className="text-[11px] text-[var(--rp-ink-muted)]">
                          Central outcome across {mc.trials.toLocaleString()} trials
                        </div>
                      </div>

                      <div className="rounded-lg p-3 bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)]">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#1E8E3E]">
                          P90 Upside (90th %ile)
                        </div>
                        <div className="text-lg font-bold font-mono tabular-nums text-[var(--rp-ink)] mt-0.5">
                          +{formatMoney(mc.p90Lift)}
                        </div>
                        <div className="text-[11px] text-[var(--rp-ink-muted)]">
                          Top-decile execution realization
                        </div>
                      </div>
                    </div>

                    {/* 20-Bin Probability Density Histogram */}
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={mc.histogram}
                          margin={{ top: 18, right: 16, left: 0, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--rp-border)" opacity={0.55} />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 10, fill: 'var(--rp-ink-muted)' }}
                            interval={2}
                          />
                          <YAxis
                            tick={{ fontSize: 10, fill: 'var(--rp-ink-muted)' }}
                            tickFormatter={(v) => `${v}%`}
                            width={38}
                          />
                          <Tooltip
                            formatter={(value: unknown, _name: unknown, item: { payload?: { count?: number; binMin?: number; binMax?: number } }) => [
                              `${Number(value).toFixed(2)}% (${(item?.payload?.count ?? 0).toLocaleString()} trials)`,
                              'Probability Density'
                            ]}
                            labelFormatter={(_label: unknown, payload: ReadonlyArray<{ payload?: { binMin?: number; binMax?: number } }>) => {
                              const bin = payload?.[0]?.payload;
                              if (!bin || bin.binMin === undefined || bin.binMax === undefined) {
                                return 'Projected Annual GMV Lift';
                              }
                              return `Annual Lift: ${formatMoney(bin.binMin)} – ${formatMoney(bin.binMax)}`;
                            }}
                            contentStyle={{
                              backgroundColor: 'var(--rp-surface)',
                              borderColor: 'var(--rp-border)',
                              borderRadius: '10px',
                              fontSize: '12px',
                              color: 'var(--rp-ink)'
                            }}
                          />
                          {p10Label && (
                            <ReferenceLine
                              x={p10Label}
                              stroke="#E37400"
                              strokeDasharray="4 4"
                              strokeWidth={1.5}
                              label={{ value: 'P10', position: 'top', fill: '#E37400', fontSize: 10, fontWeight: 700 }}
                            />
                          )}
                          {p50Label && (
                            <ReferenceLine
                              x={p50Label}
                              stroke="#1A73E8"
                              strokeWidth={2}
                              label={{ value: 'P50', position: 'top', fill: '#1A73E8', fontSize: 10, fontWeight: 700 }}
                            />
                          )}
                          {p90Label && (
                            <ReferenceLine
                              x={p90Label}
                              stroke="#1E8E3E"
                              strokeDasharray="4 4"
                              strokeWidth={1.5}
                              label={{ value: 'P90', position: 'top', fill: '#1E8E3E', fontSize: 10, fontWeight: 700 }}
                            />
                          )}
                          <Bar dataKey="probabilityPct" radius={[4, 4, 0, 0]}>
                            {mc.histogram.map((bin) => (
                              <Cell
                                key={bin.binIndex}
                                fill={bin.inInterquartileRange ? '#1A73E8' : '#94A3B8'}
                                fillOpacity={bin.inInterquartileRange ? 0.85 : 0.4}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Probability of Exceeding Key Thresholds */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[var(--rp-border)]">
                      {[
                        { label: 'P(Lift > $0)', pct: mc.probPositivePct, color: '#1A73E8' },
                        { label: 'P(Lift > $50K)', pct: mc.probExceeds50kPct, color: '#1E8E3E' },
                        { label: 'P(Lift > $100K)', pct: mc.probExceeds100kPct, color: '#9334E6' }
                      ].map((metric) => (
                        <div key={metric.label} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[var(--rp-ink-secondary)] font-medium">
                              {metric.label}
                            </span>
                            <span className="font-mono font-bold tabular-nums text-[var(--rp-ink)]">
                              {metric.pct.toFixed(1)}%
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-[var(--rp-surface-subtle)] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.min(100, Math.max(0, metric.pct))}%`,
                                backgroundColor: metric.color
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <p className="text-[11px] text-[var(--rp-ink-muted)] leading-relaxed">
                      {mc.methodologyNote}
                    </p>
                  </div>
                );
              })()}

              {/* Sensitivity Table */}
              {simPayload && (
                <div className="studio-card rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-[var(--rp-ink)]">
                    Sensitivity Analysis (Conservative / Base / Upside Realization)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[var(--rp-border)] text-[var(--rp-ink-muted)]">
                          <th className="py-2 pr-3 font-semibold">Case</th>
                          <th className="py-2 px-3 font-semibold text-right">Annual GMV Lift</th>
                          <th className="py-2 px-3 font-semibold text-right">Projected GMV</th>
                          <th className="py-2 px-3 font-semibold text-right">Late SLA</th>
                          <th className="py-2 px-3 font-semibold text-right">Review Score</th>
                          <th className="py-2 pl-3 font-semibold text-right">Addl. Orders</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--rp-border)]">
                        {simPayload.sensitivityTable.map((row) => (
                          <tr
                            key={row.caseLabel}
                            className={
                              row.multiplier === 1
                                ? 'bg-[var(--rp-primary-soft)]/40 font-semibold'
                                : ''
                            }
                          >
                            <td className="py-2.5 pr-3 text-[var(--rp-ink)]">{row.caseLabel}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#1E8E3E]">
                              +{formatMoney(row.projectedAnnualGmvLift)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[var(--rp-ink)]">
                              {formatMoney(row.projectedNewAnnualGmv)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[var(--rp-ink-secondary)]">
                              {row.projectedLateRatePct.toFixed(2)}%
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[var(--rp-ink)]">
                              {row.projectedReviewScore.toFixed(2)}★
                            </td>
                            <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-[var(--rp-primary)]">
                              +{row.projectedAdditionalOrders.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="pt-2 space-y-1 text-[11px] text-[var(--rp-ink-muted)]">
                    {simPayload.assumptionsAndLimitations.map((note, idx) => (
                      <div key={idx}>• {note}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: A/B TEST & STATISTICAL HYPOTHESIS LAB                          */}
      {/* ===================================================================== */}
      {activeTab === 'ab-lab' && (
        <div className="space-y-5">
          {abError && (
            <div className="p-4 rounded-xl bg-[var(--rp-surface)] border border-[#D93025]/40 text-xs text-[#D93025]">
              {abError}
            </div>
          )}

          {/* Controls Card */}
          <div className="studio-card rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--rp-ink)]">
                  Frequentist Experimentation &amp; Cohort Hypothesis Engine
                </h2>
                <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5">
                  Welch’s unequal-variance t-test (continuous) and two-proportion z-test (rates) with exact two-tailed p-values &amp; MDE sample-size sizing.
                </p>
              </div>

              <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)]">
                <button
                  type="button"
                  onClick={() => setAbMode('duckdb')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                    abMode === 'duckdb'
                      ? 'bg-[var(--rp-surface)] text-[var(--rp-ink)] shadow-2xs border border-[var(--rp-border)]'
                      : 'text-[var(--rp-ink-muted)]'
                  }`}
                >
                  Live DuckDB Cohorts
                </button>
                <button
                  type="button"
                  onClick={() => setAbMode('custom')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                    abMode === 'custom'
                      ? 'bg-[var(--rp-surface)] text-[var(--rp-ink)] shadow-2xs border border-[var(--rp-border)]'
                      : 'text-[var(--rp-ink-muted)]'
                  }`}
                >
                  Custom Experiment Calculator
                </button>
              </div>
            </div>

            {abMode === 'duckdb' ? (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
                <div className="md:col-span-2 space-y-1">
                  <label
                    htmlFor="ab-preset"
                    className="block text-xs font-semibold text-[var(--rp-ink-secondary)]"
                  >
                    DuckDB Cohort Comparison Preset
                  </label>
                  <select
                    id="ab-preset"
                    value={presetId}
                    onChange={(e) =>
                      setPresetId(e.target.value as Exclude<AbTestCohortPresetId, 'custom_manual'>)
                    }
                    className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                  >
                    {COHORT_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} — {p.detail}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="ab-metric"
                    className="block text-xs font-semibold text-[var(--rp-ink-secondary)]"
                  >
                    Primary Metric
                  </label>
                  <select
                    id="ab-metric"
                    value={metricKey}
                    onChange={(e) => setMetricKey(e.target.value as AbTestMetricKey)}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                  >
                    {METRIC_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label
                      htmlFor="ab-alpha"
                      className="block text-xs font-semibold text-[var(--rp-ink-secondary)]"
                    >
                      Alpha (α)
                    </label>
                    <select
                      id="ab-alpha"
                      value={alpha}
                      onChange={(e) => setAlpha(Number(e.target.value))}
                      className="w-full px-2.5 py-2 text-xs font-mono rounded-lg bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                    >
                      <option value={0.01}>0.01 (99%)</option>
                      <option value={0.05}>0.05 (95%)</option>
                      <option value={0.1}>0.10 (90%)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="ab-mde"
                      className="block text-xs font-semibold text-[var(--rp-ink-secondary)]"
                    >
                      Target MDE %
                    </label>
                    <input
                      id="ab-mde"
                      type="number"
                      min={1}
                      max={30}
                      value={targetMdePct}
                      onChange={(e) => setTargetMdePct(Math.max(1, Number(e.target.value) || 5))}
                      className="w-full px-2.5 py-2 text-xs font-mono rounded-lg bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-semibold text-[var(--rp-ink-secondary)]">Metric Type:</span>
                  <button
                    type="button"
                    onClick={() => setManualTestType('proportion')}
                    className={`px-3 py-1 rounded-lg font-semibold border cursor-pointer ${
                      manualTestType === 'proportion'
                        ? 'bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)] border-[var(--rp-primary)]'
                        : 'bg-[var(--rp-surface-subtle)] text-[var(--rp-ink-muted)] border-[var(--rp-border)]'
                    }`}
                  >
                    Conversion / Proportion (Two-Prop Z-Test)
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualTestType('continuous')}
                    className={`px-3 py-1 rounded-lg font-semibold border cursor-pointer ${
                      manualTestType === 'continuous'
                        ? 'bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)] border-[var(--rp-primary)]'
                        : 'bg-[var(--rp-surface-subtle)] text-[var(--rp-ink-muted)] border-[var(--rp-border)]'
                    }`}
                  >
                    Continuous Mean (Welch’s t-Test)
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-lg bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] space-y-2.5">
                    <input
                      type="text"
                      value={manualControlLabel}
                      onChange={(e) => setManualControlLabel(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded bg-[var(--rp-surface)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[11px] text-[var(--rp-ink-muted)]">Sample nA</label>
                        <input
                          type="number"
                          value={manualNA}
                          onChange={(e) => setManualNA(Number(e.target.value))}
                          className="w-full px-2 py-1.5 text-xs font-mono rounded bg-[var(--rp-surface)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-[var(--rp-ink-muted)]">
                          {manualTestType === 'proportion' ? 'Conversions' : 'Mean A'}
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={manualValA}
                          onChange={(e) => setManualValA(Number(e.target.value))}
                          className="w-full px-2 py-1.5 text-xs font-mono rounded bg-[var(--rp-surface)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                        />
                      </div>
                      {manualTestType === 'continuous' && (
                        <div>
                          <label className="text-[11px] text-[var(--rp-ink-muted)]">StdDev A</label>
                          <input
                            type="number"
                            step="any"
                            value={manualSdA}
                            onChange={(e) => setManualSdA(Number(e.target.value))}
                            className="w-full px-2 py-1.5 text-xs font-mono rounded bg-[var(--rp-surface)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] space-y-2.5">
                    <input
                      type="text"
                      value={manualVariantLabel}
                      onChange={(e) => setManualVariantLabel(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded bg-[var(--rp-surface)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[11px] text-[var(--rp-ink-muted)]">Sample nB</label>
                        <input
                          type="number"
                          value={manualNB}
                          onChange={(e) => setManualNB(Number(e.target.value))}
                          className="w-full px-2 py-1.5 text-xs font-mono rounded bg-[var(--rp-surface)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-[var(--rp-ink-muted)]">
                          {manualTestType === 'proportion' ? 'Conversions' : 'Mean B'}
                        </label>
                        <input
                          type="number"
                          step="any"
                          value={manualValB}
                          onChange={(e) => setManualValB(Number(e.target.value))}
                          className="w-full px-2 py-1.5 text-xs font-mono rounded bg-[var(--rp-surface)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                        />
                      </div>
                      {manualTestType === 'continuous' && (
                        <div>
                          <label className="text-[11px] text-[var(--rp-ink-muted)]">StdDev B</label>
                          <input
                            type="number"
                            step="any"
                            value={manualSdB}
                            onChange={(e) => setManualSdB(Number(e.target.value))}
                            className="w-full px-2 py-1.5 text-xs font-mono rounded bg-[var(--rp-surface)] border border-[var(--rp-border)] text-[var(--rp-ink)]"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={abLoading}
                    onClick={() => void executeAbTest()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[var(--rp-primary)] hover:bg-[var(--rp-primary-hover)] cursor-pointer"
                  >
                    <FlaskConical className="w-3.5 h-3.5" />
                    <span>{abLoading ? 'Computing...' : 'Run Statistical Test'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Statistical Results */}
          {abResult && (
            <>
              {/* Verdict Banner */}
              <div className="studio-card rounded-xl p-5 flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5 max-w-3xl">
                  <div className="flex items-center gap-2 text-xs">
                    {abResult.isStatisticallySignificant ? (
                      <CheckCircle2 className="w-4 h-4 text-[#1E8E3E]" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-[#E37400]" />
                    )}
                    <span
                      className={`font-mono font-bold ${
                        abResult.verdict === 'SIGNIFICANT_LIFT'
                          ? 'text-[#1E8E3E]'
                          : abResult.verdict === 'SIGNIFICANT_REGRESSION'
                            ? 'text-[#D93025]'
                            : 'text-[#E37400]'
                      }`}
                    >
                      {abResult.verdict.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[var(--rp-ink-muted)]">·</span>
                    <span className="font-mono text-[var(--rp-ink-muted)]">
                      {abResult.testMethod.replace(/_/g, ' ')}
                    </span>
                    {abResult.degreesOfFreedom !== null && (
                      <>
                        <span className="text-[var(--rp-ink-muted)]">·</span>
                        <span className="font-mono tabular-nums text-[var(--rp-ink-muted)]">
                          df = {abResult.degreesOfFreedom.toLocaleString()}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-[var(--rp-ink)]">
                    {abResult.verdictSummary}
                  </p>
                  <p className="text-xs text-[var(--rp-ink-muted)]">
                    {abResult.correlationVsCausationCaveat}
                  </p>
                </div>

                {abResult.executedSql && (
                  <button
                    type="button"
                    onClick={() => setShowAbSql((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--rp-ink-secondary)] bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>{showAbSql ? 'Hide SQL' : 'Inspect Cohort SQL'}</span>
                  </button>
                )}
              </div>

              {showAbSql && abResult.executedSql && (
                <pre className="code-surface rounded-xl p-4 text-[11px] font-mono overflow-x-auto leading-relaxed">
                  {abResult.executedSql}
                </pre>
              )}

              {/* Control vs Variant + Statistical Readout Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-6 studio-card rounded-xl p-5 space-y-4">
                  <h3 className="text-sm font-bold text-[var(--rp-ink)]">
                    Arm Comparison — {abResult.metricLabel}
                  </h3>

                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="p-4 rounded-lg bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)]">
                      <div className="text-[11px] font-mono text-[var(--rp-ink-muted)]">
                        CONTROL (A) · n = {abResult.control.sampleSize.toLocaleString()}
                      </div>
                      <div className="text-xs font-semibold text-[var(--rp-ink)] mt-0.5 truncate">
                        {abResult.control.label}
                      </div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-[var(--rp-ink)] mt-2">
                        {formatAbMetric(abResult.control.value, abResult.metricUnit)}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[var(--rp-ink-muted)] mt-1">
                        σ = {abResult.control.stdDev.toFixed(2)}
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-[var(--rp-surface-subtle)] border border-[var(--rp-primary)]/40">
                      <div className="text-[11px] font-mono text-[var(--rp-primary)]">
                        VARIANT (B) · n = {abResult.variant.sampleSize.toLocaleString()}
                      </div>
                      <div className="text-xs font-semibold text-[var(--rp-ink)] mt-0.5 truncate">
                        {abResult.variant.label}
                      </div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-[var(--rp-primary)] mt-2">
                        {formatAbMetric(abResult.variant.value, abResult.metricUnit)}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[var(--rp-ink-muted)] mt-1">
                        σ = {abResult.variant.stdDev.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Key Frequentist Statistics Table */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-[var(--rp-border)] text-xs">
                    <div>
                      <div className="text-[11px] text-[var(--rp-ink-muted)]">Relative Lift</div>
                      <div
                        className={`text-base font-bold font-mono tabular-nums ${
                          abResult.relativeLiftPct >= 0 ? 'text-[#1E8E3E]' : 'text-[#D93025]'
                        }`}
                      >
                        {abResult.relativeLiftPct >= 0 ? '+' : ''}
                        {abResult.relativeLiftPct.toFixed(2)}%
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-[var(--rp-ink-muted)]">Two-Tailed p-Value</div>
                      <div className="text-base font-bold font-mono tabular-nums text-[var(--rp-ink)]">
                        {abResult.pValue}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-[var(--rp-ink-muted)]">
                        Test Stat ({abResult.testMethod === 'WELCH_T_TEST' ? 't' : 'z'})
                      </div>
                      <div className="text-base font-bold font-mono tabular-nums text-[var(--rp-ink)]">
                        {abResult.testStatistic.toFixed(3)}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-[var(--rp-ink-muted)]">95% CI (Delta)</div>
                      <div className="text-xs font-bold font-mono tabular-nums text-[var(--rp-ink)] mt-1">
                        [{abResult.confidenceInterval95[0]}, {abResult.confidenceInterval95[1]}]
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-[var(--rp-ink-muted)]">
                        Effect Size (Cohen’s {abResult.testMethod === 'WELCH_T_TEST' ? 'd' : 'h'})
                      </div>
                      <div className="text-base font-bold font-mono tabular-nums text-[var(--rp-ink)]">
                        {abResult.cohensD.toFixed(3)}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-[var(--rp-ink-muted)]">Achieved Power</div>
                      <div className="text-base font-bold font-mono tabular-nums text-[var(--rp-primary)]">
                        {abResult.achievedPowerPct.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Power / MDE Sample Size Curve */}
                <div className="lg:col-span-6 studio-card rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-[var(--rp-ink)]">
                        Sample Size per Arm vs. Minimum Detectable Effect (80% Power)
                      </h3>
                      <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5">
                        At target {abResult.targetMdePct}% relative MDE (α = {abResult.alpha}), you need{' '}
                        <span className="font-mono font-semibold text-[var(--rp-ink)]">
                          {abResult.requiredSamplePerArmForTargetMde.toLocaleString()}
                        </span>{' '}
                        observations per arm.
                      </p>
                    </div>
                  </div>

                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={abResult.powerCurve}
                        margin={{ top: 10, right: 16, left: 6, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--rp-border)" opacity={0.6} />
                        <XAxis
                          dataKey="mdeRelativePct"
                          tick={{ fontSize: 11, fill: 'var(--rp-ink-muted)' }}
                          tickFormatter={(v) => `${v}%`}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: 'var(--rp-ink-muted)' }}
                          tickFormatter={(v) =>
                            Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(0)}k` : String(v)
                          }
                        />
                        <Tooltip
                          formatter={(value: unknown) => [
                            `${Number(value).toLocaleString()} / arm`,
                            'Required Sample (80% Power)'
                          ]}
                          labelFormatter={(l) => `Relative MDE: ${l}%`}
                          contentStyle={{
                            backgroundColor: 'var(--rp-surface)',
                            borderColor: 'var(--rp-border)',
                            borderRadius: '10px',
                            fontSize: '12px',
                            color: 'var(--rp-ink)'
                          }}
                        />
                        <ReferenceLine
                          x={abResult.targetMdePct}
                          stroke="#EA4335"
                          strokeDasharray="4 4"
                        />
                        <Area
                          type="monotone"
                          dataKey="requiredSamplePerArm"
                          stroke="#1A73E8"
                          fill="rgba(26, 115, 232, 0.16)"
                          strokeWidth={2.2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[var(--rp-border)] text-xs">
                    <span className="text-[var(--rp-ink-muted)]">
                      Explore deeper with Gemini BI Assistant
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleAskGeminiAboutAnomaly(
                          `Run an A/B cohort comparison for ${abResult.control.label} vs ${abResult.variant.label} on ${abResult.metricLabel} and interpret the business impact.`
                        )
                      }
                      className="inline-flex items-center gap-1 font-semibold text-[var(--rp-primary)] hover:underline cursor-pointer"
                    >
                      <span>Ask Gemini</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
