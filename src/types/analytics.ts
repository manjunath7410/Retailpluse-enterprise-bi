export type DataMode = 'EMPTY' | 'DEMONSTRATION_DATA' | 'CUSTOM_UPLOAD';

export type OlistTableKey =
  | 'orders'
  | 'customers'
  | 'order_items'
  | 'payments'
  | 'reviews'
  | 'products'
  | 'sellers'
  | 'category_translations'
  | 'geolocation';

export type AnalyticalModelName =
  | 'fact_orders'
  | 'fact_order_items'
  | 'fact_payments'
  | 'fact_reviews'
  | 'dim_customers'
  | 'dim_products'
  | 'dim_sellers'
  | 'dim_date'
  | 'dim_geography';

export type DataQualityIssueCategory =
  | 'Missing Values'
  | 'Duplicate Primary Keys'
  | 'Invalid Foreign Keys'
  | 'Invalid Timestamps'
  | 'Negative Prices'
  | 'Missing Product Categories'
  | 'Invalid Order Statuses'
  | 'Inconsistent Customer References'
  | 'Invalid Payment Records';

export type ModuleId =
  | 'executive-overview'
  | 'data-management'
  | 'data-quality'
  | 'sales-intelligence'
  | 'customer-intelligence'
  | 'customer-retention'
  | 'product-intelligence'
  | 'seller-performance'
  | 'delivery-analytics'
  | 'decision-lab'
  | 'sql-lab'
  | 'business-insights'
  | 'reports-exports';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
  meta: {
    timestamp: string;
    dataMode: DataMode;
    isDemonstrationData: boolean;
    executionTimeMs?: number;
  };
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  description: string;
  isPrimaryKey?: boolean;
  foreignKeyTo?: string;
}

export interface TableQualitySummary {
  duplicateKeysCount: number;
  missingRequiredCount: number;
  missingOptionalCount: number;
  invalidDateCount: number;
  invalidNumericCount: number;
  rejectedRowCount: number;
  warnings: string[];
}

export interface TableStatus {
  tableName: OlistTableKey;
  stagingTableName: string;
  expectedOlistFilename: string;
  isOptional?: boolean;
  displayName: string;
  grainDescription: string;
  description: string;
  stagingRowCount: number;
  rowCount: number;
  rejectedRowCount: number;
  columnCount: number;
  columns: ColumnSchema[];
  isPopulated: boolean;
  lastUpdated: string | null;
  lastImportedFile: string | null;
  processingStatus: 'EMPTY' | 'READY' | 'READY_WITH_WARNINGS' | 'ERROR';
  sourceLabel: 'EMPTY' | 'DEMONSTRATION DATA' | 'OLIST CSV IMPORT';
  qualitySummary: TableQualitySummary;
}

export interface RejectedRecordItem {
  rejectionId: string;
  batchId: string;
  sourceFile: string;
  targetTable: string;
  rowNumber: number;
  recordKey: string;
  rejectionReason:
    | 'DUPLICATE_PRIMARY_KEY'
    | 'MISSING_REQUIRED_KEY'
    | 'INVALID_DATE_FORMAT'
    | 'INVALID_NUMERIC_VALUE'
    | 'SCHEMA_MISMATCH';
  details: string;
  rawPayload: string;
  detectedAt: string;
}

export interface ImportBatchReport {
  batchId: string;
  fileName: string;
  fileSizeBytes: number;
  targetTable: OlistTableKey | 'unknown';
  status: 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED';
  stagingRowsRead: number;
  cleanedRowsInserted: number;
  rejectedRowsCount: number;
  duplicateCount: number;
  missingValueCount: number;
  invalidDateCount: number;
  detectedColumns: string[];
  columnCount: number;
  warnings: string[];
  errorMessage?: string;
  importedAt: string;
  durationMs: number;
}

export interface RelationshipVerificationItem {
  id: string;
  relationshipName: string;
  childTable: string;
  parentTable: string;
  joinKey: string;
  grainNote: string;
  totalChildRows: number;
  matchedRows: number;
  unmatchedOrphanRows: number;
  matchRatePercent: number | null;
  status: 'VERIFIED' | 'PARTIAL_MATCH' | 'SKIPPED_EMPTY';
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'error';
  service: string;
  version: string;
  uptimeSeconds: number;
  duckdb: {
    connected: boolean;
    engineVersion: string;
    databasePath: string;
    totalTables: number;
    populatedTables: number;
    totalStagingRows: number;
    totalRows: number;
    totalRejectedRows: number;
  };
  ai: {
    configured: boolean;
    model: string;
    mode: 'server-side';
  };
  runtime?: {
    memoryRssMb: number;
    heapUsedMb: number;
    warehouseEpoch: number;
    readPoolSize: number;
    activeReaders: number;
    queuedReaders: number;
    peakActiveReaders: number;
    writeLockBusy: boolean;
    queryTimeoutMs: number;
    maxCsvRows: number;
    cache: {
      entries: number;
      maxEntries: number;
      inFlight: number;
      hits: number;
      misses: number;
      coalescedHits: number;
      evictions: number;
      hitRatePct: number;
    };
    bulkheads: {
      heavyQueries: {
        active: number;
        queued: number;
        maxConcurrent: number;
        peakActive: number;
        rejectedTotal: number;
      };
      csvUploads: {
        active: number;
        queued: number;
        maxConcurrent: number;
        peakActive: number;
        rejectedTotal: number;
      };
    };
  };
  dataMode: DataMode;
  isDemonstrationData: boolean;
}

export interface SqlQueryRequest {
  sql: string;
  limit?: number;
}

export interface SqlQueryResult {
  sql: string;
  columns: { name: string; type: string }[];
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number;
  executionTimeMs: number;
  isDemonstrationData: boolean;
  dataMode: DataMode;
}

export interface QualityCheckItem {
  id: string;
  tableName: string;
  checkName: string;
  category:
    | 'COMPLETENESS'
    | 'UNIQUENESS'
    | 'REFERENTIAL_INTEGRITY'
    | 'VALIDITY'
    | 'GRAIN_SAFETY';
  sqlAssertion: string;
  status: 'PASSED' | 'WARNING' | 'FAILED' | 'SKIPPED_EMPTY';
  issueCount: number;
  totalChecked: number;
  passRatePercent: number | null;
  description: string;
}

export interface DataQualityIssueReportItem {
  id: string;
  issueCategory: DataQualityIssueCategory;
  targetTable: string;
  affectedRecords: number;
  totalRecordsEvaluated: number;
  affectedPercentage: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  recommendedCorrection: string;
  isResolved: boolean;
  resolutionStatusLabel:
    | 'RESOLVED (STAGING QUARANTINE)'
    | 'RESOLVED (REMEDIATED)'
    | 'RESOLVED (0 ISSUES)'
    | 'UNRESOLVED (ACTION REQUIRED)';
  diagnosticSql: string;
}

export interface AnalyticalModelMetadata {
  viewName: AnalyticalModelName;
  displayName: string;
  modelType: 'FACT' | 'DIMENSION';
  grain: string;
  primaryKey: string;
  sourceTables: string[];
  foreignKeys: string[];
  antiMultiplicationRule: string;
  rowCount: number;
  columnCount: number;
  columns: { name: string; type: string }[];
  viewSqlDdl: string;
  sampleQuerySql: string;
}

export interface KpiDictionaryEntry {
  id: string;
  metricName: string;
  category:
    | 'Revenue & Order Economics'
    | 'Order Lifecycle'
    | 'Customer Identity & Retention'
    | 'Experience & Fulfillment SLA';
  currentValue: number | null;
  unit: 'currency' | 'number' | 'percent' | 'score';
  businessDefinition: string;
  grainAndJoinRule: string;
  formulaExpression: string;
  reproducibleSql: string;
  sourceAnalyticalModel: AnalyticalModelName;
}

export interface CustomerIdentityAudit {
  distinctCustomerIdsCount: number;
  distinctCustomerUniqueIdsCount: number;
  repeatCustomerUniqueIdsCount: number;
  repeatRateByUniqueIdPercent: number;
  repeatRateIfMisusingCustomerIdPercent: number;
  verificationSql: string;
}

export interface DataQualityAndModelingPayload {
  overallQualityScorePercent: number;
  totalRecordsEvaluated: number;
  totalIssuesDetected: number;
  resolvedIssuesCount: number;
  unresolvedIssuesCount: number;
  issues: DataQualityIssueReportItem[];
  checks: QualityCheckItem[];
  analyticalModels: AnalyticalModelMetadata[];
  kpiDictionary: KpiDictionaryEntry[];
  customerIdentityAudit: CustomerIdentityAudit;
}

export interface RemediationResultPayload {
  actionsExecuted: string[];
  rowsRemediated: number;
  updatedQualityScorePercent: number;
}

export interface ModuleMetricItem {
  id: string;
  label: string;
  value: string | number | null;
  unit: 'currency' | 'number' | 'percent' | 'days' | 'score';
  sqlSource: string;
  subtitle: string;
}

export interface ModulePreviewPayload {
  moduleId: ModuleId;
  title: string;
  dataMode: DataMode;
  isDemonstrationData: boolean;
  isReady: boolean;
  requiredTables: { tableName: string; rowCount: number; isPopulated: boolean }[];
  metrics: ModuleMetricItem[];
  chartData: Record<string, string | number | null>[];
  chartConfig: {
    xKey: string;
    yKey: string;
    secondaryKey?: string;
    chartType: 'bar' | 'area' | 'line';
    xLabel: string;
    yLabel: string;
  };
  executedSql: string;
  sampleRows: Record<string, string | number | boolean | null>[];
}

export interface CsvUploadRequest {
  tableName?: OlistTableKey;
  fileName?: string;
  fileSizeBytes?: number;
  csvContent: string;
  mode: 'append' | 'replace';
}

export interface CsvUploadResult {
  batchReport: ImportBatchReport;
  tableName: OlistTableKey;
  rowsInserted: number;
  stagingRowsRead: number;
  rejectedRowsCount: number;
  totalRowsAfter: number;
  columnsMatched: string[];
  dataMode: DataMode;
}

export interface IngestionSummaryPayload {
  tables: TableStatus[];
  importHistory: ImportBatchReport[];
  rejectedRecords: RejectedRecordItem[];
  relationships: RelationshipVerificationItem[];
}

export interface AiInsightRequest {
  focusArea: string;
  customPrompt?: string;
}

export interface AiInsightResponse {
  summary: string;
  findings: {
    title: string;
    observation: string;
    sqlEvidence: string;
    recommendedAction: string;
  }[];
  dataScopeNotice: string;
  generatedAt: string;
  modelUsed: string;
}

export interface SqlExecutionHistoryItem {
  historyId: string;
  queryCode?: string;
  queryTitle?: string;
  sql: string;
  status: 'SUCCEEDED' | 'VALIDATION_BLOCKED' | 'EXECUTION_ERROR';
  rowCount: number;
  executionTimeMs: number;
  errorMessage?: string;
  executedAt: string;
  dataMode: DataMode;
}

export interface SavedCustomSqlQuery {
  id: string;
  code: string;
  category: string;
  title: string;
  businessQuestion: string;
  sql: string;
  explanation: string;
  expectedInterpretation: string;
  sqlConcepts: string[];
  createdAt: string;
  isCustom: boolean;
}

export interface SaveCustomSqlQueryRequest {
  category: string;
  title: string;
  businessQuestion: string;
  sql: string;
  explanation: string;
  expectedInterpretation: string;
  sqlConcepts?: string[];
}

export interface SqlBenchmarkMetricComparison {
  metricKey: string;
  metricLabel: string;
  sqlValue: number | string;
  independentValue: number | string;
  delta: number;
  unit: 'currency' | 'number' | 'percent' | 'days' | 'text';
  isMatch: boolean;
}

export interface SqlBenchmarkVerificationItem {
  benchmarkId:
    | 'revenue'
    | 'repeat_customers'
    | 'category_performance'
    | 'delivery_delays'
    | 'monthly_trends';
  queryId: string;
  queryCode: string;
  category: string;
  title: string;
  businessQuestion: string;
  sql: string;
  explanation: string;
  expectedInterpretation: string;
  executionTimeMs: number;
  rowCount: number;
  columns: { name: string; type: string }[];
  actualRows: Record<string, string | number | boolean | null>[];
  comparisons: SqlBenchmarkMetricComparison[];
  allMatched: boolean;
  independentCalculationMethod: string;
}

export interface SqlLabWorkspacePayload {
  totalCuratedQueries: number;
  totalCategories: number;
  totalSqlConcepts: number;
  savedCustomQueries: SavedCustomSqlQuery[];
  executionHistory: SqlExecutionHistoryItem[];
  dataMode: DataMode;
  isDemonstrationData: boolean;
}

export type BiDashboardId =
  | 'executive-overview'
  | 'sales-intelligence'
  | 'customer-intelligence'
  | 'product-intelligence'
  | 'delivery-performance'
  | 'customer-satisfaction';

export type DrilldownDimensionType =
  | 'state'
  | 'category'
  | 'status'
  | 'month'
  | 'seller'
  | 'payment_type'
  | 'review_score'
  | 'rfm_segment'
  | 'product';

export interface DashboardFilterState {
  startDate: string;
  endDate: string;
  category: string;
  state: string;
  orderStatus: string;
}

export interface DashboardFilterOptions {
  minDate: string;
  maxDate: string;
  categories: string[];
  states: string[];
  orderStatuses: string[];
}

export interface DashboardKpiItem {
  id: string;
  label: string;
  value: number | string | null;
  unit: 'currency' | 'number' | 'percent' | 'days' | 'score';
  subtitle: string;
  definition: string;
  sqlSource: string;
  grainNote: string;
}

export interface DashboardVisualSection {
  id: string;
  title: string;
  subtitle: string;
  chartType: 'area' | 'bar' | 'composed' | 'horizontal-bar' | 'line' | 'table';
  xKey: string;
  yKey: string;
  yLabel: string;
  secondaryKey?: string;
  secondaryLabel?: string;
  tertiaryKey?: string;
  tertiaryLabel?: string;
  yUnit: 'currency' | 'number' | 'percent' | 'days' | 'score';
  secondaryUnit?: 'currency' | 'number' | 'percent' | 'days' | 'score';
  drilldownDimension?: DrilldownDimensionType;
  executedSql: string;
  rows: Record<string, string | number | boolean | null>[];
}

export interface BiDashboardPayload {
  dashboardId: BiDashboardId;
  dashboardNumber: number;
  title: string;
  description: string;
  isReady: boolean;
  dataMode: DataMode;
  isDemonstrationData: boolean;
  appliedFilters: DashboardFilterState;
  filterOptions: DashboardFilterOptions;
  kpis: DashboardKpiItem[];
  sections: DashboardVisualSection[];
}

export interface DashboardDrilldownRequest {
  dimensionType: DrilldownDimensionType;
  dimensionValue: string;
  filters: DashboardFilterState;
}

export interface DashboardDrilldownResult {
  dimensionType: DrilldownDimensionType;
  dimensionValue: string;
  title: string;
  subtitle: string;
  executedSql: string;
  columns: { name: string; type: string }[];
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number;
  executionTimeMs: number;
}

export type AdvancedModuleId =
  | 'rfm-segmentation'
  | 'cohort-retention'
  | 'delivery-satisfaction'
  | 'seller-performance'
  | 'business-opportunities'
  | 'sales-forecasting';

export type RfmSegmentName =
  | 'Champions'
  | 'Loyal Customers'
  | 'Potential Loyalists'
  | 'New Customers'
  | 'At Risk'
  | 'Cannot Lose Them'
  | 'Hibernating';

export interface RfmSegmentDefinition {
  segment: RfmSegmentName;
  scoringRule: string;
  businessInterpretation: string;
  recommendedAction: string;
}

export interface RfmSegmentSummaryRow {
  segment: RfmSegmentName;
  customerCount: number;
  customerSharePct: number;
  totalMonetaryValue: number;
  revenueSharePct: number;
  avgRecencyDays: number;
  avgFrequency: number;
  avgMonetaryValue: number;
  scoringRule: string;
  recommendedAction: string;
}

export interface RfmCustomerRecord {
  customerUniqueId: string;
  customerCity: string;
  customerState: string;
  firstOrderDate: string;
  lastOrderDate: string;
  recencyDays: number;
  frequency: number;
  monetaryValue: number;
  rScore: number;
  fScore: number;
  mScore: number;
  rfmCode: string;
  rfmCompositeScore: number;
  segment: RfmSegmentName;
  segmentRationale: string;
}

export interface RfmAnalysisPayload {
  anchorDate: string;
  totalUniqueCustomers: number;
  totalMonetaryValue: number;
  scoringMethodology: {
    recencyFormula: string;
    frequencyFormula: string;
    monetaryFormula: string;
    scaleExplanation: string;
  };
  segmentDefinitions: RfmSegmentDefinition[];
  segmentSummary: RfmSegmentSummaryRow[];
  customerRecords: RfmCustomerRecord[];
  executedSql: string;
}

export interface CohortRetentionCell {
  monthOffset: number;
  targetMonth: string;
  activeCustomers: number;
  retentionPct: number;
  periodRevenue: number;
  isObserved: boolean;
}

export interface CohortRow {
  cohortMonth: string;
  cohortSize: number;
  initialCohortRevenue: number;
  maxObservableOffset: number;
  cumulativeRepeatCustomers: number;
  cumulativeRepeatRatePct: number;
  cells: CohortRetentionCell[];
}

export interface CohortAnalysisPayload {
  datasetStartMonth: string;
  datasetEndMonth: string;
  totalCohorts: number;
  maxMonthOffset: number;
  overallRepeatCustomerRatePct: number;
  methodology: string;
  observationWindowNotice: string;
  cohorts: CohortRow[];
  executedSql: string;
}

export interface DeliverySatisfactionGroupRow {
  performanceGroup: string;
  delayRangeLabel: string;
  orderCount: number;
  reviewedOrderCount: number;
  avgDeliveryDays: number;
  avgDelayDaysVsEstimate: number;
  avgReviewScore: number;
  score1Count: number;
  score2Count: number;
  score3Count: number;
  score4Count: number;
  score5Count: number;
  lowSatisfactionSharePct: number;
  fiveStarSharePct: number;
}

export interface StarScoreComparisonRow {
  reviewScore: number;
  onTimeCount: number;
  onTimeSharePct: number;
  lateCount: number;
  lateSharePct: number;
  totalCount: number;
}

export interface DeliverySatisfactionPayload {
  totalEvaluatedOrders: number;
  onTimeOrderCount: number;
  lateOrderCount: number;
  onTimeAvgReviewScore: number;
  lateAvgReviewScore: number;
  reviewScoreDeltaOnTimeVsLate: number;
  pearsonCorrelationDelayVsScore: number;
  correlationStrengthLabel: string;
  methodology: string;
  correlationVsCausationAnalysis: {
    empiricalAssociationSummary: string;
    whyCorrelationIsNotCausation: string;
    confoundingVariables: string[];
    recommendedExperimentalDesign: string;
  };
  performanceGroups: DeliverySatisfactionGroupRow[];
  starDistributionComparison: StarScoreComparisonRow[];
  executedSql: string;
}

export interface SellerPerformanceRow {
  sellerId: string;
  sellerCity: string;
  sellerState: string;
  distinctOrders: number;
  itemsSold: number;
  sellerRevenue: number;
  totalFreight: number;
  avgFreightPerItem: number;
  freightToRevenueRatioPct: number;
  avgDeliveryDays: number;
  onTimeDeliveryPct: number;
  lateOrderCount: number;
  rawAvgReviewScore: number;
  bayesianAdjustedReviewScore: number;
  sampleReliabilityStatus: 'QUALIFIED_SAMPLE' | 'SMALL_SAMPLE_PENALIZED';
  reliabilityNote: string;
  compositePerformanceIndex: number;
  qualifiedRank: number | null;
}

export interface SellerPerformancePayload {
  totalActiveSellers: number;
  qualifiedSellersCount: number;
  smallSampleSellersCount: number;
  minOrderThreshold: number;
  bayesianPriorWeightM: number;
  platformMeanReviewScoreC: number;
  platformAvgOnTimePct: number;
  methodology: string;
  smallSampleProtectionExplanation: string;
  sellers: SellerPerformanceRow[];
  executedSql: string;
}

export type OpportunityDomain =
  | 'DECLINING_CATEGORY_SALES'
  | 'REGIONAL_DELIVERY_BOTTLENECK'
  | 'WEAK_CUSTOMER_RETENTION'
  | 'UNUSUAL_SELLER_PERFORMANCE'
  | 'LOW_SATISFACTION_CATEGORY';

export interface BusinessOpportunityItem {
  id: string;
  domain: OpportunityDomain;
  domainLabel: string;
  severity: 'HIGH' | 'MEDIUM' | 'WATCH';
  title: string;
  targetEntity: string;
  primaryMetricLabel: string;
  primaryMetricValue: string;
  benchmarkComparison: string;
  evidenceSummary: string;
  calculationMethodology: string;
  recommendedAction: string;
  supportingSql: string;
  evidenceRecords: Record<string, string | number | boolean | null>[];
}

export interface BusinessOpportunityPayload {
  evaluatedTimestamp: string;
  totalOpportunitiesDetected: number;
  methodology: string;
  opportunities: BusinessOpportunityItem[];
}

export interface SalesForecastDataPoint {
  period: string;
  periodIndex: number;
  split: 'TRAIN' | 'TEST' | 'FORECAST';
  actualRevenue: number | null;
  actualOrders: number | null;
  modelForecastRevenue: number;
  baselineForecastRevenue: number;
  lowerConfidence95: number;
  upperConfidence95: number;
  modelAbsoluteError: number | null;
  modelPercentageErrorPct: number | null;
  baselineAbsoluteError: number | null;
  baselinePercentageErrorPct: number | null;
}

export interface SalesForecastingPayload {
  granularity: 'MONTHLY';
  totalHistoricalPeriods: number;
  trainPeriodsCount: number;
  testPeriodsCount: number;
  forecastHorizonMonths: number;
  trainPeriodRange: string;
  testPeriodRange: string;
  forecastPeriodRange: string;
  modelName: string;
  baselineName: string;
  methodology: string;
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
  limitationsAndAssumptions: string[];
  series: SalesForecastDataPoint[];
  executedSql: string;
}

export interface AdvancedAnalyticsSuitePayload {
  isReady: boolean;
  dataMode: DataMode;
  isDemonstrationData: boolean;
  generatedAt: string;
  rfmSegmentation: RfmAnalysisPayload;
  cohortAnalysis: CohortAnalysisPayload;
  deliverySatisfaction: DeliverySatisfactionPayload;
  sellerPerformance: SellerPerformancePayload;
  businessOpportunities: BusinessOpportunityPayload;
  salesForecasting: SalesForecastingPayload;
}

export type ApprovedBiToolName =
  | 'get_highest_revenue_categories'
  | 'get_at_risk_customers'
  | 'get_state_delivery_performance'
  | 'get_monthly_revenue_changes'
  | 'get_low_review_associated_factors'
  | 'get_sellers_requiring_investigation'
  | 'get_executive_kpi_overview'
  | 'get_cohort_retention_summary'
  | 'get_statistical_anomalies'
  | 'get_ab_cohort_comparison';

export interface BiAssistantToolMetadata {
  name: ApprovedBiToolName;
  displayName: string;
  domain: string;
  description: string;
  accessMode: 'READ_ONLY_SQL';
  parametersSummary: string;
  sampleQuestion: string;
}

export interface BiAssistantToolTrace {
  toolName: ApprovedBiToolName;
  displayName: string;
  validatedArgs: Record<string, string | number | boolean>;
  executedSql: string;
  rowCount: number;
  executionTimeMs: number;
  dataOrigin: DataMode;
  previewRows: Record<string, string | number | boolean | null>[];
  summaryMetrics: Record<string, string | number | boolean | null>;
}

export interface BiAssistantEvidenceItem {
  metricLabel: string;
  value: string;
  context: string;
  sourceTool: string;
}

export type BiAssistantPersona = 'executive' | 'operations' | 'analyst' | 'plain-english';
export type BiAssistantDepth = 'fast' | 'balanced' | 'deep';

export interface BiAssistantChartSpec {
  title: string;
  subtitle?: string;
  chartType: 'bar' | 'horizontal-bar' | 'area';
  xKey: string;
  yKey: string;
  yLabel: string;
  yUnit?: 'currency' | 'number' | 'percent' | 'days' | 'score';
  sourceTool: string;
  rows: Record<string, string | number | boolean | null>[];
}

export interface BiAssistantActionItem {
  owner: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  action: string;
  expectedOutcome: string;
}

export interface BiAssistantConversationTurn {
  role: 'user' | 'assistant';
  question: string;
  analyticalResult?: string;
}

export interface BiAssistantAskRequest {
  question: string;
  conversationHistory?: BiAssistantConversationTurn[];
  persona?: BiAssistantPersona;
  depth?: BiAssistantDepth;
}

export interface BiAssistantAnswer {
  id: string;
  businessQuestion: string;
  executiveHeadline?: string;
  analyticalResult: string;
  supportingNumericalEvidence: BiAssistantEvidenceItem[];
  businessInterpretation: string;
  suggestedManagementAction: string;
  actionItems?: BiAssistantActionItem[];
  followUpQuestions?: string[];
  visualChart?: BiAssistantChartSpec | null;
  importantLimitations: string[];
  correlationVsCausationNote: string;
  insufficientData: boolean;
  personaUsed?: BiAssistantPersona;
  depthUsed?: BiAssistantDepth;
  dataMode: DataMode;
  isDemonstrationData: boolean;
  dataOriginNotice: string;
  modelUsed: string;
  generatedAt: string;
  totalDurationMs: number;
  toolTraces: BiAssistantToolTrace[];
}

export type BiAssistantStreamEvent =
  | { type: 'stage'; stage: string; message: string }
  | { type: 'tool_start'; toolName: string; args: Record<string, unknown> }
  | {
      type: 'tool_done';
      toolName: string;
      displayName: string;
      rowCount: number;
      executionTimeMs: number;
    }
  | { type: 'complete'; answer: BiAssistantAnswer }
  | { type: 'error'; message: string };

export interface BiAssistantToolsCatalogResponse {
  tools: BiAssistantToolMetadata[];
  model: string;
  geminiConfigured: boolean;
  securityPolicy: 'READ_ONLY_PARAMETER_VALIDATED_DUCKDB';
}

// ============================================================================
// Google Senior Data Analyst Production Suite Types
// (Persistence, Anomaly Detection, What-If Simulator, A/B Lab, Lineage, Report)
// ============================================================================

export interface WarehousePersistenceStatus {
  storageMode: 'PERSISTENT_FILE' | 'IN_MEMORY';
  dbFilePath: string;
  fileSizeBytes: number;
  benchmarkVersion: string;
  totalRows: number;
  totalOrders: number;
  savedCustomQueriesCount: number;
  lastPersistedAt: string | null;
  dataMode: DataMode;
}

export interface StatisticalAnomalyItem {
  id: string;
  domain: 'Revenue' | 'Logistics SLA' | 'Cancellations' | 'Customer Satisfaction';
  metricKey: string;
  metricLabel: string;
  period: string;
  observedValue: number;
  formattedObserved: string;
  baselineMean: number;
  formattedBaseline: string;
  baselineStdDev: number;
  zScore: number;
  iqrStatus: 'ABOVE_UPPER_FENCE' | 'BELOW_LOWER_FENCE' | 'WITHIN_FENCE';
  severity: 'HIGH' | 'MEDIUM' | 'INFO';
  direction: 'SPIKE' | 'DROP';
  explanation: string;
  recommendedAction: string;
  suggestedSimulatorPreset?: {
    lateDeliveryReductionPct?: number;
    freightReductionPct?: number;
    repeatRateLiftPct?: number;
    cancellationReductionPct?: number;
    targetState?: string;
  };
  suggestedAiPrompt: string;
  sqlLineage: string;
}

export interface MonthlyAnomalySeriesPoint {
  month: string;
  revenue: number;
  orders: number;
  lateDeliveryPct: number;
  cancellationPct: number;
  avgReviewScore: number;
  revenueZScore: number;
  lateRateZScore: number;
  cancellationZScore: number;
}

export interface AnomalyDetectionPayload {
  generatedAt: string;
  dataMode: DataMode;
  isDemonstrationData: boolean;
  monthsEvaluated: number;
  totalAnomalies: number;
  highSeverityCount: number;
  mediumSeverityCount: number;
  anomalies: StatisticalAnomalyItem[];
  monthlySeries: MonthlyAnomalySeriesPoint[];
  methodologyNote: string;
}

export interface AnomalyRootCauseRequest {
  period: string;
  metricKey: string;
  stateCode?: string;
}

export interface RootCauseDriverRow {
  segment: string;
  targetValue: number;
  baselineValue: number;
  delta: number;
  relativeChangePct: number | null;
  contributionSharePct: number;
  targetOrders: number;
}

export interface RootCauseDimensionBreakdown {
  dimensionKey: 'category' | 'state' | 'payment_type' | 'seller';
  dimensionLabel: string;
  top3ConcentrationPct: number;
  drivers: RootCauseDriverRow[];
  executedSql: string;
}

export interface AnomalyRootCausePayload {
  generatedAt: string;
  period: string;
  metricKey: string;
  metricLabel: string;
  unit: 'currency' | 'percent' | 'score';
  direction: 'SPIKE' | 'DROP';
  targetValue: number;
  baselineValue: number;
  totalDelta: number;
  executionTimeMs: number;
  executiveVerdict: string;
  dimensions: RootCauseDimensionBreakdown[];
  topFilterSuggestion?: {
    dimension: 'state' | 'category';
    value: string;
  };
}

export interface WhatIfBaselineMetrics {
  dataMode: DataMode;
  isDemonstrationData: boolean;
  monthsObserved: number;
  annualizedGmv: number;
  monthlyAvgGmv: number;
  annualizedOrders: number;
  avgOrderValue: number;
  lateDeliveryRatePct: number;
  avgFreightRatioPct: number;
  cancellationRatePct: number;
  avgReviewScore: number;
  onTimeAvgReviewScore: number;
  lateAvgReviewScore: number;
  reviewDeltaOnTimeVsLate: number;
  repeatPurchaseRatePct: number;
  highRatingRepeatRatePct: number;
  lowRatingRepeatRatePct: number;
  availableStates: { state: string; orders: number; lateRatePct: number; gmv: number }[];
}

export interface WhatIfScenarioInput {
  lateDeliveryReductionPct: number; // 0 to 80 (% reduction in late orders)
  freightReductionPct: number; // 0 to 35 (% freight subsidy / optimization)
  repeatRateLiftPct: number; // 0 to 25 (relative % lift in repeat conversion)
  cancellationReductionPct: number; // 0 to 60 (% reduction in canceled orders)
  targetState: string; // 'ALL' or 2-letter state code
}

export interface WhatIfSensitivityRow {
  caseLabel: 'Conservative (0.65x)' | 'Base Case (1.0x)' | 'Upside (1.35x)';
  multiplier: number;
  projectedAnnualGmvLift: number;
  projectedNewAnnualGmv: number;
  projectedReviewScore: number;
  projectedLateRatePct: number;
  projectedAdditionalOrders: number;
}

export interface MonteCarloHistogramBin {
  binIndex: number;
  binMin: number;
  binMax: number;
  midpoint: number;
  label: string;
  count: number;
  probabilityPct: number;
  inInterquartileRange: boolean;
}

export interface WhatIfMonteCarloSummary {
  trials: number;
  seed: number;
  p10Lift: number;
  p50Lift: number;
  p90Lift: number;
  meanLift: number;
  stdDevLift: number;
  probPositivePct: number;
  probExceeds50kPct: number;
  probExceeds100kPct: number;
  histogram: MonteCarloHistogramBin[];
  methodologyNote: string;
}

export interface WhatIfSimulationPayload {
  baseline: WhatIfBaselineMetrics;
  scenario: WhatIfScenarioInput;
  scopedBaselineGmv: number;
  scopedLateRatePct: number;
  projectedAnnualGmvLift: number;
  projectedNewAnnualGmv: number;
  projectedGmvLiftPct: number;
  projectedNewLateRatePct: number;
  projectedNewReviewScore: number;
  projectedReviewGain: number;
  projectedRecoveredOrders: number;
  impactBreakdown: {
    driver: string;
    annualGmvImpact: number;
    sharePct: number;
    mechanism: string;
  }[];
  sensitivityTable: WhatIfSensitivityRow[];
  monteCarlo: WhatIfMonteCarloSummary;
  assumptionsAndLimitations: string[];
}

export interface SqlPlanOperatorNode {
  id: string;
  depth: number;
  operatorName: string;
  operatorType: string;
  timingMs: number;
  timingSharePct: number;
  cardinality: number;
  extraInfo: string;
  isHotspot: boolean;
}

export interface SqlQueryPlanProfile {
  executedSql: string;
  totalLatencyMs: number;
  totalOperatorTimeMs: number;
  rowsReturned: number;
  totalRowsScanned: number;
  peakCardinality: number;
  operatorCount: number;
  hotspotOperator: string;
  hotspotSharePct: number;
  operators: SqlPlanOperatorNode[];
  optimizationHints: string[];
  dataMode: DataMode;
  isDemonstrationData: boolean;
}

export type AbTestCohortPresetId =
  | 'on_time_vs_late'
  | 'credit_card_vs_boleto'
  | 'sp_vs_non_sp'
  | 'installments_high_vs_single'
  | 'low_freight_vs_high_freight'
  | 'repeat_vs_first_time'
  | 'custom_manual';

export type AbTestMetricKey = 'review_score' | 'order_value' | 'repeat_rate' | 'on_time_rate';

export interface AbTestRequest {
  presetId: AbTestCohortPresetId;
  metricKey: AbTestMetricKey;
  alpha?: number; // 0.01 | 0.05 | 0.10
  targetMdePct?: number; // e.g. 5 for 5% relative MDE
  manualInput?: {
    testType: 'continuous' | 'proportion';
    controlLabel: string;
    variantLabel: string;
    nA: number;
    meanOrSuccA: number;
    stdDevA?: number;
    nB: number;
    meanOrSuccB: number;
    stdDevB?: number;
  };
}

export interface AbTestPowerCurvePoint {
  mdeRelativePct: number;
  requiredSamplePerArm: number;
}

export interface AbTestResultPayload {
  generatedAt: string;
  dataMode: DataMode;
  isDemonstrationData: boolean;
  presetId: AbTestCohortPresetId;
  metricKey: AbTestMetricKey;
  metricLabel: string;
  metricUnit: 'score' | 'currency' | 'percent';
  testMethod: 'WELCH_T_TEST' | 'TWO_PROPORTION_Z_TEST';
  alpha: number;
  control: {
    label: string;
    sampleSize: number;
    value: number;
    stdDev: number;
    successCount?: number;
  };
  variant: {
    label: string;
    sampleSize: number;
    value: number;
    stdDev: number;
    successCount?: number;
  };
  absoluteDifference: number;
  relativeLiftPct: number;
  testStatistic: number;
  degreesOfFreedom: number | null;
  pValue: number;
  confidenceInterval95: [number, number];
  cohensD: number;
  achievedPowerPct: number;
  isStatisticallySignificant: boolean;
  requiredSamplePerArmForTargetMde: number;
  targetMdePct: number;
  verdict: 'SIGNIFICANT_LIFT' | 'SIGNIFICANT_REGRESSION' | 'INCONCLUSIVE_UNDERPOWERED' | 'NO_SIGNIFICANT_DIFFERENCE';
  verdictSummary: string;
  correlationVsCausationCaveat: string;
  powerCurve: AbTestPowerCurvePoint[];
  executedSql: string | null;
}

export interface LineageNode {
  id: string;
  layer: 'staging' | 'core_table' | 'semantic_view' | 'kpi_metric';
  label: string;
  technicalName: string;
  grain: string;
  rowCount: number | null;
  status: 'HEALTHY' | 'WARNING' | 'EMPTY';
  fanoutSafe: boolean;
  description: string;
  sqlDefinition: string;
  owner: string;
}

export interface LineageEdge {
  source: string;
  target: string;
  joinKey: string;
  cardinality: '1:1' | '1:N' | 'N:1' | 'AGGREGATED';
}

export interface LineageGovernancePayload {
  generatedAt: string;
  dataMode: DataMode;
  isDemonstrationData: boolean;
  nodes: LineageNode[];
  edges: LineageEdge[];
  governanceChecks: {
    id: string;
    title: string;
    status: 'PASS' | 'WARN';
    detail: string;
  }[];
  persistence: WarehousePersistenceStatus;
}

export interface ExecutiveBoardReportPayload {
  reportId: string;
  generatedAt: string;
  dataMode: DataMode;
  isDemonstrationData: boolean;
  dataOriginLabel: string;
  observationWindow: {
    startDate: string;
    endDate: string;
    totalMonths: number;
  };
  headlineKpis: {
    label: string;
    value: string;
    subtext: string;
    tone: 'positive' | 'neutral' | 'warning';
  }[];
  monthlyRevenueTrend: {
    month: string;
    revenue: number;
    orders: number;
    momGrowthPct: number | null;
  }[];
  topCategories: {
    category: string;
    revenue: number;
    orders: number;
    sharePct: number;
    avgReview: number;
  }[];
  regionalSlaLeadersAndLaggards: {
    state: string;
    deliveredOrders: number;
    lateRatePct: number;
    avgDeliveryDays: number;
    avgReviewScore: number;
  }[];
  rfmSummary: {
    segment: string;
    customers: number;
    sharePct: number;
    totalSpend: number;
    avgMonetary: number;
  }[];
  activeAnomalies: StatisticalAnomalyItem[];
  forecastSummary: {
    supported: boolean;
    horizonMonths: number;
    modelName: string;
    mae: number | null;
    mapePct: number | null;
    baselineMapePct: number | null;
    nextMonthProjectedRevenue: number | null;
  };
  executiveTakeaways: string[];
  methodologyAndDisclosures: string[];
  persistence: WarehousePersistenceStatus;
}






