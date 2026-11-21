import { Router, Request, Response } from 'express';
import { duckdbEngine, TABLE_DEFINITIONS } from '../db/duckdbEngine';
import {
  computeBiDashboard,
  executeDashboardDrilldown,
  getDashboardFilterOptions
} from '../db/biDashboardEngine';
import { computeAdvancedAnalyticsSuite } from '../db/advancedAnalyticsEngine';
import {
  computeAnomalyAlerts,
  computeExecutiveBoardReport,
  computeLineageAndGovernance,
  computeWhatIfBaseline,
  investigateAnomalyRootCause,
  runAbCohortHypothesisTest,
  runWhatIfSimulation
} from '../db/decisionLabEngine';
import {
  getGeminiModelName,
  isGeminiConfigured
} from '../services/geminiService';
import {
  APPROVED_BI_TOOLS_CATALOG,
  executeApprovedBiTool
} from '../services/biAnalyticalTools';
import { askBiAssistant } from '../services/biAssistantService';
import {
  ApiResponse,
  BiAssistantAskRequest,
  BiAssistantToolsCatalogResponse,
  BiDashboardId,
  CsvUploadRequest,
  DashboardDrilldownRequest,
  HealthStatus,
  ModuleId,
  SqlQueryRequest
} from '../../src/types/analytics';
import {
  validateCsvFileMetadata,
  validateCsvInput,
  validateSqlQuery
} from '../../src/utils/validators';
import { getModuleById } from '../../src/config/modules';
import {
  analyticalQueryCache,
  createTokenBucketRateLimiter,
  csvUploadBulkhead,
  heavyQueryBulkhead
} from '../services/resilienceLayer';

export const apiRouter = Router();

const standardApiLimiter = createTokenBucketRateLimiter({
  name: 'RetailPulse API',
  capacity: 300,
  refillPerSecond: 5
});

const heavyComputeLimiter = createTokenBucketRateLimiter({
  name: 'Analytical Compute Engine',
  capacity: 60,
  refillPerSecond: 1
});

const uploadAndAiLimiter = createTokenBucketRateLimiter({
  name: 'Ingestion & AI Pipeline',
  capacity: 20,
  refillPerSecond: 0.35
});

// Apply baseline per-client rate limiting to all API routes except /health
apiRouter.use((req, res, next) => {
  if (req.path === '/health') {
    next();
    return;
  }
  standardApiLimiter(req, res, next);
});

async function runCachedRead<T>(
  res: Response,
  cacheKey: string,
  factory: () => Promise<T>
): Promise<T> {
  await duckdbEngine.ensureInitialized();
  const { value, cacheStatus } = await analyticalQueryCache.getOrCompute(
    duckdbEngine.getWarehouseEpoch(),
    cacheKey,
    factory
  );
  res.setHeader('X-Cache', cacheStatus);
  return value;
}

function sendEnvelope<T>(
  res: Response,
  statusCode: number,
  payload: Omit<ApiResponse<T>, 'meta'>,
  executionTimeMs?: number
): void {
  const responseBody: ApiResponse<T> = {
    ...payload,
    meta: {
      timestamp: new Date().toISOString(),
      dataMode: duckdbEngine.getDataMode(),
      isDemonstrationData: duckdbEngine.isDemonstrationData(),
      ...(executionTimeMs !== undefined ? { executionTimeMs } : {})
    }
  };
  res.status(statusCode).json(responseBody);
}

apiRouter.get('/health', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    await duckdbEngine.ensureInitialized();
    const tables = await duckdbEngine.getDatasetStatuses();
    const populatedTables = tables.filter((t) => t.isPopulated).length;
    const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);
    const totalStagingRows = tables.reduce((sum, t) => sum + t.stagingRowCount, 0);
    const totalRejectedRows = tables.reduce((sum, t) => sum + t.rejectedRowCount, 0);

    const engineMetrics = duckdbEngine.getEngineRuntimeMetrics();
    const cacheStats = analyticalQueryCache.getStats();
    const heavyBulkheadStats = heavyQueryBulkhead.getStats();
    const csvBulkheadStats = csvUploadBulkhead.getStats();
    const mem = process.memoryUsage();

    const health: HealthStatus = {
      status: 'healthy',
      service: 'RetailPulse Enterprise Analytical API',
      version: '1.1.0-olist',
      uptimeSeconds: Math.floor(process.uptime()),
      duckdb: {
        connected: true,
        engineVersion: 'DuckDB Node Neo (@duckdb/node-api)',
        databasePath: duckdbEngine.getDatabasePath(),
        totalTables: tables.length,
        populatedTables,
        totalStagingRows,
        totalRows,
        totalRejectedRows
      },
      ai: {
        configured: isGeminiConfigured(),
        model: getGeminiModelName(),
        mode: 'server-side'
      },
      runtime: {
        memoryRssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
        heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
        warehouseEpoch: engineMetrics.warehouseEpoch,
        readPoolSize: engineMetrics.readPoolSize,
        activeReaders: engineMetrics.activeReaders,
        queuedReaders: engineMetrics.queuedReaders,
        peakActiveReaders: engineMetrics.peakActiveReaders,
        writeLockBusy: engineMetrics.writeLockBusy,
        queryTimeoutMs: engineMetrics.queryTimeoutMs,
        maxCsvRows: engineMetrics.maxCsvRows,
        cache: {
          entries: cacheStats.entries,
          maxEntries: cacheStats.maxEntries,
          inFlight: cacheStats.inFlight,
          hits: cacheStats.hits,
          misses: cacheStats.misses,
          coalescedHits: cacheStats.coalescedHits,
          evictions: cacheStats.evictions,
          hitRatePct: cacheStats.hitRatePct
        },
        bulkheads: {
          heavyQueries: {
            active: heavyBulkheadStats.active,
            queued: heavyBulkheadStats.queued,
            maxConcurrent: heavyBulkheadStats.maxConcurrent,
            peakActive: heavyBulkheadStats.peakActive,
            rejectedTotal: heavyBulkheadStats.rejectedTotal
          },
          csvUploads: {
            active: csvBulkheadStats.active,
            queued: csvBulkheadStats.queued,
            maxConcurrent: csvBulkheadStats.maxConcurrent,
            peakActive: csvBulkheadStats.peakActive,
            rejectedTotal: csvBulkheadStats.rejectedTotal
          }
        }
      },
      dataMode: duckdbEngine.getDataMode(),
      isDemonstrationData: duckdbEngine.isDemonstrationData()
    };

    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: health }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Health check failed';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'ENGINE_HEALTH_ERROR', message }
    });
  }
});

apiRouter.get('/datasets', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const statuses = await duckdbEngine.getDatasetStatuses();
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: statuses }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load dataset statuses';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'DATASETS_FETCH_ERROR', message }
    });
  }
});

apiRouter.get('/datasets/ingestion-summary', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const summary = await runCachedRead(res, 'datasets:ingestion-summary', () =>
      duckdbEngine.getIngestionSummary()
    );
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: summary }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load ingestion summary';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'INGESTION_SUMMARY_ERROR', message }
    });
  }
});

apiRouter.post('/datasets/seed-demo', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const statuses = await duckdbEngine.seedDemonstrationData();
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: statuses }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to seed demonstration data';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'DEMO_SEED_ERROR', message }
    });
  }
});

apiRouter.post('/datasets/clear', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const statuses = await duckdbEngine.clearAllTables();
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: statuses }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to clear DuckDB tables';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'CLEAR_TABLES_ERROR', message }
    });
  }
});

apiRouter.post(
  '/datasets/upload-csv',
  uploadAndAiLimiter,
  csvUploadBulkhead.middleware(),
  async (req: Request, res: Response) => {
    const start = performance.now();
    try {
      const body = req.body as Partial<CsvUploadRequest>;
      const rawTableName = (body.tableName || '').trim().toLowerCase();
      const csvContent = body.csvContent || '';
      const fileName = body.fileName || (rawTableName ? `${rawTableName}.csv` : 'upload.csv');
      const fileSizeBytes = body.fileSizeBytes ?? Buffer.byteLength(csvContent, 'utf8');
      const mode = body.mode === 'append' ? 'append' : 'replace';

      // Validate file metadata if fileName is supplied
      const fileMetaCheck = validateCsvFileMetadata(fileName, fileSizeBytes);
      if (!fileMetaCheck.valid) {
        sendEnvelope(res, 400, {
          success: false,
          error: {
            code: 'FILE_VALIDATION_ERROR',
            message: fileMetaCheck.error || 'Invalid CSV file metadata.'
          }
        });
        return;
      }

      const allowedTables = TABLE_DEFINITIONS.map((t) => t.tableName);
      const preliminaryCheck = validateCsvInput(
        rawTableName,
        csvContent,
        allowedTables,
        undefined,
        fileName
      );
      if (!preliminaryCheck.valid || !preliminaryCheck.detectedTable) {
        sendEnvelope(res, 400, {
          success: false,
          error: {
            code: 'CSV_VALIDATION_ERROR',
            message: preliminaryCheck.error || 'CSV validation failed.'
          }
        });
        return;
      }

      const resolvedTable = preliminaryCheck.detectedTable;
      const targetDef = TABLE_DEFINITIONS.find((t) => t.tableName === resolvedTable);
      const expectedColumns = targetDef?.columns.map((c) => c.name);

      const schemaCheck = validateCsvInput(
        resolvedTable,
        csvContent,
        allowedTables,
        expectedColumns,
        fileName
      );
      if (!schemaCheck.valid) {
        sendEnvelope(res, 400, {
          success: false,
          error: {
            code: 'CSV_SCHEMA_ERROR',
            message: schemaCheck.error || 'CSV header schema mismatch.'
          }
        });
        return;
      }

      const result = await duckdbEngine.ingestCsv(
        resolvedTable,
        csvContent,
        mode,
        fileName,
        fileSizeBytes
      );
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      sendEnvelope(res, 200, { success: true, data: result }, elapsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'CSV ingestion failed';
      const isRowLimitExceeded = message.includes('exceeding the per-batch safety ceiling');
      sendEnvelope(res, isRowLimitExceeded ? 413 : 400, {
        success: false,
        error: {
          code: isRowLimitExceeded ? 'CSV_ROW_LIMIT_EXCEEDED' : 'CSV_INGESTION_ERROR',
          message
        }
      });
    }
  }
);

apiRouter.get('/quality', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const checks = await duckdbEngine.runDataQualityChecks();
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: checks }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Data quality execution failed';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'QUALITY_CHECK_ERROR', message }
    });
  }
});

apiRouter.get('/quality/dashboard', heavyQueryBulkhead.middleware(), async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const dashboard = await runCachedRead(res, 'quality:dashboard', () =>
      duckdbEngine.getDataQualityAndModelingDashboard()
    );
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: dashboard }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load data quality & modeling dashboard';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'QUALITY_DASHBOARD_ERROR', message }
    });
  }
});

apiRouter.post('/quality/remediate', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const result = await duckdbEngine.remediateDataQualityIssues();
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: result }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Automated SQL remediation failed';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'QUALITY_REMEDIATION_ERROR', message }
    });
  }
});

apiRouter.post('/quality/inject-anomalies', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const dashboard = await duckdbEngine.injectSampleQualityAnomalies();
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: dashboard }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to inject sample anomalies';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'QUALITY_INJECTION_ERROR', message }
    });
  }
});

apiRouter.get('/models', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const models = await duckdbEngine.getAnalyticalModels();
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: models }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load analytical models';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'MODELS_FETCH_ERROR', message }
    });
  }
});

apiRouter.get('/kpis/dictionary', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const kpis = await duckdbEngine.getKpiDictionary();
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: kpis }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load KPI dictionary';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'KPI_DICTIONARY_ERROR', message }
    });
  }
});

apiRouter.get('/sql/workspace', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const payload = await duckdbEngine.getSqlLabWorkspacePayload();
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: payload }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load SQL Lab workspace state';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'SQL_WORKSPACE_ERROR', message }
    });
  }
});

apiRouter.post('/sql/saved', async (req: Request, res: Response) => {
  const start = performance.now();
  try {
    const saved = await duckdbEngine.saveCustomSqlQuery(req.body);
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: saved }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save custom SQL query';
    sendEnvelope(res, 400, {
      success: false,
      error: { code: 'SQL_SAVE_ERROR', message }
    });
  }
});

apiRouter.delete('/sql/saved/:id', async (req: Request, res: Response) => {
  const start = performance.now();
  try {
    const remaining = await duckdbEngine.deleteCustomSqlQuery(req.params.id);
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: remaining }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete custom SQL query';
    sendEnvelope(res, 400, {
      success: false,
      error: { code: 'SQL_DELETE_ERROR', message }
    });
  }
});

apiRouter.get(
  '/sql/verify-benchmarks',
  heavyComputeLimiter,
  heavyQueryBulkhead.middleware(),
  async (_req: Request, res: Response) => {
    const start = performance.now();
    try {
      const benchmarks = await runCachedRead(res, 'sql:verify-benchmarks', () =>
        duckdbEngine.verifySqlBenchmarksAgainstIndependentCalc()
      );
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      sendEnvelope(res, 200, { success: true, data: benchmarks }, elapsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to verify SQL acceptance benchmarks';
      sendEnvelope(res, 500, {
        success: false,
        error: { code: 'SQL_BENCHMARK_ERROR', message }
      });
    }
  }
);

apiRouter.post(
  '/sql/execute',
  heavyComputeLimiter,
  heavyQueryBulkhead.middleware(),
  async (req: Request, res: Response) => {
    const start = performance.now();
    try {
      const body = req.body as Partial<SqlQueryRequest>;
      const rawSql = body.sql ?? '';
      const limit =
        typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 1000) : 250;

      const validation = validateSqlQuery(rawSql);
      if (!validation.valid) {
        duckdbEngine.recordSqlExecutionHistory({
          sql: rawSql,
          status: 'VALIDATION_BLOCKED',
          rowCount: 0,
          executionTimeMs: 0,
          errorMessage: validation.error || 'Invalid SQL statement.'
        });
        sendEnvelope(res, 400, {
          success: false,
          error: {
            code: 'SQL_VALIDATION_ERROR',
            message: validation.error || 'Invalid SQL statement.'
          }
        });
        return;
      }

      const result = await duckdbEngine.executeReadOnlyQuery(rawSql, limit);
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      sendEnvelope(res, 200, { success: true, data: result }, elapsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'DuckDB SQL execution error';
      sendEnvelope(res, 400, {
        success: false,
        error: { code: 'DUCKDB_EXECUTION_ERROR', message }
      });
    }
  }
);

apiRouter.post(
  '/sql/explain',
  heavyComputeLimiter,
  heavyQueryBulkhead.middleware(),
  async (req: Request, res: Response) => {
    const start = performance.now();
    try {
      const body = req.body as Partial<SqlQueryRequest>;
      const rawSql = typeof body.sql === 'string' ? body.sql : '';
      const limit =
        typeof body.limit === 'number' && Number.isFinite(body.limit) && body.limit > 0
          ? Math.min(Math.floor(body.limit), 1000)
          : 250;

      const validation = validateSqlQuery(rawSql);
      if (!validation.valid) {
        sendEnvelope(res, 400, {
          success: false,
          error: {
            code: 'SQL_VALIDATION_ERROR',
            message: validation.error || 'Only read-only SELECT / WITH queries can be profiled.'
          }
        });
        return;
      }

      const profile = await duckdbEngine.profileReadOnlyQuery(rawSql, limit);
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      sendEnvelope(res, 200, { success: true, data: profile }, elapsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'DuckDB EXPLAIN ANALYZE failed';
      sendEnvelope(res, 400, {
        success: false,
        error: { code: 'DUCKDB_EXPLAIN_ERROR', message }
      });
    }
  }
);

apiRouter.get('/modules/:moduleId/preview', async (req: Request, res: Response) => {
  const start = performance.now();
  try {
    const moduleId = req.params.moduleId as ModuleId;
    const modConfig = getModuleById(moduleId);
    if (!modConfig) {
      sendEnvelope(res, 404, {
        success: false,
        error: {
          code: 'MODULE_NOT_FOUND',
          message: `Analytical module "${moduleId}" does not exist.`
        }
      });
      return;
    }

    const preview = await duckdbEngine.getModulePreview(moduleId);
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: preview }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute module preview';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'MODULE_PREVIEW_ERROR', message }
    });
  }
});

const VALID_BI_DASHBOARDS: BiDashboardId[] = [
  'executive-overview',
  'sales-intelligence',
  'customer-intelligence',
  'product-intelligence',
  'delivery-performance',
  'customer-satisfaction'
];

apiRouter.get('/dashboards/filter-options', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const options = await runCachedRead(res, 'dashboards:filter-options', () =>
      getDashboardFilterOptions()
    );
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: options }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load dashboard filter options';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'FILTER_OPTIONS_ERROR', message }
    });
  }
});

apiRouter.get(
  '/dashboards/:dashboardId',
  heavyQueryBulkhead.middleware(),
  async (req: Request, res: Response) => {
    const start = performance.now();
    try {
      const dashboardId = req.params.dashboardId as BiDashboardId;
      if (!VALID_BI_DASHBOARDS.includes(dashboardId)) {
        sendEnvelope(res, 404, {
          success: false,
          error: {
            code: 'DASHBOARD_NOT_FOUND',
            message: `BI Dashboard "${dashboardId}" is not registered.`
          }
        });
        return;
      }

      const filters = {
        startDate: typeof req.query.startDate === 'string' ? req.query.startDate : '',
        endDate: typeof req.query.endDate === 'string' ? req.query.endDate : '',
        category: typeof req.query.category === 'string' ? req.query.category : 'ALL',
        state: typeof req.query.state === 'string' ? req.query.state : 'ALL',
        orderStatus: typeof req.query.orderStatus === 'string' ? req.query.orderStatus : 'ALL'
      };
      const cacheKey = `dashboard:${dashboardId}:${JSON.stringify(filters)}`;
      const payload = await runCachedRead(res, cacheKey, () =>
        computeBiDashboard(dashboardId, filters)
      );
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      sendEnvelope(res, 200, { success: true, data: payload }, elapsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to compute BI dashboard';
      sendEnvelope(res, 500, {
        success: false,
        error: { code: 'BI_DASHBOARD_ERROR', message }
      });
    }
  }
);

apiRouter.post('/dashboards/drilldown', async (req: Request, res: Response) => {
  const start = performance.now();
  try {
    const body = req.body as Partial<DashboardDrilldownRequest>;
    if (!body.dimensionType || !body.dimensionValue) {
      sendEnvelope(res, 400, {
        success: false,
        error: {
          code: 'DRILLDOWN_VALIDATION_ERROR',
          message: 'Both dimensionType and dimensionValue are required for drill-down inspection.'
        }
      });
      return;
    }

    const result = await executeDashboardDrilldown({
      dimensionType: body.dimensionType,
      dimensionValue: String(body.dimensionValue),
      filters: body.filters || {
        startDate: '',
        endDate: '',
        category: 'ALL',
        state: 'ALL',
        orderStatus: 'ALL'
      }
    });
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: result }, elapsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to execute drill-down query';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'DRILLDOWN_EXECUTION_ERROR', message }
    });
  }
});

apiRouter.get(
  '/analytics/advanced',
  heavyComputeLimiter,
  heavyQueryBulkhead.middleware(),
  async (req: Request, res: Response) => {
    const start = performance.now();
    try {
      const minSellerOrders =
        typeof req.query.minSellerOrders === 'string'
          ? parseInt(req.query.minSellerOrders, 10)
          : 3;
      const forecastHorizonMonths =
        typeof req.query.forecastHorizonMonths === 'string'
          ? parseInt(req.query.forecastHorizonMonths, 10)
          : 3;

      const resolvedMinOrders = Number.isNaN(minSellerOrders) ? 3 : minSellerOrders;
      const resolvedHorizon = Number.isNaN(forecastHorizonMonths) ? 3 : forecastHorizonMonths;
      const cacheKey = `analytics:advanced:${resolvedMinOrders}:${resolvedHorizon}`;

      const payload = await runCachedRead(res, cacheKey, () =>
        computeAdvancedAnalyticsSuite({
          minSellerOrders: resolvedMinOrders,
          forecastHorizonMonths: resolvedHorizon
        })
      );
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      sendEnvelope(res, 200, { success: true, data: payload }, elapsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to compute advanced analytical suite';
      sendEnvelope(res, 500, {
        success: false,
        error: { code: 'ADVANCED_ANALYTICS_ERROR', message }
      });
    }
  }
);

apiRouter.get('/assistant/tools', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    await duckdbEngine.ensureInitialized();
    const payload: BiAssistantToolsCatalogResponse = {
      tools: APPROVED_BI_TOOLS_CATALOG,
      model: getGeminiModelName(),
      geminiConfigured: isGeminiConfigured(),
      securityPolicy: 'READ_ONLY_PARAMETER_VALIDATED_DUCKDB'
    };
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: payload }, elapsed);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to load approved BI analytical tools';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'ASSISTANT_TOOLS_ERROR', message }
    });
  }
});

apiRouter.post('/assistant/ask', uploadAndAiLimiter, async (req: Request, res: Response) => {
  const start = performance.now();
  try {
    const body = (req.body || {}) as Partial<BiAssistantAskRequest>;
    if (typeof body.question !== 'string' || body.question.trim().length === 0) {
      sendEnvelope(res, 400, {
        success: false,
        error: {
          code: 'ASSISTANT_VALIDATION_ERROR',
          message: 'Please provide a non-empty business question string.'
        }
      });
      return;
    }

    const answer = await askBiAssistant(
      body.question,
      Array.isArray(body.conversationHistory) ? body.conversationHistory : [],
      {
        persona: body.persona,
        depth: body.depth
      }
    );
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: answer }, elapsed);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Gemini BI Assistant failed to process question.';
    const isConfigOrUpstream =
      message.includes('GEMINI_API_KEY') ||
      message.includes('Gemini API') ||
      message.includes('quota') ||
      message.includes('rate limit');
    sendEnvelope(res, isConfigOrUpstream ? 503 : 400, {
      success: false,
      error: {
        code: isConfigOrUpstream ? 'GEMINI_UPSTREAM_ERROR' : 'ASSISTANT_EXECUTION_ERROR',
        message
      }
    });
  }
});

apiRouter.post('/assistant/ask-stream', uploadAndAiLimiter, async (req: Request, res: Response) => {
  const body = (req.body || {}) as Partial<BiAssistantAskRequest>;
  if (typeof body.question !== 'string' || body.question.trim().length === 0) {
    sendEnvelope(res, 400, {
      success: false,
      error: {
        code: 'ASSISTANT_VALIDATION_ERROR',
        message: 'Please provide a non-empty business question string.'
      }
    });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
  });

  const writeEvent = (payload: unknown) => {
    if (!res.writableEnded && !clientClosed) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  // Send periodic SSE keepalive comments so Cloud Run / reverse proxies never drop long-running streams
  const keepAliveTimer = setInterval(() => {
    if (!res.writableEnded && !clientClosed) {
      res.write(': keepalive\n\n');
    }
  }, 4000);

  try {
    await askBiAssistant(
      body.question,
      Array.isArray(body.conversationHistory) ? body.conversationHistory : [],
      {
        persona: body.persona,
        depth: body.depth,
        onProgress: (event) => writeEvent(event)
      }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Gemini BI Assistant failed to process question.';
    writeEvent({ type: 'error', message });
  } finally {
    clearInterval(keepAliveTimer);
    if (!res.writableEnded) {
      res.end();
    }
  }
});

apiRouter.post('/assistant/tools/preview', async (req: Request, res: Response) => {
  const start = performance.now();
  try {
    const body = (req.body || {}) as { toolName?: string; args?: Record<string, unknown> };
    if (typeof body.toolName !== 'string' || body.toolName.trim().length === 0) {
      sendEnvelope(res, 400, {
        success: false,
        error: {
          code: 'TOOL_VALIDATION_ERROR',
          message: 'toolName is required and must match an approved read-only BI tool.'
        }
      });
      return;
    }

    const execution = await executeApprovedBiTool(body.toolName, body.args || {});
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: execution.trace }, elapsed);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Approved analytical tool execution failed.';
    sendEnvelope(res, 400, {
      success: false,
      error: { code: 'TOOL_EXECUTION_ERROR', message }
    });
  }
});

apiRouter.get('/warehouse/persistence', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const status = await duckdbEngine.getPersistenceStatus();
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: status }, elapsed);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to inspect DuckDB persistence status.';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'PERSISTENCE_STATUS_ERROR', message }
    });
  }
});

apiRouter.get(
  '/analytics/anomalies',
  heavyQueryBulkhead.middleware(),
  async (_req: Request, res: Response) => {
    const start = performance.now();
    try {
      const payload = await runCachedRead(res, 'analytics:anomalies', () =>
        computeAnomalyAlerts()
      );
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      sendEnvelope(res, 200, { success: true, data: payload }, elapsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to compute statistical anomaly alerts.';
      sendEnvelope(res, 500, {
        success: false,
        error: { code: 'ANOMALY_DETECTION_ERROR', message }
      });
    }
  }
);

apiRouter.post(
  '/analytics/anomalies/investigate',
  heavyComputeLimiter,
  heavyQueryBulkhead.middleware(),
  async (req: Request, res: Response) => {
    const start = performance.now();
    try {
      const payload = await investigateAnomalyRootCause(req.body || {});
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      sendEnvelope(res, 200, { success: true, data: payload }, elapsed);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to execute automated anomaly root-cause attribution.';
      sendEnvelope(res, 400, {
        success: false,
        error: { code: 'ROOT_CAUSE_ATTRIBUTION_ERROR', message }
      });
    }
  }
);

apiRouter.get('/analytics/simulate/baseline', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const baseline = await runCachedRead(res, 'analytics:simulate:baseline', () =>
      computeWhatIfBaseline()
    );
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: baseline }, elapsed);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to load What-If simulation baseline.';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'SIMULATOR_BASELINE_ERROR', message }
    });
  }
});

apiRouter.post(
  '/analytics/simulate',
  heavyQueryBulkhead.middleware(),
  async (req: Request, res: Response) => {
    const start = performance.now();
    try {
      const payload = await runWhatIfSimulation(req.body || {});
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      sendEnvelope(res, 200, { success: true, data: payload }, elapsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to run What-If business simulation.';
      sendEnvelope(res, 400, {
        success: false,
        error: { code: 'SIMULATOR_EXECUTION_ERROR', message }
      });
    }
  }
);

apiRouter.post(
  '/analytics/ab-test',
  heavyComputeLimiter,
  heavyQueryBulkhead.middleware(),
  async (req: Request, res: Response) => {
    const start = performance.now();
    try {
      const payload = await runAbCohortHypothesisTest(req.body || {});
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      sendEnvelope(res, 200, { success: true, data: payload }, elapsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to execute A/B hypothesis test.';
      sendEnvelope(res, 400, {
        success: false,
        error: { code: 'AB_TEST_EXECUTION_ERROR', message }
      });
    }
  }
);

apiRouter.get('/governance/lineage', async (_req: Request, res: Response) => {
  const start = performance.now();
  try {
    const payload = await runCachedRead(res, 'governance:lineage', () =>
      computeLineageAndGovernance()
    );
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    sendEnvelope(res, 200, { success: true, data: payload }, elapsed);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to compute visual lineage & governance graph.';
    sendEnvelope(res, 500, {
      success: false,
      error: { code: 'LINEAGE_GOVERNANCE_ERROR', message }
    });
  }
});

apiRouter.get(
  '/reports/executive',
  heavyComputeLimiter,
  heavyQueryBulkhead.middleware(),
  async (_req: Request, res: Response) => {
    const start = performance.now();
    try {
      const payload = await runCachedRead(res, 'reports:executive', () =>
        computeExecutiveBoardReport()
      );
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      sendEnvelope(res, 200, { success: true, data: payload }, elapsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to compile executive board report.';
      sendEnvelope(res, 500, {
        success: false,
        error: { code: 'EXECUTIVE_REPORT_ERROR', message }
      });
    }
  }
);



