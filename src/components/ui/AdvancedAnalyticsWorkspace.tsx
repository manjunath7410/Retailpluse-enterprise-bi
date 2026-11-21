import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Calendar,
  CheckCircle2,
  Code2,
  Compass,
  Database,
  Download,
  Filter,
  Grid,
  Info,
  Layers,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Truck,
  Users
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import {
  AdvancedAnalyticsSuitePayload,
  AdvancedModuleId,
  RfmSegmentName
} from '../../types/analytics';
import { apiClient } from '../../services/apiClient';
import { usePlatform } from '../../context/PlatformContext';
import { useTheme } from '../../context/ThemeContext';

interface AdvancedAnalyticsWorkspaceProps {
  defaultModule?: AdvancedModuleId;
  compactHeader?: boolean;
}

const MODULE_TABS: {
  id: AdvancedModuleId;
  label: string;
  shortDesc: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  {
    id: 'rfm-segmentation',
    label: 'RFM Segments',
    shortDesc: 'Recency, Frequency & Monetary 7-tier scoring',
    icon: Users
  },
  {
    id: 'cohort-retention',
    label: 'Cohorts',
    shortDesc: 'Monthly acquisition retention heatmap',
    icon: Grid
  },
  {
    id: 'delivery-satisfaction',
    label: 'Delivery & Reviews',
    shortDesc: 'SLA delay vs. star ratings & correlation analysis',
    icon: Truck
  },
  {
    id: 'seller-performance',
    label: 'Sellers',
    shortDesc: 'Empirical Bayes sample-size adjusted ranking',
    icon: Award
  },
  {
    id: 'business-opportunities',
    label: 'Opportunities',
    shortDesc: 'SQL-derived anomalies across categories & regions',
    icon: Compass
  },
  {
    id: 'sales-forecasting',
    label: 'Forecast',
    shortDesc: 'Chronological train/test split & baseline backtesting',
    icon: TrendingUp
  }
];

function exportRecordsToCsv(
  filename: string,
  rows: Record<string, string | number | boolean | null | undefined>[]
): void {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const val = r[h];
          if (val === null || val === undefined) return '';
          const str = String(val).replace(/"/g, '""');
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str}"`
            : str;
        })
        .join(',')
    )
  ];
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const AdvancedAnalyticsWorkspace: React.FC<AdvancedAnalyticsWorkspaceProps> = ({
  defaultModule = 'rfm-segmentation',
  compactHeader = false
}) => {
  const navigate = useNavigate();
  const { themeConfig } = useTheme();
  const { refreshPlatformState, totalRows } = usePlatform();

  const tooltipBoxStyle: React.CSSProperties = {
    backgroundColor: themeConfig.tooltipBg,
    borderColor: themeConfig.tooltipBorder,
    borderRadius: '12px',
    fontSize: '12px',
    color: themeConfig.tooltipText,
    boxShadow: themeConfig.isDark
      ? '0 10px 30px rgba(0,0,0,0.45)'
      : '0 10px 26px rgba(15,23,42,0.12)'
  };

  const [activeTab, setActiveTab] = useState<AdvancedModuleId>(defaultModule);
  const [payload, setPayload] = useState<AdvancedAnalyticsSuitePayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Interactive parameters
  const [minSellerOrders, setMinSellerOrders] = useState<number>(3);
  const [forecastHorizonMonths, setForecastHorizonMonths] = useState<number>(3);
  const [selectedRfmSegment, setSelectedRfmSegment] = useState<RfmSegmentName | 'ALL'>('ALL');
  const [openSqlModule, setOpenSqlModule] = useState<string | null>(null);
  const [seedingDemo, setSeedingDemo] = useState<boolean>(false);

  useEffect(() => {
    setActiveTab(defaultModule);
  }, [defaultModule]);

  const loadSuite = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getAdvancedAnalytics({
        minSellerOrders,
        forecastHorizonMonths
      });
      if (res.data) {
        setPayload(res.data);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to compute advanced analytical suite'
      );
    } finally {
      setLoading(false);
    }
  }, [minSellerOrders, forecastHorizonMonths]);

  useEffect(() => {
    void loadSuite();
  }, [loadSuite, totalRows]);

  const handleSeedDemo = async () => {
    setSeedingDemo(true);
    try {
      await apiClient.seedDemoData();
      await refreshPlatformState();
      await loadSuite();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seed Olist dataset');
    } finally {
      setSeedingDemo(false);
    }
  };

  if (loading && !payload) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-4 w-48 bg-slate-800 rounded animate-pulse" />
            <div className="h-6 w-96 bg-slate-800 rounded animate-pulse" />
          </div>
          <div className="h-9 w-36 bg-slate-800 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="h-16 bg-slate-950 border border-slate-800 rounded animate-pulse" />
          ))}
        </div>
        <div className="h-80 bg-slate-950 border border-slate-800 rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-950/30 border border-rose-500/40 rounded-lg p-6 text-rose-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold">Advanced Analytical Engine Error</h3>
            <p className="text-xs text-rose-300/90 mt-0.5">{error}</p>
          </div>
        </div>
        <button
          onClick={loadSuite}
          className="px-3 py-1.5 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-xs font-medium text-rose-200 transition-colors cursor-pointer"
        >
          Retry Computation
        </button>
      </div>
    );
  }

  if (!payload || !payload.isReady) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center space-y-4">
        <Database className="w-10 h-10 text-amber-400 mx-auto" />
        <div className="max-w-lg mx-auto space-y-1.5">
          <h3 className="text-base font-semibold text-[var(--rp-ink)]">
            No Analytical Dataset Loaded in DuckDB
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Advanced Analytical Capabilities (RFM Segmentation, Cohort Heatmaps, Delivery Econometrics, Sample-Adjusted Seller Ranking, Opportunity Detection, and Time-Series Forecasting) require active Olist records in DuckDB.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={handleSeedDemo}
            disabled={seedingDemo}
            className="px-4 py-2 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold transition-colors cursor-pointer"
          >
            {seedingDemo ? 'Loading Olist Benchmark Data...' : 'Load Olist Benchmark Dataset'}
          </button>
          <button
            onClick={() => navigate('/data-management')}
            className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors cursor-pointer"
          >
            Upload Custom CSVs
          </button>
        </div>
      </div>
    );
  }

  const {
    rfmSegmentation,
    cohortAnalysis,
    deliverySatisfaction,
    sellerPerformance,
    businessOpportunities,
    salesForecasting
  } = payload;

  const filteredRfmCustomers =
    selectedRfmSegment === 'ALL'
      ? rfmSegmentation.customerRecords
      : rfmSegmentation.customerRecords.filter((c) => c.segment === selectedRfmSegment);

  return (
    <div className="space-y-5" data-testid="advanced-analytics-workspace">
      {/* Clean Header Banner */}
      {!compactHeader && (
        <div className="bg-[#111827] border border-slate-800 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-50 tracking-tight">
              Advanced Analytics &amp; Forecasting
            </h2>
            <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
              Live DuckDB statistical models across {rfmSegmentation.totalUniqueCustomers.toLocaleString()} unique customers — RFM tiers, retention cohorts, seller benchmarks, and backtested forecasts.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadSuite}
              disabled={loading}
              data-testid="refresh-advanced-suite-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#8ab4f8]' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/sql-lab')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1a2842] hover:bg-[#223456] border border-[#4285f4]/40 text-xs font-medium text-[#8ab4f8] transition-colors whitespace-nowrap cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>SQL Studio</span>
            </button>
          </div>
        </div>
      )}

      {/* Clean Google Cloud / GA4 Horizontal Underline Tab Bar */}
      <div
        className="flex items-center gap-1 border-b border-slate-800 overflow-x-auto"
        role="tablist"
        aria-label="Advanced Analytical Modules"
      >
        {MODULE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={tab.shortDesc}
              data-testid={`adv-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'border-[#8ab4f8] text-[#8ab4f8]'
                  : 'border-transparent text-slate-400 hover:text-slate-100 hover:border-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* =====================================================================
          MODULE 1: RFM CUSTOMER SEGMENTATION
      ===================================================================== */}
      {activeTab === 'rfm-segmentation' && (
        <div className="space-y-5" data-testid="module-rfm-segmentation">
          {/* Top KPI Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Dataset Reference Anchor Date
              </div>
              <div className="text-xl font-bold font-mono text-[var(--rp-ink)] mt-1 tabular-nums">
                {rfmSegmentation.anchorDate}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                MAX(order_purchase_timestamp) for R_days
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Evaluated Unique Customers
              </div>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1 tabular-nums">
                {rfmSegmentation.totalUniqueCustomers}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Grouped strictly by customer_unique_id
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Total Lifetime Monetary Value
              </div>
              <div className="text-xl font-bold font-mono text-sky-400 mt-1 tabular-nums">
                ${rfmSegmentation.totalMonetaryValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Cumulative merchandise + freight value
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Defined RFM Taxonomy Tiers
              </div>
              <div className="text-xl font-bold font-mono text-amber-400 mt-1 tabular-nums">
                {rfmSegmentation.segmentDefinitions.length} Segments
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Deterministic 1–5 scoring rules documented below
              </div>
            </div>
          </div>

          {/* Documented RFM Mathematical Scoring Methodology */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-400" />
                <h3 className="text-sm font-semibold text-[var(--rp-ink)]">
                  Documented RFM Scoring Methodology & Mathematical Rules
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setOpenSqlModule(openSqlModule === 'rfm' ? null : 'rfm')
                  }
                  className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 cursor-pointer"
                >
                  {openSqlModule === 'rfm' ? 'Hide DuckDB SQL' : 'Inspect DuckDB SQL'}
                </button>
                <button
                  onClick={() =>
                    exportRecordsToCsv(
                      'retailpulse_rfm_customers.csv',
                      rfmSegmentation.customerRecords as unknown as Record<string, string | number>[]
                    )
                  }
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>Export RFM CSV</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-1">
                <div className="font-mono font-semibold text-sky-400">
                  1. Recency Score (R: 1–5)
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {rfmSegmentation.scoringMethodology.recencyFormula}
                </p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-1">
                <div className="font-mono font-semibold text-emerald-400">
                  2. Frequency Score (F: 1–5)
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {rfmSegmentation.scoringMethodology.frequencyFormula}
                </p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-1">
                <div className="font-mono font-semibold text-amber-400">
                  3. Monetary Score (M: 1–5)
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {rfmSegmentation.scoringMethodology.monetaryFormula}
                </p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-1">
                <div className="font-mono font-semibold text-purple-400">
                  4. Composite Index & Assignment
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {rfmSegmentation.scoringMethodology.scaleExplanation}
                </p>
              </div>
            </div>

            {openSqlModule === 'rfm' && (
              <pre className="bg-slate-950 border border-slate-800 rounded p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                {rfmSegmentation.executedSql}
              </pre>
            )}
          </div>

          {/* RFM Visual Distribution + 7 Segment Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-[var(--rp-ink)] mb-1">
                Revenue & Customer Share by RFM Segment
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Click any segment row or filter button to inspect individual customer scores
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={rfmSegmentation.segmentSummary}
                    layout="vertical"
                    margin={{ top: 5, right: 20, left: 30, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={themeConfig.gridColor} />
                    <XAxis type="number" stroke={themeConfig.axisColor} fontSize={11} />
                    <YAxis
                      dataKey="segment"
                      type="category"
                      stroke={themeConfig.axisColor}
                      fontSize={11}
                      width={115}
                    />
                    <Tooltip
                      contentStyle={tooltipBoxStyle}
                      itemStyle={{ color: themeConfig.tooltipText }}
                      formatter={(val: unknown, name: unknown) => [
                        String(name) === 'totalMonetaryValue'
                          ? `$${Number(val || 0).toFixed(2)}`
                          : `${Number(val || 0)} customers`,
                        String(name) === 'totalMonetaryValue' ? 'Total Spend' : 'Customers'
                      ]}
                    />
                    <Bar
                      dataKey="totalMonetaryValue"
                      name="totalMonetaryValue"
                      fill={themeConfig.chartPalette[0]}
                      radius={[0, 6, 6, 0]}
                    >
                      {rfmSegmentation.segmentSummary.map((entry, idx) => (
                        <Cell
                          key={entry.segment}
                          fill={themeConfig.chartPalette[idx % themeConfig.chartPalette.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 7 Segment Taxonomy & Summary Table */}
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-lg p-5 overflow-x-auto">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--rp-ink)]">
                    7-Segment RFM Classification Matrix & Playbook
                  </h3>
                  <p className="text-xs text-slate-400">
                    All 7 required customer segments with explicit mathematical thresholds and commercial actions
                  </p>
                </div>
                {selectedRfmSegment !== 'ALL' && (
                  <button
                    onClick={() => setSelectedRfmSegment('ALL')}
                    className="text-xs text-sky-400 hover:underline cursor-pointer"
                  >
                    Reset Filter ({selectedRfmSegment})
                  </button>
                )}
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400">
                    <th className="py-2 pr-3">Segment</th>
                    <th className="py-2 px-2">Scoring Rule</th>
                    <th className="py-2 px-2 text-right">Customers</th>
                    <th className="py-2 px-2 text-right">Monetary</th>
                    <th className="py-2 px-2 text-right">Avg R / F / M</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {rfmSegmentation.segmentSummary.map((row) => {
                    const isSelected = selectedRfmSegment === row.segment;
                    return (
                      <tr
                        key={row.segment}
                        onClick={() =>
                          setSelectedRfmSegment(isSelected ? 'ALL' : row.segment)
                        }
                        className={`transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-sky-500/15'
                            : 'hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="py-2.5 pr-3 font-semibold text-[var(--rp-ink)] whitespace-nowrap">
                          {row.segment}
                        </td>
                        <td className="py-2.5 px-2 text-[11px] font-mono text-slate-300">
                          {row.scoringRule}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-200">
                          {row.customerCount} ({row.customerSharePct.toFixed(1)}%)
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-emerald-400">
                          ${row.totalMonetaryValue.toFixed(2)} ({row.revenueSharePct.toFixed(1)}%)
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {row.avgRecencyDays}d / {row.avgFrequency}x / ${row.avgMonetaryValue.toFixed(0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Customer-Level RFM Ledger */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--rp-ink)]">
                  Customer-Level RFM Scoring Ledger ({filteredRfmCustomers.length} Customers)
                </h3>
                <p className="text-xs text-slate-400">
                  Individual customer_unique_id records with exact Recency days, Frequency count, Monetary spend, R-F-M scores, and classification rationale
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(['ALL', ...rfmSegmentation.segmentDefinitions.map((d) => d.segment)] as const).map(
                  (seg) => (
                    <button
                      key={seg}
                      onClick={() => setSelectedRfmSegment(seg)}
                      className={`px-2 py-1 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                        selectedRfmSegment === seg
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-[var(--rp-ink)]'
                      }`}
                    >
                      {seg}
                    </button>
                  )
                )}
              </div>
            </div>

            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400">
                  <th className="py-2 pr-3">Customer Unique ID</th>
                  <th className="py-2 px-2">Location</th>
                  <th className="py-2 px-2 text-right">Recency (Days)</th>
                  <th className="py-2 px-2 text-right">Frequency</th>
                  <th className="py-2 px-2 text-right">Monetary ($)</th>
                  <th className="py-2 px-2 text-center">R-F-M Score</th>
                  <th className="py-2 px-2">Assigned Segment</th>
                  <th className="py-2 pl-2">Mathematical Classification Rationale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {filteredRfmCustomers.map((c) => (
                  <tr key={c.customerUniqueId} className="hover:bg-slate-800/40">
                    <td className="py-2.5 pr-3 font-mono font-semibold text-sky-300">
                      {c.customerUniqueId}
                    </td>
                    <td className="py-2.5 px-2 text-slate-300">
                      {c.customerCity}, {c.customerState}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-200">
                      {c.recencyDays}d
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-200">
                      {c.frequency}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono tabular-nums text-emerald-400">
                      ${c.monetaryValue.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono">
                      <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-amber-300">
                        {c.rScore}-{c.fScore}-{c.mScore} ({c.rfmCompositeScore.toFixed(2)})
                      </span>
                    </td>
                    <td className="py-2.5 px-2 font-semibold text-[var(--rp-ink)] whitespace-nowrap">
                      {c.segment}
                    </td>
                    <td className="py-2.5 pl-2 text-slate-300 text-[11px]">
                      {c.segmentRationale}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODULE 2: CUSTOMER COHORT ANALYSIS
      ===================================================================== */}
      {activeTab === 'cohort-retention' && (
        <div className="space-y-5" data-testid="module-cohort-retention">
          {/* Cohort Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Dataset Observation Window
              </div>
              <div className="text-xl font-bold font-mono text-[var(--rp-ink)] mt-1 tabular-nums">
                {cohortAnalysis.datasetStartMonth} → {cohortAnalysis.datasetEndMonth}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {cohortAnalysis.maxMonthOffset + 1} calendar months observed
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Monthly Acquisition Cohorts
              </div>
              <div className="text-xl font-bold font-mono text-sky-400 mt-1 tabular-nums">
                {cohortAnalysis.totalCohorts} Cohorts
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Indexed by first purchase YYYY-MM
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Overall Repeat Customer Rate
              </div>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1 tabular-nums">
                {cohortAnalysis.overallRepeatCustomerRatePct.toFixed(2)}%
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Multi-order customer_unique_id ratio
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Right-Censoring Boundary
              </div>
              <div className="text-xl font-bold font-mono text-amber-400 mt-1 tabular-nums">
                Explicitly Masked
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Unobserved future offsets marked Censored
              </div>
            </div>
          </div>

          {/* Observation Window & Right-Censoring Notice */}
          <div className="bg-amber-950/20 border border-amber-500/30 rounded-lg p-4 flex items-start gap-3">
            <Calendar className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-amber-200">
                Historical Observation Window & Right-Censoring Accounting
              </div>
              <p className="text-amber-100/80 leading-relaxed">
                {cohortAnalysis.observationWindowNotice}
              </p>
              <p className="text-slate-300 font-mono text-[11px] pt-1">
                Methodology: {cohortAnalysis.methodology}
              </p>
            </div>
          </div>

          {/* Cohort Retention Heatmap Matrix */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--rp-ink)]">
                  Monthly Customer Acquisition & Retention Heatmap (%)
                </h3>
                <p className="text-xs text-slate-400">
                  Each cell displays Retention % (Active Buyers / Cohort Size) and active count. Shaded cells with &ldquo;Censored&rdquo; exceed the {cohortAnalysis.datasetEndMonth} dataset cutoff.
                </p>
              </div>
              <button
                onClick={() =>
                  setOpenSqlModule(openSqlModule === 'cohort' ? null : 'cohort')
                }
                className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 cursor-pointer"
              >
                {openSqlModule === 'cohort' ? 'Hide DuckDB SQL' : 'Inspect DuckDB SQL'}
              </button>
            </div>

            {openSqlModule === 'cohort' && (
              <pre className="bg-slate-950 border border-slate-800 rounded p-3 mb-4 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                {cohortAnalysis.executedSql}
              </pre>
            )}

            <table
              className="w-full text-left border-collapse"
              data-testid="cohort-heatmap-table"
            >
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400">
                  <th className="py-2.5 pr-3">Acquisition Cohort</th>
                  <th className="py-2.5 px-2 text-right">Cohort Size</th>
                  <th className="py-2.5 px-2 text-right">Initial GMV</th>
                  <th className="py-2.5 px-2 text-right">Cumulative Repeat</th>
                  {Array.from(
                    { length: cohortAnalysis.maxMonthOffset + 1 },
                    (_, idx) => (
                      <th key={idx} className="py-2.5 px-2 text-center">
                        M+{idx}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs font-mono">
                {cohortAnalysis.cohorts.map((cohort) => (
                  <tr key={cohort.cohortMonth} className="hover:bg-slate-800/30">
                    <td className="py-2.5 pr-3 font-semibold text-[var(--rp-ink)] whitespace-nowrap">
                      {cohort.cohortMonth}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-slate-200">
                      {cohort.cohortSize} buyers
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-emerald-400">
                      ${cohort.initialCohortRevenue.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-sky-300">
                      {cohort.cumulativeRepeatCustomers} ({cohort.cumulativeRepeatRatePct.toFixed(1)}%)
                    </td>
                    {cohort.cells.map((cell) => {
                      if (!cell.isObserved) {
                        return (
                          <td
                            key={cell.monthOffset}
                            className="p-1.5 text-center"
                            title={`Target month ${cell.targetMonth} is beyond dataset end (${cohortAnalysis.datasetEndMonth})`}
                          >
                            <div className="py-2 px-1.5 rounded bg-slate-950/60 border border-dashed border-slate-800 text-[10px] text-slate-400">
                              Censored ({cell.targetMonth})
                            </div>
                          </td>
                        );
                      }

                      const pct = cell.retentionPct;
                      let bgClass = 'bg-slate-950 text-slate-400 border-slate-800';
                      if (cell.monthOffset === 0) {
                        bgClass =
                          'bg-sky-600/30 text-sky-200 border-sky-500/40 font-semibold';
                      } else if (pct >= 40) {
                        bgClass =
                          'bg-emerald-600/35 text-emerald-200 border-emerald-500/50 font-semibold';
                      } else if (pct > 0) {
                        bgClass =
                          'bg-teal-600/25 text-teal-200 border-teal-500/40 font-semibold';
                      }

                      return (
                        <td
                          key={cell.monthOffset}
                          className="p-1.5 text-center"
                          title={`Cohort ${cohort.cohortMonth} @ ${cell.targetMonth} (M+${cell.monthOffset}): ${cell.activeCustomers} active buyers ($${cell.periodRevenue.toFixed(2)})`}
                        >
                          <div
                            className={`py-1.5 px-2 rounded border ${bgClass} tabular-nums`}
                          >
                            <div>{pct.toFixed(1)}%</div>
                            <div className="text-[10px] opacity-80">
                              n={cell.activeCustomers}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODULE 3: DELIVERY AND SATISFACTION ANALYSIS
      ===================================================================== */}
      {activeTab === 'delivery-satisfaction' && (
        <div className="space-y-5" data-testid="module-delivery-satisfaction">
          {/* Top KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                On-Time Delivery Mean Score
              </div>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1 tabular-nums">
                {deliverySatisfaction.onTimeAvgReviewScore.toFixed(2)} ★
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                n = {deliverySatisfaction.onTimeOrderCount} reviewed on-time orders
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Late Delivery Mean Score
              </div>
              <div className="text-xl font-bold font-mono text-rose-400 mt-1 tabular-nums">
                {deliverySatisfaction.lateAvgReviewScore.toFixed(2)} ★
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                n = {deliverySatisfaction.lateOrderCount} reviewed late orders
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Satisfaction Degradation Spread
              </div>
              <div className="text-xl font-bold font-mono text-amber-400 mt-1 tabular-nums">
                -{deliverySatisfaction.reviewScoreDeltaOnTimeVsLate.toFixed(2)} ★
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Mean rating drop when SLA is missed
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Pearson Correlation (r: Delay vs. ★)
              </div>
              <div className="text-xl font-bold font-mono text-sky-400 mt-1 tabular-nums">
                r = {deliverySatisfaction.pearsonCorrelationDelayVsScore.toFixed(3)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {deliverySatisfaction.correlationStrengthLabel}
              </div>
            </div>
          </div>

          {/* Correlation vs. Causation Econometric Distinction Panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-[var(--rp-ink)]">
                  Econometric Identification: Distinguishing Correlation from Causation
                </h3>
              </div>
              <button
                onClick={() =>
                  setOpenSqlModule(openSqlModule === 'deliv-sat' ? null : 'deliv-sat')
                }
                className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 cursor-pointer"
              >
                {openSqlModule === 'deliv-sat' ? 'Hide DuckDB SQL' : 'Inspect DuckDB SQL'}
              </button>
            </div>

            {openSqlModule === 'deliv-sat' && (
              <pre className="bg-slate-950 border border-slate-800 rounded p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                {deliverySatisfaction.executedSql}
              </pre>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-950 border border-slate-800 rounded p-3.5 space-y-2">
                <div className="font-mono font-semibold text-amber-300 uppercase">
                  1. Empirical Association vs. Structural Causality
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {deliverySatisfaction.correlationVsCausationAnalysis.empiricalAssociationSummary}
                </p>
                <p className="text-slate-400 leading-relaxed">
                  {deliverySatisfaction.correlationVsCausationAnalysis.whyCorrelationIsNotCausation}
                </p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded p-3.5 space-y-2">
                <div className="font-mono font-semibold text-sky-300 uppercase">
                  2. Omitted Confounders & Causal Identification Strategy
                </div>
                <ul className="list-disc list-inside space-y-1 text-slate-300">
                  {deliverySatisfaction.correlationVsCausationAnalysis.confoundingVariables.map(
                    (conf, idx) => (
                      <li key={idx}>{conf}</li>
                    )
                  )}
                </ul>
                <p className="text-emerald-300/90 text-[11px] pt-1 font-mono">
                  Identification Design:{' '}
                  {deliverySatisfaction.correlationVsCausationAnalysis.recommendedExperimentalDesign}
                </p>
              </div>
            </div>
          </div>

          {/* Charts: Star Distribution Comparison & Performance Group Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-[var(--rp-ink)] mb-1">
                Review Score Distribution: On-Time vs. Late Deliveries (% Share)
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Comparison of 1★ to 5★ probability mass functions conditioned on SLA compliance
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={deliverySatisfaction.starDistributionComparison}>
                    <CartesianGrid strokeDasharray="3 3" stroke={themeConfig.gridColor} />
                    <XAxis
                      dataKey="reviewScore"
                      stroke={themeConfig.axisColor}
                      fontSize={11}
                      tickFormatter={(v) => `${v} ★`}
                    />
                    <YAxis
                      stroke={themeConfig.axisColor}
                      fontSize={11}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={tooltipBoxStyle}
                      itemStyle={{ color: themeConfig.tooltipText }}
                      formatter={(val: unknown, name: unknown) => [
                        `${Number(val || 0).toFixed(1)}%`,
                        String(name) === 'onTimeSharePct'
                          ? 'On-Time Orders Share'
                          : 'Late Orders Share'
                      ]}
                    />
                    <Legend />
                    <Bar
                      dataKey="onTimeSharePct"
                      name="On-Time Orders (%)"
                      fill={themeConfig.secondaryHex}
                      radius={[6, 6, 0, 0]}
                    />
                    <Bar
                      dataKey="lateSharePct"
                      name="Late Orders (%)"
                      fill="#EA4335"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-lg p-5 overflow-x-auto">
              <h3 className="text-sm font-semibold text-[var(--rp-ink)] mb-1">
                Satisfaction Metrics by Delivery Performance Group
              </h3>
              <p className="text-xs text-slate-400 mb-3">
                Average review score and star breakdown across SLA variance buckets
              </p>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400">
                    <th className="py-2 pr-2">Delivery Performance Group</th>
                    <th className="py-2 px-2 text-right">Orders</th>
                    <th className="py-2 px-2 text-right">Avg Transit</th>
                    <th className="py-2 px-2 text-right">SLA Variance</th>
                    <th className="py-2 px-2 text-right">Mean Score</th>
                    <th className="py-2 pl-2 text-right">&le;3★ Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {deliverySatisfaction.performanceGroups.map((g) => (
                    <tr key={g.performanceGroup} className="hover:bg-slate-800/40">
                      <td className="py-2.5 pr-2">
                        <div className="font-semibold text-[var(--rp-ink)]">{g.performanceGroup}</div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {g.delayRangeLabel}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-200">
                        {g.orderCount}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300">
                        {g.avgDeliveryDays.toFixed(1)}d
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300">
                        {g.avgDelayDaysVsEstimate > 0 ? '+' : ''}
                        {g.avgDelayDaysVsEstimate.toFixed(1)}d
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums font-bold text-amber-400">
                        {g.avgReviewScore.toFixed(2)} ★
                      </td>
                      <td className="py-2.5 pl-2 text-right font-mono tabular-nums text-rose-400">
                        {g.lowSatisfactionSharePct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODULE 4: SELLER PERFORMANCE (SAMPLE-SIZE ADJUSTED)
      ===================================================================== */}
      {activeTab === 'seller-performance' && (
        <div className="space-y-5" data-testid="module-seller-performance">
          {/* Interactive Controls + Top KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Active Merchants Evaluated
              </div>
              <div className="text-xl font-bold font-mono text-[var(--rp-ink)] mt-1 tabular-nums">
                {sellerPerformance.totalActiveSellers} Sellers
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {sellerPerformance.qualifiedSellersCount} qualified /{' '}
                {sellerPerformance.smallSampleSellersCount} low-sample penalized
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Platform Prior Mean (C)
              </div>
              <div className="text-xl font-bold font-mono text-amber-400 mt-1 tabular-nums">
                {sellerPerformance.platformMeanReviewScoreC.toFixed(2)} ★
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Bayesian shrinkage anchor (weight m = {sellerPerformance.bayesianPriorWeightM})
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Platform On-Time Benchmark
              </div>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1 tabular-nums">
                {sellerPerformance.platformAvgOnTimePct.toFixed(1)}%
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Order-weighted SLA compliance rate
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase text-slate-400">
                  Min Order Sample Threshold
                </span>
                <Filter className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                {[1, 2, 3, 4].map((thresh) => (
                  <button
                    key={thresh}
                    data-testid={`seller-threshold-btn-${thresh}`}
                    onClick={() => setMinSellerOrders(thresh)}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-colors cursor-pointer ${
                      minSellerOrders === thresh
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-[var(--rp-ink)]'
                    }`}
                  >
                    n &ge; {thresh}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400 mt-1.5">
                Protects leaderboard from small-n outliers
              </div>
            </div>
          </div>

          {/* Small-Sample Protection Explanation */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-[var(--rp-ink)] flex items-center gap-2">
                <Award className="w-4 h-4 text-teal-400" />
                <span>
                  Sample-Size Shrinkage & Fair Ranking Methodology (Empirical Bayes)
                </span>
              </div>
              <p className="text-slate-300 leading-relaxed">
                {sellerPerformance.smallSampleProtectionExplanation}
              </p>
            </div>
            <button
              onClick={() =>
                setOpenSqlModule(openSqlModule === 'seller' ? null : 'seller')
              }
              className="px-3 py-1.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 shrink-0 cursor-pointer"
            >
              {openSqlModule === 'seller' ? 'Hide DuckDB SQL' : 'Inspect DuckDB SQL'}
            </button>
          </div>

          {openSqlModule === 'seller' && (
            <pre className="bg-slate-950 border border-slate-800 rounded p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto">
              {sellerPerformance.executedSql}
            </pre>
          )}

          {/* Seller Multi-Metric Leaderboard Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 overflow-x-auto">
            <h3 className="text-sm font-semibold text-[var(--rp-ink)] mb-1">
              Sample-Size Adjusted Seller Performance Matrix
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              Comparing Seller GMV Revenue, Order Volume, Average Freight, On-Time SLA %, Raw Review Score, and Empirical Bayes Adjusted Score
            </p>
            <table
              className="w-full text-left border-collapse"
              data-testid="seller-performance-table"
            >
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400">
                  <th className="py-2 pr-2">Rank</th>
                  <th className="py-2 px-2">Seller ID & Hub</th>
                  <th className="py-2 px-2 text-right">Order Vol (n)</th>
                  <th className="py-2 px-2 text-right">GMV Revenue</th>
                  <th className="py-2 px-2 text-right">Avg Freight</th>
                  <th className="py-2 px-2 text-right">On-Time SLA</th>
                  <th className="py-2 px-2 text-right">Raw Rating</th>
                  <th className="py-2 px-2 text-right">Bayesian Score</th>
                  <th className="py-2 px-2 text-right">Composite Index</th>
                  <th className="py-2 pl-2">Sample Reliability Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {sellerPerformance.sellers.map((s) => {
                  const isQualified = s.sampleReliabilityStatus === 'QUALIFIED_SAMPLE';
                  return (
                    <tr key={s.sellerId} className="hover:bg-slate-800/40">
                      <td className="py-2.5 pr-2 font-mono">
                        {s.qualifiedRank !== null ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold">
                            #{s.qualifiedRank}
                          </span>
                        ) : (
                          <span
                            className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px]"
                            title={s.reliabilityNote}
                          >
                            UNRANKED (n&lt;{sellerPerformance.minOrderThreshold})
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="font-mono font-semibold text-[var(--rp-ink)]">
                          {s.sellerId}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {s.sellerCity}, {s.sellerState}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-200">
                        {s.distinctOrders} orders ({s.itemsSold} items)
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-emerald-400 font-semibold">
                        ${s.sellerRevenue.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300">
                        ${s.avgFreightPerItem.toFixed(2)} ({s.freightToRevenueRatioPct.toFixed(1)}%)
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums">
                        <span
                          className={
                            s.onTimeDeliveryPct >= 80
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }
                        >
                          {s.onTimeDeliveryPct.toFixed(1)}% ({s.avgDeliveryDays.toFixed(1)}d)
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300">
                        {s.rawAvgReviewScore.toFixed(2)} ★
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums font-bold text-amber-300">
                        {s.bayesianAdjustedReviewScore.toFixed(2)} ★
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-sky-300 font-semibold">
                        {s.compositePerformanceIndex.toFixed(1)} / 100
                      </td>
                      <td className="py-2.5 pl-2 text-[11px]">
                        <span
                          className={
                            isQualified ? 'text-emerald-300' : 'text-amber-300'
                          }
                        >
                          {s.reliabilityNote}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODULE 5: BUSINESS OPPORTUNITY DETECTION
      ===================================================================== */}
      {activeTab === 'business-opportunities' && (
        <div className="space-y-5" data-testid="module-business-opportunities">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-[var(--rp-ink)] flex items-center gap-2">
                <Compass className="w-4 h-4 text-sky-400" />
                <span>
                  Automated SQL Anomaly & Opportunity Detection ({businessOpportunities.totalOpportunitiesDetected} Verified Findings)
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {businessOpportunities.methodology}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {businessOpportunities.opportunities.map((opp) => {
              const isSqlOpen = openSqlModule === opp.id;
              return (
                <div
                  key={opp.id}
                  data-testid={`opportunity-card-${opp.domain}`}
                  className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded ${
                            opp.severity === 'HIGH'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : opp.severity === 'MEDIUM'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                          }`}
                        >
                          {opp.severity} PRIORITY
                        </span>
                        <span className="text-xs font-mono text-teal-400 font-semibold">
                          {opp.domainLabel}
                        </span>
                        <span className="text-slate-700">•</span>
                        <span className="text-xs font-mono text-slate-300">
                          {opp.targetEntity}
                        </span>
                      </div>
                      <h4 className="text-base font-bold text-[var(--rp-ink)]">{opp.title}</h4>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 rounded px-3.5 py-2 text-right">
                      <div className="text-[10px] font-mono uppercase text-slate-400">
                        {opp.primaryMetricLabel}
                      </div>
                      <div className="text-sm font-mono font-bold text-amber-400 tabular-nums mt-0.5">
                        {opp.primaryMetricValue}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
                    <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-1">
                      <div className="font-mono text-[11px] uppercase text-slate-400">
                        Empirical Finding & Benchmark
                      </div>
                      <p className="text-slate-200 leading-relaxed">
                        {opp.evidenceSummary}
                      </p>
                      <p className="text-[11px] font-mono text-sky-300 pt-1">
                        Benchmark: {opp.benchmarkComparison}
                      </p>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-1">
                      <div className="font-mono text-[11px] uppercase text-slate-400">
                        SQL Calculation Methodology
                      </div>
                      <p className="text-slate-300 leading-relaxed">
                        {opp.calculationMethodology}
                      </p>
                    </div>
                    <div className="bg-slate-950 border border-emerald-500/25 rounded p-3 space-y-1">
                      <div className="font-mono text-[11px] uppercase text-emerald-400">
                        Recommended Commercial Action
                      </div>
                      <p className="text-slate-200 leading-relaxed">
                        {opp.recommendedAction}
                      </p>
                    </div>
                  </div>

                  {/* Supporting Evidence Records & SQL Toggle */}
                  <div className="pt-1">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-mono uppercase text-slate-400">
                        Underlying DuckDB Verification Rows ({opp.evidenceRecords.length} rows)
                      </span>
                      <button
                        onClick={() =>
                          setOpenSqlModule(isSqlOpen ? null : opp.id)
                        }
                        className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 cursor-pointer"
                      >
                        {isSqlOpen ? 'Hide Detection SQL' : 'Inspect Detection SQL'}
                      </button>
                    </div>

                    {isSqlOpen && (
                      <pre className="bg-slate-950 border border-slate-800 rounded p-3 mb-3 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                        {opp.supportingSql}
                      </pre>
                    )}

                    {opp.evidenceRecords.length > 0 && (
                      <div className="overflow-x-auto bg-slate-950 border border-slate-800 rounded">
                        <table className="w-full text-left border-collapse text-[11px] font-mono">
                          <thead>
                            <tr className="border-b border-slate-800 text-slate-400 uppercase">
                              {Object.keys(opp.evidenceRecords[0]).map((col) => (
                                <th key={col} className="py-1.5 px-2.5">
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 text-slate-200">
                            {opp.evidenceRecords.map((row, rIdx) => (
                              <tr key={rIdx}>
                                {Object.keys(opp.evidenceRecords[0]).map((col) => (
                                  <td key={col} className="py-1.5 px-2.5 tabular-nums">
                                    {String(row[col] ?? 'NULL')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          MODULE 6: SALES FORECASTING (CHRONOLOGICAL TRAIN/TEST & BACKTESTING)
      ===================================================================== */}
      {activeTab === 'sales-forecasting' && (
        <div className="space-y-5" data-testid="module-sales-forecasting">
          {/* Top KPI & Evaluation Metrics Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Chronological Split
              </div>
              <div className="text-lg font-bold font-mono text-[var(--rp-ink)] mt-1 tabular-nums">
                {salesForecasting.trainPeriodsCount} Train / {salesForecasting.testPeriodsCount} Test
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                +{salesForecasting.forecastHorizonMonths} Future Horizon Months
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Out-of-Sample Model MAE
              </div>
              <div className="text-lg font-bold font-mono text-emerald-400 mt-1 tabular-nums">
                ${salesForecasting.evaluationMetrics.modelMae.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                MAPE: {salesForecasting.evaluationMetrics.modelMapePct.toFixed(2)}% on held-out test
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Simple Baseline MAE
              </div>
              <div className="text-lg font-bold font-mono text-amber-400 mt-1 tabular-nums">
                ${salesForecasting.evaluationMetrics.baselineMae.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Baseline MAPE: {salesForecasting.evaluationMetrics.baselineMapePct.toFixed(2)}%
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                vs. Moving Avg Baseline
              </div>
              <div className="text-lg font-bold font-mono text-sky-400 mt-1 tabular-nums flex items-center gap-1">
                {salesForecasting.evaluationMetrics.modelOutperformsBaseline ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>
                      {salesForecasting.evaluationMetrics.maeImprovementPct >= 0 ? '+' : ''}
                      {salesForecasting.evaluationMetrics.maeImprovementPct.toFixed(1)}% Lower Error
                    </span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-4 h-4 text-amber-400" />
                    <span>
                      {salesForecasting.evaluationMetrics.maeImprovementPct.toFixed(1)}% vs Baseline
                    </span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Evaluated strictly on Test window ({salesForecasting.testPeriodRange})
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase text-slate-400">
                Forward Horizon Selector
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                {[2, 3, 4, 6].map((h) => (
                  <button
                    key={h}
                    data-testid={`forecast-horizon-btn-${h}`}
                    onClick={() => setForecastHorizonMonths(h)}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-colors cursor-pointer ${
                      forecastHorizonMonths === h
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-[var(--rp-ink)]'
                    }`}
                  >
                    +{h}m
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400 mt-1.5">
                Range: {salesForecasting.forecastPeriodRange}
              </div>
            </div>
          </div>

          {/* Forecasting Chart + Model Parameters */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-lg p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--rp-ink)]">
                    Chronological Train / Test Backtest & Forward Revenue Forecast ($)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Comparing Actual GMV vs. {salesForecasting.modelName} and {salesForecasting.baselineName}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setOpenSqlModule(openSqlModule === 'forecast' ? null : 'forecast')
                  }
                  className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300 cursor-pointer"
                >
                  {openSqlModule === 'forecast' ? 'Hide DuckDB SQL' : 'Inspect DuckDB SQL'}
                </button>
              </div>

              {openSqlModule === 'forecast' && (
                <pre className="bg-slate-950 border border-slate-800 rounded p-3 mb-3 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                  {salesForecasting.executedSql}
                </pre>
              )}

              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={salesForecasting.series}>
                    <CartesianGrid strokeDasharray="3 3" stroke={themeConfig.gridColor} />
                    <XAxis dataKey="period" stroke={themeConfig.axisColor} fontSize={11} />
                    <YAxis
                      stroke={themeConfig.axisColor}
                      fontSize={11}
                      tickFormatter={(v) => `$${v}`}
                    />
                    <Tooltip
                      contentStyle={tooltipBoxStyle}
                      itemStyle={{ color: themeConfig.tooltipText }}
                      formatter={(val: unknown, name: unknown) => [
                        val !== null && val !== undefined
                          ? `$${Number(val).toFixed(2)}`
                          : 'Unobserved (Future)',
                        String(name)
                      ]}
                    />
                    <Legend />
                    <Bar
                      dataKey="actualRevenue"
                      name="Actual Observed Revenue ($)"
                      fill={themeConfig.chartPalette[0]}
                      barSize={26}
                      radius={[6, 6, 0, 0]}
                    />
                    <Line
                      type="monotone"
                      dataKey="modelForecastRevenue"
                      name="Holt Linear Trend + OLS Model ($)"
                      stroke={themeConfig.secondaryHex}
                      strokeWidth={2.5}
                      dot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="baselineForecastRevenue"
                      name="Moving Avg Baseline ($)"
                      stroke="#FBBC04"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ r: 3 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Model Specification & Documented Limitations */}
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--rp-ink)]">
                  Model Parameters & Limitations
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Fitted strictly on Training Window ({salesForecasting.trainPeriodRange})
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                  <div className="text-[10px] text-slate-400">OLS Slope / Mo</div>
                  <div className="text-sm font-bold text-emerald-400 tabular-nums">
                    {salesForecasting.modelParameters.olsSlopePerMonth >= 0 ? '+' : ''}
                    ${salesForecasting.modelParameters.olsSlopePerMonth.toFixed(2)}
                  </div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                  <div className="text-[10px] text-slate-400">OLS Intercept</div>
                  <div className="text-sm font-bold text-sky-400 tabular-nums">
                    ${salesForecasting.modelParameters.olsIntercept.toFixed(2)}
                  </div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                  <div className="text-[10px] text-slate-400">Smoothing (&alpha;, &beta;)</div>
                  <div className="text-sm font-bold text-slate-200 tabular-nums">
                    {salesForecasting.modelParameters.alphaLevelSmoothing} /{' '}
                    {salesForecasting.modelParameters.betaTrendSmoothing}
                  </div>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
                  <div className="text-[10px] text-slate-400">Residual Std Err</div>
                  <div className="text-sm font-bold text-amber-400 tabular-nums">
                    &plusmn;${salesForecasting.modelParameters.residualStdError.toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-mono font-semibold uppercase text-amber-300">
                  Documented Econometric Limitations
                </div>
                <ul className="space-y-1.5 text-xs text-slate-300">
                  {salesForecasting.limitationsAndAssumptions.map((lim, i) => (
                    <li
                      key={i}
                      className="bg-slate-950 border border-slate-800 rounded p-2.5 leading-relaxed text-[11px]"
                    >
                      {lim}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Period-by-Period Chronological Backtesting Ledger */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 overflow-x-auto">
            <h3 className="text-sm font-semibold text-[var(--rp-ink)] mb-1">
              Period-by-Period Chronological Train / Test / Forecast Evaluation Table
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              Out-of-sample MAE and MAPE are calculated strictly on rows marked TEST ({salesForecasting.testPeriodRange})
            </p>
            <table
              className="w-full text-left border-collapse"
              data-testid="forecast-evaluation-table"
            >
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400">
                  <th className="py-2 pr-2">Period</th>
                  <th className="py-2 px-2">Split Partition</th>
                  <th className="py-2 px-2 text-right">Actual Revenue</th>
                  <th className="py-2 px-2 text-right">Model Forecast</th>
                  <th className="py-2 px-2 text-right">Baseline Forecast</th>
                  <th className="py-2 px-2 text-right">95% Prediction Interval</th>
                  <th className="py-2 px-2 text-right">Model Abs Error (APE %)</th>
                  <th className="py-2 pl-2 text-right">Baseline Abs Error (APE %)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs font-mono">
                {salesForecasting.series.map((pt) => (
                  <tr
                    key={pt.period}
                    className={
                      pt.split === 'TEST'
                        ? 'bg-emerald-950/15 hover:bg-emerald-950/25'
                        : pt.split === 'FORECAST'
                          ? 'bg-sky-950/15 hover:bg-sky-950/25'
                          : 'hover:bg-slate-800/40'
                    }
                  >
                    <td className="py-2.5 pr-2 font-semibold text-[var(--rp-ink)]">
                      {pt.period}
                    </td>
                    <td className="py-2.5 px-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          pt.split === 'TRAIN'
                            ? 'bg-slate-950 text-slate-300 border border-slate-700'
                            : pt.split === 'TEST'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        }`}
                      >
                        {pt.split}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-[var(--rp-ink)]">
                      {pt.actualRevenue !== null
                        ? `$${pt.actualRevenue.toFixed(2)} (${pt.actualOrders} ord)`
                        : '— (Future)'}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-emerald-400 font-semibold">
                      ${pt.modelForecastRevenue.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-amber-300">
                      ${pt.baselineForecastRevenue.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-slate-400">
                      [${pt.lowerConfidence95.toFixed(2)}, ${pt.upperConfidence95.toFixed(2)}]
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums text-emerald-300">
                      {pt.modelAbsoluteError !== null
                        ? `$${pt.modelAbsoluteError.toFixed(2)} (${pt.modelPercentageErrorPct?.toFixed(1)}%)`
                        : '—'}
                    </td>
                    <td className="py-2.5 pl-2 text-right tabular-nums text-amber-300">
                      {pt.baselineAbsoluteError !== null
                        ? `$${pt.baselineAbsoluteError.toFixed(2)} (${pt.baselinePercentageErrorPct?.toFixed(1)}%)`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
