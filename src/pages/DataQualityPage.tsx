import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Code2,
  Database,
  Layers,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wrench
} from 'lucide-react';
import {
  AnalyticalModelMetadata,
  DataQualityAndModelingPayload,
  SqlQueryResult
} from '../types/analytics';
import { apiClient } from '../services/apiClient';
import { usePlatform } from '../context/PlatformContext';
import { DataStateBanner } from '../components/ui/DataStateBanner';
import { DataTable } from '../components/ui/DataTable';
import { LineageGovernancePanel } from '../components/ui/LineageGovernancePanel';
import { formatAnalyticalMetric } from '../utils/validators';

type ActiveSectionTab = 'ALL' | 'QUALITY' | 'MODELS' | 'KPIS' | 'GRAIN_DOCS' | 'LINEAGE';

export const DataQualityPage: React.FC = () => {
  const {
    totalRows,
    totalStagingRows,
    totalRejectedRows,
    rejectedRecords,
    dataMode,
    isDemonstrationData,
    refreshPlatformState
  } = usePlatform();

  const [dashboard, setDashboard] = useState<DataQualityAndModelingPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [remediationBanner, setRemediationBanner] = useState<string[] | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveSectionTab>('QUALITY');

  // Interactive model / SQL inspector state
  const [selectedModel, setSelectedModel] = useState<AnalyticalModelMetadata | null>(null);
  const [inspectorSql, setInspectorSql] = useState<string>('');
  const [inspectorTitle, setInspectorTitle] = useState<string>('');
  const [inspectorResult, setInspectorResult] = useState<SqlQueryResult | null>(null);
  const [inspectorLoading, setInspectorLoading] = useState<boolean>(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getQualityDashboard();
      if (res.data) {
        setDashboard(res.data);
        if (!selectedModel && res.data.analyticalModels.length > 0) {
          setSelectedModel(res.data.analyticalModels[0]);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to evaluate DuckDB data quality and analytical models.'
      );
    } finally {
      setLoading(false);
    }
  }, [selectedModel]);

  useEffect(() => {
    void loadDashboard();
  }, [totalRows, dataMode]);

  const runInlineSqlPreview = async (title: string, sql: string) => {
    setInspectorTitle(title);
    setInspectorSql(sql);
    setInspectorLoading(true);
    try {
      const res = await apiClient.executeSql({ sql, limit: 25 });
      if (res.data) {
        setInspectorResult(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute inline SQL preview.');
    } finally {
      setInspectorLoading(false);
    }
  };

  const handleInjectAnomalies = async () => {
    setActionBusy(true);
    setError(null);
    setRemediationBanner(null);
    try {
      const res = await apiClient.injectSampleAnomalies();
      if (res.data) {
        setDashboard(res.data);
      }
      await refreshPlatformState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to inject sample anomalies.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemediateIssues = async () => {
    setActionBusy(true);
    setError(null);
    try {
      const res = await apiClient.remediateQualityIssues();
      const dashRes = await apiClient.getQualityDashboard();
      if (dashRes.data) {
        setDashboard(dashRes.data);
      }
      if (res.data) {
        setRemediationBanner(res.data.actionsExecuted);
      }
      await refreshPlatformState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Automated SQL remediation failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const issues = dashboard?.issues || [];
  const checks = dashboard?.checks || [];
  const models = dashboard?.analyticalModels || [];
  const kpiDictionary = dashboard?.kpiDictionary || [];
  const custAudit = dashboard?.customerIdentityAudit;

  const passedAssertionsCount = checks.filter((c) => c.status === 'PASSED').length;

  return (
    <div className="space-y-6">
      <DataStateBanner />

      {/* Top Executive Header with Live Circular SVG Quality Score Gauge */}
      <div className="studio-card rounded-xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="flex items-center gap-4">
            {(() => {
              const score = dashboard?.overallQualityScorePercent ?? 100;
              const clamped = Math.max(0, Math.min(100, score));
              const radius = 32;
              const circumference = 2 * Math.PI * radius;
              const dashOffset = circumference - (clamped / 100) * circumference;
              const ringColor =
                score >= 98 ? '#34A853' : score >= 90 ? '#F59E0B' : '#F43F5E';
              return (
                <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80" aria-label={`Overall Quality Score ${score.toFixed(1)}%`}>
                    <circle
                      cx="40"
                      cy="40"
                      r={radius}
                      fill="none"
                      stroke="rgba(148, 163, 184, 0.16)"
                      strokeWidth="6"
                    />
                    <circle
                      cx="40"
                      cy="40"
                      r={radius}
                      fill="none"
                      stroke={ringColor}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      className="transition-all duration-700 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-sm font-bold font-mono tabular-nums text-slate-50">
                      {dashboard ? `${Math.round(score)}%` : '—'}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider text-slate-400">
                      Health
                    </span>
                  </div>
                </div>
              );
            })()}
            <div className="space-y-1 max-w-2xl">
              <h1 className="text-xl font-bold text-slate-50 tracking-tight">
                Data Quality &amp; Models
              </h1>
              <p className="text-xs text-slate-400 leading-relaxed">
                Audit integrity rules, inspect 9 star-schema views, and verify KPI formulas and join grain.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={loading || actionBusy}
              onClick={() => void handleInjectAnomalies()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-200 bg-amber-950/50 hover:bg-amber-900/60 border border-amber-700/50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>Test Anomalies</span>
            </button>

            <button
              type="button"
              disabled={loading || actionBusy}
              onClick={() => void handleRemediateIssues()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-100 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Auto-Fix</span>
            </button>

            <button
              type="button"
              disabled={loading || actionBusy}
              onClick={() => void loadDashboard()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#1a73e8] hover:bg-[#2b7de9] disabled:opacity-50 rounded-lg shadow-sm shadow-blue-950/40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Run Audit</span>
            </button>
          </div>
        </div>

        {/* Live Calculated Quality Scorecards */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5 text-xs">
          <div className="relative overflow-hidden p-3.5 bg-slate-950/65 border border-slate-800/90 rounded-lg">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#34A853] to-[#34D399]" />
            <div className="text-slate-400">Calculated Quality Score</div>
            <div
              className={`text-xl font-bold font-mono tabular-nums mt-1 whitespace-nowrap ${
                (dashboard?.overallQualityScorePercent ?? 100) >= 98
                  ? 'text-emerald-400'
                  : (dashboard?.overallQualityScorePercent ?? 100) >= 90
                  ? 'text-amber-400'
                  : 'text-red-400'
              }`}
            >
              {dashboard ? `${dashboard.overallQualityScorePercent.toFixed(2)}%` : '—'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
              {dashboard?.totalRecordsEvaluated ?? 0} total records evaluated
            </div>
          </div>

          <div className="relative overflow-hidden p-3.5 bg-slate-950/65 border border-slate-800/90 rounded-lg">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#4285F4] to-[#60A5FA]" />
            <div className="text-slate-400">Issue Categories Resolved</div>
            <div className="text-xl font-bold font-mono tabular-nums text-emerald-400 mt-1 whitespace-nowrap">
              {dashboard ? `${dashboard.resolvedIssuesCount} / ${issues.length}` : '—'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
              {dashboard?.unresolvedIssuesCount ?? 0} unresolved requiring action
            </div>
          </div>

          <div className="relative overflow-hidden p-3.5 bg-slate-950/65 border border-slate-800/90 rounded-lg">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA]" />
            <div className="text-slate-400">Star-Schema Analytical Views</div>
            <div className="text-xl font-bold font-mono tabular-nums text-sky-400 mt-1 whitespace-nowrap">
              {models.length} Active Views
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
              4 Fact tables · 5 Dimensions
            </div>
          </div>

          <div className="relative overflow-hidden p-3.5 bg-slate-950/65 border border-slate-800/90 rounded-lg">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#06B6D4] to-[#22D3EE]" />
            <div className="text-slate-400">Documented KPI Dictionary</div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-100 mt-1 whitespace-nowrap">
              {kpiDictionary.length} Core KPIs
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
              Order-grain & unique-customer safe
            </div>
          </div>

          <div className="relative overflow-hidden p-3.5 bg-slate-950/65 border border-slate-800/90 rounded-lg">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#F59E0B] to-[#FBBF24]" />
            <div className="text-slate-400">Staging Quarantine Log</div>
            <div className="text-xl font-bold font-mono tabular-nums text-amber-400 mt-1 whitespace-nowrap">
              {totalRejectedRows} / {totalStagingRows}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
              SQL Assertions: {passedAssertionsCount}/{checks.length} PASSED
            </div>
          </div>
        </div>
      </div>

      {/* Remediation Execution Feedback Banner */}
      {remediationBanner && (
        <div
          role="status"
          className="bg-emerald-950/40 border border-emerald-800/80 rounded-lg p-4 text-xs text-emerald-100 space-y-1.5"
        >
          <div className="flex items-center justify-between">
            <div className="font-semibold flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="w-4 h-4" />
              Automated DuckDB SQL Remediation Executed
            </div>
            <button
              type="button"
              onClick={() => setRemediationBanner(null)}
              className="text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
            >
              Dismiss
            </button>
          </div>
          <ul className="list-disc list-inside space-y-1 text-emerald-200/90 font-mono text-[11px]">
            {remediationBanner.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-4 bg-red-950/50 border border-red-800 rounded-lg text-xs text-red-200"
        >
          {error}
        </div>
      )}

      {/* Clean Google Cloud Horizontal Underline Tab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800">
        <div className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Data Quality and Modeling Sections">
          {(
            [
              { id: 'QUALITY', label: 'Issues (9)' },
              { id: 'LINEAGE', label: 'Lineage & Governance' },
              { id: 'MODELS', label: 'Views (9)' },
              { id: 'KPIS', label: 'KPIs (10)' },
              { id: 'GRAIN_DOCS', label: 'Grain Rules' },
              { id: 'ALL', label: 'All' }
            ] as { id: ActiveSectionTab; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'border-[#8ab4f8] text-[#8ab4f8]'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <Link
          to="/sql-lab"
          className="inline-flex items-center gap-1.5 pb-2 text-xs font-medium text-[#8ab4f8] hover:text-blue-300 whitespace-nowrap shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          <span>SQL Studio</span>
        </Link>
      </div>

      {/* Interactive 4-Layer Visual Data Lineage & Metric Governance DAG */}
      {activeTab === 'LINEAGE' && <LineageGovernancePanel />}

      {/* Inline SQL Preview Drawer (when user clicks "Verify SQL Live" or "Preview View") */}
      {inspectorResult && (
        <div className="bg-slate-900 border border-sky-800/80 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-mono text-sky-400">LIVE DUCKDB SQL VERIFICATION</div>
              <h3 className="text-sm font-semibold text-slate-100 mt-0.5">{inspectorTitle}</h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-emerald-400 tabular-nums">
                {inspectorResult.rowCount} rows · {inspectorResult.executionTimeMs} ms
              </span>
              <button
                type="button"
                onClick={() => setInspectorResult(null)}
                className="px-2.5 py-1 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 rounded cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>

          <pre className="p-3 bg-slate-950 border border-slate-800 rounded text-[11px] font-mono text-sky-200 overflow-x-auto">
            {inspectorSql}
          </pre>

          <DataTable
            title={`${inspectorTitle} — Query Output`}
            subtitle={`Executed live against DuckDB in-memory analytical engine`}
            columns={inspectorResult.columns}
            rows={inspectorResult.rows}
            isDemonstrationData={inspectorResult.isDemonstrationData}
            loading={inspectorLoading}
            exportFilename="duckdb_verification_output.csv"
          />
        </div>
      )}

      {/* =====================================================================
          SECTION 1: 9-CATEGORY DATA QUALITY EVALUATION DASHBOARD
         ===================================================================== */}
      {(activeTab === 'ALL' || activeTab === 'QUALITY') && (
        <div className="space-y-6">
          <div className="studio-card rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  1. Comprehensive Olist Data Quality Evaluation (9 Issue Categories)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Every issue category is evaluated directly from imported staging (
                  <code className="font-mono text-slate-300">stg_*</code> /{' '}
                  <code className="font-mono text-slate-300">audit_rejected_records</code>) and
                  cleaned DuckDB tables.
                </p>
              </div>
              <div className="text-xs font-mono text-slate-400 tabular-nums">
                9 Required Categories · {dashboard?.resolvedIssuesCount ?? 0} Resolved ·{' '}
                {dashboard?.unresolvedIssuesCount ?? 0} Unresolved
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-300">
                    <th className="px-4 py-3 font-semibold">1. Issue Category & Target Tables</th>
                    <th className="px-4 py-3 font-semibold text-right">2. Affected Records</th>
                    <th className="px-4 py-3 font-semibold text-right">3. % Affected</th>
                    <th className="px-4 py-3 font-semibold">4. Severity</th>
                    <th className="px-4 py-3 font-semibold">5. Recommended Correction</th>
                    <th className="px-4 py-3 font-semibold">6. Resolution Status</th>
                    <th className="px-4 py-3 font-semibold text-right">Verify SQL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {issues.map((issue) => (
                    <tr key={issue.id} className="hover:bg-slate-800/30">
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-100">{issue.issueCategory}</div>
                        <div className="font-mono text-[11px] text-sky-400 mt-0.5">
                          {issue.targetTable}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-100 whitespace-nowrap">
                        <span
                          className={
                            issue.affectedRecords > 0
                              ? issue.isResolved
                                ? 'text-amber-300 font-semibold'
                                : 'text-red-400 font-semibold'
                              : 'text-emerald-400'
                          }
                        >
                          {issue.affectedRecords.toLocaleString()}
                        </span>{' '}
                        <span className="text-slate-500">
                          / {issue.totalRecordsEvaluated.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                        {issue.affectedPercentage.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] whitespace-nowrap">
                        <span
                          className={
                            issue.severity === 'CRITICAL'
                              ? 'text-red-400 font-semibold'
                              : issue.severity === 'HIGH'
                              ? 'text-amber-400 font-semibold'
                              : 'text-sky-300'
                          }
                        >
                          {issue.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-300 max-w-md leading-relaxed">
                        {issue.recommendedCorrection}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] whitespace-nowrap">
                        {issue.isResolved ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-400">
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                            <span>Yes · {issue.resolutionStatusLabel}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-red-400 font-semibold">
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                            <span>No · {issue.resolutionStatusLabel}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            void runInlineSqlPreview(
                              `Diagnostic SQL — ${issue.issueCategory}`,
                              issue.diagnosticSql
                            )
                          }
                          className="px-2.5 py-1 text-[11px] font-mono text-sky-300 bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer"
                        >
                          Run SQL
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* SQL Relational & Grain-Safety Assertions Table */}
          <div className="studio-card rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">
                Automated DuckDB Relational Integrity & Anti-Multiplication Assertions
              </h3>
              <span className="text-xs font-mono text-slate-400 tabular-nums">
                {checks.length} SQL invariants evaluated
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-300">
                    <th className="px-4 py-3 font-semibold">Rule & Description</th>
                    <th className="px-4 py-3 font-semibold">Table</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">SQL Assertion</th>
                    <th className="px-4 py-3 font-semibold text-right">Records Checked</th>
                    <th className="px-4 py-3 font-semibold text-right">Pass Rate</th>
                    <th className="px-4 py-3 font-semibold text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {checks.map((chk) => (
                    <tr key={chk.id} className="hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-100">{chk.checkName}</div>
                        <div className="text-slate-400 mt-0.5">{chk.description}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-sky-300 whitespace-nowrap">
                        {chk.tableName}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-400 whitespace-nowrap">
                        {chk.category}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-300 max-w-xs truncate">
                        {chk.sqlAssertion}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                        {chk.totalChecked}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                        {chk.passRatePercent === null ? '—' : `${chk.passRatePercent.toFixed(1)}%`}
                      </td>
                      <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                        {chk.status === 'PASSED' && (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            PASSED
                          </span>
                        )}
                        {chk.status === 'SKIPPED_EMPTY' && (
                          <span className="text-amber-400">SKIPPED (0 ROWS)</span>
                        )}
                        {(chk.status === 'FAILED' || chk.status === 'WARNING') && (
                          <span className="inline-flex items-center gap-1 text-red-400">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            {chk.status} ({chk.issueCount})
                          </span>
                        )}
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
          SECTION 2: STAR-SCHEMA ANALYTICAL DATA MODEL (9 REUSABLE VIEWS)
         ===================================================================== */}
      {(activeTab === 'ALL' || activeTab === 'MODELS') && (
        <div className="studio-card rounded-xl p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs text-sky-400 font-mono">
                <Layers className="w-3.5 h-3.5" />
                <span>STAR-SCHEMA ANALYTICAL MODELLING LAYER</span>
              </div>
              <h2 className="text-base font-semibold text-slate-100 mt-1">
                2. Reusable DuckDB Analytical Views (4 Fact Models & 5 Dimension Models)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Materialized as live SQL views inside DuckDB. Click any model below to inspect its
                grain, foreign keys, anti-multiplication rules, SQL DDL, and live records.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {models.map((m) => {
              const isSelected = selectedModel?.viewName === m.viewName;
              return (
                <div
                  key={m.viewName}
                  className={`p-4 rounded-lg border transition-colors flex flex-col justify-between ${
                    isSelected
                      ? 'bg-slate-950 border-sky-500'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={`font-mono font-semibold ${
                          m.modelType === 'FACT' ? 'text-sky-400' : 'text-emerald-400'
                        }`}
                      >
                        {m.modelType} VIEW
                      </span>
                      <span className="font-mono tabular-nums text-slate-300">
                        {m.rowCount.toLocaleString()} rows · {m.columnCount} cols
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-100">{m.displayName}</h3>
                      <code className="text-xs font-mono text-sky-300">{m.viewName}</code>
                    </div>

                    <div className="mt-2 text-xs text-slate-300">
                      <span className="text-slate-400">Grain:</span>{' '}
                      <span className="font-mono text-[11px] text-slate-200">{m.grain}</span>
                    </div>

                    <div className="mt-1 text-xs text-slate-400">
                      <span>PK:</span>{' '}
                      <code className="font-mono text-[11px] text-slate-300">{m.primaryKey}</code>
                    </div>

                    <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
                      {m.antiMultiplicationRule}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedModel(m)}
                      className="text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
                    >
                      Inspect DDL & Schema
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedModel(m);
                        void runInlineSqlPreview(
                          `${m.displayName} (${m.viewName}) — Sample Rows`,
                          m.sampleQuerySql
                        );
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 rounded cursor-pointer"
                    >
                      <Play className="w-3 h-3" />
                      Query View
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected Analytical Model DDL & Column Inspector */}
          {selectedModel && (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono text-sky-400">
                    <Database className="w-3.5 h-3.5" />
                    <span>{selectedModel.viewName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{selectedModel.modelType} MODEL SPECIFICATION</span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-100 mt-1">
                    {selectedModel.displayName} — Grain: {selectedModel.grain}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void runInlineSqlPreview(
                      `${selectedModel.displayName} (${selectedModel.viewName})`,
                      selectedModel.sampleQuerySql
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 rounded cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  Execute {selectedModel.viewName} Sample Query
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div className="lg:col-span-5 space-y-3 text-xs">
                  <div>
                    <div className="font-semibold text-slate-200 mb-1">
                      Source Tables & Foreign Key Lineage
                    </div>
                    <div className="text-slate-400 font-mono text-[11px]">
                      Sources: {selectedModel.sourceTables.join(', ')}
                    </div>
                    {selectedModel.foreignKeys.length > 0 && (
                      <ul className="mt-1.5 space-y-1 font-mono text-[11px] text-sky-300">
                        {selectedModel.foreignKeys.map((fk) => (
                          <li key={fk}>{fk}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <div className="font-semibold text-slate-200 mb-1">
                      Columns ({selectedModel.columns.length})
                    </div>
                    <div className="max-h-52 overflow-y-auto border border-slate-800 rounded divide-y divide-slate-800/60">
                      {selectedModel.columns.map((col) => (
                        <div
                          key={col.name}
                          className="px-3 py-1.5 flex items-center justify-between font-mono text-[11px]"
                        >
                          <span className="text-slate-200">{col.name}</span>
                          <span className="text-slate-400">{col.type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-7 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Code2 className="w-3.5 h-3.5 text-sky-400" />
                      Reproducible View Transformation SQL (DDL)
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">DuckDB SQL</span>
                  </div>
                  <pre className="p-3.5 bg-slate-900 border border-slate-800 rounded text-[11px] font-mono text-sky-200 overflow-x-auto max-h-72 leading-relaxed">
                    {selectedModel.viewSqlDdl}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SECTION 3: DOCUMENTED KPI DICTIONARY (10 REPRODUCIBLE METRICS)
         ===================================================================== */}
      {(activeTab === 'ALL' || activeTab === 'KPIS') && (
        <div className="studio-card rounded-xl p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs text-sky-400 font-mono">
                <BookOpen className="w-3.5 h-3.5" />
                <span>ENTERPRISE KPI DICTIONARY & SQL TRANSFORMATION LOGIC</span>
              </div>
              <h2 className="text-base font-semibold text-slate-100 mt-1">
                3. Documented KPI Dictionary (10 Core Metrics Calculated from DuckDB)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Distinguishes Gross Merchandise Value, Freight Revenue, and Total Order Value,
                enforces order-grain AOV, and resolves repeat purchasing strictly via{' '}
                <code className="font-mono text-sky-300">customer_unique_id</code>.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {kpiDictionary.map((kpi) => (
              <div
                key={kpi.id}
                className="p-4 bg-slate-950/70 border border-slate-800 rounded-lg flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span>{kpi.category}</span>
                    <span className="font-mono text-sky-400">
                      Model: {kpi.sourceAnalyticalModel}
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="text-sm font-semibold text-slate-100">{kpi.metricName}</h3>
                    <div className="text-xl font-bold font-mono tabular-nums text-emerald-400 shrink-0">
                      {formatAnalyticalMetric(kpi.currentValue, kpi.unit)}
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">{kpi.businessDefinition}</p>

                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    <strong className="text-slate-200">Grain & Anti-Multiplication Rule:</strong>{' '}
                    {kpi.grainAndJoinRule}
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-slate-400">
                      Formula: <code className="text-slate-200">{kpi.formulaExpression}</code>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void runInlineSqlPreview(
                          `KPI Verification — ${kpi.metricName}`,
                          kpi.reproducibleSql
                        )
                      }
                      className="px-2.5 py-1 font-mono text-sky-300 bg-slate-800 hover:bg-slate-700 rounded transition-colors cursor-pointer"
                    >
                      Verify SQL Live
                    </button>
                  </div>
                  <pre className="p-2.5 bg-slate-900 border border-slate-800/90 rounded text-[11px] font-mono text-sky-200 overflow-x-auto">
                    {kpi.reproducibleSql}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          SECTION 4: CUSTOMER IDENTIFICATION & DATA GRAIN DOCUMENTATION
         ===================================================================== */}
      {(activeTab === 'ALL' || activeTab === 'GRAIN_DOCS') && (
        <div className="studio-card rounded-xl p-6 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs text-sky-400 font-mono">
                <Users className="w-3.5 h-3.5" />
                <span>CUSTOMER ENTITY RESOLUTION & GRAIN ARCHITECTURE</span>
              </div>
              <h2 className="text-base font-semibold text-slate-100 mt-1">
                4. Customer Identification (<code className="font-mono">customer_unique_id</code> vs.{' '}
                <code className="font-mono">customer_id</code>) & Grain Governance
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Live empirical proof from the imported dataset showing why{' '}
                <code className="font-mono text-slate-200">customer_unique_id</code> is mandatory
                for repeat-purchase and retention analytics.
              </p>
            </div>
            {custAudit && (
              <button
                type="button"
                onClick={() =>
                  void runInlineSqlPreview(
                    'Customer Identity Resolution Audit (customer_unique_id vs customer_id)',
                    custAudit.verificationSql
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-md cursor-pointer shrink-0"
              >
                <Play className="w-3.5 h-3.5" />
                Verify Customer Identity SQL
              </button>
            )}
          </div>

          {custAudit && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-md">
                <div className="text-slate-400">
                  Order-Scoped Keys (<code className="font-mono">customer_id</code>)
                </div>
                <div className="text-xl font-semibold font-mono tabular-nums text-slate-200 mt-1">
                  {custAudit.distinctCustomerIdsCount.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  1:1 transaction foreign key generated per order
                </div>
              </div>

              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-md">
                <div className="text-slate-400">
                  Permanent Buyers (<code className="font-mono text-emerald-400">customer_unique_id</code>)
                </div>
                <div className="text-xl font-semibold font-mono tabular-nums text-emerald-400 mt-1">
                  {custAudit.distinctCustomerUniqueIdsCount.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  True deduplicated customer population in dim_customers
                </div>
              </div>

              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-md">
                <div className="text-slate-400">
                  True Repeat Rate (via <code className="font-mono text-emerald-400">customer_unique_id</code>)
                </div>
                <div className="text-xl font-semibold font-mono tabular-nums text-emerald-400 mt-1">
                  {custAudit.repeatRateByUniqueIdPercent.toFixed(2)}%
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {custAudit.repeatCustomerUniqueIdsCount} customers with 2+ distinct orders
                </div>
              </div>

              <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-md">
                <div className="text-slate-400">
                  Naive Repeat Rate (if misusing <code className="font-mono text-red-400">customer_id</code>)
                </div>
                <div className="text-xl font-semibold font-mono tabular-nums text-red-400 mt-1">
                  {custAudit.repeatRateIfMisusingCustomerIdPercent.toFixed(2)}%
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Always 0% in Olist because each order gets a new customer_id
                </div>
              </div>
            </div>
          )}

          {/* Architectural Documentation Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-md space-y-2">
              <div className="font-semibold text-slate-100">
                Rule 1: Customer Identity Resolution
              </div>
              <p className="text-slate-300 leading-relaxed">
                In the Brazilian Olist dataset, <code className="font-mono text-sky-300">orders.customer_id</code>{' '}
                is an order-specific session key created for each checkout. To track repeat
                purchasing, cohort retention, and Customer Lifetime Value (LTV), queries must join{' '}
                <code className="font-mono text-sky-300">orders</code> to{' '}
                <code className="font-mono text-sky-300">customers</code> on{' '}
                <code className="font-mono text-sky-300">customer_id</code> and aggregate by{' '}
                <code className="font-mono text-emerald-400">customer_unique_id</code> (encapsulated
                in <code className="font-mono text-sky-300">dim_customers</code>).
              </p>
            </div>

            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-md space-y-2">
              <div className="font-semibold text-slate-100">
                Rule 2: One-to-Many Join Fan-Out Prevention
              </div>
              <p className="text-slate-300 leading-relaxed">
                One order can contain multiple line items (<code className="font-mono text-sky-300">order_items</code>)
                and multiple payment settlement rows (<code className="font-mono text-sky-300">payments</code>,
                e.g. credit card + voucher). Joining <code className="font-mono text-sky-300">order_items</code>{' '}
                directly to <code className="font-mono text-sky-300">payments</code> on{' '}
                <code className="font-mono text-sky-300">order_id</code> creates a Cartesian
                fan-out per order and inflates revenue. <code className="font-mono text-emerald-400">fact_orders</code>{' '}
                pre-aggregates both tables to <code className="font-mono text-sky-300">1 row per order_id</code>{' '}
                via CTEs prior to joining.
              </p>
            </div>

            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-md space-y-2">
              <div className="font-semibold text-slate-100">
                Rule 3: Revenue Metric Separation
              </div>
              <p className="text-slate-300 leading-relaxed">
                RetailPulse strictly distinguishes: (a){' '}
                <strong className="text-slate-100">Gross Merchandise Value (GMV)</strong> ={' '}
                <code className="font-mono text-sky-300">SUM(order_items.price)</code>, (b){' '}
                <strong className="text-slate-100">Freight Revenue</strong> ={' '}
                <code className="font-mono text-sky-300">SUM(order_items.freight_value)</code>, and
                (c) <strong className="text-slate-100">Total Order Value</strong> ={' '}
                <code className="font-mono text-sky-300">SUM(fact_orders.total_order_value)</code>{' '}
                at the order grain. Average Order Value (AOV) divides Total Order Value by distinct
                orders, never by item count.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Rejected Records Summary Link */}
      {rejectedRecords.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex items-center justify-between gap-4 text-xs">
          <div className="text-slate-300">
            <strong className="font-mono text-amber-400">{rejectedRecords.length}</strong> invalid,
            duplicate, or remediated records are isolated in{' '}
            <code className="font-mono text-sky-300">audit_rejected_records</code> without polluting
            the cleaned analytical tables or Star-Schema views.
          </div>
          <Link
            to="/data-management"
            className="px-3.5 py-2 font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-md whitespace-nowrap shrink-0"
          >
            Inspect Rejected Records
          </Link>
        </div>
      )}
    </div>
  );
};
