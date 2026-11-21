import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  BookmarkPlus,
  BookOpen,
  CheckCircle2,
  Clock,
  Code2,
  Cpu,
  Database,
  Download,
  Filter,
  History,
  Layers,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  Zap
} from 'lucide-react';
import { getModuleById } from '../config/modules';
import {
  ALL_SQL_CONCEPTS,
  CURATED_SQL_LIBRARY,
  SQL_QUERY_CATEGORIES,
  SavedSqlQueryItem,
  SqlConceptTag,
  SqlQueryCategory
} from '../config/sqlCatalog';
import {
  AnalyticalModelMetadata,
  KpiDictionaryEntry,
  SavedCustomSqlQuery,
  SqlBenchmarkVerificationItem,
  SqlExecutionHistoryItem,
  SqlQueryPlanProfile,
  SqlQueryResult
} from '../types/analytics';
import { apiClient } from '../services/apiClient';
import { validateSqlQuery } from '../utils/validators';
import { usePlatform } from '../context/PlatformContext';
import { DataStateBanner } from '../components/ui/DataStateBanner';
import { DataTable } from '../components/ui/DataTable';

type ExecutionStatus =
  | 'IDLE'
  | 'EXECUTING'
  | 'SUCCEEDED'
  | 'VALIDATION_BLOCKED'
  | 'EXECUTION_ERROR';

type WorkspaceTab = 'RESULTS' | 'EXPLAIN_PLAN' | 'BENCHMARKS' | 'HISTORY' | 'SCHEMA';

function exportRowsToCsv(
  filename: string,
  columns: { name: string; type: string }[],
  rows: Record<string, string | number | boolean | null>[]
): void {
  if (!columns.length) return;
  const header = columns.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(',');
  const body = rows
    .map((r) =>
      columns
        .map((c) => {
          const val = r[c.name];
          if (val === null || val === undefined) return '';
          const str = String(val).replace(/"/g, '""');
          return `"${str}"`;
        })
        .join(',')
    )
    .join('\n');

  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const SqlLabPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialModuleId = searchParams.get('module');
  const queryCodeParam = searchParams.get('query');
  const initialMod = initialModuleId ? getModuleById(initialModuleId) : undefined;
  const initialCuratedQuery = useMemo(() => {
    if (!queryCodeParam) return CURATED_SQL_LIBRARY[0];
    return (
      CURATED_SQL_LIBRARY.find(
        (item) => item.code.toLowerCase() === queryCodeParam.toLowerCase()
      ) || CURATED_SQL_LIBRARY[0]
    );
  }, [queryCodeParam]);

  const { datasets, isDemonstrationData, totalRows, dataMode } = usePlatform();

  // Library filtering state
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedConcept, setSelectedConcept] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Active selected query from library
  const [activeQueryItem, setActiveQueryItem] = useState<SavedSqlQueryItem>(initialCuratedQuery);

  // SQL Editor & Execution state
  const [sqlText, setSqlText] = useState<string>(
    initialMod?.defaultSql || initialCuratedQuery.sql
  );
  const [rowLimit, setRowLimit] = useState<number>(250);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('IDLE');
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Workspace tabs
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('RESULTS');

  // History, Custom Saved Queries, Benchmarks, Query Plan Profiler, and Schema Explorer
  const [history, setHistory] = useState<SqlExecutionHistoryItem[]>([]);
  const [customQueries, setCustomQueries] = useState<SavedCustomSqlQuery[]>([]);
  const [benchmarks, setBenchmarks] = useState<SqlBenchmarkVerificationItem[]>([]);
  const [benchmarksLoading, setBenchmarksLoading] = useState<boolean>(false);
  const [planProfile, setPlanProfile] = useState<SqlQueryPlanProfile | null>(null);
  const [planLoading, setPlanLoading] = useState<boolean>(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [showAllPlanOperators, setShowAllPlanOperators] = useState<boolean>(false);
  const [models, setModels] = useState<AnalyticalModelMetadata[]>([]);
  const [kpis, setKpis] = useState<KpiDictionaryEntry[]>([]);
  const [schemaSubTab, setSchemaSubTab] = useState<'MODELS' | 'KPIS' | 'TABLES'>('MODELS');

  // Save Custom Query Drawer/Form state
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [saveTitle, setSaveTitle] = useState<string>('');
  const [saveCategory, setSaveCategory] = useState<SqlQueryCategory>('Sales Analysis');
  const [saveQuestion, setSaveQuestion] = useState<string>('');
  const [saveExplanation, setSaveExplanation] = useState<string>('');
  const [saveInterpretation, setSaveInterpretation] = useState<string>('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingQuery, setSavingQuery] = useState<boolean>(false);

  const loadWorkspaceMeta = useCallback(async () => {
    try {
      const wsRes = await apiClient.getSqlWorkspace();
      if (wsRes.data) {
        setHistory(wsRes.data.executionHistory);
        setCustomQueries(wsRes.data.savedCustomQueries);
      }
    } catch {
      // ignore non-fatal load errors
    }
  }, []);

  const loadBenchmarks = useCallback(async () => {
    setBenchmarksLoading(true);
    try {
      const res = await apiClient.verifySqlBenchmarks();
      if (res.data) {
        setBenchmarks(res.data);
      }
    } catch {
      // ignore
    } finally {
      setBenchmarksLoading(false);
    }
  }, []);

  const executeQuery = useCallback(
    async (queryToRun: string, limitOverride?: number) => {
      setError(null);
      const effectiveLimit = limitOverride ?? rowLimit;
      const clientCheck = validateSqlQuery(queryToRun);

      if (!clientCheck.valid) {
        setExecutionStatus('VALIDATION_BLOCKED');
        setError(clientCheck.error || 'SQL validation failed.');
        // Also send to server so it records in audit history
        try {
          await apiClient.executeSql({ sql: queryToRun, limit: effectiveLimit });
        } catch {
          // expected 400
        }
        await loadWorkspaceMeta();
        return;
      }

      setExecutionStatus('EXECUTING');
      try {
        const res = await apiClient.executeSql({
          sql: queryToRun,
          limit: effectiveLimit
        });
        if (res.data) {
          setResult(res.data);
          setExecutionStatus('SUCCEEDED');
        }
      } catch (err) {
        setExecutionStatus('EXECUTION_ERROR');
        setError(err instanceof Error ? err.message : 'DuckDB query execution failed.');
      } finally {
        await loadWorkspaceMeta();
      }
    },
    [rowLimit, loadWorkspaceMeta]
  );

  const explainQuery = useCallback(
    async (queryToProfile: string, limitOverride?: number) => {
      setPlanError(null);
      const effectiveLimit = limitOverride ?? rowLimit;
      const clientCheck = validateSqlQuery(queryToProfile);
      if (!clientCheck.valid) {
        setPlanError(clientCheck.error || 'Only read-only SELECT / WITH queries can be profiled.');
        setWorkspaceTab('EXPLAIN_PLAN');
        return;
      }

      setPlanLoading(true);
      setWorkspaceTab('EXPLAIN_PLAN');
      try {
        const res = await apiClient.explainSqlQuery({
          sql: queryToProfile,
          limit: effectiveLimit
        });
        if (res.data) {
          setPlanProfile(res.data);
        }
      } catch (err) {
        setPlanError(
          err instanceof Error ? err.message : 'DuckDB EXPLAIN ANALYZE profiling failed.'
        );
      } finally {
        setPlanLoading(false);
      }
    },
    [rowLimit]
  );

  // Initial execution & metadata fetch
  useEffect(() => {
    void executeQuery(sqlText);
    void loadBenchmarks();
  }, []);

  // React to ?query= deep-link updates (e.g. from Command Palette while already in SQL Studio)
  useEffect(() => {
    if (!queryCodeParam) return;
    const matched = CURATED_SQL_LIBRARY.find(
      (item) => item.code.toLowerCase() === queryCodeParam.toLowerCase()
    );
    if (matched) {
      setActiveQueryItem(matched);
      setSqlText(matched.sql);
      setWorkspaceTab('RESULTS');
      void executeQuery(matched.sql);
    }
  }, [queryCodeParam]);

  useEffect(() => {
    apiClient
      .getAnalyticalModels()
      .then((res) => {
        if (res.data) setModels(res.data);
      })
      .catch(() => {});
    apiClient
      .getKpiDictionary()
      .then((res) => {
        if (res.data) setKpis(res.data);
      })
      .catch(() => {});
    void loadBenchmarks();
  }, [totalRows, dataMode, loadBenchmarks]);

  // Combine 36 curated queries + user custom saved queries
  const allSavedQueries: SavedSqlQueryItem[] = useMemo(() => {
    const mappedCustom: SavedSqlQueryItem[] = customQueries.map((cq) => ({
      id: cq.id,
      code: cq.code,
      title: cq.title,
      category: (cq.category as SqlQueryCategory) || 'Sales Analysis',
      businessQuestion: cq.businessQuestion,
      sql: cq.sql,
      explanation: cq.explanation,
      expectedInterpretation: cq.expectedInterpretation,
      sqlConcepts: (cq.sqlConcepts as SqlConceptTag[]) || ['GROUP BY'],
      isSystemPreset: false,
      createdAt: cq.createdAt
    }));
    return [...mappedCustom, ...CURATED_SQL_LIBRARY];
  }, [customQueries]);

  const filteredQueries = useMemo(() => {
    return allSavedQueries.filter((q) => {
      if (selectedCategory === 'CUSTOM_ONLY') {
        if (q.isSystemPreset !== false) return false;
      } else if (selectedCategory === 'BENCHMARKS_ONLY') {
        if (!q.isAcceptanceBenchmark) return false;
      } else if (selectedCategory !== 'ALL' && q.category !== selectedCategory) {
        return false;
      }

      if (
        selectedConcept !== 'ALL' &&
        !q.sqlConcepts.includes(selectedConcept as SqlConceptTag)
      ) {
        return false;
      }

      if (searchTerm.trim() !== '') {
        const term = searchTerm.toLowerCase();
        const matchCode = q.code.toLowerCase().includes(term);
        const matchTitle = q.title.toLowerCase().includes(term);
        const matchQuestion = q.businessQuestion.toLowerCase().includes(term);
        const matchSql = q.sql.toLowerCase().includes(term);
        if (!matchCode && !matchTitle && !matchQuestion && !matchSql) return false;
      }

      return true;
    });
  }, [allSavedQueries, selectedCategory, selectedConcept, searchTerm]);

  const handleSelectSavedQuery = (item: SavedSqlQueryItem) => {
    setActiveQueryItem(item);
    setSqlText(item.sql);
    setPlanProfile(null);
    setPlanError(null);
    setWorkspaceTab('RESULTS');
    void executeQuery(item.sql);
  };

  const handleSaveCustomQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);

    const check = validateSqlQuery(sqlText);
    if (!check.valid) {
      setSaveError(check.error || 'SQL query is invalid.');
      return;
    }

    if (!saveTitle.trim() || !saveQuestion.trim()) {
      setSaveError('Please provide both a Query Title and a Business Question.');
      return;
    }

    setSavingQuery(true);
    try {
      const res = await apiClient.saveCustomSqlQuery({
        title: saveTitle.trim(),
        category: saveCategory,
        businessQuestion: saveQuestion.trim(),
        sql: sqlText,
        explanation:
          saveExplanation.trim() ||
          'Custom analyst SQL query executing against DuckDB Olist analytical tables.',
        expectedInterpretation:
          saveInterpretation.trim() ||
          'Evaluate returned rows and metrics at the target table grain.'
      });

      if (res.data) {
        await loadWorkspaceMeta();
        const newSavedItem: SavedSqlQueryItem = {
          id: res.data.id,
          code: res.data.code,
          title: res.data.title,
          category: res.data.category as SqlQueryCategory,
          businessQuestion: res.data.businessQuestion,
          sql: res.data.sql,
          explanation: res.data.explanation,
          expectedInterpretation: res.data.expectedInterpretation,
          sqlConcepts: (res.data.sqlConcepts as SqlConceptTag[]) || ['GROUP BY'],
          isSystemPreset: false,
          createdAt: res.data.createdAt
        };
        setActiveQueryItem(newSavedItem);
        setShowSaveModal(false);
        setSaveTitle('');
        setSaveQuestion('');
        setSaveExplanation('');
        setSaveInterpretation('');
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save custom query.');
    } finally {
      setSavingQuery(false);
    }
  };

  const handleDeleteCustomQuery = async (id: string) => {
    try {
      await apiClient.deleteCustomSqlQuery(id);
      await loadWorkspaceMeta();
      if (activeQueryItem.id === id) {
        setActiveQueryItem(CURATED_SQL_LIBRARY[0]);
      }
    } catch {
      // ignore
    }
  };

  const matchedBenchmarksCount = benchmarks.filter((b) => b.allMatched).length;

  return (
    <div className="space-y-6">
      <DataStateBanner />

      {/* Top Module Header */}
      <div className="studio-card rounded-xl p-5 sm:p-6">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h1 className="text-xl font-bold text-slate-50 tracking-tight">
              SQL Studio
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Run read-only DuckDB SQL across star-schema views and cleaned tables, or explore{' '}
              <span className="font-mono text-slate-200">{allSavedQueries.length}</span> curated
              business queries.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setWorkspaceTab('BENCHMARKS');
                void loadBenchmarks();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/70 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Benchmarks ({matchedBenchmarksCount}/{benchmarks.length || 5})</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSaveModal((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <BookmarkPlus className="w-3.5 h-3.5 text-[#8ab4f8]" />
              <span>Save</span>
            </button>
          </div>
        </div>

        {/* Unboxed KPI Strip */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              Curated & Saved Library
            </div>
            <div className="mt-0.5 text-lg font-bold font-mono tabular-nums text-slate-100">
              {allSavedQueries.length} Queries
            </div>
            <div className="text-[11px] text-slate-400">
              {CURATED_SQL_LIBRARY.length} curated · {customQueries.length} user-saved
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              Advanced SQL Concepts
            </div>
            <div className="mt-0.5 text-lg font-bold font-mono tabular-nums text-sky-400">
              {ALL_SQL_CONCEPTS.length} / 17 Covered
            </div>
            <div className="text-[11px] text-slate-400">
              Joins, CTEs, Window, LAG/LEAD, Moving Avg
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              Last Execution Status
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span
                className={`text-sm font-bold font-mono ${
                  executionStatus === 'SUCCEEDED'
                    ? 'text-emerald-400'
                    : executionStatus === 'EXECUTING'
                    ? 'text-sky-400'
                    : executionStatus === 'VALIDATION_BLOCKED' ||
                      executionStatus === 'EXECUTION_ERROR'
                    ? 'text-red-400'
                    : 'text-slate-300'
                }`}
              >
                {executionStatus}
              </span>
              {result && executionStatus === 'SUCCEEDED' && (
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  ({result.executionTimeMs} ms)
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400 font-mono tabular-nums">
              {result ? `${result.rowCount} result rows returned` : 'Ready'}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              Independent Benchmark Parity
            </div>
            <div className="mt-0.5 text-lg font-bold font-mono tabular-nums text-emerald-400">
              {benchmarks.length > 0
                ? `${matchedBenchmarksCount} / ${benchmarks.length} Matched`
                : '5 / 5 Ready'}
            </div>
            <div className="text-[11px] text-slate-400">
              Reconciled vs. pure TypeScript calculations
            </div>
          </div>
        </div>
      </div>

      {/* Optional Save Custom Query Form Drawer */}
      {showSaveModal && (
        <form
          onSubmit={handleSaveCustomQuery}
          className="bg-slate-900 border border-sky-800/80 rounded-lg p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <BookmarkPlus className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                Save Current Editor SQL to Saved Query Library
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowSaveModal(false)}
              className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {saveError && (
            <div className="p-3 bg-red-950/60 border border-red-800 rounded text-xs text-red-200">
              {saveError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1">
              <label htmlFor="save-query-title" className="text-xs text-slate-300 font-medium">
                Query Title *
              </label>
              <input
                id="save-query-title"
                type="text"
                required
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="e.g., High-Value Repeat Buyers in Sao Paulo"
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="save-query-category" className="text-xs text-slate-300 font-medium">
                Analytical Category *
              </label>
              <select
                id="save-query-category"
                value={saveCategory}
                onChange={(e) => setSaveCategory(e.target.value as SqlQueryCategory)}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-sky-500"
              >
                {SQL_QUERY_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label htmlFor="save-query-question" className="text-xs text-slate-300 font-medium">
                Business Question *
              </label>
              <textarea
                id="save-query-question"
                rows={2}
                required
                value={saveQuestion}
                onChange={(e) => setSaveQuestion(e.target.value)}
                placeholder="What specific business question does this SQL query answer?"
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="save-query-explanation"
                className="text-xs text-slate-300 font-medium"
              >
                SQL Explanation
              </label>
              <textarea
                id="save-query-explanation"
                rows={2}
                value={saveExplanation}
                onChange={(e) => setSaveExplanation(e.target.value)}
                placeholder="Explain the tables, grain rules, joins, or window functions used..."
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="save-query-interpretation"
                className="text-xs text-slate-300 font-medium"
              >
                Expected Analytical Interpretation
              </label>
              <textarea
                id="save-query-interpretation"
                rows={2}
                value={saveInterpretation}
                onChange={(e) => setSaveInterpretation(e.target.value)}
                placeholder="How should stakeholders interpret the resulting metrics?"
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowSaveModal(false)}
              className="px-3 py-1.5 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 rounded cursor-pointer"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={savingQuery}
              className="px-4 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 rounded cursor-pointer"
            >
              {savingQuery ? 'Saving...' : 'Save Query to Library'}
            </button>
          </div>
        </form>
      )}

      {/* Main 12-Column SQL Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (4 cols): 36+ Business Analysis Query Library Browser */}
        <div className="lg:col-span-4 studio-card rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                Business SQL Library ({filteredQueries.length}/{allSavedQueries.length})
              </h2>
            </div>
            <span className="text-[11px] font-mono text-slate-400">8 Categories</span>
          </div>

          {/* Search & Filters */}
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Search SQL query library"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search 36+ queries by code, topic, or SQL..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div>
                <label htmlFor="sql-category-filter" className="sr-only">
                  Filter by Category
                </label>
                <select
                  id="sql-category-filter"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  <option value="ALL">Category: All 8 Categories ({allSavedQueries.length})</option>
                  <option value="BENCHMARKS_ONLY">Category: ★ 5 Acceptance Benchmarks</option>
                  {customQueries.length > 0 && (
                    <option value="CUSTOM_ONLY">
                      Category: User Saved Queries ({customQueries.length})
                    </option>
                  )}
                  {SQL_QUERY_CATEGORIES.map((cat) => {
                    const cnt = allSavedQueries.filter((q) => q.category === cat).length;
                    return (
                      <option key={cat} value={cat}>
                        Category: {cat} ({cnt})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label htmlFor="sql-concept-filter" className="sr-only">
                  Filter by SQL Concept
                </label>
                <select
                  id="sql-concept-filter"
                  value={selectedConcept}
                  onChange={(e) => setSelectedConcept(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  <option value="ALL">SQL Concept: All 17 Concepts</option>
                  {ALL_SQL_CONCEPTS.map((concept) => {
                    const cnt = allSavedQueries.filter((q) =>
                      q.sqlConcepts.includes(concept)
                    ).length;
                    return (
                      <option key={concept} value={concept}>
                        Concept: {concept} ({cnt})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          </div>

          {/* Scrollable Query Catalog List */}
          <div
            className="space-y-2 max-h-[680px] overflow-y-auto pr-1"
            role="list"
            aria-label="Saved SQL Queries"
          >
            {filteredQueries.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 border border-slate-800/80 rounded-md">
                No saved queries match the current filter criteria.
              </div>
            ) : (
              filteredQueries.map((item) => {
                const isSelected = activeQueryItem.id === item.id;
                return (
                  <div
                    key={item.id}
                    role="listitem"
                    className={`rounded-md border transition-colors ${
                      isSelected
                        ? 'bg-[#1a2842] border-[#4285f4]/60'
                        : 'bg-[#0b0f17] border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <button
                        type="button"
                        title={item.businessQuestion}
                        onClick={() => handleSelectSavedQuery(item)}
                        className="text-left flex-1 min-w-0 cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 text-[11px] font-mono">
                          <span className="font-semibold text-[#8ab4f8] shrink-0">
                            {item.code}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span className="text-slate-400 truncate">{item.category}</span>
                          {item.isAcceptanceBenchmark && (
                            <span className="text-emerald-400 font-semibold shrink-0">★</span>
                          )}
                          {item.isSystemPreset === false && (
                            <span className="text-amber-400 font-semibold shrink-0">CUSTOM</span>
                          )}
                        </div>
                        <div className="text-xs font-medium text-slate-100 truncate mt-0.5">
                          {item.title}
                        </div>
                      </button>

                      {item.isSystemPreset === false && (
                        <button
                          type="button"
                          title="Delete custom saved query"
                          onClick={() => void handleDeleteCustomQuery(item.id)}
                          className="p-1 text-slate-500 hover:text-red-400 shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN (8 cols): Active Query Spec, SQL Editor & Workspace Tabs */}
        <div className="lg:col-span-8 space-y-6">
          {/* Active Query Specification Card */}
          <div className="studio-card rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-bold text-sky-400">
                  {activeQueryItem.code}
                </span>
                <span className="text-slate-500">·</span>
                <span className="font-medium text-slate-300">
                  {activeQueryItem.category}
                </span>
                {activeQueryItem.isAcceptanceBenchmark && (
                  <>
                    <span className="text-slate-500">·</span>
                    <span className="font-mono text-emerald-400">
                      ACCEPTANCE BENCHMARK QUERY
                    </span>
                  </>
                )}
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                Concepts: {activeQueryItem.sqlConcepts.join(', ')}
              </div>
            </div>

            <h2 className="text-base font-bold text-slate-50">
              {activeQueryItem.title}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
              <div className="p-3 bg-slate-950/70 border border-slate-800/90 rounded-md space-y-1">
                <div className="text-[11px] font-mono uppercase tracking-wider text-sky-400">
                  1. Business Question
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {activeQueryItem.businessQuestion}
                </p>
              </div>

              <div className="p-3 bg-slate-950/70 border border-slate-800/90 rounded-md space-y-1">
                <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-400">
                  2. SQL Architecture & Grain Logic
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {activeQueryItem.explanation}
                </p>
              </div>

              <div className="p-3 bg-slate-950/70 border border-slate-800/90 rounded-md space-y-1">
                <div className="text-[11px] font-mono uppercase tracking-wider text-amber-400">
                  3. Expected Analytical Interpretation
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {activeQueryItem.expectedInterpretation}
                </p>
              </div>
            </div>
          </div>

          {/* BigQuery Studio IDE Code Editor Panel */}
          <div className="studio-card rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#1a2842] border border-[#4285F4]/30 flex items-center justify-center shrink-0">
                  <Terminal className="w-3.5 h-3.5 text-[#8ab4f8]" />
                </div>
                <label
                  htmlFor="sql-editor-textarea"
                  className="text-sm font-semibold text-slate-100"
                >
                  DuckDB SQL Editor
                </label>
                <span className="hidden sm:inline-block font-mono text-[11px] text-slate-400">
                  {activeQueryItem.code.toLowerCase()}.sql
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="sql-row-limit" className="text-slate-400">
                    Limit:
                  </label>
                  <select
                    id="sql-row-limit"
                    value={rowLimit}
                    onChange={(e) => {
                      const nextLim = Number(e.target.value);
                      setRowLimit(nextLim);
                      void executeQuery(sqlText, nextLim);
                    }}
                    className="px-2 py-1 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-sky-500"
                  >
                    <option value={50}>50 rows</option>
                    <option value={100}>100 rows</option>
                    <option value={250}>250 rows</option>
                    <option value={500}>500 rows</option>
                    <option value={1000}>1000 rows</option>
                  </select>
                </div>

                {result && (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400 tabular-nums">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                    <Clock className="w-3 h-3" />
                    <span>
                      {result.executionTimeMs} ms · {result.rowCount} rows
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* IDE Editor Surface with Synchronized Line-Number Gutter */}
            <div className="code-surface rounded-xl overflow-hidden border focus-within:ring-2 focus-within:ring-[var(--rp-ring)] transition-all">
              <div className="px-3.5 py-2 bg-[#0b101b] border-b border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span className="text-slate-300">
                  duckdb://retailpulse/{activeQueryItem.code.toLowerCase()}.sql
                </span>
                <span
                  className={
                    executionStatus === 'SUCCEEDED'
                      ? 'text-emerald-400'
                      : executionStatus === 'EXECUTING'
                      ? 'text-sky-400'
                      : executionStatus === 'VALIDATION_BLOCKED' ||
                        executionStatus === 'EXECUTION_ERROR'
                      ? 'text-rose-400'
                      : 'text-slate-400'
                  }
                >
                  {executionStatus}
                </span>
              </div>

              <div className="flex items-stretch overflow-x-auto">
                <div
                  aria-hidden="true"
                  className="code-gutter select-none py-3.5 px-3 border-r text-right font-mono text-[11px] leading-[1.625] shrink-0 min-w-[42px]"
                >
                  {Array.from(
                    { length: Math.max(10, sqlText.split('\n').length) },
                    (_, i) => (
                      <div key={i + 1}>{i + 1}</div>
                    )
                  )}
                </div>
                <textarea
                  id="sql-editor-textarea"
                  rows={Math.max(10, Math.min(18, sqlText.split('\n').length + 1))}
                  value={sqlText}
                  onChange={(e) => setSqlText(e.target.value)}
                  spellCheck={false}
                  className="flex-1 w-full p-3.5 text-xs font-mono bg-transparent focus:outline-none leading-[1.625] resize-y"
                  placeholder="SELECT * FROM fact_orders LIMIT 25;"
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3.5 bg-red-950/60 border border-red-800/80 rounded-md flex items-start gap-2.5 text-xs text-red-200"
              >
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold text-red-100">
                    {executionStatus === 'VALIDATION_BLOCKED'
                      ? 'Read-Only SQL Security Guard Blocked Execution'
                      : 'DuckDB Analytical Engine Error'}
                  </div>
                  <div className="font-mono text-[11px] text-red-200">{error}</div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500 mr-1">Quick:</span>
                <button
                  type="button"
                  title="SAL-01: GMV Reconciliation"
                  onClick={() => {
                    const sal01 = CURATED_SQL_LIBRARY[0];
                    handleSelectSavedQuery(sal01);
                  }}
                  className="px-2.5 py-1 text-xs font-mono text-[#8ab4f8] bg-[#0b0f17] hover:bg-[#1a2842] border border-slate-800 rounded transition-colors cursor-pointer whitespace-nowrap"
                >
                  SAL-01
                </button>
                <button
                  type="button"
                  title="CUS-01: Repeat Cohorts"
                  onClick={() => {
                    const cus01 = CURATED_SQL_LIBRARY.find((q) => q.code === 'CUS-01')!;
                    handleSelectSavedQuery(cus01);
                  }}
                  className="px-2.5 py-1 text-xs font-mono text-emerald-400 bg-[#0b0f17] hover:bg-slate-800 border border-slate-800 rounded transition-colors cursor-pointer whitespace-nowrap"
                >
                  CUS-01
                </button>
                <button
                  type="button"
                  title="WIN-01: Running Total & Moving Average"
                  onClick={() => {
                    const win01 = CURATED_SQL_LIBRARY.find((q) => q.code === 'WIN-01')!;
                    handleSelectSavedQuery(win01);
                  }}
                  className="px-2.5 py-1 text-xs font-mono text-amber-400 bg-[#0b0f17] hover:bg-slate-800 border border-slate-800 rounded transition-colors cursor-pointer whitespace-nowrap"
                >
                  WIN-01
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSqlText(activeQueryItem.sql);
                    void executeQuery(activeQueryItem.sql);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>

                <button
                  type="button"
                  disabled={!result || result.rows.length === 0}
                  onClick={() => {
                    if (result) {
                      exportRowsToCsv(
                        `retailpulse_${activeQueryItem.code.toLowerCase()}_results.csv`,
                        result.columns,
                        result.rows
                      );
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#8ab4f8]" />
                  <span>CSV</span>
                </button>

                <button
                  type="button"
                  disabled={planLoading}
                  onClick={() => void explainQuery(sqlText)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-300 bg-[#1a2842] hover:bg-[#223456] border border-[#4285F4]/35 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>{planLoading ? 'Profiling...' : 'Explain Plan'}</span>
                </button>

                <button
                  type="button"
                  disabled={executionStatus === 'EXECUTING'}
                  onClick={() => {
                    setWorkspaceTab('RESULTS');
                    void executeQuery(sqlText);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-[#1a73e8] hover:bg-[#2b7de9] disabled:opacity-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{executionStatus === 'EXECUTING' ? 'Running...' : 'Run'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Clean Google Cloud Horizontal Underline Workspace Tabs */}
          <div className="flex items-center gap-1 border-b border-slate-800 overflow-x-auto" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'RESULTS'}
              onClick={() => setWorkspaceTab('RESULTS')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                workspaceTab === 'RESULTS'
                  ? 'border-[#8ab4f8] text-[#8ab4f8]'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Results ({result?.rowCount ?? 0})</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'EXPLAIN_PLAN'}
              onClick={() => {
                setWorkspaceTab('EXPLAIN_PLAN');
                if (!planProfile && !planLoading) {
                  void explainQuery(sqlText);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                workspaceTab === 'EXPLAIN_PLAN'
                  ? 'border-[#8ab4f8] text-[#8ab4f8]'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              <Cpu className="w-3.5 h-3.5 text-sky-400" />
              <span>
                Execution Plan{planProfile ? ` (${planProfile.operatorCount} ops)` : ''}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'BENCHMARKS'}
              onClick={() => {
                setWorkspaceTab('BENCHMARKS');
                if (benchmarks.length === 0) void loadBenchmarks();
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                workspaceTab === 'BENCHMARKS'
                  ? 'border-[#8ab4f8] text-[#8ab4f8]'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Benchmarks ({matchedBenchmarksCount}/5)</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'HISTORY'}
              onClick={() => setWorkspaceTab('HISTORY')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                workspaceTab === 'HISTORY'
                  ? 'border-[#8ab4f8] text-[#8ab4f8]'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>History ({history.length})</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'SCHEMA'}
              onClick={() => setWorkspaceTab('SCHEMA')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                workspaceTab === 'SCHEMA'
                  ? 'border-[#8ab4f8] text-[#8ab4f8]'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Schema</span>
            </button>
          </div>

          {/* TAB 1: LIVE QUERY RESULTS TABLE */}
          {workspaceTab === 'RESULTS' && (
            <DataTable
              title={`Actual Execution Results — ${activeQueryItem.code}: ${activeQueryItem.title}`}
              subtitle={
                result
                  ? `Status: ${executionStatus} · Duration: ${result.executionTimeMs} ms · Returned ${result.rowCount} row(s) (Safe Limit: ${rowLimit})`
                  : 'Execute any SQL query above to inspect actual DuckDB rows.'
              }
              columns={result?.columns || []}
              rows={result?.rows || []}
              isDemonstrationData={Boolean(result?.isDemonstrationData)}
              loading={executionStatus === 'EXECUTING'}
              exportFilename={`retailpulse_${activeQueryItem.code.toLowerCase()}_results.csv`}
            />
          )}

          {/* TAB 2: BIGQUERY-STYLE DUCKDB EXPLAIN ANALYZE QUERY PLAN PROFILER */}
          {workspaceTab === 'EXPLAIN_PLAN' && (
            <div className="studio-card rounded-xl p-5 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[var(--rp-border)] pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-mono text-[var(--rp-primary)]">
                    <Cpu className="w-4 h-4" />
                    <span>DUCKDB PHYSICAL EXECUTION PLANNER · EXPLAIN (ANALYZE, FORMAT JSON)</span>
                  </div>
                  <h3 className="text-base font-bold text-[var(--rp-ink)]">
                    Query Plan Profiler &amp; Operator CPU Breakdown
                  </h3>
                  <p className="text-xs text-[var(--rp-ink-muted)]">
                    Inspect vectorized operator latency, scan cardinality, bottleneck hotspots, and
                    automated query-tuning hints directly from DuckDB&apos;s execution engine.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={planLoading}
                  onClick={() => void explainQuery(sqlText)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#1a73e8] hover:bg-[#2b7de9] disabled:opacity-50 rounded-md shrink-0 cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{planLoading ? 'Profiling Plan...' : 'Re-Profile Current SQL'}</span>
                </button>
              </div>

              {planError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg border border-[#D93025]/40 bg-[#D93025]/10 text-xs text-[#D93025] flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="font-mono">{planError}</div>
                </div>
              )}

              {planLoading && !planProfile && (
                <div className="py-10 text-center text-xs font-mono text-[var(--rp-ink-muted)]">
                  Executing native DuckDB EXPLAIN (ANALYZE, FORMAT JSON)...
                </div>
              )}

              {!planLoading && !planProfile && !planError && (
                <div className="py-10 text-center space-y-3">
                  <p className="text-xs text-[var(--rp-ink-muted)]">
                    Click &ldquo;Explain Plan&rdquo; above to profile physical operator timings and
                    rows scanned for the active SQL query.
                  </p>
                  <button
                    type="button"
                    onClick={() => void explainQuery(sqlText)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#1a73e8] hover:bg-[#2b7de9] rounded-md cursor-pointer"
                  >
                    <Cpu className="w-3.5 h-3.5" />
                    <span>Profile Active Query</span>
                  </button>
                </div>
              )}

              {planProfile && (
                <div className="space-y-5">
                  {/* 4 Summary Telemetry KPIs */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-lg p-3.5 bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)]">
                      <div className="text-[11px] font-medium text-[var(--rp-ink-muted)]">
                        Total Plan Latency
                      </div>
                      <div className="text-xl font-bold font-mono tabular-nums text-[var(--rp-ink)] mt-1">
                        {planProfile.totalLatencyMs.toFixed(2)} ms
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[var(--rp-ink-muted)]">
                        {planProfile.operatorCount} physical operators
                      </div>
                    </div>

                    <div className="rounded-lg p-3.5 bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)]">
                      <div className="text-[11px] font-medium text-[var(--rp-ink-muted)]">
                        Total Rows Scanned
                      </div>
                      <div className="text-xl font-bold font-mono tabular-nums text-[var(--rp-primary)] mt-1">
                        {planProfile.totalRowsScanned.toLocaleString()}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[var(--rp-ink-muted)]">
                        Returned {planProfile.rowsReturned.toLocaleString()} row(s)
                      </div>
                    </div>

                    <div className="rounded-lg p-3.5 bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)]">
                      <div className="text-[11px] font-medium text-[var(--rp-ink-muted)]">
                        Peak Cardinality
                      </div>
                      <div className="text-xl font-bold font-mono tabular-nums text-[var(--rp-ink)] mt-1">
                        {planProfile.peakCardinality.toLocaleString()}
                      </div>
                      <div className="text-[11px] font-mono text-[var(--rp-ink-muted)]">
                        Max intermediate tuples
                      </div>
                    </div>

                    <div className="rounded-lg p-3.5 bg-[var(--rp-surface-subtle)] border border-[#E37400]/40">
                      <div className="text-[11px] font-medium text-[#E37400]">
                        CPU Hotspot Operator
                      </div>
                      <div
                        className="text-sm font-bold font-mono text-[var(--rp-ink)] mt-1 truncate"
                        title={planProfile.hotspotOperator}
                      >
                        {planProfile.hotspotOperator}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[#E37400]">
                        {planProfile.hotspotSharePct.toFixed(1)}% of operator CPU time
                      </div>
                    </div>
                  </div>

                  {/* Automated Optimization Hints */}
                  <div className="rounded-lg p-4 bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--rp-ink)]">
                      <Zap className="w-3.5 h-3.5 text-[#1E8E3E]" />
                      <span>Automated Query-Tuning Insights</span>
                    </div>
                    <ul className="space-y-1.5 text-xs text-[var(--rp-ink-secondary)]">
                      {planProfile.optimizationHints.map((hint, idx) => (
                        <li key={idx} className="leading-relaxed">
                          • {hint}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Hierarchical Physical Operator Flame-Bar Tree */}
                  {(() => {
                    const keyOperators = planProfile.operators.filter(
                      (op) =>
                        op.isHotspot ||
                        op.operatorType !== 'PROJECTION' ||
                        op.timingSharePct >= 2
                    );
                    const visibleOperators =
                      showAllPlanOperators || keyOperators.length === 0
                        ? planProfile.operators
                        : keyOperators;

                    return (
                      <div className="rounded-lg border border-[var(--rp-border)] overflow-hidden">
                        <div className="px-4 py-2.5 bg-[var(--rp-surface-subtle)] border-b border-[var(--rp-border)] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono uppercase tracking-wider text-[var(--rp-ink-muted)]">
                          <span>
                            Physical Operator Tree ({visibleOperators.length} of{' '}
                            {planProfile.operatorCount} ops)
                          </span>
                          <div className="flex items-center gap-3">
                            {keyOperators.length < planProfile.operatorCount && (
                              <button
                                type="button"
                                onClick={() => setShowAllPlanOperators((prev) => !prev)}
                                className="normal-case font-sans text-[11px] font-semibold text-[var(--rp-primary)] hover:underline cursor-pointer"
                              >
                                {showAllPlanOperators
                                  ? `Hide trivial projections (${planProfile.operatorCount - keyOperators.length})`
                                  : `Show all ${planProfile.operatorCount} operators`}
                              </button>
                            )}
                            <span>CPU Share · Timing · Cardinality</span>
                          </div>
                        </div>

                        <div className="divide-y divide-[var(--rp-border)] max-h-[460px] overflow-y-auto">
                          {visibleOperators.map((op) => {
                            const barWidthPct = Math.min(100, Math.max(2, op.timingSharePct));
                            const barColor = op.isHotspot
                              ? '#E37400'
                              : op.operatorType.includes('SCAN')
                              ? '#1A73E8'
                              : op.operatorType.includes('JOIN')
                              ? '#9334E6'
                              : op.operatorType.includes('GROUP')
                              ? '#1E8E3E'
                              : '#64748B';
                            const formattedTiming =
                              op.timingMs < 0.1
                                ? `${op.timingMs.toFixed(3)} ms`
                                : `${op.timingMs.toFixed(2)} ms`;

                            return (
                              <div
                                key={op.id}
                                className={`px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                                  op.isHotspot ? 'bg-[#E37400]/5' : ''
                                }`}
                              >
                                <div
                                  className="min-w-0 flex-1 space-y-0.5"
                                  style={{ paddingLeft: `${Math.min(op.depth, 6) * 14}px` }}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    {op.depth > 0 && (
                                      <span className="font-mono text-xs text-[var(--rp-ink-muted)] select-none">
                                        └─
                                      </span>
                                    )}
                                    <span className="font-mono text-xs font-bold text-[var(--rp-ink)]">
                                      {op.operatorName}
                                    </span>
                                    {op.isHotspot && (
                                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#E37400]">
                                        HOTSPOT
                                      </span>
                                    )}
                                  </div>
                                  {op.extraInfo && (
                                    <div className="text-[11px] font-mono text-[var(--rp-ink-muted)] truncate">
                                      {op.extraInfo}
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-4 shrink-0 md:w-80">
                                  <div className="flex-1 space-y-1">
                                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                                      <span className="text-[var(--rp-ink)] font-semibold">
                                        {formattedTiming}
                                      </span>
                                      <span className="text-[var(--rp-ink-muted)]">
                                        {op.timingSharePct.toFixed(1)}%
                                      </span>
                                    </div>
                                    <div className="h-1.5 w-full rounded-full bg-[var(--rp-surface-subtle)] overflow-hidden">
                                      <div
                                        className="h-full rounded-full"
                                        style={{
                                          width: `${barWidthPct}%`,
                                          backgroundColor: barColor
                                        }}
                                      />
                                    </div>
                                  </div>

                                  <div className="w-24 text-right font-mono tabular-nums text-[11px] text-[var(--rp-ink-secondary)]">
                                    {op.cardinality.toLocaleString()} rows
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ACCEPTANCE BENCHMARK VERIFICATION SUITE */}
          {workspaceTab === 'BENCHMARKS' && (
            <div className="studio-card rounded-xl p-5 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-mono text-emerald-400">
                    <ShieldCheck className="w-4 h-4" />
                    <span>INDEPENDENT MATHEMATICAL RECONCILIATION SUITE</span>
                  </div>
                  <h3 className="text-base font-bold text-slate-100">
                    5 Representative Acceptance Tests vs. Independent Pure-TypeScript Calculations
                  </h3>
                  <p className="text-xs text-slate-400">
                    Verifies DuckDB SQL query outputs for Revenue, Repeat Customers, Category
                    Performance, Delivery Delays, and Monthly Trends against independent
                    TypeScript calculations computed directly from raw base records.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={benchmarksLoading}
                  onClick={() => void loadBenchmarks()}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-md shrink-0 cursor-pointer"
                >
                  {benchmarksLoading ? 'Reconciling...' : 'Re-Run All 5 Benchmarks'}
                </button>
              </div>

              <div className="space-y-4">
                {benchmarks.map((bm) => (
                  <div
                    key={bm.benchmarkId}
                    className="p-4 bg-slate-950/80 border border-slate-800 rounded-lg space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 text-xs font-mono">
                          <span className="font-bold text-sky-400">{bm.queryCode}</span>
                          <span className="text-slate-500">·</span>
                          <span className="text-slate-300">{bm.category}</span>
                          <span className="text-slate-500">·</span>
                          <span className="text-emerald-400 font-semibold inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {bm.allMatched ? 'VERIFIED 100% PARITY' : 'VARIANCE DETECTED'}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-100 mt-0.5">
                          {bm.title}
                        </h4>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const found = CURATED_SQL_LIBRARY.find(
                            (q) => q.code === bm.queryCode
                          );
                          if (found) handleSelectSavedQuery(found);
                        }}
                        className="px-3 py-1.5 text-xs font-mono text-sky-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded cursor-pointer self-start sm:self-auto whitespace-nowrap shrink-0"
                      >
                        Load in Editor ({bm.rowCount} rows · {bm.executionTimeMs} ms)
                      </button>
                    </div>

                    <div className="text-xs text-slate-400">
                      <strong className="text-slate-300">Independent Verification Method:</strong>{' '}
                      {bm.independentCalculationMethod}
                    </div>

                    <div className="overflow-x-auto border border-slate-800/90 rounded-md">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-900/90 border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400">
                            <th className="py-2 px-3">Benchmark Metric</th>
                            <th className="py-2 px-3 text-right">DuckDB SQL Output</th>
                            <th className="py-2 px-3 text-right">Independent TS Calc</th>
                            <th className="py-2 px-3 text-right">Variance Delta</th>
                            <th className="py-2 px-3 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                          {bm.comparisons.map((cmp) => (
                            <tr key={cmp.metricKey} className="hover:bg-slate-900/40">
                              <td className="py-2 px-3 font-sans text-slate-200">
                                {cmp.metricLabel}
                              </td>
                              <td className="py-2 px-3 text-right text-sky-300 font-semibold">
                                {cmp.unit === 'currency' && typeof cmp.sqlValue === 'number'
                                  ? `$${cmp.sqlValue.toLocaleString('en-US', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2
                                    })}`
                                  : cmp.unit === 'percent'
                                  ? `${cmp.sqlValue}%`
                                  : String(cmp.sqlValue)}
                              </td>
                              <td className="py-2 px-3 text-right text-slate-200">
                                {cmp.unit === 'currency' &&
                                typeof cmp.independentValue === 'number'
                                  ? `$${cmp.independentValue.toLocaleString('en-US', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2
                                    })}`
                                  : cmp.unit === 'percent'
                                  ? `${cmp.independentValue}%`
                                  : String(cmp.independentValue)}
                              </td>
                              <td className="py-2 px-3 text-right text-slate-400">
                                {cmp.delta === 0 ? '0.00' : cmp.delta}
                              </td>
                              <td className="py-2 px-3 text-right">
                                <span
                                  className={
                                    cmp.isMatch ? 'text-emerald-400 font-bold' : 'text-red-400'
                                  }
                                >
                                  {cmp.isMatch ? 'PASS' : 'MISMATCH'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: QUERY EXECUTION HISTORY */}
          {workspaceTab === 'HISTORY' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-sky-400" />
                  <h3 className="text-sm font-semibold text-slate-100">
                    DuckDB Session Query Execution History ({history.length})
                  </h3>
                </div>
                <span className="text-xs text-slate-400">
                  Chronological audit log of executed and validated statements
                </span>
              </div>

              {history.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No SQL queries have been executed in this session yet.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
                  {history.map((h) => (
                    <div
                      key={h.historyId}
                      className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-md space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-bold ${
                              h.status === 'SUCCEEDED'
                                ? 'text-emerald-400'
                                : 'text-red-400'
                            }`}
                          >
                            {h.status}
                          </span>
                          {h.queryCode && (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="text-sky-400 font-semibold">
                                {h.queryCode}
                              </span>
                            </>
                          )}
                          {h.queryTitle && (
                            <span className="font-sans text-slate-200 font-medium">
                              {h.queryTitle}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-slate-400 tabular-nums">
                          <span>{h.rowCount} rows</span>
                          <span>{h.executionTimeMs} ms</span>
                          <span>{new Date(h.executedAt).toLocaleTimeString()}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setSqlText(h.sql);
                              setWorkspaceTab('RESULTS');
                              void executeQuery(h.sql);
                            }}
                            className="text-sky-400 hover:underline font-semibold cursor-pointer"
                          >
                            Re-Run
                          </button>
                        </div>
                      </div>

                      <pre className="p-2.5 bg-slate-900/90 border border-slate-800/80 rounded text-[11px] font-mono text-slate-300 overflow-x-auto">
                        {h.sql}
                      </pre>

                      {h.errorMessage && (
                        <div className="text-[11px] font-mono text-red-400">
                          Error: {h.errorMessage}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: DUCKDB STAR-SCHEMA & KPI EXPLORER */}
          {workspaceTab === 'SCHEMA' && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-sky-400" />
                  <h3 className="text-sm font-semibold text-slate-100">
                    DuckDB Star-Schema Views, KPI Dictionary & Base Olist Tables
                  </h3>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-md text-xs">
                  <button
                    type="button"
                    onClick={() => setSchemaSubTab('MODELS')}
                    className={`py-1 px-2.5 rounded font-medium cursor-pointer ${
                      schemaSubTab === 'MODELS'
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Star-Schema Views ({models.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSchemaSubTab('KPIS')}
                    className={`py-1 px-2.5 rounded font-medium cursor-pointer ${
                      schemaSubTab === 'KPIS'
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    KPI SQL ({kpis.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSchemaSubTab('TABLES')}
                    className={`py-1 px-2.5 rounded font-medium cursor-pointer ${
                      schemaSubTab === 'TABLES'
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Base Tables ({datasets.length})
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[520px] overflow-y-auto pr-1">
                {schemaSubTab === 'MODELS' &&
                  models.map((m) => (
                    <div
                      key={m.viewName}
                      className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-md space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setSqlText(m.sampleQuerySql);
                            setWorkspaceTab('RESULTS');
                            void executeQuery(m.sampleQuerySql);
                          }}
                          className="font-mono font-semibold text-sky-400 hover:underline cursor-pointer flex items-center gap-1.5"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          {m.viewName}
                        </button>
                        <span className="font-mono tabular-nums text-slate-400">
                          {m.rowCount} rows · {m.modelType}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300">{m.grain}</div>
                      <div className="text-[11px] font-mono text-slate-500 leading-relaxed">
                        {m.columns.map((c) => c.name).join(', ')}
                      </div>
                    </div>
                  ))}

                {schemaSubTab === 'KPIS' &&
                  kpis.map((k) => (
                    <div
                      key={k.id}
                      className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-md space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setSqlText(k.reproducibleSql);
                            setWorkspaceTab('RESULTS');
                            void executeQuery(k.reproducibleSql);
                          }}
                          className="font-semibold text-emerald-400 hover:underline cursor-pointer flex items-center gap-1.5 text-left"
                        >
                          <Filter className="w-3.5 h-3.5 shrink-0" />
                          {k.metricName}
                        </button>
                        <span className="font-mono text-[11px] text-sky-300 shrink-0">
                          {k.sourceAnalyticalModel}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">{k.formulaExpression}</div>
                    </div>
                  ))}

                {schemaSubTab === 'TABLES' &&
                  datasets.map((tbl) => (
                    <div
                      key={tbl.tableName}
                      className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-md space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            const q = `SELECT * FROM ${tbl.tableName} LIMIT 25;`;
                            setSqlText(q);
                            setWorkspaceTab('RESULTS');
                            void executeQuery(q);
                          }}
                          className="font-mono font-semibold text-sky-400 hover:underline cursor-pointer"
                        >
                          {tbl.tableName}
                        </button>
                        <span className="font-mono tabular-nums text-slate-400">
                          {tbl.rowCount} rows
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 leading-relaxed">
                        {tbl.columns.map((c) => c.name).join(', ')}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
