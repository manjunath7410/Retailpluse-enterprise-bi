import {
  AbTestRequest,
  AbTestResultPayload,
  AdvancedAnalyticsSuitePayload,
  AnalyticalModelMetadata,
  AnomalyDetectionPayload,
  AnomalyRootCausePayload,
  AnomalyRootCauseRequest,
  ApiResponse,
  BiAssistantAnswer,
  BiAssistantAskRequest,
  BiAssistantStreamEvent,
  BiAssistantToolTrace,
  BiAssistantToolsCatalogResponse,
  BiDashboardId,
  BiDashboardPayload,
  CsvUploadRequest,
  CsvUploadResult,
  DashboardDrilldownRequest,
  DashboardDrilldownResult,
  DashboardFilterOptions,
  DashboardFilterState,
  DataQualityAndModelingPayload,
  ExecutiveBoardReportPayload,
  HealthStatus,
  IngestionSummaryPayload,
  KpiDictionaryEntry,
  LineageGovernancePayload,
  RemediationResultPayload,
  SaveCustomSqlQueryRequest,
  SavedCustomSqlQuery,
  SqlBenchmarkVerificationItem,
  SqlLabWorkspacePayload,
  SqlQueryPlanProfile,
  SqlQueryRequest,
  SqlQueryResult,
  TableStatus,
  WarehousePersistenceStatus,
  WhatIfBaselineMetrics,
  WhatIfScenarioInput,
  WhatIfSimulationPayload
} from '../types/analytics';

async function requestJson<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {})
    },
    ...options
  });

  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !body.success) {
    throw new Error(body.error?.message || `HTTP ${response.status} request failed`);
  }
  return body;
}

export const apiClient = {
  getHealth: () => requestJson<HealthStatus>('/api/health'),
  getDatasets: () => requestJson<TableStatus[]>('/api/datasets'),
  getIngestionSummary: () =>
    requestJson<IngestionSummaryPayload>('/api/datasets/ingestion-summary'),
  seedDemoData: () => requestJson<TableStatus[]>('/api/datasets/seed-demo', { method: 'POST' }),
  clearDatasets: () => requestJson<TableStatus[]>('/api/datasets/clear', { method: 'POST' }),
  uploadCsv: (payload: CsvUploadRequest) =>
    requestJson<CsvUploadResult>('/api/datasets/upload-csv', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  getQualityDashboard: () =>
    requestJson<DataQualityAndModelingPayload>('/api/quality/dashboard'),
  remediateQualityIssues: () =>
    requestJson<RemediationResultPayload>('/api/quality/remediate', { method: 'POST' }),
  injectSampleAnomalies: () =>
    requestJson<DataQualityAndModelingPayload>('/api/quality/inject-anomalies', {
      method: 'POST'
    }),
  getAnalyticalModels: () => requestJson<AnalyticalModelMetadata[]>('/api/models'),
  getKpiDictionary: () => requestJson<KpiDictionaryEntry[]>('/api/kpis/dictionary'),
  getSqlWorkspace: () => requestJson<SqlLabWorkspacePayload>('/api/sql/workspace'),
  saveCustomSqlQuery: (payload: SaveCustomSqlQueryRequest) =>
    requestJson<SavedCustomSqlQuery>('/api/sql/saved', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  deleteCustomSqlQuery: (id: string) =>
    requestJson<SavedCustomSqlQuery[]>(`/api/sql/saved/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),
  verifySqlBenchmarks: () =>
    requestJson<SqlBenchmarkVerificationItem[]>('/api/sql/verify-benchmarks'),
  executeSql: (payload: SqlQueryRequest) =>
    requestJson<SqlQueryResult>('/api/sql/execute', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  explainSqlQuery: (payload: SqlQueryRequest) =>
    requestJson<SqlQueryPlanProfile>('/api/sql/explain', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  getDashboardFilterOptions: () =>
    requestJson<DashboardFilterOptions>('/api/dashboards/filter-options'),
  getBiDashboard: (dashboardId: BiDashboardId, filters: Partial<DashboardFilterState>) => {
    const params = new URLSearchParams();
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
    if (filters.category && filters.category !== 'ALL') params.set('category', filters.category);
    if (filters.state && filters.state !== 'ALL') params.set('state', filters.state);
    if (filters.orderStatus && filters.orderStatus !== 'ALL') {
      params.set('orderStatus', filters.orderStatus);
    }
    const qs = params.toString();
    return requestJson<BiDashboardPayload>(
      `/api/dashboards/${encodeURIComponent(dashboardId)}${qs ? `?${qs}` : ''}`
    );
  },
  executeDashboardDrilldown: (payload: DashboardDrilldownRequest) =>
    requestJson<DashboardDrilldownResult>('/api/dashboards/drilldown', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  getAdvancedAnalytics: (options?: {
    minSellerOrders?: number;
    forecastHorizonMonths?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.minSellerOrders !== undefined) {
      params.set('minSellerOrders', String(options.minSellerOrders));
    }
    if (options?.forecastHorizonMonths !== undefined) {
      params.set('forecastHorizonMonths', String(options.forecastHorizonMonths));
    }
    const qs = params.toString();
    return requestJson<AdvancedAnalyticsSuitePayload>(
      `/api/analytics/advanced${qs ? `?${qs}` : ''}`
    );
  },
  getAssistantTools: () => requestJson<BiAssistantToolsCatalogResponse>('/api/assistant/tools'),
  askBiAssistant: (payload: BiAssistantAskRequest) =>
    requestJson<BiAssistantAnswer>('/api/assistant/ask', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  askBiAssistantStream: async (
    payload: BiAssistantAskRequest,
    onEvent: (event: BiAssistantStreamEvent) => void
  ): Promise<BiAssistantAnswer> => {
    let explicitServerError: Error | null = null;

    const processFrame = (frame: string): BiAssistantAnswer | null => {
      const dataLines = frame
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) return null;

      const rawJson = dataLines.join('\n');
      let parsed: BiAssistantStreamEvent;
      try {
        parsed = JSON.parse(rawJson) as BiAssistantStreamEvent;
      } catch {
        return null;
      }

      onEvent(parsed);
      if (parsed.type === 'error') {
        explicitServerError = new Error(parsed.message);
        throw explicitServerError;
      }
      if (parsed.type === 'complete') {
        return parsed.answer;
      }
      return null;
    };

    try {
      const response = await fetch('/api/assistant/ask-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errMsg = `HTTP ${response.status} request failed`;
        try {
          const errJson = (await response.json()) as ApiResponse<unknown>;
          if (errJson.error?.message) errMsg = errJson.error.message;
        } catch {
          // fallback to HTTP status message
        }
        explicitServerError = new Error(errMsg);
        throw explicitServerError;
      }

      if (!response.body) {
        throw new Error('Streaming response body unavailable.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalAnswer: BiAssistantAnswer | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
        } else if (done) {
          buffer += decoder.decode();
        }

        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = done ? '' : (frames.pop() ?? '');

        for (const frame of frames) {
          if (!frame.trim()) continue;
          const maybeAnswer = processFrame(frame);
          if (maybeAnswer) finalAnswer = maybeAnswer;
        }

        if (done) break;
      }

      if (finalAnswer) {
        return finalAnswer;
      }
      throw new Error('SSE_STREAM_INCOMPLETE');
    } catch (err) {
      // Propagate genuine server/Gemini errors without masking them
      if (explicitServerError) {
        throw explicitServerError;
      }
      // If a reverse proxy or network blip cut the SSE stream, fall back to standard JSON endpoint
      onEvent({
        type: 'stage',
        stage: 'planning',
        message: 'Reconnecting via standard JSON transport...'
      });
      const fallbackJson = await requestJson<BiAssistantAnswer>('/api/assistant/ask', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (!fallbackJson.data) {
        throw err instanceof Error ? err : new Error('Gemini BI Assistant request failed.');
      }
      onEvent({ type: 'complete', answer: fallbackJson.data });
      return fallbackJson.data;
    }
  },
  executeApprovedToolAudit: (toolName: string, args?: Record<string, unknown>) =>
    requestJson<BiAssistantToolTrace>('/api/assistant/tools/preview', {
      method: 'POST',
      body: JSON.stringify({ toolName, args: args || {} })
    }),
  getWarehousePersistence: () =>
    requestJson<WarehousePersistenceStatus>('/api/warehouse/persistence'),
  getStatisticalAnomalies: () =>
    requestJson<AnomalyDetectionPayload>('/api/analytics/anomalies'),
  investigateAnomalyRootCause: (req: AnomalyRootCauseRequest) =>
    requestJson<AnomalyRootCausePayload>('/api/analytics/anomalies/investigate', {
      method: 'POST',
      body: JSON.stringify(req)
    }),
  getWhatIfBaseline: () =>
    requestJson<WhatIfBaselineMetrics>('/api/analytics/simulate/baseline'),
  runWhatIfSimulation: (scenario: Partial<WhatIfScenarioInput>) =>
    requestJson<WhatIfSimulationPayload>('/api/analytics/simulate', {
      method: 'POST',
      body: JSON.stringify(scenario)
    }),
  runAbHypothesisTest: (req: AbTestRequest) =>
    requestJson<AbTestResultPayload>('/api/analytics/ab-test', {
      method: 'POST',
      body: JSON.stringify(req)
    }),
  getLineageGovernance: () =>
    requestJson<LineageGovernancePayload>('/api/governance/lineage'),
  getExecutiveBoardReport: () =>
    requestJson<ExecutiveBoardReportPayload>('/api/reports/executive')
};




