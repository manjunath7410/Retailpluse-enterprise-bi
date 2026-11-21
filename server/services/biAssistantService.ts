import { Content, GoogleGenAI, Part, ThinkingLevel, Type } from '@google/genai';
import {
  BiAssistantActionItem,
  BiAssistantAnswer,
  BiAssistantChartSpec,
  BiAssistantConversationTurn,
  BiAssistantDepth,
  BiAssistantPersona,
  BiAssistantStreamEvent,
  BiAssistantToolTrace,
  DataMode
} from '../../src/types/analytics';
import { duckdbEngine } from '../db/duckdbEngine';
import {
  BI_ANALYTICAL_TOOL_DECLARATIONS,
  executeApprovedBiTool
} from './biAnalyticalTools';
import { getGeminiModelName, isGeminiConfigured } from './geminiService';

export interface AskBiAssistantOptions {
  persona?: BiAssistantPersona;
  depth?: BiAssistantDepth;
  onProgress?: (event: BiAssistantStreamEvent) => void;
}

const VALID_PERSONAS = new Set<BiAssistantPersona>([
  'executive',
  'operations',
  'analyst',
  'plain-english'
]);

const VALID_DEPTHS = new Set<BiAssistantDepth>(['fast', 'balanced', 'deep']);

function resolveThinkingLevel(depth: BiAssistantDepth): ThinkingLevel {
  if (depth === 'fast') return ThinkingLevel.LOW;
  if (depth === 'deep') return ThinkingLevel.XHIGH;
  return ThinkingLevel.HIGH;
}

function getPersonaGuidance(persona: BiAssistantPersona): string {
  switch (persona) {
    case 'executive':
      return 'AUDIENCE: C-Suite / Company Executive. Lead with a crisp boardroom headline, financial/strategic impact, and prioritized owner-assigned company actions. Keep wording decisive and high-signal.';
    case 'operations':
      return 'AUDIENCE: Operations, Logistics & Marketplace Lead. Focus on SLA bottlenecks, regional delivery delays, seller accountability, and immediate operational playbooks.';
    case 'analyst':
      return 'AUDIENCE: Senior BI & Data Analyst. Highlight exact grain definitions, variance deltas, distribution skewness, statistical caveats, and empirical thresholds.';
    case 'plain-english':
    default:
      return 'AUDIENCE: Everyday Business User / Cross-Functional Team Member. Explain findings in warm, crystal-clear, jargon-free English while citing exact verified numbers so anyone in the company immediately understands what is happening and what to do next.';
  }
}

function buildVerifiedChartFromTraces(
  toolTraces: BiAssistantToolTrace[]
): BiAssistantChartSpec | null {
  for (const trace of toolTraces) {
    const rows = trace.previewRows;
    if (!rows || rows.length < 2) continue;

    if (trace.toolName === 'get_highest_revenue_categories') {
      return {
        title: 'Verified Category Merchandise GMV',
        subtitle: `Top ${Math.min(rows.length, 8)} categories directly from DuckDB`,
        chartType: 'horizontal-bar',
        xKey: 'category',
        yKey: 'merchandise_gmv',
        yLabel: 'Merchandise GMV ($)',
        yUnit: 'currency',
        sourceTool: trace.toolName,
        rows: rows.slice(0, 8)
      };
    }

    if (trace.toolName === 'get_monthly_revenue_changes') {
      return {
        title: 'Monthly Revenue Trajectory',
        subtitle: 'Chronological total order value from DuckDB',
        chartType: 'area',
        xKey: 'order_month',
        yKey: 'total_revenue',
        yLabel: 'Total Revenue ($)',
        yUnit: 'currency',
        sourceTool: trace.toolName,
        rows: rows.slice(0, 12)
      };
    }

    if (trace.toolName === 'get_state_delivery_performance') {
      return {
        title: 'Late Delivery Rate by Customer State',
        subtitle: 'Percentage of delivered orders arriving after estimated SLA',
        chartType: 'horizontal-bar',
        xKey: 'customer_state',
        yKey: 'late_delivery_pct',
        yLabel: 'Late Delivery (%)',
        yUnit: 'percent',
        sourceTool: trace.toolName,
        rows: rows.slice(0, 8)
      };
    }

    if (trace.toolName === 'get_at_risk_customers') {
      return {
        title: 'Customer Monetary Value at Risk',
        subtitle: 'Historical spend across matched RFM customer records',
        chartType: 'horizontal-bar',
        xKey: 'customer_unique_id',
        yKey: 'monetary_value',
        yLabel: 'Customer Spend ($)',
        yUnit: 'currency',
        sourceTool: trace.toolName,
        rows: rows.slice(0, 8)
      };
    }

    if (trace.toolName === 'get_low_review_associated_factors') {
      return {
        title: 'Low-Review Concentration by Category',
        subtitle: 'Share of orders receiving low review scores',
        chartType: 'horizontal-bar',
        xKey: 'category',
        yKey: 'low_review_share_pct',
        yLabel: 'Low Review Share (%)',
        yUnit: 'percent',
        sourceTool: trace.toolName,
        rows: rows.slice(0, 8)
      };
    }

    if (trace.toolName === 'get_sellers_requiring_investigation') {
      return {
        title: 'Seller On-Time Delivery Performance',
        subtitle: 'Empirical Bayes audited sellers by SLA compliance',
        chartType: 'horizontal-bar',
        xKey: 'seller_id',
        yKey: 'on_time_delivery_pct',
        yLabel: 'On-Time Delivery (%)',
        yUnit: 'percent',
        sourceTool: trace.toolName,
        rows: rows.slice(0, 8)
      };
    }

    if (trace.toolName === 'get_cohort_retention_summary') {
      const sample = rows[0];
      if ('cohort_month' in sample && 'cohort_size' in sample) {
        return {
          title: 'Monthly Acquisition Cohort Size',
          subtitle: 'Unique first-time customers acquired per month',
          chartType: 'bar',
          xKey: 'cohort_month',
          yKey: 'cohort_size',
          yLabel: 'Acquired Customers',
          yUnit: 'number',
          sourceTool: trace.toolName,
          rows: rows.slice(0, 10)
        };
      }
    }

    if (trace.toolName === 'get_statistical_anomalies') {
      return {
        title: 'Flagged Statistical Anomalies (|Z-Score|)',
        subtitle: 'Standard deviations from leave-one-out baseline mean',
        chartType: 'horizontal-bar',
        xKey: 'period',
        yKey: 'z_score',
        yLabel: 'Z-Score (σ)',
        yUnit: 'number',
        sourceTool: trace.toolName,
        rows: rows.slice(0, 8)
      };
    }

    if (trace.toolName === 'get_ab_cohort_comparison') {
      return {
        title: 'A/B Cohort Comparison',
        subtitle: 'Control vs. Variant mean metric across live DuckDB cohorts',
        chartType: 'bar',
        xKey: 'arm',
        yKey: 'metric_value',
        yLabel: 'Metric Value',
        yUnit: 'number',
        sourceTool: trace.toolName,
        rows: rows.slice(0, 2)
      };
    }
  }
  return null;
}

const FALLBACK_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const PRIMARY_COOLDOWN_MS = 180_000;
let primaryModelCooldownUntil = 0;

function getAiClient(timeoutMs = 25000): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

function isFailoverEligibleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('429') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('INTERNAL') ||
    lower.includes('too many requests') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('timeout') ||
    lower.includes('aborted')
  );
}

function supportsThinkingConfig(model: string): boolean {
  return model.startsWith('gemini-4');
}

function parseGeminiJson<T>(rawText: string): T {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    throw new Error('Gemini returned an empty synthesis payload.');
  }
  // Strip accidental markdown code fences if present
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced) as T;
  } catch {
    const firstBrace = unfenced.indexOf('{');
    const lastBrace = unfenced.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('Gemini returned malformed JSON during brief synthesis.');
  }
}

async function generateWithResilience(
  primaryModel: string,
  buildParams: (model: string) => Parameters<GoogleGenAI['models']['generateContent']>[0],
  onFallback?: (fallbackModel: string) => void
): Promise<{ response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>; modelUsed: string }> {
  const now = Date.now();
  const canUsePrimary = primaryModel === FALLBACK_GEMINI_MODEL || now >= primaryModelCooldownUntil;

  if (canUsePrimary && primaryModel !== FALLBACK_GEMINI_MODEL) {
    try {
      // Fast 8s timeout on primary model so slow high-demand hangs fail over smoothly
      const primaryClient = getAiClient(8000);
      const response = await primaryClient.models.generateContent(buildParams(primaryModel));
      return { response, modelUsed: primaryModel };
    } catch (err) {
      if (!isFailoverEligibleError(err)) {
        throw err;
      }
      primaryModelCooldownUntil = Date.now() + PRIMARY_COOLDOWN_MS;
    }
  }

  onFallback?.(FALLBACK_GEMINI_MODEL);
  const fallbackClient = getAiClient(28000);
  let lastFallbackError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fallbackClient.models.generateContent(
        buildParams(FALLBACK_GEMINI_MODEL)
      );
      return { response, modelUsed: FALLBACK_GEMINI_MODEL };
    } catch (err) {
      lastFallbackError = err;
      if (!isFailoverEligibleError(err) || attempt === 2) {
        throw err;
      }
      const backoffMs = attempt === 0 ? 700 : 1600;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastFallbackError;
}

function formatGeminiApiError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (
    raw.includes('API_KEY_INVALID') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('403') ||
    raw.includes('API key not valid')
  ) {
    return new Error(
      'Gemini API authentication failed. Please verify your GEMINI_API_KEY in the Settings > Secrets panel.'
    );
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return new Error(
      'Gemini API rate limit or quota exceeded (429). Please retry shortly or check your API key quota in Settings > Secrets.'
    );
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return new Error(
      'Gemini API is temporarily experiencing high demand (503). Please retry in a few seconds.'
    );
  }
  return new Error(`Gemini BI Assistant request failed: ${raw}`);
}

export async function askBiAssistant(
  rawQuestion: string,
  conversationHistory: BiAssistantConversationTurn[] = [],
  options: AskBiAssistantOptions = {}
): Promise<BiAssistantAnswer> {
  const startTime = performance.now();
  const question = String(rawQuestion || '').trim();
  const persona: BiAssistantPersona =
    options.persona && VALID_PERSONAS.has(options.persona) ? options.persona : 'executive';
  const depth: BiAssistantDepth =
    options.depth && VALID_DEPTHS.has(options.depth) ? options.depth : 'balanced';
  const emit = options.onProgress;

  if (!question) {
    throw new Error('Please enter a business question for the BI Assistant to analyze.');
  }
  if (question.length > 1000) {
    throw new Error('Business question exceeds the 1,000-character validation limit.');
  }

  emit?.({
    type: 'stage',
    stage: 'grounding',
    message: 'Checking active DuckDB warehouse state & schema readiness...'
  });

  await duckdbEngine.ensureInitialized();
  const statuses = await duckdbEngine.getDatasetStatuses();
  const totalRows = statuses.reduce((acc, s) => acc + s.rowCount, 0);
  const dataMode: DataMode = duckdbEngine.getDataMode();
  const isDemonstrationData = duckdbEngine.isDemonstrationData();
  let activeModelName = getGeminiModelName();

  const dataOriginNotice =
    dataMode === 'EMPTY'
      ? 'EMPTY DATABASE (0 rows loaded in DuckDB)'
      : dataMode === 'DEMONSTRATION_DATA'
        ? `DEMONSTRATION DATA (${totalRows} seeded DuckDB rows across ${statuses.filter((s) => s.rowCount > 0).length} tables)`
        : `UPLOADED OLIST CSV DATASET (${totalRows} active DuckDB rows across ${statuses.filter((s) => s.rowCount > 0).length} tables)`;

  // Guard 1: If DuckDB has 0 rows, explicitly state insufficient data without inventing metrics or calling LLM
  if (totalRows === 0 || dataMode === 'EMPTY') {
    const emptyAnswer: BiAssistantAnswer = {
      id: `BIA-${Date.now()}`,
      businessQuestion: question,
      executiveHeadline: 'Warehouse is currently empty — load data to analyze',
      analyticalResult:
        'Insufficient data: The RetailPulse DuckDB analytical database currently contains 0 rows across all tables. No metrics can be calculated until data is loaded.',
      supportingNumericalEvidence: [
        {
          metricLabel: 'Active DuckDB Row Count',
          value: '0 rows',
          context: 'All 9 Olist analytical tables are currently empty',
          sourceTool: 'database_inventory_guard'
        }
      ],
      businessInterpretation:
        'Because no order, customer, product, seller, or review records exist in the analytical database, no empirical business trend or comparison can be evaluated.',
      suggestedManagementAction:
        'Load the Olist Benchmark Demonstration Dataset or upload real Olist CSV files in Data Management (/data-management), then ask this question again.',
      actionItems: [
        {
          owner: 'Data Engineering',
          priority: 'HIGH',
          action: 'Seed the verified Olist benchmark dataset or ingest company CSV files.',
          expectedOutcome: 'Populates star-schema views so live BI & AI queries can run.'
        }
      ],
      followUpQuestions: [
        'What were our highest revenue categories?',
        'Which states have poor delivery performance?',
        'Which customers are at risk?'
      ],
      visualChart: null,
      importantLimitations: [
        'Dataset contains 0 records; RetailPulse BI Assistant strictly prohibits inventing or extrapolating figures without verified DuckDB SQL results.'
      ],
      correlationVsCausationNote:
        'Not applicable — no empirical dataset is currently loaded.',
      insufficientData: true,
      personaUsed: persona,
      depthUsed: depth,
      dataMode,
      isDemonstrationData,
      dataOriginNotice,
      modelUsed: activeModelName,
      generatedAt: new Date().toISOString(),
      totalDurationMs: Math.round((performance.now() - startTime) * 100) / 100,
      toolTraces: []
    };
    emit?.({ type: 'complete', answer: emptyAnswer });
    return emptyAnswer;
  }

  // Guard 2: Verify server-side Gemini API key (never mask missing key with fake AI answers)
  if (!isGeminiConfigured()) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please configure your Gemini API key in the Settings > Secrets panel to run the Gemini BI Assistant.'
    );
  }

  const toolTraces: BiAssistantToolTrace[] = [];
  const verifiedToolPayloads: Array<{
    toolName: string;
    displayName: string;
    validatedArgs: Record<string, string | number | boolean>;
    payload: Record<string, unknown>;
  }> = [];
  const maxToolRounds = depth === 'fast' ? 1 : depth === 'deep' ? 3 : 2;
  const thinkingLevel = resolveThinkingLevel(depth);

  // Build concise sanitized prior conversation turns (up to last 6 turns for comfortable multi-turn dialogue)
  const historyContents: Content[] = [];
  for (const turn of conversationHistory.slice(-6)) {
    if (turn.role === 'user' && turn.question) {
      historyContents.push({
        role: 'user',
        parts: [{ text: turn.question.slice(0, 450) }]
      });
    } else if (turn.role === 'assistant' && turn.analyticalResult) {
      historyContents.push({
        role: 'model',
        parts: [{ text: `Previous Verified Result: ${turn.analyticalResult.slice(0, 600)}` }]
      });
    }
  }

  const toolSelectionSystemInstruction = `You are the RetailPulse Enterprise Conversational Analytics AI (modeled on Google Looker Studio Conversational Analytics) connected to a live DuckDB analytical database via approved read-only analytical functions.

STRICT OPERATING RULES:
1. You MUST call one or more of the approved read-only analytical functions to retrieve verified DuckDB data before answering ANY business question. Never guess or invent numbers.
2. Select the exact function(s) that match the user's business question:
   - Revenue by category -> get_highest_revenue_categories
   - At-risk / churning / RFM customers -> get_at_risk_customers
   - State delivery SLA problems -> get_state_delivery_performance
   - Monthly revenue changes / trends / forecast -> get_monthly_revenue_changes
   - Low review score factors / delivery vs satisfaction -> get_low_review_associated_factors
   - Sellers needing investigation / seller risk -> get_sellers_requiring_investigation
   - Retention / cohort questions -> get_cohort_retention_summary
   - Statistical anomalies, spikes, cancellation waves, or SLA outliers -> get_statistical_anomalies
   - Statistical significance, A/B cohort comparison, p-value, or Welch t-test -> get_ab_cohort_comparison
   - Broad executive KPIs or dataset availability -> get_executive_kpi_overview
3. ${
    depth === 'deep'
      ? 'DEEP RESEARCH MODE: Proactively call 2-3 complementary functions in parallel when helpful to cross-validate revenue, logistics, customer retention, and review impact.'
      : 'Invoke all relevant functions in a single turn when the question spans multiple business domains.'
  }
4. If a question asks for data that does NOT exist in Olist (e.g. ad spend, marketing CAC, website bounce rate, employee payroll, COGS margin), still call get_executive_kpi_overview so you can verify the exact tables available and explicitly report insufficient data.
5. Current Dataset Origin: ${dataOriginNotice}.`;

  const contents: Content[] = [
    ...historyContents,
    {
      role: 'user',
      parts: [{ text: question }]
    }
  ];

  emit?.({
    type: 'stage',
    stage: 'planning',
    message:
      depth === 'deep'
        ? 'Gemini Deep Research is planning multi-domain DuckDB queries...'
        : 'Gemini is selecting verified DuckDB analytical tools...'
  });

  // Phase 1: Function Calling loop (Gemini selects approved tools -> Server validates & executes DuckDB queries)
  try {
    let failoverAnnounced = false;
    for (let round = 0; round < maxToolRounds; round++) {
      const { response: toolResponse, modelUsed } = await generateWithResilience(
        activeModelName,
        (model) => ({
          model,
          contents,
          config: {
            systemInstruction: toolSelectionSystemInstruction,
            ...(supportsThinkingConfig(model) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
            tools: [{ functionDeclarations: BI_ANALYTICAL_TOOL_DECLARATIONS }]
          }
        }),
        (fb) => {
          if (!failoverAnnounced) {
            failoverAnnounced = true;
            emit?.({
              type: 'stage',
              stage: 'failover',
              message: `Primary Gemini model busy — routing seamlessly to ${fb}...`
            });
          }
        }
      );
      activeModelName = modelUsed;

      const modelContent = toolResponse.candidates?.[0]?.content;
      const functionCalls = toolResponse.functionCalls;

      if (!functionCalls || functionCalls.length === 0) {
        if (round === 0 && toolTraces.length === 0) {
          emit?.({
            type: 'tool_start',
            toolName: 'get_executive_kpi_overview',
            args: {}
          });
          const fallbackExec = await executeApprovedBiTool('get_executive_kpi_overview', {});
          toolTraces.push(fallbackExec.trace);
          verifiedToolPayloads.push({
            toolName: fallbackExec.trace.toolName,
            displayName: fallbackExec.trace.displayName,
            validatedArgs: fallbackExec.trace.validatedArgs,
            payload: fallbackExec.llmPayload
          });
          emit?.({
            type: 'tool_done',
            toolName: fallbackExec.trace.toolName,
            displayName: fallbackExec.trace.displayName,
            rowCount: fallbackExec.trace.rowCount,
            executionTimeMs: fallbackExec.trace.executionTimeMs
          });
        }
        break;
      }

      if (modelContent) {
        contents.push(modelContent);
      }

      const functionResponseParts: Part[] = await Promise.all(
        functionCalls.map(async (call) => {
          const callName = call.name || '';
          const callArgs = (call.args as Record<string, unknown>) || {};
          emit?.({
            type: 'tool_start',
            toolName: callName,
            args: callArgs
          });
          try {
            const executed = await executeApprovedBiTool(callName, callArgs);
            toolTraces.push(executed.trace);
            verifiedToolPayloads.push({
              toolName: executed.trace.toolName,
              displayName: executed.trace.displayName,
              validatedArgs: executed.trace.validatedArgs,
              payload: executed.llmPayload
            });
            emit?.({
              type: 'tool_done',
              toolName: executed.trace.toolName,
              displayName: executed.trace.displayName,
              rowCount: executed.trace.rowCount,
              executionTimeMs: executed.trace.executionTimeMs
            });
            return {
              functionResponse: {
                id: call.id,
                name: callName,
                response: { result: executed.llmPayload }
              }
            };
          } catch (toolErr) {
            const errMsg =
              toolErr instanceof Error ? toolErr.message : 'Tool validation/execution failed';
            return {
              functionResponse: {
                id: call.id,
                name: callName,
                response: { error: errMsg }
              }
            };
          }
        })
      );

      contents.push({
        role: 'user',
        parts: functionResponseParts
      });
    }
  } catch (err) {
    throw formatGeminiApiError(err);
  }

  // Ensure at least one verified DuckDB tool output exists before synthesis
  if (verifiedToolPayloads.length === 0) {
    const overviewExec = await executeApprovedBiTool('get_executive_kpi_overview', {});
    toolTraces.push(overviewExec.trace);
    verifiedToolPayloads.push({
      toolName: overviewExec.trace.toolName,
      displayName: overviewExec.trace.displayName,
      validatedArgs: overviewExec.trace.validatedArgs,
      payload: overviewExec.llmPayload
    });
  }

  emit?.({
    type: 'stage',
    stage: 'synthesizing',
    message: `Synthesizing ${persona.replace('-', ' ')} brief with ${activeModelName}...`
  });

  // Phase 2: Grounded Structured Executive Answer Synthesis with clean, decoupled contents
  // (Avoids consecutive user turns, missing-tools 400s, and cross-model thoughtSignature conflicts)
  const synthesisSystemInstruction = `You are the RetailPulse Enterprise Conversational BI Analyst. Synthesize a rigorous, comfortable-to-read, company-ready structured answer strictly from the verified DuckDB analytical function results provided.

${getPersonaGuidance(persona)}

MANDATORY INTEGRITY & SCIENTIFIC RULES:
1. ZERO FABRICATION: Every single number, currency amount, percentage, count, customer ID, seller ID, category name, or state code MUST come directly from the verified DuckDB tool outputs below. Never invent or approximate metrics.
2. INSUFFICIENT DATA HONESTY: If the dataset does not contain the columns, time horizon, or records needed to answer the question (for instance, marketing spend, profit margins, or missing segments), set "insufficientData": true and explicitly state what is missing.
3. CORRELATION VS. CAUSATION: Never claim that an observational relationship proves causation (e.g., late deliveries are empirically associated with lower reviews, but confounders like seller quality, product fragility, and carrier routes exist). Explicitly state this distinction.
4. GROUNDED MANAGEMENT ACTIONS ONLY: Every suggested management action and structured action item must tie directly to the specific entities and metrics observed in the tool outputs (or advise collecting the missing data if insufficientData is true).
5. SMART FOLLOW-UPS: Provide 3 concise, natural next questions the user can click to explore deeper into what was just discovered using our available Olist data.
6. SAMPLE SIZE & DATA ORIGIN TRANSPARENCY: Explicitly mention the dataset origin (${dataOriginNotice}) and sample size constraints inside importantLimitations.`;

  const synthesisContents: Content[] = [
    ...historyContents,
    {
      role: 'user',
      parts: [
        {
          text: [
            `Business Question: "${question}"`,
            `Active Dataset Origin: ${dataOriginNotice}`,
            `Verified Read-Only DuckDB Analytical Tool Results (JSON):`,
            JSON.stringify(verifiedToolPayloads),
            `Synthesize the complete structured JSON Business Intelligence brief strictly from the verified DuckDB results above.`
          ].join('\n\n')
        }
      ]
    }
  ];

  try {
    const { response: finalResponse, modelUsed: synthModel } = await generateWithResilience(
      activeModelName,
      (model) => ({
        model,
        contents: synthesisContents,
        config: {
          systemInstruction: synthesisSystemInstruction,
          ...(supportsThinkingConfig(model) ? { thinkingConfig: { thinkingLevel } } : {}),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              businessQuestion: {
                type: Type.STRING,
                description: 'Clear restatement of the user business question.'
              },
              executiveHeadline: {
                type: Type.STRING,
                description:
                  'One-line high-impact takeaway headline summarizing the core verified finding (max 16 words).'
              },
              analyticalResult: {
                type: Type.STRING,
                description:
                  'Concise, direct quantitative answer grounded strictly in the verified DuckDB tool results.'
              },
              supportingNumericalEvidence: {
                type: Type.ARRAY,
                description:
                  'Exact verified metrics, counts, dollar values, and percentages retrieved from the backend analytical functions (up to 6 strongest metrics).',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    metricLabel: { type: Type.STRING },
                    value: { type: Type.STRING },
                    context: { type: Type.STRING },
                    sourceTool: { type: Type.STRING }
                  },
                  required: ['metricLabel', 'value', 'context', 'sourceTool']
                }
              },
              businessInterpretation: {
                type: Type.STRING,
                description:
                  'Analytical business interpretation tailored to the requested audience persona, without confusing correlation with causation.'
              },
              suggestedManagementAction: {
                type: Type.STRING,
                description:
                  'Concrete, non-fabricated management summary directly supported by the retrieved data.'
              },
              actionItems: {
                type: Type.ARRAY,
                description:
                  '2 to 3 concrete, prioritized company action items assigned to a realistic functional owner (e.g. Logistics Ops, Seller Success, CRM & Retention, Merchandising).',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    owner: { type: Type.STRING },
                    priority: {
                      type: Type.STRING,
                      description: 'HIGH, MEDIUM, or LOW'
                    },
                    action: { type: Type.STRING },
                    expectedOutcome: { type: Type.STRING }
                  },
                  required: ['owner', 'priority', 'action', 'expectedOutcome']
                }
              },
              followUpQuestions: {
                type: Type.ARRAY,
                description:
                  'Exactly 3 concise, natural follow-up questions the user can ask next based on these findings.',
                items: { type: Type.STRING }
              },
              importantLimitations: {
                type: Type.ARRAY,
                description:
                  'List of concrete statistical, methodological, and dataset limitations (sample size, observation window, right-censoring, confounders, data origin).',
                items: { type: Type.STRING }
              },
              correlationVsCausationNote: {
                type: Type.STRING,
                description:
                  'Explicit note distinguishing observed statistical association from causal proof.'
              },
              insufficientData: {
                type: Type.BOOLEAN,
                description:
                  'True if the dataset lacks sufficient information, records, or columns to fully answer the question.'
              }
            },
            required: [
              'businessQuestion',
              'executiveHeadline',
              'analyticalResult',
              'supportingNumericalEvidence',
              'businessInterpretation',
              'suggestedManagementAction',
              'actionItems',
              'followUpQuestions',
              'importantLimitations',
              'correlationVsCausationNote',
              'insufficientData'
            ]
          }
        }
      })
    );
    activeModelName = synthModel;

    const rawText = (finalResponse.text ?? '{}').trim();
    const parsed = parseGeminiJson<Partial<BiAssistantAnswer>>(rawText);
    const totalDurationMs = Math.round((performance.now() - startTime) * 100) / 100;

    const normalizedActionItems: BiAssistantActionItem[] = Array.isArray(parsed.actionItems)
      ? parsed.actionItems.slice(0, 4).map((item) => {
          const p = String(item.priority || 'MEDIUM').toUpperCase();
          return {
            owner: String(item.owner || 'Operations'),
            priority: p === 'HIGH' || p === 'LOW' ? p : 'MEDIUM',
            action: String(item.action || ''),
            expectedOutcome: String(item.expectedOutcome || '')
          };
        })
      : [];

    const normalizedFollowUps = Array.isArray(parsed.followUpQuestions)
      ? parsed.followUpQuestions
          .map((q) => String(q || '').trim())
          .filter((q) => q.length > 4)
          .slice(0, 3)
      : [];

    const visualChart = parsed.insufficientData ? null : buildVerifiedChartFromTraces(toolTraces);

    const answer: BiAssistantAnswer = {
      id: `BIA-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      businessQuestion: parsed.businessQuestion || question,
      executiveHeadline:
        parsed.executiveHeadline ||
        (parsed.insufficientData
          ? 'Insufficient warehouse data to fully answer this question'
          : 'Verified DuckDB analytical summary'),
      analyticalResult:
        parsed.analyticalResult ||
        'Analytical query executed; see supporting numerical evidence below.',
      supportingNumericalEvidence: Array.isArray(parsed.supportingNumericalEvidence)
        ? parsed.supportingNumericalEvidence
        : [],
      businessInterpretation:
        parsed.businessInterpretation ||
        'Interpretation derived strictly from DuckDB analytical results.',
      suggestedManagementAction:
        parsed.suggestedManagementAction ||
        'Review underlying records before initiating operational changes.',
      actionItems: normalizedActionItems,
      followUpQuestions: normalizedFollowUps,
      visualChart,
      importantLimitations:
        Array.isArray(parsed.importantLimitations) && parsed.importantLimitations.length > 0
          ? parsed.importantLimitations
          : [`Analysis reflects ${dataOriginNotice}.`],
      correlationVsCausationNote:
        parsed.correlationVsCausationNote ||
        'Observational marketplace aggregations measure statistical association and do not establish isolated causation without controlled experimentation.',
      insufficientData: Boolean(parsed.insufficientData),
      personaUsed: persona,
      depthUsed: depth,
      dataMode,
      isDemonstrationData,
      dataOriginNotice,
      modelUsed: activeModelName,
      generatedAt: new Date().toISOString(),
      totalDurationMs,
      toolTraces
    };

    emit?.({ type: 'complete', answer });
    return answer;
  } catch (err) {
    throw formatGeminiApiError(err);
  }
}
