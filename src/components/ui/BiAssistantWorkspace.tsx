import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  BarChart2,
  Bookmark,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  History,
  Layers,
  Loader2,
  MessageSquarePlus,
  Mic,
  MicOff,
  PanelLeft,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Table2,
  Terminal,
  Trash2,
  TrendingUp,
  Truck,
  Users,
  Volume2,
  VolumeX,
  Zap
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  BiAssistantAnswer,
  BiAssistantChartSpec,
  BiAssistantConversationTurn,
  BiAssistantDepth,
  BiAssistantPersona,
  BiAssistantStreamEvent,
  BiAssistantToolMetadata,
  BiAssistantToolTrace,
  BiAssistantToolsCatalogResponse
} from '../../types/analytics';
import { apiClient } from '../../services/apiClient';
import { usePlatform } from '../../context/PlatformContext';
import { useTheme } from '../../context/ThemeContext';

interface AiChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  answers: BiAssistantAnswer[];
}

interface LiveStepItem {
  id: string;
  kind: 'stage' | 'tool';
  label: string;
  detail?: string;
  status: 'running' | 'done';
}

const SESSIONS_STORAGE_KEY = 'retailpulse-ai-sessions-v1';

const STARTER_PROMPTS: {
  label: string;
  subtitle: string;
  question: string;
  icon: React.FC<{ className?: string }>;
  accent: string;
}[] = [
  {
    label: 'Top revenue categories',
    subtitle: 'Rank categories by GMV, unit volume & ratings',
    question: 'What were our highest revenue categories?',
    icon: TrendingUp,
    accent: '#4285F4'
  },
  {
    label: 'At-risk customers',
    subtitle: 'Identify churning RFM segments & spend at stake',
    question: 'Which customers are at risk?',
    icon: Users,
    accent: '#EA4335'
  },
  {
    label: 'Late delivery states',
    subtitle: 'Find regional SLA delays & transit bottlenecks',
    question: 'Which states have poor delivery performance?',
    icon: Truck,
    accent: '#FBBC04'
  },
  {
    label: 'Monthly revenue trend',
    subtitle: 'Inspect MoM revenue variance & growth trajectory',
    question: 'What changed in monthly revenue?',
    icon: BarChart2,
    accent: '#34A853'
  },
  {
    label: 'Low review factors',
    subtitle: 'Evaluate delivery SLA & category rating associations',
    question: 'What factors are associated with low reviews?',
    icon: AlertTriangle,
    accent: '#9334E6'
  },
  {
    label: 'Sellers to investigate',
    subtitle: 'Sample-adjusted seller risk & SLA audit',
    question: 'Which sellers require further investigation?',
    icon: ShieldCheck,
    accent: '#00ACC1'
  }
];

const PERSONA_OPTIONS: {
  id: BiAssistantPersona;
  label: string;
  hint: string;
}[] = [
  { id: 'executive', label: 'Executive', hint: 'Boardroom summary & strategic priorities' },
  { id: 'plain-english', label: 'Plain English', hint: 'Simple, jargon-free explanation for any team' },
  { id: 'operations', label: 'Operations', hint: 'Logistics SLAs, regions & seller action plan' },
  { id: 'analyst', label: 'Analyst', hint: 'Granular metrics, grain & statistical caveats' }
];

const DEPTH_OPTIONS: {
  id: BiAssistantDepth;
  label: string;
  hint: string;
}[] = [
  { id: 'fast', label: 'Fast', hint: 'Low-latency Gemini lookup' },
  { id: 'balanced', label: 'Balanced', hint: 'Standard Gemini BI synthesis' },
  { id: 'deep', label: 'Deep Research', hint: 'Multi-tool cross-domain Gemini reasoning' }
];

function formatCellValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString('en-US');
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return String(value);
}

function formatChartValue(
  val: unknown,
  unit?: BiAssistantChartSpec['yUnit']
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
  if (unit === 'percent') return `${num.toFixed(1)}%`;
  if (unit === 'days') return `${num.toFixed(1)} d`;
  if (unit === 'score') return `${num.toFixed(2)} ★`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
}

function buildMarkdownBrief(ans: BiAssistantAnswer): string {
  const lines: string[] = [
    `# ${ans.executiveHeadline || ans.businessQuestion}`,
    '',
    `**Business Question:** ${ans.businessQuestion}`,
    `**Audience Lens:** ${ans.personaUsed || 'executive'} | **Reasoning:** ${ans.depthUsed || 'balanced'} | **Model:** ${ans.modelUsed}`,
    `**Data Source:** ${ans.dataOriginNotice}`,
    `**Generated:** ${new Date(ans.generatedAt).toLocaleString()}`,
    '',
    '## Analytical Result',
    ans.analyticalResult,
    '',
    '## Supporting Numerical Evidence',
    ...ans.supportingNumericalEvidence.map(
      (e) => `- **${e.metricLabel}:** ${e.value} — ${e.context} (\`${e.sourceTool}\`)`
    ),
    '',
    '## Business Interpretation',
    ans.businessInterpretation,
    '',
    `**Correlation vs. Causation:** ${ans.correlationVsCausationNote}`,
    '',
    '## Suggested Management Action',
    ans.suggestedManagementAction
  ];

  if (ans.actionItems && ans.actionItems.length > 0) {
    lines.push('', '### Prioritized Company Action Plan');
    for (const item of ans.actionItems) {
      lines.push(
        `- **[${item.priority}] ${item.owner}:** ${item.action} _(Expected outcome: ${item.expectedOutcome})_`
      );
    }
  }

  lines.push(
    '',
    '## Important Limitations',
    ...ans.importantLimitations.map((l) => `- ${l}`)
  );

  if (ans.toolTraces.length > 0) {
    lines.push('', '## Executed Read-Only DuckDB SQL');
    for (const trace of ans.toolTraces) {
      lines.push(`### ${trace.toolName} (${trace.rowCount} rows, ${trace.executionTimeMs.toFixed(1)} ms)`);
      lines.push('```sql', trace.executedSql, '```');
    }
  }

  return lines.join('\n');
}

function downloadMarkdownFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function loadSavedSessions(): AiChatSession[] {
  try {
    const raw = window.localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AiChatSession[];
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

const InlineAnswerChart: React.FC<{ chart: BiAssistantChartSpec }> = ({ chart }) => {
  const { themeConfig } = useTheme();
  const [tableView, setTableView] = useState(false);

  const columns = useMemo(
    () => (chart.rows.length > 0 ? Object.keys(chart.rows[0]) : []),
    [chart.rows]
  );

  const tooltipBoxStyle: React.CSSProperties = {
    backgroundColor: themeConfig.tooltipBg,
    borderColor: themeConfig.tooltipBorder,
    borderRadius: '12px',
    fontSize: '12px',
    color: themeConfig.tooltipText,
    boxShadow: themeConfig.isDark
      ? '0 10px 28px rgba(0,0,0,0.45)'
      : '0 8px 24px rgba(15,23,42,0.12)'
  };

  if (!chart.rows || chart.rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--rp-border)] bg-[var(--rp-surface-subtle)]/55 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--rp-ink)] truncate">{chart.title}</div>
          {chart.subtitle && (
            <div className="text-[11px] text-[var(--rp-ink-muted)] truncate">{chart.subtitle}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setTableView((prev) => !prev)}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-full bg-[var(--rp-surface)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] text-[var(--rp-ink-secondary)] transition-colors whitespace-nowrap cursor-pointer"
        >
          {tableView ? (
            <>
              <BarChart2 className="w-3 h-3 text-[var(--rp-primary)]" />
              <span>Chart</span>
            </>
          ) : (
            <>
              <Table2 className="w-3 h-3 text-[var(--rp-primary)]" />
              <span>Table</span>
            </>
          )}
        </button>
      </div>

      {tableView ? (
        <div className="overflow-x-auto max-h-56 rounded-lg border border-[var(--rp-border)] bg-[var(--rp-surface)]">
          <table className="w-full text-left border-collapse text-[11px]">
            <thead className="bg-[var(--rp-surface-subtle)] sticky top-0">
              <tr className="border-b border-[var(--rp-border)] text-[var(--rp-ink-muted)]">
                {columns.map((col) => (
                  <th key={col} className="px-2.5 py-2 font-mono font-semibold whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--rp-border)]">
              {chart.rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-[var(--rp-surface-subtle)]/60">
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="px-2.5 py-1.5 font-mono tabular-nums text-[var(--rp-ink)] whitespace-nowrap"
                    >
                      {formatCellValue(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {chart.chartType === 'area' ? (
              <AreaChart data={chart.rows}>
                <defs>
                  <linearGradient id={`ai-area-${chart.sourceTool}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={themeConfig.chartPalette[0]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={themeConfig.chartPalette[0]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={themeConfig.gridColor} vertical={false} />
                <XAxis dataKey={chart.xKey} stroke={themeConfig.axisColor} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke={themeConfig.axisColor} fontSize={11} tickLine={false} axisLine={false} width={56} />
                <Tooltip
                  contentStyle={tooltipBoxStyle}
                  itemStyle={{ color: themeConfig.tooltipText }}
                  formatter={(v: unknown) => [formatChartValue(v, chart.yUnit), chart.yLabel]}
                />
                <Area
                  type="monotone"
                  dataKey={chart.yKey}
                  name={chart.yLabel}
                  stroke={themeConfig.chartPalette[0]}
                  fill={`url(#ai-area-${chart.sourceTool})`}
                  strokeWidth={2.5}
                />
              </AreaChart>
            ) : chart.chartType === 'horizontal-bar' ? (
              <BarChart data={chart.rows} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={themeConfig.gridColor} horizontal={false} />
                <XAxis type="number" stroke={themeConfig.axisColor} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey={chart.xKey}
                  stroke={themeConfig.axisColor}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={165}
                  tickFormatter={(v: unknown) => {
                    const label = String(v ?? '').replace(/_/g, ' ');
                    return label.length > 22 ? `${label.slice(0, 21)}…` : label;
                  }}
                />
                <Tooltip
                  cursor={{ fill: themeConfig.gridColor }}
                  contentStyle={tooltipBoxStyle}
                  itemStyle={{ color: themeConfig.tooltipText }}
                  formatter={(v: unknown) => [formatChartValue(v, chart.yUnit), chart.yLabel]}
                />
                <Bar dataKey={chart.yKey} name={chart.yLabel} radius={[0, 6, 6, 0]} barSize={18}>
                  {chart.rows.map((_, idx) => (
                    <Cell
                      key={`ai-hbar-${idx}`}
                      fill={themeConfig.chartPalette[idx % themeConfig.chartPalette.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <BarChart data={chart.rows}>
                <CartesianGrid strokeDasharray="3 3" stroke={themeConfig.gridColor} vertical={false} />
                <XAxis dataKey={chart.xKey} stroke={themeConfig.axisColor} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke={themeConfig.axisColor} fontSize={11} tickLine={false} axisLine={false} width={56} />
                <Tooltip
                  cursor={{ fill: themeConfig.gridColor }}
                  contentStyle={tooltipBoxStyle}
                  itemStyle={{ color: themeConfig.tooltipText }}
                  formatter={(v: unknown) => [formatChartValue(v, chart.yUnit), chart.yLabel]}
                />
                <Bar dataKey={chart.yKey} name={chart.yLabel} radius={[6, 6, 0, 0]} maxBarSize={42}>
                  {chart.rows.map((_, idx) => (
                    <Cell
                      key={`ai-vbar-${idx}`}
                      fill={themeConfig.chartPalette[idx % themeConfig.chartPalette.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

interface ToolTraceCardProps {
  trace: BiAssistantToolTrace;
  defaultExpanded?: boolean;
}

const ToolTraceCard: React.FC<ToolTraceCardProps> = ({ trace, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);
  const columns = trace.previewRows.length > 0 ? Object.keys(trace.previewRows[0]) : [];
  const summaryEntries = Object.entries(trace.summaryMetrics || {});

  return (
    <div className="bg-[var(--rp-surface)] border border-[var(--rp-border)] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-left hover:bg-[var(--rp-surface-subtle)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[var(--rp-ink-muted)] shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[var(--rp-ink-muted)] shrink-0" />
          )}
          <Terminal className="w-3.5 h-3.5 text-[var(--rp-primary)] shrink-0" />
          <span className="font-mono text-xs font-semibold text-[var(--rp-ink)] truncate">
            {trace.toolName}
          </span>
          <span className="text-[11px] text-[var(--rp-ink-muted)] hidden sm:inline">
            ({trace.displayName})
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums text-[var(--rp-ink-muted)]">
          <span>{trace.rowCount} rows</span>
          <span>{trace.executionTimeMs.toFixed(1)} ms</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">READ-ONLY</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--rp-border)] p-3.5 space-y-3.5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--rp-ink-muted)]">
                Validated Function Arguments
              </div>
              <pre className="p-2.5 code-surface border rounded-lg text-[11px] font-mono overflow-x-auto">
                {JSON.stringify(trace.validatedArgs, null, 2)}
              </pre>
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--rp-ink-muted)]">
                Verified DuckDB Summary Metrics
              </div>
              <div className="p-2.5 bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                {summaryEntries.length > 0 ? (
                  summaryEntries.map(([k, v]) => (
                    <div key={k} className="flex flex-col">
                      <span className="text-[var(--rp-ink-muted)] font-mono truncate">{k}</span>
                      <span className="text-[var(--rp-ink)] font-mono font-medium tabular-nums truncate">
                        {formatCellValue(v)}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-[var(--rp-ink-muted)] col-span-2">
                    No summary keys returned.
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[var(--rp-ink-muted)]">
              <Code2 className="w-3 h-3" />
              <span>Executed DuckDB Read-Only SQL</span>
            </div>
            <pre className="p-3 code-surface border rounded-lg text-[11px] font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {trace.executedSql}
            </pre>
          </div>

          {trace.previewRows.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--rp-ink-muted)]">
                Verified Result Preview ({trace.previewRows.length} of {trace.rowCount} rows)
              </div>
              <div className="overflow-x-auto border border-[var(--rp-border)] rounded-lg">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-[var(--rp-surface-subtle)] border-b border-[var(--rp-border)]">
                      {columns.map((col) => (
                        <th
                          key={col}
                          className="px-2.5 py-2 font-mono font-semibold text-[var(--rp-ink-muted)] whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--rp-border)]">
                    {trace.previewRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-[var(--rp-surface-subtle)]/60">
                        {columns.map((col) => (
                          <td
                            key={col}
                            className="px-2.5 py-1.5 font-mono tabular-nums text-[var(--rp-ink)] whitespace-nowrap"
                          >
                            {formatCellValue(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const BiAssistantWorkspace: React.FC = () => {
  const { health, totalRows, dataMode } = usePlatform();
  const { themeConfig } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeSubView, setActiveSubView] = useState<'assistant' | 'tools'>('assistant');
  const [catalog, setCatalog] = useState<BiAssistantToolsCatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(true);

  // Multi-session thread management (Google Gemini style)
  const [sessions, setSessions] = useState<AiChatSession[]>(() => loadSavedSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    const saved = loadSavedSessions();
    return saved.length > 0 ? saved[0].id : null;
  });
  const [showHistoryRail, setShowHistoryRail] = useState<boolean>(true);
  const [onlyPinned, setOnlyPinned] = useState<boolean>(false);

  // Audience lens & Gemini reasoning depth controls
  const [persona, setPersona] = useState<BiAssistantPersona>('executive');
  const [depth, setDepth] = useState<BiAssistantDepth>('balanced');

  // Composer & live streaming state
  const [question, setQuestion] = useState<string>(() => searchParams.get('prompt') || '');

  useEffect(() => {
    const incomingPrompt = searchParams.get('prompt');
    if (incomingPrompt) {
      setQuestion(incomingPrompt);
      const next = new URLSearchParams(searchParams);
      next.delete('prompt');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const [asking, setAsking] = useState<boolean>(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [liveSteps, setLiveSteps] = useState<LiveStepItem[]>([]);
  const [askError, setAskError] = useState<string | null>(null);
  const [lastFailedQuestion, setLastFailedQuestion] = useState<string | null>(null);

  // Answer interactions (SQL traces, limitations toggle, copy, TTS, voice)
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});
  const [expandedLimitations, setExpandedLimitations] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [listening, setListening] = useState<boolean>(false);

  // Direct Approved Tool Audit state
  const [auditingTool, setAuditingTool] = useState<string | null>(null);
  const [auditTrace, setAuditTrace] = useState<BiAssistantToolTrace | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  const answers = activeSession?.answers || [];

  const visibleSessions = useMemo(
    () => (onlyPinned ? sessions.filter((s) => s.pinned) : sessions),
    [sessions, onlyPinned]
  );

  const voiceSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as Record<string, unknown>;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions.slice(0, 20)));
    } catch {
      // Ignore storage limits in sandboxed iframes
    }
  }, [sessions]);

  useEffect(() => {
    let active = true;
    const loadTools = async () => {
      try {
        const res = await apiClient.getAssistantTools();
        if (active && res.data) {
          setCatalog(res.data);
        }
      } catch {
        // Degrade silently for metadata badge; primary ask endpoint surfaces explicit errors
      } finally {
        if (active) setCatalogLoading(false);
      }
    };
    void loadTools();
    return () => {
      active = false;
    };
  }, [totalRows, dataMode]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      recognitionRef.current?.stop();
    };
  }, []);

  const buildConversationHistory = (currentAnswers: BiAssistantAnswer[]): BiAssistantConversationTurn[] => {
    const turns: BiAssistantConversationTurn[] = [];
    for (const ans of currentAnswers.slice(-6)) {
      turns.push({ role: 'user', question: ans.businessQuestion });
      turns.push({
        role: 'assistant',
        question: ans.businessQuestion,
        analyticalResult: ans.analyticalResult
      });
    }
    return turns;
  };

  const handleStartNewChat = () => {
    setActiveSessionId(null);
    setAskError(null);
    setPendingQuestion(null);
    setLiveSteps([]);
    setActiveSubView('assistant');
  };

  const handleTogglePinSession = (sessionId: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, pinned: !s.pinned } : s))
    );
  };

  const handleDeleteSession = (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
    }
  };

  const submitQuestion = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (!trimmed || asking) return;

    setActiveSubView('assistant');
    setAsking(true);
    setAskError(null);
    setPendingQuestion(trimmed);
    setQuestion('');
    setLiveSteps([
      {
        id: 'init',
        kind: 'stage',
        label: 'Connecting to RetailPulse Gemini analytical engine...',
        status: 'running'
      }
    ]);

    const currentHistory = buildConversationHistory(answers);
    const targetSessionId = activeSessionId;

    setTimeout(() => {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 60);

    const handleStreamEvent = (event: BiAssistantStreamEvent) => {
      if (event.type === 'stage') {
        setLiveSteps((prev) => {
          const completed = prev.map((s) =>
            s.kind === 'stage' ? { ...s, status: 'done' as const } : s
          );
          return [
            ...completed,
            {
              id: `stage-${event.stage}-${Date.now()}`,
              kind: 'stage',
              label: event.message,
              status: 'running'
            }
          ];
        });
      } else if (event.type === 'tool_start') {
        setLiveSteps((prev) => [
          ...prev,
          {
            id: `tool-${event.toolName}-${prev.length}`,
            kind: 'tool',
            label: `Querying DuckDB: ${event.toolName}`,
            detail: Object.keys(event.args || {}).length
              ? JSON.stringify(event.args)
              : 'read-only analytical view',
            status: 'running'
          }
        ]);
      } else if (event.type === 'tool_done') {
        setLiveSteps((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].kind === 'tool' && next[i].label.includes(event.toolName)) {
              next[i] = {
                ...next[i],
                label: `${event.displayName} (${event.toolName})`,
                detail: `${event.rowCount} verified rows · ${event.executionTimeMs.toFixed(1)} ms`,
                status: 'done'
              };
              break;
            }
          }
          return next;
        });
      }
    };

    try {
      const newAnswer = await apiClient.askBiAssistantStream(
        {
          question: trimmed,
          conversationHistory: currentHistory,
          persona,
          depth
        },
        handleStreamEvent
      );

      const nowIso = new Date().toISOString();
      if (targetSessionId && sessions.some((s) => s.id === targetSessionId)) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === targetSessionId
              ? { ...s, updatedAt: nowIso, answers: [...s.answers, newAnswer] }
              : s
          )
        );
      } else {
        const createdId = `sess-${Date.now()}`;
        const newSession: AiChatSession = {
          id: createdId,
          title: trimmed.length > 52 ? `${trimmed.slice(0, 52)}...` : trimmed,
          createdAt: nowIso,
          updatedAt: nowIso,
          pinned: false,
          answers: [newAnswer]
        };
        setSessions((prev) => [newSession, ...prev]);
        setActiveSessionId(createdId);
      }

      setLastFailedQuestion(null);
      setTimeout(() => {
        threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 100);
    } catch (err) {
      setLastFailedQuestion(trimmed);
      setAskError(
        err instanceof Error ? err.message : 'Unable to complete Gemini BI Assistant request.'
      );
    } finally {
      setAsking(false);
      setPendingQuestion(null);
      setLiveSteps([]);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitQuestion(question);
  };

  const handleCopyBrief = async (ans: BiAssistantAnswer) => {
    try {
      await navigator.clipboard.writeText(buildMarkdownBrief(ans));
      setCopiedId(ans.id);
      setTimeout(() => setCopiedId((prev) => (prev === ans.id ? null : prev)), 2000);
    } catch {
      // Clipboard blocked in restricted iframe
    }
  };

  const handleToggleSpeak = (ans: BiAssistantAnswer) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speakingId === ans.id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const spokenText = [
      ans.executiveHeadline || ans.businessQuestion,
      ans.analyticalResult,
      ans.businessInterpretation,
      `Suggested action: ${ans.suggestedManagementAction}`
    ].join('. ');
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.rate = 1.02;
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(ans.id);
    window.speechSynthesis.speak(utterance);
  };

  const handleToggleVoiceDictation = () => {
    if (!voiceSupported) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const w = window as unknown as Record<string, new () => {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void;
      onerror: () => void;
      start: () => void;
      stop: () => void;
    }>;
    const RecognitionCtor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!RecognitionCtor) return;
    const rec = new RecognitionCtor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      const transcript = ev.results?.[0]?.[0]?.transcript || '';
      if (transcript) {
        setQuestion((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const handleRunDirectAudit = async (tool: BiAssistantToolMetadata) => {
    setAuditingTool(tool.name);
    setAuditError(null);
    try {
      const res = await apiClient.executeApprovedToolAudit(tool.name, {});
      if (res.data) {
        setAuditTrace(res.data);
      }
    } catch (err) {
      setAuditError(
        err instanceof Error ? err.message : `Failed to run approved tool "${tool.name}".`
      );
    } finally {
      setAuditingTool(null);
    }
  };

  const modelLabel = catalog?.model || health?.ai.model || 'gemini-4-hydrogen';
  const toolCount = catalog?.tools.length ?? 8;

  return (
    <div className="space-y-4">
      {/* Clean Google Workspace Sub-Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--rp-border)]">
        <div className="flex items-center gap-1" role="tablist">
          <button
            type="button"
            onClick={() => setShowHistoryRail((prev) => !prev)}
            title={showHistoryRail ? 'Hide conversation history' : 'Show conversation history'}
            className="p-2 mr-1 rounded-full text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-subtle)] transition-colors cursor-pointer"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubView === 'assistant'}
            onClick={() => setActiveSubView('assistant')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
              activeSubView === 'assistant'
                ? 'border-[var(--rp-primary)] text-[var(--rp-primary)]'
                : 'border-transparent text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Conversational AI</span>
            {answers.length > 0 && (
              <span className="font-mono text-[11px] opacity-80">({answers.length})</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubView === 'tools'}
            onClick={() => setActiveSubView('tools')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
              activeSubView === 'tools'
                ? 'border-[var(--rp-primary)] text-[var(--rp-primary)]'
                : 'border-transparent text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)]'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Verified Tools ({toolCount})</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pb-2 text-xs text-[var(--rp-ink-muted)]">
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--rp-ink-secondary)]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#34A853]" />
            <span>Read-only SQL guard</span>
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{modelLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-[var(--rp-ink-secondary)]">
            {totalRows.toLocaleString('en-US')} rows
          </span>
        </div>
      </div>

      {activeSubView === 'assistant' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Google Gemini Conversation Sessions Rail */}
          {showHistoryRail && (
            <aside className="lg:col-span-3 studio-card rounded-2xl p-3.5 space-y-3 lg:sticky lg:top-20">
              <button
                type="button"
                onClick={handleStartNewChat}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-[var(--rp-primary-ink)] bg-[var(--rp-primary-soft)] hover:brightness-95 rounded-full transition-all cursor-pointer"
              >
                <MessageSquarePlus className="w-4 h-4 text-[var(--rp-primary)]" />
                <span>New analysis</span>
              </button>

              <div className="flex items-center justify-between px-1 text-[11px]">
                <span className="font-semibold text-[var(--rp-ink-muted)] flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  <span>Recent Briefs ({sessions.length})</span>
                </span>
                <button
                  type="button"
                  onClick={() => setOnlyPinned((prev) => !prev)}
                  className={`font-medium transition-colors cursor-pointer ${
                    onlyPinned
                      ? 'text-[var(--rp-primary)]'
                      : 'text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)]'
                  }`}
                >
                  {onlyPinned ? 'Pinned only' : 'All'}
                </button>
              </div>

              {visibleSessions.length === 0 ? (
                <div className="px-3 py-5 text-center text-[11px] text-[var(--rp-ink-muted)] rounded-xl bg-[var(--rp-surface-subtle)]/60 border border-dashed border-[var(--rp-border)]">
                  {onlyPinned
                    ? 'No pinned briefs yet. Click the bookmark icon on any session to save it.'
                    : 'Your business Q&A sessions appear here automatically for quick recall.'}
                </div>
              ) : (
                <ul className="space-y-1 max-h-[420px] overflow-y-auto pr-0.5">
                  {visibleSessions.map((sess) => {
                    const isActive = sess.id === activeSessionId;
                    return (
                      <li
                        key={sess.id}
                        className={`group flex items-center justify-between gap-1.5 rounded-xl px-2.5 py-2 transition-colors ${
                          isActive
                            ? 'bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)]'
                            : 'hover:bg-[var(--rp-surface-subtle)] text-[var(--rp-ink-secondary)]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveSessionId(sess.id)}
                          className="flex-1 min-w-0 text-left cursor-pointer"
                        >
                          <div className="text-xs font-medium truncate">{sess.title}</div>
                          <div className="text-[10px] font-mono text-[var(--rp-ink-muted)] mt-0.5">
                            {sess.answers.length} brief{sess.answers.length === 1 ? '' : 's'} ·{' '}
                            {new Date(sess.updatedAt).toLocaleDateString()}
                          </div>
                        </button>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleTogglePinSession(sess.id)}
                            title={sess.pinned ? 'Unpin brief' : 'Pin brief'}
                            className={`p-1 rounded-md transition-colors cursor-pointer ${
                              sess.pinned
                                ? 'text-[#FBBC04]'
                                : 'text-[var(--rp-ink-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--rp-ink)]'
                            }`}
                          >
                            <Bookmark className="w-3.5 h-3.5" fill={sess.pinned ? 'currentColor' : 'none'} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSession(sess.id)}
                            title="Delete session"
                            className="p-1 rounded-md text-[var(--rp-ink-muted)] opacity-0 group-hover:opacity-100 hover:text-rose-500 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Compact Enterprise Governance Notice */}
              <div className="pt-2.5 border-t border-[var(--rp-border)] text-[11px] text-[var(--rp-ink-muted)] space-y-1">
                <div className="font-semibold text-[var(--rp-ink-secondary)] flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                  <span>Zero-Hallucination Guard</span>
                </div>
                <p className="leading-relaxed">
                  Every number is computed by DuckDB SQL before Gemini synthesizes your brief.
                </p>
              </div>
            </aside>
          )}

          {/* Main Google Gemini Conversational Canvas */}
          <div className={`${showHistoryRail ? 'lg:col-span-9' : 'lg:col-span-12'} space-y-4`}>
            {/* Empty State: Spacious Google Gemini Welcome Screen */}
            {answers.length === 0 && !asking && (
              <div className="studio-card rounded-2xl overflow-hidden">
                <div className="google-spectrum-bar" />
                <div className="p-6 sm:p-8 space-y-6">
                  <div className="max-w-2xl space-y-2">
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--rp-primary)]">
                      <Sparkles className="w-4 h-4" />
                      <span>RetailPulse Conversational Analytics</span>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-[var(--rp-ink)] tracking-tight leading-tight">
                      Ask anything about your business — get verified insights in seconds.
                    </h2>
                    <p className="text-sm text-[var(--rp-ink-muted)] leading-relaxed">
                      Choose your audience lens below, ask in plain English, and inspect live
                      charts, owner-assigned company actions, and auditable DuckDB SQL.
                    </p>
                  </div>

                  {/* 6 Comfortable Executive Starter Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {STARTER_PROMPTS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.question}
                          type="button"
                          disabled={asking}
                          onClick={() => void submitQuestion(item.question)}
                          className="group text-left p-4 rounded-2xl bg-[var(--rp-surface-subtle)]/70 hover:bg-[var(--rp-primary-soft)]/50 border border-[var(--rp-border)] hover:border-[var(--rp-primary)] transition-all flex flex-col justify-between gap-3 cursor-pointer"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span
                              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                              style={{
                                backgroundColor: `${item.accent}1a`,
                                color: item.accent
                              }}
                            >
                              <Icon className="w-4 h-4" />
                            </span>
                            <Sparkles className="w-3.5 h-3.5 text-[var(--rp-ink-muted)] group-hover:text-[var(--rp-primary)] transition-colors" />
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-[var(--rp-ink)]">
                              {item.label}
                            </div>
                            <div className="text-[11px] text-[var(--rp-ink-muted)] mt-0.5 leading-snug">
                              {item.subtitle}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Chronological Conversation Thread (Google Gemini Style) */}
            {answers.length > 0 && (
              <div className="space-y-6">
                {answers.map((ans) => {
                  const tracesOpen = Boolean(expandedTraces[ans.id]);
                  const limitsOpen = Boolean(expandedLimitations[ans.id]);
                  const isCopied = copiedId === ans.id;
                  const isSpeaking = speakingId === ans.id;

                  return (
                    <div key={ans.id} className="space-y-3">
                      {/* User Message Bubble (Right-Aligned Material 3 Pill) */}
                      <div className="flex justify-end">
                        <div className="max-w-2xl px-4 py-3 rounded-2xl rounded-br-sm bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)] border border-[var(--rp-primary)]/25 text-sm font-medium leading-relaxed shadow-xs">
                          {ans.businessQuestion}
                        </div>
                      </div>

                      {/* Gemini Analytical Response Card */}
                      <article className="studio-card rounded-2xl overflow-hidden">
                        {/* Response Top Utility Bar */}
                        <div className="px-5 py-3 bg-[var(--rp-surface-subtle)]/70 border-b border-[var(--rp-border)] flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--rp-primary)]">
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Gemini BI Brief</span>
                            </span>
                            <span className="text-[var(--rp-ink-muted)]">·</span>
                            <span className="capitalize font-medium text-[var(--rp-ink-secondary)]">
                              {(ans.personaUsed || 'executive').replace('-', ' ')} lens
                            </span>
                            <span className="text-[var(--rp-ink-muted)]">·</span>
                            <span className="font-mono text-[var(--rp-ink-muted)] tabular-nums">
                              {ans.toolTraces.length} SQL tool{ans.toolTraces.length === 1 ? '' : 's'} ·{' '}
                              {(ans.totalDurationMs / 1000).toFixed(1)}s
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleToggleSpeak(ans)}
                              title={isSpeaking ? 'Stop reading aloud' : 'Read executive brief aloud'}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                                isSpeaking
                                  ? 'bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)]'
                                  : 'text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-hover)]'
                              }`}
                            >
                              {isSpeaking ? (
                                <VolumeX className="w-3.5 h-3.5" />
                              ) : (
                                <Volume2 className="w-3.5 h-3.5" />
                              )}
                              <span className="hidden sm:inline">{isSpeaking ? 'Stop' : 'Listen'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleCopyBrief(ans)}
                              title="Copy Markdown brief for Slack, Email, or Docs"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-hover)] transition-colors cursor-pointer"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-[#34A853]" />
                                  <span className="text-[#137333] dark:text-[#81C995]">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline">Copy</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                downloadMarkdownFile(
                                  `retailpulse-brief-${ans.id.toLowerCase()}.md`,
                                  buildMarkdownBrief(ans)
                                )
                              }
                              title="Export executive report (.md)"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-hover)] transition-colors cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Export</span>
                            </button>
                          </div>
                        </div>

                        <div className="p-5 sm:p-6 space-y-5">
                          {/* Insufficient Data Warning */}
                          {ans.insufficientData && (
                            <div className="p-3.5 bg-amber-950/40 border border-amber-700/50 rounded-xl flex items-start gap-2.5 text-xs">
                              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                              <div>
                                <strong className="font-semibold">
                                  Insufficient Analytical Data:
                                </strong>{' '}
                                The active warehouse lacks required records or columns for a full
                                answer. No numbers were fabricated.
                              </div>
                            </div>
                          )}

                          {/* Executive Headline + Direct Analytical Result */}
                          <div className="space-y-2">
                            {ans.executiveHeadline && (
                              <h3 className="text-lg font-bold text-[var(--rp-ink)] tracking-tight leading-snug">
                                {ans.executiveHeadline}
                              </h3>
                            )}
                            <p className="text-sm text-[var(--rp-ink-secondary)] leading-relaxed">
                              {ans.analyticalResult}
                            </p>
                          </div>

                          {/* Supporting Numerical Evidence Tiles */}
                          {ans.supportingNumericalEvidence.length > 0 && (
                            <section className="space-y-2.5">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--rp-ink-muted)]">
                                Verified Numerical Evidence
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {ans.supportingNumericalEvidence.map((item, idx) => {
                                  const accent =
                                    themeConfig.chartPalette[idx % themeConfig.chartPalette.length];
                                  return (
                                    <div
                                      key={idx}
                                      className="relative overflow-hidden p-3.5 rounded-xl bg-[var(--rp-surface-subtle)]/70 border border-[var(--rp-border)] flex flex-col justify-between gap-2"
                                    >
                                      <div
                                        className="absolute top-0 inset-x-0 h-[3px]"
                                        style={{ backgroundColor: accent }}
                                      />
                                      <div className="space-y-1">
                                        <div className="text-[11px] font-medium text-[var(--rp-ink-muted)] leading-snug">
                                          {item.metricLabel}
                                        </div>
                                        <div className="text-lg font-bold font-mono tabular-nums text-[var(--rp-ink)] tracking-tight">
                                          {item.value}
                                        </div>
                                      </div>
                                      <div className="space-y-1 pt-2 border-t border-[var(--rp-border)]">
                                        <p className="text-[11px] text-[var(--rp-ink-secondary)] leading-relaxed">
                                          {item.context}
                                        </p>
                                        <div className="text-[10px] font-mono text-[var(--rp-primary)] truncate">
                                          {item.sourceTool}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          )}

                          {/* Auto-Generated Inline Interactive Visualization */}
                          {ans.visualChart && <InlineAnswerChart chart={ans.visualChart} />}

                          {/* Business Interpretation + Company Action Plan */}
                          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                            <section className="xl:col-span-6 p-4 rounded-xl bg-[var(--rp-surface-subtle)]/55 border border-[var(--rp-border)] space-y-2.5">
                              <div className="text-xs font-semibold text-[var(--rp-primary)] flex items-center gap-1.5">
                                <Briefcase className="w-3.5 h-3.5" />
                                <span>Business Interpretation</span>
                              </div>
                              <p className="text-xs text-[var(--rp-ink-secondary)] leading-relaxed">
                                {ans.businessInterpretation}
                              </p>
                              {ans.correlationVsCausationNote && (
                                <div className="pt-2.5 border-t border-[var(--rp-border)] text-[11px] text-[var(--rp-ink-muted)] leading-relaxed">
                                  <strong className="text-[var(--rp-ink-secondary)]">
                                    Correlation vs. Causation:{' '}
                                  </strong>
                                  {ans.correlationVsCausationNote}
                                </div>
                              )}
                            </section>

                            <section className="xl:col-span-6 p-4 rounded-xl bg-[var(--rp-surface-subtle)]/55 border border-[var(--rp-border)] space-y-2.5">
                              <div className="text-xs font-semibold text-[#137333] dark:text-[#81C995] flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Company Action Playbook</span>
                              </div>
                              <p className="text-xs text-[var(--rp-ink-secondary)] leading-relaxed">
                                {ans.suggestedManagementAction}
                              </p>

                              {ans.actionItems && ans.actionItems.length > 0 && (
                                <div className="space-y-2 pt-2 border-t border-[var(--rp-border)]">
                                  {ans.actionItems.map((act, idx) => (
                                    <div
                                      key={idx}
                                      className="p-2.5 rounded-lg bg-[var(--rp-surface)] border border-[var(--rp-border)] space-y-1 text-xs"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold text-[var(--rp-ink)]">
                                          {act.owner}
                                        </span>
                                        <span
                                          className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full ${
                                            act.priority === 'HIGH'
                                              ? 'bg-[#fce8e6] text-[#c5221f] dark:bg-rose-950/60 dark:text-rose-300'
                                              : act.priority === 'LOW'
                                                ? 'bg-[#e6f4ea] text-[#137333] dark:bg-emerald-950/60 dark:text-emerald-300'
                                                : 'bg-[#fef7e0] text-[#b06000] dark:bg-amber-950/60 dark:text-amber-300'
                                          }`}
                                        >
                                          {act.priority}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-[var(--rp-ink-secondary)] leading-snug">
                                        {act.action}
                                      </p>
                                      {act.expectedOutcome && (
                                        <p className="text-[11px] text-[var(--rp-ink-muted)]">
                                          Target: {act.expectedOutcome}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </section>
                          </div>

                          {/* Smart Follow-Up Chips (Google Gemini Experience) */}
                          {ans.followUpQuestions && ans.followUpQuestions.length > 0 && (
                            <div className="space-y-2 pt-1">
                              <div className="text-[11px] font-medium text-[var(--rp-ink-muted)]">
                                Explore deeper
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {ans.followUpQuestions.map((fq, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    disabled={asking}
                                    onClick={() => void submitQuestion(fq)}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-[var(--rp-surface)] hover:bg-[var(--rp-primary-soft)] text-[var(--rp-ink-secondary)] hover:text-[var(--rp-primary-ink)] border border-[var(--rp-border)] hover:border-[var(--rp-primary)] transition-colors disabled:opacity-50 cursor-pointer"
                                  >
                                    <Sparkles className="w-3 h-3 text-[var(--rp-primary)] shrink-0" />
                                    <span>{fq}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Calm Footer Drawers: Limitations & Auditable SQL Traces */}
                          <div className="pt-3 border-t border-[var(--rp-border)] flex flex-wrap items-center gap-4 text-xs">
                            {ans.toolTraces.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedTraces((prev) => ({
                                    ...prev,
                                    [ans.id]: !prev[ans.id]
                                  }))
                                }
                                className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[var(--rp-primary)] hover:underline cursor-pointer"
                              >
                                {tracesOpen ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                                <span>
                                  {tracesOpen ? 'Hide' : 'Inspect'} Executed DuckDB SQL (
                                  {ans.toolTraces.length})
                                </span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() =>
                                setExpandedLimitations((prev) => ({
                                  ...prev,
                                  [ans.id]: !prev[ans.id]
                                }))
                              }
                              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] cursor-pointer"
                            >
                              {limitsOpen ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                              <span>
                                Limitations &amp; Data Scope ({ans.importantLimitations.length})
                              </span>
                            </button>

                            <span className="ml-auto text-[11px] font-mono text-[var(--rp-ink-muted)]">
                              {ans.dataOriginNotice}
                            </span>
                          </div>

                          {limitsOpen && (
                            <div className="p-3.5 rounded-xl bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] space-y-1.5">
                              <div className="text-[11px] font-semibold text-[var(--rp-ink-secondary)]">
                                Statistical &amp; Dataset Scope Caveats
                              </div>
                              <ul className="space-y-1 text-xs text-[var(--rp-ink-muted)] list-disc pl-4">
                                {ans.importantLimitations.map((lim, idx) => (
                                  <li key={idx} className="leading-relaxed">
                                    {lim}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {tracesOpen && (
                            <div className="space-y-2.5">
                              {ans.toolTraces.map((trace, idx) => (
                                <ToolTraceCard
                                  key={`${ans.id}-trace-${idx}`}
                                  trace={trace}
                                  defaultExpanded={idx === 0}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Live Real-Time Gemini SSE Reasoning & Tool Execution Feed */}
            {asking && (
              <div className="space-y-3">
                {pendingQuestion && (
                  <div className="flex justify-end">
                    <div className="max-w-2xl px-4 py-3 rounded-2xl rounded-br-sm bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)] border border-[var(--rp-primary)]/25 text-sm font-medium">
                      {pendingQuestion}
                    </div>
                  </div>
                )}

                <div className="studio-card rounded-2xl p-5 space-y-3 border-[var(--rp-primary)]/40">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full gemini-aura flex items-center justify-center text-white shrink-0">
                      <Sparkles className="w-4 h-4 animate-pulse" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-[var(--rp-ink)]">
                        Gemini is analyzing your live DuckDB warehouse...
                      </div>
                      <div className="text-[11px] text-[var(--rp-ink-muted)]">
                        Real-time server-side function calling &amp; verification
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 pl-2">
                    {liveSteps.map((step) => (
                      <div key={step.id} className="flex items-start gap-2.5 text-xs">
                        {step.status === 'done' ? (
                          <CheckCircle2 className="w-4 h-4 text-[#34A853] shrink-0 mt-0.5" />
                        ) : (
                          <Loader2 className="w-4 h-4 text-[var(--rp-primary)] animate-spin shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-[var(--rp-ink-secondary)]">
                            {step.label}
                          </div>
                          {step.detail && (
                            <div className="text-[11px] font-mono text-[var(--rp-ink-muted)]">
                              {step.detail}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Honest Error Alert */}
            {askError && (
              <div
                role="alert"
                className="p-4 bg-[var(--rp-surface)] border border-[#EA4335]/40 rounded-2xl space-y-2.5 shadow-xs"
              >
                <div className="flex items-start gap-2.5 text-xs">
                  <AlertCircle className="w-4 h-4 text-[#EA4335] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold text-[var(--rp-ink)]">
                      Gemini BI Assistant Service Error
                    </div>
                    <p className="leading-relaxed text-[var(--rp-ink-secondary)]">{askError}</p>
                  </div>
                </div>
                <div className="pl-6 flex flex-wrap items-center gap-3 text-[11px] text-[var(--rp-ink-muted)]">
                  {lastFailedQuestion && (
                    <button
                      type="button"
                      disabled={asking}
                      onClick={() => void submitQuestion(lastFailedQuestion)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--rp-primary)] hover:bg-[var(--rp-primary-hover)] text-white font-semibold transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Retry question</span>
                    </button>
                  )}
                  <span>Or inspect all {toolCount} verified DuckDB tools directly:</span>
                  <button
                    type="button"
                    onClick={() => setActiveSubView('tools')}
                    className="font-mono font-semibold text-[var(--rp-primary)] underline cursor-pointer"
                  >
                    Open Verified Tools Audit
                  </button>
                </div>
              </div>
            )}

            <div ref={threadEndRef} />

            {/* Sticky Comfortable Google Gemini Material 3 Prompt Bar */}
            <div className="sticky bottom-3 z-20 pt-2">
              <div className="gemini-aura p-[1.5px] rounded-3xl shadow-lg">
                <form
                  onSubmit={handleFormSubmit}
                  className="bg-[var(--rp-surface)] rounded-[22px] p-3.5 sm:p-4 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <input
                      id="bi-assistant-question-input"
                      type="text"
                      aria-label="Ask a business question"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      disabled={asking}
                      placeholder="Ask about revenue, customer churn, late deliveries, sellers, or forecasts..."
                      className="flex-1 px-3.5 py-2.5 text-sm bg-transparent text-[var(--rp-ink)] placeholder:text-[var(--rp-ink-muted)] focus:outline-none"
                    />

                    {voiceSupported && (
                      <button
                        type="button"
                        onClick={handleToggleVoiceDictation}
                        disabled={asking}
                        title={listening ? 'Stop voice input' : 'Speak your business question'}
                        aria-label={listening ? 'Stop voice input' : 'Speak your business question'}
                        className={`p-2.5 rounded-full transition-colors cursor-pointer shrink-0 ${
                          listening
                            ? 'bg-[#EA4335] text-white'
                            : 'text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-subtle)]'
                        }`}
                      >
                        {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </button>
                    )}

                    <button
                      type="submit"
                      disabled={asking || question.trim().length === 0}
                      className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white bg-[var(--rp-primary)] hover:bg-[var(--rp-primary-hover)] disabled:opacity-45 rounded-full shadow-xs transition-all shrink-0 whitespace-nowrap cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{asking ? 'Analyzing...' : 'Ask'}</span>
                    </button>
                  </div>

                  {/* Clean Audience Lens & Gemini Reasoning Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--rp-border)] text-[11px]">
                    <div
                      className="flex flex-wrap items-center gap-1"
                      role="radiogroup"
                      aria-label="Audience lens"
                    >
                      <span className="text-[var(--rp-ink-muted)] font-medium mr-1">Lens:</span>
                      {PERSONA_OPTIONS.map((opt) => {
                        const active = persona === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            title={opt.hint}
                            onClick={() => setPersona(opt.id)}
                            className={`px-2.5 py-1 rounded-full font-medium transition-colors whitespace-nowrap cursor-pointer ${
                              active
                                ? 'bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)] font-semibold'
                                : 'text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-subtle)]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>

                    <div
                      className="flex items-center gap-1"
                      role="radiogroup"
                      aria-label="Gemini reasoning depth"
                    >
                      <span className="text-[var(--rp-ink-muted)] font-medium mr-1">Depth:</span>
                      {DEPTH_OPTIONS.map((opt) => {
                        const active = depth === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            title={opt.hint}
                            onClick={() => setDepth(opt.id)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium transition-colors whitespace-nowrap cursor-pointer ${
                              active
                                ? 'bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)] font-semibold'
                                : 'text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-subtle)]'
                            }`}
                          >
                            {opt.id === 'fast' && <Zap className="w-3 h-3 text-[#FBBC04]" />}
                            {opt.id === 'deep' && <Layers className="w-3 h-3 text-[#4285F4]" />}
                            <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Approved Backend Analytical Functions Registry & Direct DuckDB Audit */
        <div className="space-y-5">
          <div className="studio-card rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold text-[var(--rp-ink)]">
                  Approved Read-Only DuckDB Analytical Tools ({toolCount})
                </h3>
                <p className="text-xs text-[var(--rp-ink-muted)]">
                  Parameter-validated functions callable by Gemini or audited independently without AI.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-[#137333] dark:text-[#81C995]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Read-only guard active</span>
              </div>
            </div>

            {catalogLoading ? (
              <div className="py-8 text-center text-xs text-[var(--rp-ink-muted)]">
                Loading tool catalog...
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {(catalog?.tools || []).map((tool) => {
                  const isRunning = auditingTool === tool.name;
                  return (
                    <div
                      key={tool.name}
                      className="studio-card studio-card-hover p-4 rounded-2xl flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-[var(--rp-primary)] truncate">
                            {tool.name}
                          </span>
                          <span className="text-[11px] font-mono text-[var(--rp-ink-muted)] shrink-0">
                            {tool.domain}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-[var(--rp-ink)]">
                          {tool.displayName}
                        </div>
                        <p className="text-[11px] text-[var(--rp-ink-muted)] leading-relaxed line-clamp-2">
                          {tool.description}
                        </p>
                      </div>

                      <div className="pt-2.5 border-t border-[var(--rp-border)] flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={isRunning}
                          onClick={() => void handleRunDirectAudit(tool)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-[var(--rp-ink-secondary)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] disabled:opacity-50 rounded-full transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <Play className="w-3 h-3 text-[#34A853]" />
                          <span>{isRunning ? 'Running...' : 'Run SQL'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={asking}
                          onClick={() => void submitQuestion(tool.sampleQuestion)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[var(--rp-primary-ink)] bg-[var(--rp-primary-soft)] hover:brightness-95 rounded-full transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <Sparkles className="w-3 h-3 text-[var(--rp-primary)]" />
                          <span>Ask Gemini</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {auditError && (
            <div
              role="alert"
              className="p-4 bg-rose-950/40 border border-rose-800/80 rounded-2xl flex items-start gap-2.5 text-xs"
            >
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div>
                <strong>Approved Tool Audit Error:</strong> {auditError}
              </div>
            </div>
          )}

          {auditTrace && (
            <div className="studio-card rounded-2xl p-5 space-y-3 border-[#34A853]/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-mono text-[#137333] dark:text-[#81C995] uppercase tracking-wider font-semibold">
                    Direct DuckDB Tool Audit (Non-AI Verification)
                  </div>
                  <h4 className="text-sm font-semibold text-[var(--rp-ink)]">
                    Verified Output: {auditTrace.displayName}
                  </h4>
                </div>
                <span className="text-[11px] font-mono text-[var(--rp-ink-muted)]">
                  Data Origin: {auditTrace.dataOrigin}
                </span>
              </div>
              <ToolTraceCard trace={auditTrace} defaultExpanded={true} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
