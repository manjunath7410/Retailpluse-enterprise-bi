import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  Activity,
  Award,
  BarChart2,
  Code2,
  Database,
  DollarSign,
  Download,
  ExternalLink,
  Filter,
  Info,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingBag,
  Table2,
  Terminal,
  TrendingUp,
  Users,
  X
} from 'lucide-react';
import {
  BiDashboardId,
  BiDashboardPayload,
  DashboardDrilldownResult,
  DashboardKpiItem,
  DashboardVisualSection,
  DrilldownDimensionType
} from '../../types/analytics';
import { usePlatform } from '../../context/PlatformContext';
import { useTheme } from '../../context/ThemeContext';
import { apiClient } from '../../services/apiClient';
import { DataStateBanner } from './DataStateBanner';

function formatKpiDisplayValue(kpi: DashboardKpiItem, exact = false): string {
  if (kpi.value === null || kpi.value === undefined) return '—';
  if (typeof kpi.value === 'string') return kpi.value;
  if (kpi.unit === 'currency') {
    if (!exact && Math.abs(kpi.value) >= 1_000_000) {
      return `$${(kpi.value / 1_000_000).toFixed(2)}M`;
    }
    if (!exact && Math.abs(kpi.value) >= 10_000) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
      }).format(kpi.value);
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2
    }).format(kpi.value);
  }
  if (kpi.unit === 'percent') {
    return `${kpi.value.toFixed(2)}%`;
  }
  if (kpi.unit === 'days') {
    return `${kpi.value.toFixed(2)} days`;
  }
  if (kpi.unit === 'score') {
    return `${kpi.value.toFixed(2)} / 5.00`;
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2
  }).format(kpi.value);
}

const KPI_ICONS = [DollarSign, ShoppingBag, Users, TrendingUp, Award];

function KpiSparkline({ values, color, id }: { values: number[]; color: string; id: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 56;
  const height = 24;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - 3 - ((v - min) / span) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${id})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KpiRadialGauge({ ratio, color }: { ratio: number; color: string }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const r = 15;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - clamped);
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" className="shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="19" cy="19" r={r} fill="none" stroke="rgba(148,163,184,0.16)" strokeWidth="4" />
      <circle
        cx="19"
        cy="19"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

function shouldRenderDonut(section: DashboardVisualSection): boolean {
  if (section.chartType !== 'bar' && section.chartType !== 'horizontal-bar') return false;
  if (section.rows.length < 2 || section.rows.length > 7) return false;
  const lower = `${section.id} ${section.title}`.toLowerCase();
  return (
    lower.includes('status') ||
    lower.includes('payment') ||
    lower.includes('distribution') ||
    lower.includes('segment') ||
    lower.includes('mix')
  );
}

function formatSeriesValue(
  val: unknown,
  unit?: 'currency' | 'number' | 'percent' | 'days' | 'score'
): string {
  const num = Number(val);
  if (!Number.isFinite(num)) return String(val ?? '—');
  if (unit === 'currency') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2
    }).format(num);
  }
  if (unit === 'percent') return `${num.toFixed(2)}%`;
  if (unit === 'days') return `${num.toFixed(2)} d`;
  if (unit === 'score') return `${num.toFixed(2)} ★`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
}

function exportRowsToCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const raw = row[h] === null || row[h] === undefined ? '' : String(row[h]);
          return raw.includes(',') || raw.includes('"') || raw.includes('\n')
            ? `"${raw.replace(/"/g, '""')}"`
            : raw;
        })
        .join(',')
    )
  ];
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportJsonReport(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8;'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface BiDashboardWorkspaceProps {
  dashboardId: BiDashboardId;
  moduleHeaderBadge?: string;
  showDataStateBanner?: boolean;
  headerTabs?: React.ReactNode;
  topBanner?: React.ReactNode;
}

export const BiDashboardWorkspace: React.FC<BiDashboardWorkspaceProps> = ({
  dashboardId,
  showDataStateBanner = true,
  headerTabs,
  topBanner
}) => {
  const navigate = useNavigate();
  const { themeConfig } = useTheme();
  const {
    totalRows,
    dataMode,
    isDemonstrationData,
    dashboardFilters,
    filterOptions,
    updateDashboardFilters,
    resetDashboardFilters,
    seedDemoDataset,
    actionLoading
  } = usePlatform();

  const [activeDashboardId, setActiveDashboardId] = useState<BiDashboardId>(dashboardId);
  const [payload, setPayload] = useState<BiDashboardPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded SQL source & interactive Chart/Table toggle states
  const [openKpiSqlIds, setOpenKpiSqlIds] = useState<Record<string, boolean>>({});
  const [openVisualSqlIds, setOpenVisualSqlIds] = useState<Record<string, boolean>>({});
  const [tableModeSections, setTableModeSections] = useState<Record<string, boolean>>({});
  const [inspectedKpiModal, setInspectedKpiModal] = useState<DashboardKpiItem | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState<boolean>(false);

  const chartPalette = themeConfig.chartPalette;
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

  // Live DuckDB Drilldown state
  const [drilldownLoading, setDrilldownLoading] = useState<boolean>(false);
  const [drilldownResult, setDrilldownResult] = useState<DashboardDrilldownResult | null>(null);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);

  const sparklineSeries = useMemo(() => {
    const firstSeries = payload?.sections?.find((s) => s.chartType !== 'table' && s.rows.length >= 2);
    if (!firstSeries) return [] as number[];
    return firstSeries.rows
      .map((r) => Number(r[firstSeries.yKey]))
      .filter((n) => Number.isFinite(n));
  }, [payload]);

  useEffect(() => {
    setActiveDashboardId(dashboardId);
  }, [dashboardId]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getBiDashboard(activeDashboardId, dashboardFilters);
      if (res.data) {
        setPayload(res.data);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to execute DuckDB BI dashboard queries.'
      );
    } finally {
      setLoading(false);
    }
  }, [activeDashboardId, dashboardFilters]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard, totalRows, dataMode]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (dashboardFilters.startDate) count++;
    if (dashboardFilters.endDate) count++;
    if (dashboardFilters.category && dashboardFilters.category !== 'ALL') count++;
    if (dashboardFilters.state && dashboardFilters.state !== 'ALL') count++;
    if (dashboardFilters.orderStatus && dashboardFilters.orderStatus !== 'ALL') count++;
    return count;
  }, [dashboardFilters]);

  const handleTriggerDrilldown = useCallback(
    async (dimensionType: DrilldownDimensionType | undefined, rawValue: unknown) => {
      if (!dimensionType || rawValue === undefined || rawValue === null) return;
      const dimensionValue = String(rawValue).trim();
      if (!dimensionValue) return;

      setDrilldownLoading(true);
      setDrilldownError(null);
      try {
        const res = await apiClient.executeDashboardDrilldown({
          dimensionType,
          dimensionValue,
          filters: dashboardFilters
        });
        if (res.data) {
          setDrilldownResult(res.data);
        }
      } catch (err) {
        setDrilldownError(
          err instanceof Error ? err.message : 'Failed to execute DuckDB drill-down query.'
        );
      } finally {
        setDrilldownLoading(false);
      }
    },
    [dashboardFilters]
  );

  const handleApplyCrossFilterFromDrilldown = useCallback(
    (dimensionType: DrilldownDimensionType, dimensionValue: string) => {
      if (dimensionType === 'state') {
        updateDashboardFilters({ state: dimensionValue });
        setDrilldownResult(null);
      } else if (dimensionType === 'category') {
        updateDashboardFilters({ category: dimensionValue });
        setDrilldownResult(null);
      } else if (dimensionType === 'status') {
        updateDashboardFilters({ orderStatus: dimensionValue });
        setDrilldownResult(null);
      } else if (dimensionType === 'month' && /^\d{4}-\d{2}$/.test(dimensionValue)) {
        const [yr, mo] = dimensionValue.split('-').map(Number);
        const lastDay = new Date(yr, mo, 0).getDate();
        updateDashboardFilters({
          startDate: `${dimensionValue}-01`,
          endDate: `${dimensionValue}-${String(lastDay).padStart(2, '0')}`
        });
        setDrilldownResult(null);
      }
    },
    [updateDashboardFilters]
  );

  const toggleKpiSql = (id: string) => {
    setOpenKpiSqlIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleVisualSql = (id: string) => {
    setOpenVisualSqlIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSectionTableMode = (id: string) => {
    setTableModeSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExportFullDashboardCsv = () => {
    if (!payload) return;
    const summaryRows = payload.kpis.map((k) => ({
      dashboard: payload.title,
      kpi_id: k.id,
      kpi_label: k.label,
      value: k.value,
      unit: k.unit,
      grain_note: k.grainNote,
      business_definition: k.definition,
      sql_source: k.sqlSource
    }));
    exportRowsToCsv(`${payload.dashboardId}-kpis.csv`, summaryRows);
  };

  const showFilterDrawer = filtersExpanded;
  const displayTitle = (payload?.title || 'Loading dashboard...').replace(
    /^Dashboard\s+\d+:\s*/i,
    ''
  );

  const activeFilterChips: Array<{ key: string; label: string; onClear: () => void }> = [];
  if (dashboardFilters.startDate) {
    activeFilterChips.push({
      key: 'startDate',
      label: `From ${dashboardFilters.startDate}`,
      onClear: () => updateDashboardFilters({ startDate: '' })
    });
  }
  if (dashboardFilters.endDate) {
    activeFilterChips.push({
      key: 'endDate',
      label: `To ${dashboardFilters.endDate}`,
      onClear: () => updateDashboardFilters({ endDate: '' })
    });
  }
  if (dashboardFilters.category && dashboardFilters.category !== 'ALL') {
    activeFilterChips.push({
      key: 'category',
      label: `Category: ${dashboardFilters.category}`,
      onClear: () => updateDashboardFilters({ category: 'ALL' })
    });
  }
  if (dashboardFilters.state && dashboardFilters.state !== 'ALL') {
    activeFilterChips.push({
      key: 'state',
      label: `State: ${dashboardFilters.state}`,
      onClear: () => updateDashboardFilters({ state: 'ALL' })
    });
  }
  if (dashboardFilters.orderStatus && dashboardFilters.orderStatus !== 'ALL') {
    activeFilterChips.push({
      key: 'orderStatus',
      label: `Status: ${dashboardFilters.orderStatus}`,
      onClear: () => updateDashboardFilters({ orderStatus: 'ALL' })
    });
  }

  return (
    <div className="space-y-4">
      {showDataStateBanner && <DataStateBanner />}

      {/* Unified Google Looker / Analytics Dashboard Header & Underline Tabs */}
      <div className="studio-card rounded-2xl overflow-hidden">
        <div className="px-5 pt-4 pb-3.5 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="min-w-0 max-w-2xl">
              <h1 className="font-display text-[21px] font-bold text-[var(--rp-ink)] tracking-tight leading-snug">
                {displayTitle}
              </h1>
              <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5 truncate">
                {payload?.description ||
                  'Live analytical metrics computed directly from your active warehouse.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setFiltersExpanded((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                  showFilterDrawer || activeFilterCount > 0
                    ? 'bg-[var(--rp-primary-soft)] border-[var(--rp-primary)] text-[var(--rp-primary-ink)]'
                    : 'bg-[var(--rp-surface)] border-[var(--rp-border)] text-[var(--rp-ink-secondary)] hover:bg-[var(--rp-surface-subtle)]'
                }`}
              >
                <Filter className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <span className="font-mono text-[11px] font-semibold">({activeFilterCount})</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => void loadDashboard()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--rp-ink-secondary)] bg-[var(--rp-surface)] hover:bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[var(--rp-primary)]' : ''}`}
                />
                <span>Refresh</span>
              </button>

              <button
                type="button"
                onClick={handleExportFullDashboardCsv}
                disabled={!payload || !payload.isReady}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--rp-ink-secondary)] bg-[var(--rp-surface)] hover:bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {/* Active Cross-Dashboard Filter Chips (Always visible when filters are applied) */}
          {activeFilterChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] font-medium text-[var(--rp-ink-muted)] mr-1">
                Active slice:
              </span>
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onClear}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)] border border-[var(--rp-primary)]/25 text-[11px] font-medium hover:opacity-85 transition-opacity cursor-pointer"
                  title={`Remove ${chip.label} filter`}
                >
                  <span>{chip.label}</span>
                  <X className="w-3 h-3" />
                </button>
              ))}
              <button
                type="button"
                onClick={resetDashboardFilters}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>
          )}

          {/* Collapsible Synchronized Filter Controls */}
          {showFilterDrawer && (
            <div className="pt-3.5 border-t border-[var(--rp-border)] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-[var(--rp-ink-muted)]">
                Filters apply live across all dashboards and drill-down queries.
                {filterOptions?.minDate && filterOptions?.maxDate && (
                  <span className="ml-2 font-mono text-[11px] text-[var(--rp-ink-muted)]">
                    ({filterOptions.minDate} to {filterOptions.maxDate})
                  </span>
                )}
              </div>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetDashboardFilters}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#E37400] bg-[#FEF7E0] dark:bg-amber-950/50 hover:opacity-90 border border-[#FBBC04]/40 rounded-lg transition-opacity cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Clear all ({activeFilterCount})
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label
                  htmlFor="bi-filter-start-date"
                  className="block text-[11px] font-medium text-[var(--rp-ink-muted)] mb-1"
                >
                  Start Date
                </label>
                <input
                  id="bi-filter-start-date"
                  type="date"
                  value={dashboardFilters.startDate}
                  min={filterOptions?.minDate || undefined}
                  max={filterOptions?.maxDate || undefined}
                  onChange={(e) => updateDashboardFilters({ startDate: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg text-[var(--rp-ink)] focus:outline-none focus:border-[var(--rp-primary)] font-mono"
                />
              </div>

              <div>
                <label
                  htmlFor="bi-filter-end-date"
                  className="block text-[11px] font-medium text-[var(--rp-ink-muted)] mb-1"
                >
                  End Date
                </label>
                <input
                  id="bi-filter-end-date"
                  type="date"
                  value={dashboardFilters.endDate}
                  min={filterOptions?.minDate || undefined}
                  max={filterOptions?.maxDate || undefined}
                  onChange={(e) => updateDashboardFilters({ endDate: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg text-[var(--rp-ink)] focus:outline-none focus:border-[var(--rp-primary)] font-mono"
                />
              </div>

              <div>
                <label
                  htmlFor="bi-filter-category"
                  className="block text-[11px] font-medium text-[var(--rp-ink-muted)] mb-1"
                >
                  Category
                </label>
                <select
                  id="bi-filter-category"
                  value={dashboardFilters.category}
                  onChange={(e) => updateDashboardFilters({ category: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg text-[var(--rp-ink)] focus:outline-none focus:border-[var(--rp-primary)]"
                >
                  <option value="ALL">All Categories ({filterOptions?.categories.length || 0})</option>
                  {(filterOptions?.categories || []).map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="bi-filter-state"
                  className="block text-[11px] font-medium text-[var(--rp-ink-muted)] mb-1"
                >
                  State
                </label>
                <select
                  id="bi-filter-state"
                  value={dashboardFilters.state}
                  onChange={(e) => updateDashboardFilters({ state: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg text-[var(--rp-ink)] focus:outline-none focus:border-[var(--rp-primary)]"
                >
                  <option value="ALL">All States ({filterOptions?.states.length || 0})</option>
                  {(filterOptions?.states || []).map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="bi-filter-status"
                  className="block text-[11px] font-medium text-[var(--rp-ink-muted)] mb-1"
                >
                  Order Status
                </label>
                <select
                  id="bi-filter-status"
                  value={dashboardFilters.orderStatus}
                  onChange={(e) => updateDashboardFilters({ orderStatus: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg text-[var(--rp-ink)] focus:outline-none focus:border-[var(--rp-primary)]"
                >
                  <option value="ALL">
                    All Statuses ({filterOptions?.orderStatuses.length || 0})
                  </option>
                  {(filterOptions?.orderStatuses || []).map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
              <span className="text-[var(--rp-ink-muted)] font-medium">Quick filters:</span>
              <button
                type="button"
                onClick={() => updateDashboardFilters({ state: dashboardFilters.state === 'SP' ? 'ALL' : 'SP' })}
                className={`px-3 py-1 rounded-full font-mono text-[11px] font-medium border transition-colors cursor-pointer ${
                  dashboardFilters.state === 'SP'
                    ? 'bg-[var(--rp-primary-soft)] border-[var(--rp-primary)] text-[var(--rp-primary-ink)]'
                    : 'bg-[var(--rp-surface)] border-[var(--rp-border)] text-[var(--rp-ink-secondary)] hover:bg-[var(--rp-surface-subtle)]'
                }`}
              >
                SP
              </button>
              <button
                type="button"
                onClick={() => updateDashboardFilters({ state: dashboardFilters.state === 'RJ' ? 'ALL' : 'RJ' })}
                className={`px-3 py-1 rounded-full font-mono text-[11px] font-medium border transition-colors cursor-pointer ${
                  dashboardFilters.state === 'RJ'
                    ? 'bg-[var(--rp-primary-soft)] border-[var(--rp-primary)] text-[var(--rp-primary-ink)]'
                    : 'bg-[var(--rp-surface)] border-[var(--rp-border)] text-[var(--rp-ink-secondary)] hover:bg-[var(--rp-surface-subtle)]'
                }`}
              >
                RJ
              </button>
              <button
                type="button"
                onClick={() =>
                  updateDashboardFilters({
                    orderStatus: dashboardFilters.orderStatus === 'delivered' ? 'ALL' : 'delivered'
                  })
                }
                className={`px-3 py-1 rounded-full font-mono text-[11px] font-medium border transition-colors cursor-pointer ${
                  dashboardFilters.orderStatus === 'delivered'
                    ? 'bg-[var(--rp-primary-soft)] border-[var(--rp-primary)] text-[var(--rp-primary-ink)]'
                    : 'bg-[var(--rp-surface)] border-[var(--rp-border)] text-[var(--rp-ink-secondary)] hover:bg-[var(--rp-surface-subtle)]'
                }`}
              >
                Delivered
              </button>
              <button
                type="button"
                onClick={() =>
                  updateDashboardFilters({
                    category: dashboardFilters.category === 'computers' ? 'ALL' : 'computers'
                  })
                }
                className={`px-3 py-1 rounded-full font-mono text-[11px] font-medium border transition-colors cursor-pointer ${
                  dashboardFilters.category === 'computers'
                    ? 'bg-[var(--rp-primary-soft)] border-[var(--rp-primary)] text-[var(--rp-primary-ink)]'
                    : 'bg-[var(--rp-surface)] border-[var(--rp-border)] text-[var(--rp-ink-secondary)] hover:bg-[var(--rp-surface-subtle)]'
                }`}
              >
                Computers
              </button>
            </div>
          </div>
          )}
        </div>

        {/* Flush Material 3 Underline Tabs Slot */}
        {headerTabs && (
          <div className="px-5 border-t border-[var(--rp-border)] bg-[var(--rp-surface)]">
            {headerTabs}
          </div>
        )}
      </div>

      {/* Optional Compact Executive Signal Banner */}
      {topBanner}

      {/* Error State */}
      {error && (
        <div className="bg-[#FCE8E6] dark:bg-red-950/50 border border-[#EA4335]/35 rounded-xl p-4 text-xs text-[#A50E0E] dark:text-red-200 flex items-center justify-between gap-3">
          <div>
            <span className="font-semibold">DuckDB Analytical Query Error: </span>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="px-3 py-1 bg-[#D93025] hover:opacity-90 text-white rounded-lg font-medium cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty Dataset Guard */}
      {payload && !payload.isReady ? (
        <div className="studio-card rounded-2xl p-8 text-center space-y-4">
          <Database className="w-8 h-8 text-[#E37400] mx-auto" />
          <div className="space-y-1 max-w-lg mx-auto">
            <h2 className="text-base font-semibold text-[var(--rp-ink)]">
              DuckDB Analytical Tables Require Population
            </h2>
            <p className="text-xs text-[var(--rp-ink-muted)] leading-relaxed">
              Required Olist tables currently contain 0 rows. Seed the verified Olist demonstration
              dataset or upload CSV files in Datasets.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void seedDemoDataset()}
              disabled={actionLoading}
              className="px-4 py-2 text-xs font-semibold text-white bg-[var(--rp-primary)] hover:bg-[var(--rp-primary-hover)] rounded-full transition-colors cursor-pointer"
            >
              {actionLoading ? 'Seeding DuckDB...' : 'Load Demonstration Data'}
            </button>
            <Link
              to="/data-management"
              className="px-4 py-2 text-xs font-semibold text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] rounded-full transition-colors"
            >
              Open Datasets
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* 5-Card Google Material 3 Scorecards with Theme-Reactive Accents, Rings & Sparklines */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 items-stretch">
            {(payload?.kpis || []).map((kpi, kpiIdx) => {
              const isSqlOpen = Boolean(openKpiSqlIds[kpi.id]);
              const accent = themeConfig.kpiAccents[kpiIdx % themeConfig.kpiAccents.length];
              const Icon = KPI_ICONS[kpiIdx % KPI_ICONS.length];
              const numVal = typeof kpi.value === 'number' ? kpi.value : null;
              const showGauge =
                numVal !== null && (kpi.unit === 'percent' || kpi.unit === 'score');
              const gaugeRatio =
                numVal === null
                  ? 0
                  : kpi.unit === 'score'
                  ? numVal / 5
                  : numVal / 100;

              return (
                <div
                  key={kpi.id}
                  className="studio-card studio-card-hover rounded-xl overflow-hidden flex flex-col justify-between relative"
                >
                  {/* Refined 2px Accent Hairline */}
                  <div className="h-[2px] w-full" style={{ backgroundColor: accent }} />

                  <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                          style={{
                            color: accent,
                            backgroundColor: `${accent}16`
                          }}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <span className="text-xs font-medium text-[var(--rp-ink-secondary)] leading-tight truncate">
                          {kpi.label}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setInspectedKpiModal(kpi)}
                        aria-label={`Inspect ${kpi.label} formula and grain`}
                        title={`${kpi.definition} (${kpi.grainNote})`}
                        className="p-1 text-[var(--rp-ink-muted)] hover:text-[var(--rp-primary)] rounded-md transition-colors shrink-0 cursor-pointer"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-end justify-between gap-2 pt-0.5 min-w-0">
                      {(() => {
                        const formattedVal = loading ? '...' : formatKpiDisplayValue(kpi);
                        const exactVal = loading ? '...' : formatKpiDisplayValue(kpi, true);
                        const sizeClass =
                          formattedVal.length >= 10
                            ? 'text-[20px] 2xl:text-[22px]'
                            : 'text-[23px] 2xl:text-[24px]';
                        return (
                          <div
                            className={`font-display ${sizeClass} font-bold tabular-nums text-[var(--rp-ink)] tracking-tight leading-none whitespace-nowrap`}
                            title={exactVal}
                          >
                            {formattedVal}
                          </div>
                        );
                      })()}
                      {!loading &&
                        (showGauge ? (
                          <KpiRadialGauge ratio={gaugeRatio} color={accent} />
                        ) : sparklineSeries.length >= 2 ? (
                          <KpiSparkline
                            values={sparklineSeries}
                            color={accent}
                            id={kpi.id}
                          />
                        ) : null)}
                    </div>

                    <div className="pt-2.5 border-t border-[var(--rp-border)] space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="text-[11px] text-[var(--rp-ink-muted)] truncate"
                          title={kpi.grainNote}
                        >
                          {kpi.grainNote}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleKpiSql(kpi.id)}
                          className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-[var(--rp-primary)] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Code2 className="w-3 h-3 shrink-0" />
                          <span>{isSqlOpen ? 'Hide' : 'SQL'}</span>
                        </button>
                      </div>

                      {isSqlOpen && (
                        <pre className="p-2.5 rounded-lg code-surface border text-[10px] font-mono whitespace-pre-wrap break-words leading-relaxed">
                          {kpi.sqlSource}
                        </pre>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Asymmetric Bento Visualization Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            {(payload?.sections || []).map((section: DashboardVisualSection, idx: number) => {
              const totalVisuals = payload?.sections.length || 0;
              const isDonut = shouldRenderDonut(section);
              const nextIsDonut =
                idx + 1 < totalVisuals && shouldRenderDonut(payload!.sections[idx + 1]);
              const prevIsHero = idx === 1 && isDonut;

              const colSpanClass =
                section.chartType === 'table' || (idx === totalVisuals - 1 && totalVisuals % 2 === 1)
                  ? 'lg:col-span-12'
                  : idx === 0 && nextIsDonut
                  ? 'lg:col-span-8'
                  : prevIsHero
                  ? 'lg:col-span-4'
                  : isDonut
                  ? 'lg:col-span-5'
                  : idx > 0 && idx < totalVisuals - 1 && shouldRenderDonut(payload!.sections[idx + 1])
                  ? 'lg:col-span-7'
                  : 'lg:col-span-6';

              const isSqlOpen = Boolean(openVisualSqlIds[section.id]);
              const isTableView = section.chartType === 'table' || Boolean(tableModeSections[section.id]);
              const tableColumns =
                section.rows.length > 0 ? Object.keys(section.rows[0]) : [];
              const donutTotal = isDonut
                ? section.rows.reduce((sum, r) => sum + (Number(r[section.yKey]) || 0), 0)
                : 0;

              return (
                <div
                  key={section.id}
                  className={`${colSpanClass} studio-card rounded-2xl p-5 flex flex-col justify-between space-y-4`}
                >
                  <div className="space-y-3">
                    {/* Clean Looker Studio Card Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-[15px] font-semibold text-[var(--rp-ink)] truncate">
                          {section.title}
                        </h2>
                        <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5 truncate">
                          {section.subtitle}
                          {section.drilldownDimension ? ' · Click visual to drill down' : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {section.chartType !== 'table' && section.rows.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleSectionTableMode(section.id)}
                            title={isTableView ? 'Switch back to Chart view' : 'Inspect underlying data table'}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                              isTableView
                                ? 'bg-[var(--rp-primary-soft)] border-[var(--rp-primary)] text-[var(--rp-primary-ink)]'
                                : 'bg-[var(--rp-surface-subtle)] border-[var(--rp-border)] text-[var(--rp-ink-secondary)] hover:bg-[var(--rp-surface-hover)]'
                            }`}
                          >
                            {isTableView ? (
                              <>
                                <BarChart2 className="w-3 h-3" />
                                <span>Chart</span>
                              </>
                            ) : (
                              <>
                                <Table2 className="w-3 h-3" />
                                <span>Table</span>
                              </>
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleVisualSql(section.id)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                            isSqlOpen
                              ? 'bg-[var(--rp-primary-soft)] border-[var(--rp-primary)] text-[var(--rp-primary-ink)]'
                              : 'bg-[var(--rp-surface-subtle)] border-[var(--rp-border)] text-[var(--rp-ink-secondary)] hover:bg-[var(--rp-surface-hover)]'
                          }`}
                        >
                          <Code2 className="w-3 h-3" />
                          <span>SQL</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            exportRowsToCsv(`${section.id}.csv`, section.rows || [])
                          }
                          disabled={!section.rows || section.rows.length === 0}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[var(--rp-ink-secondary)] hover:text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                          <span>CSV</span>
                        </button>
                      </div>
                    </div>

                    {/* Expandable SQL Calculation Source */}
                    {isSqlOpen && (
                      <div className="p-3 rounded-xl code-surface border space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-mono text-[#8ab4f8]">
                            DuckDB SQL Source
                          </span>
                          <span className="font-mono tabular-nums">{section.rows.length} rows</span>
                        </div>
                        <pre className="text-[11px] font-mono overflow-x-auto leading-relaxed">
                          {section.executedSql}
                        </pre>
                      </div>
                    )}

                    {/* Chart or Table Body */}
                    {section.rows.length === 0 ? (
                      <div className="h-64 flex items-center justify-center text-xs text-[var(--rp-ink-muted)] border border-dashed border-[var(--rp-border)] rounded-xl">
                        No records match the active filter criteria.
                      </div>
                    ) : isTableView ? (
                      <div className="overflow-x-auto max-h-80 border border-[var(--rp-border)] rounded-xl">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-[var(--rp-surface-subtle)] sticky top-0">
                            <tr className="border-b border-[var(--rp-border)] text-[var(--rp-ink-muted)]">
                              {tableColumns.map((colKey) => (
                                <th key={colKey} className="py-2.5 px-3 font-mono font-semibold">
                                  {colKey}
                                </th>
                              ))}
                              {section.drilldownDimension && (
                                <th className="py-2.5 px-3 font-semibold text-right">Inspect</th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--rp-border)]">
                            {section.rows.map((row, rIdx) => {
                              const drillVal =
                                section.drilldownDimension === 'category' && row.category
                                  ? row.category
                                  : row[section.xKey];
                              return (
                                <tr
                                  key={`${section.id}-row-${rIdx}`}
                                  onClick={() =>
                                    section.drilldownDimension &&
                                    void handleTriggerDrilldown(
                                      section.drilldownDimension,
                                      drillVal
                                    )
                                  }
                                  className={`h-9 transition-colors ${
                                    section.drilldownDimension
                                      ? 'hover:bg-[var(--rp-primary-soft)]/50 cursor-pointer'
                                      : 'hover:bg-[var(--rp-surface-subtle)]'
                                  }`}
                                >
                                  {tableColumns.map((colKey) => (
                                    <td
                                      key={colKey}
                                      className="py-2 px-3 font-mono text-[var(--rp-ink)] whitespace-nowrap"
                                    >
                                      {String(row[colKey] ?? '—')}
                                    </td>
                                  ))}
                                  {section.drilldownDimension && (
                                    <td className="py-2 px-3 text-right">
                                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--rp-primary)]">
                                        <Search className="w-3 h-3" />
                                        Inspect
                                      </span>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : isDonut ? (
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center min-h-[280px]">
                        <div className="sm:col-span-7 h-64 relative">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={section.rows}
                                dataKey={section.yKey}
                                nameKey={section.xKey}
                                cx="50%"
                                cy="50%"
                                innerRadius={58}
                                outerRadius={92}
                                paddingAngle={3}
                                stroke={themeConfig.donutStroke}
                                strokeWidth={2}
                                onClick={(entry) => {
                                  const rawEntry = entry as unknown as Record<string, unknown>;
                                  const entryPayload = (rawEntry?.payload as Record<string, unknown> | undefined) ?? rawEntry;
                                  const targetValue = entryPayload?.[section.xKey];
                                  if (section.drilldownDimension && targetValue !== undefined && targetValue !== null) {
                                    void handleTriggerDrilldown(
                                      section.drilldownDimension,
                                      String(targetValue)
                                    );
                                  }
                                }}
                                className={section.drilldownDimension ? 'cursor-pointer' : ''}
                              >
                                {section.rows.map((_, i) => (
                                  <Cell
                                    key={`slice-${i}`}
                                    fill={chartPalette[i % chartPalette.length]}
                                  />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={tooltipBoxStyle}
                                itemStyle={{ color: themeConfig.tooltipText }}
                                formatter={(value: unknown, name: unknown) => [
                                  formatSeriesValue(value, section.yUnit),
                                  String(name ?? '')
                                ]}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-[11px] text-[var(--rp-ink-muted)]">Total</span>
                            <span className="text-lg font-bold font-mono tabular-nums text-[var(--rp-ink)]">
                              {formatSeriesValue(donutTotal, section.yUnit)}
                            </span>
                          </div>
                        </div>
                        <div className="sm:col-span-5 space-y-2">
                          {section.rows.map((row, i) => {
                            const val = Number(row[section.yKey]) || 0;
                            const pct = donutTotal > 0 ? (val / donutTotal) * 100 : 0;
                            const color = chartPalette[i % chartPalette.length];
                            const label = String(row[section.xKey] ?? '');
                            return (
                              <button
                                key={`legend-${i}`}
                                type="button"
                                onClick={() =>
                                  section.drilldownDimension &&
                                  void handleTriggerDrilldown(section.drilldownDimension, label)
                                }
                                className="w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--rp-surface-subtle)] transition-colors cursor-pointer"
                              >
                                <span className="inline-flex items-center gap-2 min-w-0">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="text-xs font-medium text-[var(--rp-ink-secondary)] truncate capitalize">
                                    {label.replace(/_/g, ' ')}
                                  </span>
                                </span>
                                <span className="text-xs font-mono tabular-nums text-[var(--rp-ink-muted)] shrink-0">
                                  {pct.toFixed(1)}%
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          {section.chartType === 'composed' ? (
                            <ComposedChart
                              data={section.rows}
                              onClick={(state) => {
                                if (
                                  section.drilldownDimension &&
                                  state &&
                                  state.activeLabel !== undefined
                                ) {
                                  void handleTriggerDrilldown(
                                    section.drilldownDimension,
                                    state.activeLabel
                                  );
                                }
                              }}
                            >
                              <defs>
                                <linearGradient id={`bar-grad-${section.id}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor={chartPalette[0]} stopOpacity={0.96} />
                                  <stop offset="100%" stopColor={chartPalette[4] || chartPalette[0]} stopOpacity={0.72} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke={themeConfig.gridColor} vertical={false} />
                              <XAxis
                                dataKey={section.xKey}
                                stroke={themeConfig.axisColor}
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                                tickMargin={8}
                              />
                              <YAxis
                                yAxisId="left"
                                stroke={themeConfig.axisColor}
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                                width={65}
                              />
                              {section.secondaryKey && (
                                <YAxis
                                  yAxisId="right"
                                  orientation="right"
                                  stroke={themeConfig.axisColor}
                                  fontSize={11}
                                  tickLine={false}
                                  axisLine={false}
                                  width={55}
                                />
                              )}
                              <Tooltip
                                cursor={{ fill: themeConfig.gridColor }}
                                contentStyle={tooltipBoxStyle}
                                itemStyle={{ color: themeConfig.tooltipText }}
                                formatter={(value: unknown, name: unknown) => {
                                  const label = String(name ?? '');
                                  const isPrimary = label === section.yLabel;
                                  return [
                                    formatSeriesValue(
                                      value,
                                      isPrimary ? section.yUnit : section.secondaryUnit
                                    ),
                                    label
                                  ];
                                }}
                              />
                              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                              <Bar
                                yAxisId="left"
                                dataKey={section.yKey}
                                name={section.yLabel}
                                fill={`url(#bar-grad-${section.id})`}
                                radius={[6, 6, 0, 0]}
                                maxBarSize={42}
                                cursor={section.drilldownDimension ? 'pointer' : 'default'}
                              />
                              {section.secondaryKey && (
                                <Line
                                  yAxisId="right"
                                  type="monotone"
                                  dataKey={section.secondaryKey}
                                  name={section.secondaryLabel || section.secondaryKey}
                                  stroke={themeConfig.secondaryHex}
                                  strokeWidth={2.5}
                                  dot={{ r: 3.5, fill: themeConfig.secondaryHex, strokeWidth: 0 }}
                                  activeDot={{ r: 5.5, fill: themeConfig.secondaryHex, stroke: '#fff', strokeWidth: 2 }}
                                />
                              )}
                            </ComposedChart>
                          ) : section.chartType === 'area' ? (
                            <AreaChart
                              data={section.rows}
                              onClick={(state) => {
                                if (
                                  section.drilldownDimension &&
                                  state &&
                                  state.activeLabel !== undefined
                                ) {
                                  void handleTriggerDrilldown(
                                    section.drilldownDimension,
                                    state.activeLabel
                                  );
                                }
                              }}
                            >
                              <defs>
                                <linearGradient id={`area-grad-${section.id}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor={chartPalette[0]} stopOpacity={0.38} />
                                  <stop offset="60%" stopColor={chartPalette[1]} stopOpacity={0.14} />
                                  <stop offset="100%" stopColor={chartPalette[0]} stopOpacity={0.0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke={themeConfig.gridColor} vertical={false} />
                              <XAxis dataKey={section.xKey} stroke={themeConfig.axisColor} fontSize={11} tickLine={false} axisLine={false} />
                              <YAxis stroke={themeConfig.axisColor} fontSize={11} tickLine={false} axisLine={false} width={60} />
                              <Tooltip
                                contentStyle={tooltipBoxStyle}
                                itemStyle={{ color: themeConfig.tooltipText }}
                                formatter={(value: unknown, name: unknown) => [
                                  formatSeriesValue(value, section.yUnit),
                                  String(name ?? '')
                                ]}
                              />
                              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                              <Area
                                type="monotone"
                                dataKey={section.yKey}
                                name={section.yLabel}
                                stroke={chartPalette[0]}
                                fill={`url(#area-grad-${section.id})`}
                                strokeWidth={2.5}
                                activeDot={{ r: 5, fill: chartPalette[0], stroke: '#fff', strokeWidth: 2 }}
                              />
                            </AreaChart>
                          ) : section.chartType === 'horizontal-bar' ? (
                            <BarChart
                              data={section.rows}
                              layout="vertical"
                              margin={{ left: 16, right: 16 }}
                              onClick={(state) => {
                                if (
                                  section.drilldownDimension &&
                                  state &&
                                  state.activeLabel !== undefined
                                ) {
                                  void handleTriggerDrilldown(
                                    section.drilldownDimension,
                                    state.activeLabel
                                  );
                                }
                              }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke={themeConfig.gridColor} horizontal={false} />
                              <XAxis type="number" stroke={themeConfig.axisColor} fontSize={11} tickLine={false} axisLine={false} />
                              <YAxis
                                type="category"
                                dataKey={section.xKey}
                                stroke={themeConfig.axisColor}
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                                width={136}
                                tickFormatter={(value: unknown) => {
                                  const cleaned = String(value ?? '').replace(/_/g, ' ');
                                  return cleaned.length > 18
                                    ? `${cleaned.slice(0, 17)}…`
                                    : cleaned;
                                }}
                              />
                              <Tooltip
                                cursor={{ fill: themeConfig.gridColor }}
                                contentStyle={tooltipBoxStyle}
                                itemStyle={{ color: themeConfig.tooltipText }}
                                formatter={(value: unknown, name: unknown) => [
                                  formatSeriesValue(value, section.yUnit),
                                  String(name ?? '')
                                ]}
                              />
                              <Bar
                                dataKey={section.yKey}
                                name={section.yLabel}
                                radius={[0, 6, 6, 0]}
                                barSize={20}
                                cursor={section.drilldownDimension ? 'pointer' : 'default'}
                              >
                                {section.rows.map((_, i) => (
                                  <Cell
                                    key={`hbar-${i}`}
                                    fill={chartPalette[i % chartPalette.length]}
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          ) : (
                            <BarChart
                              data={section.rows}
                              onClick={(state) => {
                                if (
                                  section.drilldownDimension &&
                                  state &&
                                  state.activeLabel !== undefined
                                ) {
                                  void handleTriggerDrilldown(
                                    section.drilldownDimension,
                                    state.activeLabel
                                  );
                                }
                              }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke={themeConfig.gridColor} vertical={false} />
                              <XAxis dataKey={section.xKey} stroke={themeConfig.axisColor} fontSize={11} tickLine={false} axisLine={false} />
                              <YAxis stroke={themeConfig.axisColor} fontSize={11} tickLine={false} axisLine={false} width={60} />
                              <Tooltip
                                cursor={{ fill: themeConfig.gridColor }}
                                contentStyle={tooltipBoxStyle}
                                itemStyle={{ color: themeConfig.tooltipText }}
                                formatter={(value: unknown, name: unknown) => [
                                  formatSeriesValue(value, section.yUnit),
                                  String(name ?? '')
                                ]}
                              />
                              <Bar
                                dataKey={section.yKey}
                                name={section.yLabel}
                                radius={[6, 6, 0, 0]}
                                maxBarSize={44}
                                cursor={section.drilldownDimension ? 'pointer' : 'default'}
                              >
                                {section.rows.map((_, i) => (
                                  <Cell
                                    key={`vbar-${i}`}
                                    fill={chartPalette[i % chartPalette.length]}
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>

                  {/* Interactive Drill-Down Chip Selector Footer */}
                  {section.drilldownDimension && section.rows.length > 0 && (
                    <div className="pt-3 border-t border-[var(--rp-border)] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-[var(--rp-ink-muted)] font-medium">Drill down:</span>
                        {section.rows.slice(0, 5).map((r, chipIdx) => {
                          const rawChipVal =
                            section.drilldownDimension === 'category' && r.category
                              ? r.category
                              : r[section.xKey];
                          const labelVal = String(rawChipVal ?? '');
                          if (!labelVal) return null;
                          return (
                            <button
                              key={`${section.id}-drill-${chipIdx}`}
                              type="button"
                              onClick={() =>
                                void handleTriggerDrilldown(section.drilldownDimension, labelVal)
                              }
                              className="px-2.5 py-0.5 rounded-full bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-primary-soft)] text-[var(--rp-ink-secondary)] hover:text-[var(--rp-primary-ink)] border border-[var(--rp-border)] hover:border-[var(--rp-primary)] font-mono text-[11px] transition-colors cursor-pointer"
                            >
                              {labelVal}
                            </button>
                          );
                        })}
                      </div>
                      <span className="text-[11px] font-mono text-[var(--rp-ink-muted)]">
                        {section.rows.length} rows
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* KPI SQL & Lineage Modal */}
      {inspectedKpiModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kpi-lineage-modal-title"
          onClick={() => setInspectedKpiModal(null)}
        >
          <div
            className="bg-[var(--rp-surface)] border border-[var(--rp-border)] rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[var(--rp-primary)]">
                  Verified KPI Definition &amp; SQL Lineage
                </span>
                <h3
                  id="kpi-lineage-modal-title"
                  className="font-display text-lg font-bold text-[var(--rp-ink)] mt-0.5"
                >
                  {inspectedKpiModal.label}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectedKpiModal(null)}
                aria-label="Close KPI modal"
                className="p-1.5 text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-subtle)] rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)]">
              <div>
                <div className="text-[11px] text-[var(--rp-ink-muted)]">
                  Live Computed DuckDB Value
                </div>
                <div className="font-display text-xl font-bold tabular-nums text-[var(--rp-primary)] mt-0.5">
                  {formatKpiDisplayValue(inspectedKpiModal, true)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--rp-ink-muted)]">
                  Data Grain &amp; De-duplication Rule
                </div>
                <div className="text-xs font-mono text-[#137333] dark:text-emerald-400 mt-1">
                  {inspectedKpiModal.grainNote}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-[var(--rp-ink)] flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                <span>Business Definition</span>
              </div>
              <p className="text-xs text-[var(--rp-ink-secondary)] leading-relaxed">
                {inspectedKpiModal.definition}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-[var(--rp-ink)] flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                <span>Reproducible DuckDB SQL Calculation Source</span>
              </div>
              <pre className="p-3.5 rounded-xl code-surface border text-xs font-mono overflow-x-auto leading-relaxed">
                {inspectedKpiModal.sqlSource}
              </pre>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <Link
                to="/sql-lab"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[var(--rp-primary)] hover:bg-[var(--rp-primary-hover)] rounded-lg transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in SQL Studio
              </Link>
              <button
                type="button"
                onClick={() => setInspectedKpiModal(null)}
                className="px-3.5 py-1.5 text-xs font-medium text-[var(--rp-ink-secondary)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live DuckDB Drill-Down Modal */}
      {(drilldownLoading || drilldownResult || drilldownError) && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drilldown-modal-title"
          onClick={() => {
            setDrilldownResult(null);
            setDrilldownError(null);
          }}
        >
          <div
            className="bg-[var(--rp-surface)] border border-[var(--rp-border)] rounded-2xl max-w-4xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-[var(--rp-border)] flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-mono font-semibold uppercase tracking-wider text-[var(--rp-primary)]">
                  <Search className="w-3.5 h-3.5" />
                  <span>Live DuckDB Drill-Down Inspector</span>
                </div>
                <h3
                  id="drilldown-modal-title"
                  className="font-display text-base font-bold text-[var(--rp-ink)] mt-1"
                >
                  {drilldownLoading
                    ? 'Executing Granular DuckDB Drill-Down Query...'
                    : drilldownResult?.title || 'Drill-Down Results'}
                </h3>
                {drilldownResult && (
                  <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5">
                    {drilldownResult.subtitle}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setDrilldownResult(null);
                  setDrilldownError(null);
                }}
                aria-label="Close drill-down inspector"
                className="p-1.5 text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-subtle)] rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {drilldownError && (
                <div className="p-3 rounded-xl bg-[#FCE8E6] dark:bg-red-950/50 border border-[#EA4335]/35 text-xs text-[#A50E0E] dark:text-red-200">
                  {drilldownError}
                </div>
              )}

              {drilldownResult && (
                <>
                  {/* Option to apply as cross-dashboard filter if supported */}
                  {['state', 'category', 'status', 'month'].includes(
                    drilldownResult.dimensionType
                  ) && (
                    <div className="p-3 rounded-xl bg-[var(--rp-primary-soft)] border border-[var(--rp-primary)]/25 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-[var(--rp-ink)]">
                        Filter all 6 BI dashboards by{' '}
                        <strong className="font-mono text-[var(--rp-primary-ink)]">
                          {drilldownResult.dimensionType} = {drilldownResult.dimensionValue}
                        </strong>
                        ?
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleApplyCrossFilterFromDrilldown(
                            drilldownResult.dimensionType,
                            drilldownResult.dimensionValue
                          )
                        }
                        className="px-3 py-1.5 bg-[var(--rp-primary)] hover:bg-[var(--rp-primary-hover)] text-white rounded-lg font-medium transition-colors cursor-pointer"
                      >
                        Apply Cross-Dashboard Filter
                      </button>
                    </div>
                  )}

                  {/* Executed SQL */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-[var(--rp-ink-muted)]">
                      <span className="font-mono font-semibold text-[var(--rp-primary)]">
                        EXECUTED DUCKDB DRILL-DOWN SQL
                      </span>
                      <span className="font-mono tabular-nums">
                        {drilldownResult.rowCount} records · {drilldownResult.executionTimeMs} ms
                      </span>
                    </div>
                    <pre className="p-3 rounded-xl code-surface border text-[11px] font-mono overflow-x-auto">
                      {drilldownResult.executedSql}
                    </pre>
                  </div>

                  {/* Granular Results Table */}
                  <div className="overflow-x-auto border border-[var(--rp-border)] rounded-xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-[var(--rp-surface-subtle)]">
                        <tr className="border-b border-[var(--rp-border)] text-[var(--rp-ink-muted)]">
                          {drilldownResult.columns.map((col) => (
                            <th key={col.name} className="py-2.5 px-3 font-mono font-semibold">
                              {col.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--rp-border)]">
                        {drilldownResult.rows.map((row, rIdx) => (
                          <tr
                            key={`drill-row-${rIdx}`}
                            className="hover:bg-[var(--rp-surface-subtle)] transition-colors"
                          >
                            {drilldownResult.columns.map((col) => (
                              <td
                                key={col.name}
                                className="py-2 px-3 font-mono tabular-nums text-[var(--rp-ink)] whitespace-nowrap"
                              >
                                {String(row[col.name] ?? '—')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-[var(--rp-border)] bg-[var(--rp-surface-subtle)] flex items-center justify-between">
              {drilldownResult ? (
                <button
                  type="button"
                  onClick={() =>
                    exportRowsToCsv(
                      `drilldown-${drilldownResult.dimensionType}-${drilldownResult.dimensionValue}.csv`,
                      drilldownResult.rows
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--rp-ink-secondary)] bg-[var(--rp-surface)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] rounded-lg transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                  Export Drill-Down CSV
                </button>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={() => {
                  setDrilldownResult(null);
                  setDrilldownError(null);
                }}
                className="px-4 py-1.5 text-xs font-medium text-[var(--rp-ink)] bg-[var(--rp-surface)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] rounded-lg transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
