import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DuckDBAnalyticalEngine, duckdbEngine, TABLE_DEFINITIONS } from './duckdbEngine';
import {
  computeBiDashboard,
  executeDashboardDrilldown,
  getDashboardFilterOptions
} from './biDashboardEngine';
import {
  computeAdvancedAnalyticsSuite,
  computeBayesianAdjustedRating,
  computePearsonCorrelation,
  computeRfmScoresAndSegment,
  runChronologicalForecastExperiment
} from './advancedAnalyticsEngine';
import {
  computeAnomalyAlerts,
  computeExecutiveBoardReport,
  computeLineageAndGovernance,
  computeTwoProportionZTest,
  computeWelchTTest,
  detectSeriesAnomalies,
  investigateAnomalyRootCause,
  runAbCohortHypothesisTest,
  runMonteCarloWhatIfDistribution,
  runWhatIfSimulation
} from './decisionLabEngine';
import {
  ALL_SQL_CONCEPTS,
  CURATED_SQL_LIBRARY,
  SQL_QUERY_CATEGORIES
} from '../../src/config/sqlCatalog';
import { BiDashboardId } from '../../src/types/analytics';
import {
  APPROVED_BI_TOOLS_CATALOG,
  executeApprovedBiTool,
  validateToolParameters
} from '../services/biAnalyticalTools';
import { askBiAssistant } from '../services/biAssistantService';
import { ConcurrencyBulkhead, SingleFlightLruCache } from '../services/resilienceLayer';

test('DuckDB analytical engine initializes all 9 Olist tables (8 required + 1 optional) and seeds DEMONSTRATION DATA', async () => {
  await duckdbEngine.ensureInitialized();
  const statuses = await duckdbEngine.seedDemonstrationData();

  assert.equal(statuses.length, TABLE_DEFINITIONS.length);
  assert.equal(duckdbEngine.getDataMode(), 'DEMONSTRATION_DATA');
  assert.equal(duckdbEngine.isDemonstrationData(), true);

  for (const tbl of statuses) {
    assert.ok(tbl.rowCount > 0, `Expected ${tbl.tableName} to have seeded demonstration rows`);
    assert.equal(tbl.stagingRowCount, tbl.rowCount);
    assert.equal(tbl.sourceLabel, 'DEMONSTRATION DATA');
  }
});

test('DuckDB executeReadOnlyQuery runs analytical SQL and blocks mutating statements', async () => {
  const res = await duckdbEngine.executeReadOnlyQuery(
    'SELECT order_status, COUNT(*) AS cnt FROM orders GROUP BY order_status ORDER BY cnt DESC;'
  );
  assert.ok(res.rowCount > 0);
  assert.equal(res.isDemonstrationData, true);
  assert.ok(res.columns.some((c) => c.name === 'order_status'));

  await assert.rejects(
    async () => {
      await duckdbEngine.executeReadOnlyQuery('DROP TABLE orders;');
    },
    /Query must start with a read-only keyword/
  );
});

test('DuckDB ingests all 8 real Olist CSV schemas, isolates rejected records, and verifies relationships & grain safety', async () => {
  // 1. Ingest olist_customers_dataset.csv
  const customersCsv = `customer_id,customer_unique_id,customer_zip_code_prefix,customer_city,customer_state
9ef432eb6251297304e76186b10a928d,7c396fd4830fd04220f754e42b4e5bff,03149,sao paulo,SP
b0830fb4747a6c6d20dea0b8c802d7ef,af07308b275d755c9edb36a90c618231,47813,barreiras,BA`;
  const custRes = await duckdbEngine.ingestCsv(
    undefined,
    customersCsv,
    'replace',
    'olist_customers_dataset.csv'
  );
  assert.equal(custRes.tableName, 'customers');
  assert.equal(custRes.rowsInserted, 2);
  assert.equal(custRes.stagingRowsRead, 2);
  assert.equal(custRes.rejectedRowsCount, 0);
  assert.equal(custRes.dataMode, 'CUSTOM_UPLOAD');

  // 2. Ingest olist_orders_dataset.csv with 2 valid rows + 3 invalid rows (duplicate PK, invalid date, missing PK)
  const ordersCsv = `order_id,customer_id,order_status,order_purchase_timestamp,order_approved_at,order_delivered_carrier_date,order_delivered_customer_date,order_estimated_delivery_date
e481f51cbdc54678b7cc49136f2d6af7,9ef432eb6251297304e76186b10a928d,delivered,2017-10-02 10:56:33,2017-10-02 11:07:15,2017-10-04 19:55:00,2017-10-10 21:25:13,2017-10-18 00:00:00
53cdb2fc8bc7dce0b6741e2150273451,b0830fb4747a6c6d20dea0b8c802d7ef,delivered,2018-07-24 20:41:37,2018-07-26 03:24:27,2018-07-26 14:31:00,2018-08-07 15:27:45,2018-08-13 00:00:00
e481f51cbdc54678b7cc49136f2d6af7,9ef432eb6251297304e76186b10a928d,delivered,2017-10-02 10:56:33,2017-10-02 11:07:15,2017-10-04 19:55:00,2017-10-10 21:25:13,2017-10-18 00:00:00
bad_date_order,b0830fb4747a6c6d20dea0b8c802d7ef,shipped,2018-99-99 99:00:00,,,,2018-08-13 00:00:00
,b0830fb4747a6c6d20dea0b8c802d7ef,processing,2018-07-24 20:41:37,,,,2018-08-13 00:00:00`;
  const ordRes = await duckdbEngine.ingestCsv(
    undefined,
    ordersCsv,
    'replace',
    'olist_orders_dataset.csv'
  );
  assert.equal(ordRes.tableName, 'orders');
  assert.equal(ordRes.stagingRowsRead, 5, 'All 5 raw rows must be preserved in stg_orders');
  assert.equal(ordRes.rowsInserted, 2, 'Only 2 valid orders should enter cleaned orders table');
  assert.equal(ordRes.rejectedRowsCount, 3, '3 invalid rows must be logged in audit_rejected_records');

  // Verify rejected records report contains exact reasons
  const rejected = await duckdbEngine.getRejectedRecords();
  assert.equal(rejected.length, 3);
  const reasons = rejected.map((r) => r.rejectionReason).sort();
  assert.deepEqual(reasons, [
    'DUPLICATE_PRIMARY_KEY',
    'INVALID_DATE_FORMAT',
    'MISSING_REQUIRED_KEY'
  ]);

  // 3. Ingest product_category_name_translation.csv (with UTF-8 BOM)
  const translationCsv = `\uFEFFproduct_category_name,product_category_name_english
utilidades_domesticas,housewares
perfumaria,perfumery`;
  const transRes = await duckdbEngine.ingestCsv(
    undefined,
    translationCsv,
    'replace',
    'product_category_name_translation.csv'
  );
  assert.equal(transRes.tableName, 'category_translations');
  assert.equal(transRes.rowsInserted, 2);

  // 4. Ingest olist_products_dataset.csv
  const productsCsv = `product_id,product_category_name,product_name_lenght,product_description_lenght,product_photos_qty,product_weight_g,product_length_cm,product_height_cm,product_width_cm
87285b34884572647811a353c7ac498a,utilidades_domesticas,40,268,4,500,19,8,13
595fac2a385ac33a80bd5114aec74eb8,perfumaria,29,178,1,400,19,13,19`;
  const prodRes = await duckdbEngine.ingestCsv(
    undefined,
    productsCsv,
    'replace',
    'olist_products_dataset.csv'
  );
  assert.equal(prodRes.tableName, 'products');
  assert.equal(prodRes.rowsInserted, 2);

  // 5. Ingest olist_sellers_dataset.csv
  const sellersCsv = `seller_id,seller_zip_code_prefix,seller_city,seller_state
3504c0cb71d7fa48d967e0e4c94d59d9,09350,maua,SP
289cdb325fb7e7f891c38608bf9e0962,31570,belo horizonte,MG`;
  const sellRes = await duckdbEngine.ingestCsv(
    undefined,
    sellersCsv,
    'replace',
    'olist_sellers_dataset.csv'
  );
  assert.equal(sellRes.tableName, 'sellers');
  assert.equal(sellRes.rowsInserted, 2);

  // 6. Ingest olist_order_items_dataset.csv (order e481... has 2 items to test multi-item grain!)
  const itemsCsv = `order_id,order_item_id,product_id,seller_id,shipping_limit_date,price,freight_value
e481f51cbdc54678b7cc49136f2d6af7,1,87285b34884572647811a353c7ac498a,3504c0cb71d7fa48d967e0e4c94d59d9,2017-10-06 11:07:15,20.00,5.00
e481f51cbdc54678b7cc49136f2d6af7,2,87285b34884572647811a353c7ac498a,3504c0cb71d7fa48d967e0e4c94d59d9,2017-10-06 11:07:15,10.00,3.72
53cdb2fc8bc7dce0b6741e2150273451,1,595fac2a385ac33a80bd5114aec74eb8,289cdb325fb7e7f891c38608bf9e0962,2018-07-30 03:24:27,118.70,22.76`;
  const itemRes = await duckdbEngine.ingestCsv(
    undefined,
    itemsCsv,
    'replace',
    'olist_order_items_dataset.csv'
  );
  assert.equal(itemRes.tableName, 'order_items');
  assert.equal(itemRes.rowsInserted, 3);

  // 7. Ingest olist_order_payments_dataset.csv (order e481... has 2 payment rows: 18.12 + 20.60 = 38.72!)
  const paymentsCsv = `order_id,payment_sequential,payment_type,payment_installments,payment_value
e481f51cbdc54678b7cc49136f2d6af7,1,credit_card,1,18.12
e481f51cbdc54678b7cc49136f2d6af7,2,voucher,1,20.60
53cdb2fc8bc7dce0b6741e2150273451,1,boleto,1,141.46`;
  const payRes = await duckdbEngine.ingestCsv(
    undefined,
    paymentsCsv,
    'replace',
    'olist_order_payments_dataset.csv'
  );
  assert.equal(payRes.tableName, 'payments');
  assert.equal(payRes.rowsInserted, 3);

  // 8. Ingest olist_order_reviews_dataset.csv
  const reviewsCsv = `review_id,order_id,review_score,review_comment_title,review_comment_message,review_creation_date,review_answer_timestamp
a54f0611adc9ed256b57ede6b6eb5114,e481f51cbdc54678b7cc49136f2d6af7,5,Excelente,Produto muito bom,2017-10-11 00:00:00,2017-10-12 03:43:48
8d5266042046a06655c8db133d120ba5,53cdb2fc8bc7dce0b6741e2150273451,4,Bom,Chegou no prazo,2018-08-08 00:00:00,2018-08-08 18:37:50`;
  const revRes = await duckdbEngine.ingestCsv(
    undefined,
    reviewsCsv,
    'replace',
    'olist_order_reviews_dataset.csv'
  );
  assert.equal(revRes.tableName, 'reviews');
  assert.equal(revRes.rowsInserted, 2);

  // Verify all 7 entity relationships are 100% VERIFIED
  const relationships = await duckdbEngine.verifyRelationships();
  assert.equal(relationships.length, 7);
  for (const rel of relationships) {
    assert.equal(rel.status, 'VERIFIED', `Relationship ${rel.relationshipName} should be VERIFIED`);
    assert.equal(rel.matchRatePercent, 100);
    assert.equal(rel.unmatchedOrphanRows, 0);
  }

  // Verify Data Grain safety: order e481 has 2 items AND 2 payments.
  // A careless join of order_items x payments would multiply payment_value by 2 (38.72 * 2 = 77.44).
  // Our grain-safe view vw_order_grain_summary must report exact settled_payment_value = 38.72 + 141.46 = 180.18!
  const grainQuery = await duckdbEngine.executeReadOnlyQuery(
    'SELECT ROUND(SUM(settled_payment_value), 2) AS total_settled, ROUND(SUM(merchandise_value), 2) AS total_merch FROM vw_order_grain_summary;'
  );
  assert.equal(grainQuery.rows[0].total_settled, 180.18);
  assert.equal(grainQuery.rows[0].total_merch, 148.7);

  // Run Data Quality Checks including Grain Safety check
  const dqChecks = await duckdbEngine.runDataQualityChecks();
  assert.equal(dqChecks.length, 8);
  for (const chk of dqChecks) {
    assert.equal(chk.status, 'PASSED', `Quality rule ${chk.id} should pass on valid Olist relational data`);
  }
});

test('DuckDB clearAllTables resets all tables to 0 rows and EMPTY mode, then restores demo seed', async () => {
  const cleared = await duckdbEngine.clearAllTables();
  assert.equal(duckdbEngine.getDataMode(), 'EMPTY');
  for (const tbl of cleared) {
    assert.equal(tbl.rowCount, 0);
    assert.equal(tbl.stagingRowCount, 0);
    assert.equal(tbl.sourceLabel, 'EMPTY');
  }

  const emptyPreview = await duckdbEngine.getModulePreview('sales-intelligence');
  assert.equal(emptyPreview.isReady, false);

  // Restore demonstration data and verify all module previews
  await duckdbEngine.seedDemonstrationData();
  const allModules = [
    'executive-overview',
    'sales-intelligence',
    'customer-intelligence',
    'customer-retention',
    'product-intelligence',
    'seller-performance',
    'delivery-analytics'
  ] as const;

  for (const modId of allModules) {
    const preview = await duckdbEngine.getModulePreview(modId);
    assert.equal(preview.isReady, true, `Expected ${modId} preview to be ready`);
    assert.equal(preview.metrics.length, 4, `Expected 4 computed KPIs for ${modId}`);
    assert.ok(preview.sampleRows.length > 0, `Expected sample SQL rows for ${modId}`);
  }
});

test('DuckDB provisions all 9 Star-Schema Analytical Views and computes all 10 KPI Dictionary metrics', async () => {
  await duckdbEngine.seedDemonstrationData();

  const models = await duckdbEngine.getAnalyticalModels();
  assert.equal(models.length, 9, 'Must expose all 9 Star-Schema analytical views');
  const expectedViews = [
    'fact_orders',
    'fact_order_items',
    'fact_payments',
    'fact_reviews',
    'dim_customers',
    'dim_products',
    'dim_sellers',
    'dim_date',
    'dim_geography'
  ];
  assert.deepEqual(
    models.map((m) => m.viewName),
    expectedViews
  );

  for (const model of models) {
    assert.ok(model.rowCount > 0, `Analytical view ${model.viewName} must have populated rows`);
    assert.ok(model.columnCount > 0, `Analytical view ${model.viewName} must have columns`);
    const sampleRes = await duckdbEngine.executeReadOnlyQuery(model.sampleQuerySql, 10);
    assert.ok(sampleRes.rowCount > 0, `Sample query for ${model.viewName} must execute cleanly`);
  }

  // Verify all 10 KPI Dictionary metrics and their reproducible SQL queries
  const kpis = await duckdbEngine.getKpiDictionary();
  assert.equal(kpis.length, 10, 'Must expose all 10 required KPI Dictionary metrics');
  for (const kpi of kpis) {
    assert.notEqual(kpi.currentValue, null, `KPI ${kpi.metricName} must compute a numeric value`);
    const sqlRes = await duckdbEngine.executeReadOnlyQuery(kpi.reproducibleSql, 5);
    assert.equal(sqlRes.rowCount, 1, `Reproducible SQL for ${kpi.metricName} must return 1 scalar row`);
  }

  // Verify Customer Identity Audit (customer_unique_id vs customer_id) on 5,300-order benchmark
  const custAudit = await duckdbEngine.getCustomerIdentityAudit();
  assert.equal(custAudit.distinctCustomerIdsCount, 5300, '5,300 order-scoped customer_id keys');
  assert.ok(
    custAudit.distinctCustomerUniqueIdsCount >= 3000 && custAudit.distinctCustomerUniqueIdsCount < 5000,
    `Expected ~3,500-4,000 permanent customer_unique_id entities, got ${custAudit.distinctCustomerUniqueIdsCount}`
  );
  assert.ok(
    custAudit.repeatCustomerUniqueIdsCount >= 600,
    `Expected >= 600 repeat buyers via customer_unique_id, got ${custAudit.repeatCustomerUniqueIdsCount}`
  );
  assert.ok(
    custAudit.repeatRateByUniqueIdPercent >= 18,
    `Expected >= 18% repeat rate, got ${custAudit.repeatRateByUniqueIdPercent}%`
  );
  assert.equal(
    custAudit.repeatRateIfMisusingCustomerIdPercent,
    0,
    'Misusing customer_id yields 0% repeat rate'
  );
});

test('DuckDB evaluates all 9 Data Quality Issue Categories, detects injected anomalies, and remediates them via SQL', async () => {
  await duckdbEngine.seedDemonstrationData();

  const initialDashboard = await duckdbEngine.getDataQualityAndModelingDashboard();
  assert.equal(initialDashboard.issues.length, 9, 'Must evaluate all 9 required issue categories');
  assert.equal(initialDashboard.overallQualityScorePercent, 100);
  assert.equal(initialDashboard.unresolvedIssuesCount, 0);

  // Inject sample anomalies across categories
  const dirtyDashboard = await duckdbEngine.injectSampleQualityAnomalies();
  assert.ok(
    dirtyDashboard.unresolvedIssuesCount > 0,
    'Injected anomalies must flag unresolved issues'
  );
  assert.ok(
    dirtyDashboard.overallQualityScorePercent < 100,
    'Quality score must decrease when unresolved anomalies exist'
  );

  // Remediate open anomalies via automated SQL remediation
  const remediation = await duckdbEngine.remediateDataQualityIssues();
  assert.ok(remediation.rowsRemediated > 0, 'Must remediate anomalous rows');
  assert.equal(remediation.updatedQualityScorePercent, 100, 'Quality score must return to 100%');

  const finalDashboard = await duckdbEngine.getDataQualityAndModelingDashboard();
  assert.equal(finalDashboard.unresolvedIssuesCount, 0, 'All 9 issue categories must be resolved');

  // Restore clean demonstration seed
  await duckdbEngine.seedDemonstrationData();
});

test('SQL Analytics Lab library contains >= 35 queries across all 8 categories and 17 SQL concepts, and all 36 execute against DuckDB', async () => {
  await duckdbEngine.seedDemonstrationData();

  assert.ok(
    CURATED_SQL_LIBRARY.length >= 35,
    `Expected at least 35 curated queries, found ${CURATED_SQL_LIBRARY.length}`
  );
  assert.equal(SQL_QUERY_CATEGORIES.length, 8, 'Expected all 8 required query categories');
  assert.equal(ALL_SQL_CONCEPTS.length, 17, 'Expected all 17 required SQL concepts');

  // Verify every category has multiple queries
  for (const category of SQL_QUERY_CATEGORIES) {
    const count = CURATED_SQL_LIBRARY.filter((q) => q.category === category).length;
    assert.ok(count >= 4, `Category "${category}" must contain at least 4 queries (found ${count})`);
  }

  // Verify every required SQL concept is demonstrated in the catalog
  for (const concept of ALL_SQL_CONCEPTS) {
    const count = CURATED_SQL_LIBRARY.filter((q) => q.sqlConcepts.includes(concept)).length;
    assert.ok(
      count >= 1,
      `Advanced SQL concept "${concept}" must be demonstrated in at least 1 saved query`
    );
  }

  // Execute every single one of the 36 curated queries against DuckDB and assert real execution results
  for (const queryItem of CURATED_SQL_LIBRARY) {
    assert.ok(queryItem.businessQuestion.length > 10, `${queryItem.code} missing business question`);
    assert.ok(queryItem.explanation.length > 10, `${queryItem.code} missing explanation`);
    assert.ok(
      queryItem.expectedInterpretation.length > 10,
      `${queryItem.code} missing expected interpretation`
    );

    const execResult = await duckdbEngine.executeReadOnlyQuery(queryItem.sql, 250);
    assert.ok(
      execResult.columns.length > 0,
      `Query ${queryItem.code} (${queryItem.title}) returned 0 columns`
    );
    assert.ok(
      execResult.rowCount > 0,
      `Query ${queryItem.code} (${queryItem.title}) returned 0 rows`
    );
  }
});

test('SQL Analytics Lab Acceptance Test: verifies revenue, repeat customers, category performance, delivery delays, and monthly trends against independent calculations', async () => {
  await duckdbEngine.seedDemonstrationData();

  const benchmarks = await duckdbEngine.verifySqlBenchmarksAgainstIndependentCalc();
  assert.equal(benchmarks.length, 5, 'Must run all 5 acceptance benchmark reconciliations');

  const expectedBenchmarkIds = [
    'revenue',
    'repeat_customers',
    'category_performance',
    'delivery_delays',
    'monthly_trends'
  ];
  assert.deepEqual(
    benchmarks.map((b) => b.benchmarkId),
    expectedBenchmarkIds
  );

  for (const bm of benchmarks) {
    assert.equal(
      bm.allMatched,
      true,
      `Benchmark ${bm.benchmarkId} (${bm.queryCode}) failed independent calculation parity: ${JSON.stringify(
        bm.comparisons.filter((c) => !c.isMatch)
      )}`
    );
    assert.ok(bm.actualRows.length > 0, `Benchmark ${bm.queryCode} must include actual SQL rows`);
    for (const cmp of bm.comparisons) {
      assert.equal(
        cmp.isMatch,
        true,
        `Metric ${cmp.metricKey} in ${bm.queryCode}: SQL=${cmp.sqlValue} vs Independent=${cmp.independentValue}`
      );
    }
  }

  // Also test saving and deleting a custom SQL query and inspecting workspace history
  const saved = await duckdbEngine.saveCustomSqlQuery({
    title: 'Custom State Revenue Verification',
    category: 'Sales Analysis',
    businessQuestion: 'What is our total order value by customer_state?',
    sql: 'SELECT customer_state, COUNT(*) AS orders_cnt, ROUND(SUM(total_order_value), 2) AS total_val FROM fact_orders GROUP BY customer_state ORDER BY total_val DESC;',
    explanation: 'Aggregates fact_orders by customer_state.',
    expectedInterpretation: 'Ranks states by order value.'
  });
  assert.equal(saved.code, 'USR-01');
  assert.equal(saved.isCustom, true);

  const wsAfterSave = await duckdbEngine.getSqlLabWorkspacePayload();
  assert.equal(wsAfterSave.savedCustomQueries.length, 1);
  assert.ok(wsAfterSave.executionHistory.length > 0);

  const remaining = await duckdbEngine.deleteCustomSqlQuery(saved.id);
  assert.equal(remaining.length, 0);
});

test('Complete BI Dashboard System: computes all 6 Dashboards from DuckDB, enforces SQL lineage on KPIs, updates dynamically on filters, and executes drill-downs', async () => {
  await duckdbEngine.seedDemonstrationData();

  const filterOpts = await getDashboardFilterOptions();
  assert.ok(filterOpts.categories.length > 0, 'Must expose English product categories for filtering');
  assert.ok(filterOpts.states.includes('SP'), 'Must expose customer states for filtering');
  assert.ok(filterOpts.orderStatuses.includes('delivered'), 'Must expose order statuses for filtering');

  const allDashboards: BiDashboardId[] = [
    'executive-overview',
    'sales-intelligence',
    'customer-intelligence',
    'product-intelligence',
    'delivery-performance',
    'customer-satisfaction'
  ];

  for (const dashId of allDashboards) {
    const payload = await computeBiDashboard(dashId, {});
    assert.equal(payload.dashboardId, dashId);
    assert.equal(payload.isReady, true, `Dashboard ${dashId} must be ready when demo data is seeded`);
    assert.equal(payload.kpis.length, 5, `Dashboard ${dashId} must compute 5 KPIs`);
    assert.ok(payload.sections.length >= 3, `Dashboard ${dashId} must compute >= 3 visual sections`);

    for (const kpi of payload.kpis) {
      assert.notEqual(kpi.value, null, `KPI ${kpi.id} in ${dashId} must have a computed value`);
      assert.ok(kpi.definition.length > 10, `KPI ${kpi.id} must have a business definition`);
      assert.ok(kpi.sqlSource.includes('SELECT'), `KPI ${kpi.id} must expose its SQL calculation source`);
      assert.ok(kpi.grainNote.length > 5, `KPI ${kpi.id} must document its grain guard`);
    }

    for (const sec of payload.sections) {
      assert.ok(sec.rows.length > 0, `Visual ${sec.id} in ${dashId} must return DuckDB rows`);
      assert.ok(sec.executedSql.includes('SELECT'), `Visual ${sec.id} must expose its SQL query source`);
    }
  }

  // Verify dynamic filtering: filtering by State = 'SP' must reduce Total Orders compared to unfiltered
  const execUnfiltered = await computeBiDashboard('executive-overview', {});
  const execSpFiltered = await computeBiDashboard('executive-overview', { state: 'SP' });
  const totalOrdersUnfiltered = Number(
    execUnfiltered.kpis.find((k) => k.id === 'exec-total-orders')?.value
  );
  const totalOrdersSp = Number(
    execSpFiltered.kpis.find((k) => k.id === 'exec-total-orders')?.value
  );
  assert.equal(totalOrdersUnfiltered, 5300);
  assert.ok(
    totalOrdersSp > 0 && totalOrdersSp < totalOrdersUnfiltered,
    `Expected SP filtered orders (${totalOrdersSp}) to be between 1 and ${totalOrdersUnfiltered - 1}`
  );

  // Verify drill-down execution across dimensions
  const stateDrill = await executeDashboardDrilldown({
    dimensionType: 'state',
    dimensionValue: 'SP',
    filters: { startDate: '', endDate: '', category: 'ALL', state: 'ALL', orderStatus: 'ALL' }
  });
  assert.ok(stateDrill.rowCount > 0, 'State drill-down for SP must return granular order records');
  assert.ok(stateDrill.executedSql.includes("customer_state = 'SP'"));

  const rfmDrill = await executeDashboardDrilldown({
    dimensionType: 'rfm_segment',
    dimensionValue: '1. Champions (Repeat High-LTV)',
    filters: { startDate: '', endDate: '', category: 'ALL', state: 'ALL', orderStatus: 'ALL' }
  });
  assert.ok(rfmDrill.rowCount > 0, 'RFM segment drill-down must return customer cohort records');
});

test('Pure Econometric & Statistical Helpers: RFM classification, Pearson correlation, Bayesian shrinkage, and chronological backtesting', () => {
  // 1. Deterministic RFM classification across segments
  const champion = computeRfmScoresAndSegment({
    recencyDays: 5,
    frequency: 3,
    monetaryValue: 750
  });
  assert.equal(champion.rScore, 5);
  assert.equal(champion.fScore, 5);
  assert.equal(champion.mScore, 5);
  assert.equal(champion.segment, 'Champions');

  const cannotLose = computeRfmScoresAndSegment({
    recencyDays: 110,
    frequency: 3,
    monetaryValue: 500
  });
  assert.equal(cannotLose.segment, 'Cannot Lose Them');

  const newCustomer = computeRfmScoresAndSegment({
    recencyDays: 8,
    frequency: 1,
    monetaryValue: 95
  });
  assert.equal(newCustomer.segment, 'New Customers');

  const hibernating = computeRfmScoresAndSegment({
    recencyDays: 120,
    frequency: 1,
    monetaryValue: 65
  });
  assert.equal(hibernating.segment, 'Hibernating');

  // 2. Pearson correlation coefficient r
  const rNeg = computePearsonCorrelation([-4, -2, 0, 2, 5], [5, 5, 4, 3, 2]);
  assert.ok(rNeg < -0.9, `Expected strong negative correlation, got ${rNeg}`);

  // 3. Empirical Bayes shrinkage protects against small-n seller variance
  const smallSample5Star = computeBayesianAdjustedRating(1, 5.0, 4.1, 3);
  const largeSample5Star = computeBayesianAdjustedRating(25, 5.0, 4.1, 3);
  assert.ok(
    smallSample5Star < largeSample5Star,
    `Expected n=1 seller rating (${smallSample5Star}) to be shrunk closer to prior 4.1 than n=25 seller (${largeSample5Star})`
  );

  // 4. Chronological Forecast Experiment (Train/Test split + MAE/MAPE vs Baseline)
  const exp = runChronologicalForecastExperiment(
    [
      { period: '2026-06', revenue: 400, orders: 2 },
      { period: '2026-07', revenue: 480, orders: 2 },
      { period: '2026-08', revenue: 550, orders: 2 },
      { period: '2026-09', revenue: 620, orders: 2 },
      { period: '2026-10', revenue: 700, orders: 2 },
      { period: '2026-11', revenue: 780, orders: 2 }
    ],
    3
  );
  assert.equal(exp.trainPeriodsCount, 4);
  assert.equal(exp.testPeriodsCount, 2);
  assert.equal(exp.series.length, 9); // 6 historical + 3 forecast
  assert.ok(exp.evaluationMetrics.modelMae >= 0);
  assert.ok(exp.evaluationMetrics.modelMapePct >= 0);
  assert.ok(exp.evaluationMetrics.baselineMae > 0);
  assert.equal(exp.evaluationMetrics.modelOutperformsBaseline, true);
});

test('Advanced Analytics Suite: All 6 required modules compute live DuckDB results with documented methodology', async () => {
  await duckdbEngine.ensureInitialized();
  await duckdbEngine.seedDemonstrationData();

  const suite = await computeAdvancedAnalyticsSuite({
    minSellerOrders: 3,
    forecastHorizonMonths: 3
  });

  assert.equal(suite.isReady, true);
  assert.equal(suite.dataMode, 'DEMONSTRATION_DATA');

  // MODULE 1: RFM Customer Segmentation (5,200-order scale)
  assert.ok(suite.rfmSegmentation.totalUniqueCustomers >= 3000);
  assert.equal(suite.rfmSegmentation.segmentDefinitions.length, 7);
  assert.ok(suite.rfmSegmentation.customerRecords.length >= 3000);
  const champions = suite.rfmSegmentation.customerRecords.filter(
    (c) => c.segment === 'Champions'
  );
  assert.ok(champions.length > 0, 'Expected Champions segment buyers in 5,200-order dataset');

  // MODULE 2: Customer Cohort Analysis (24 months: 2024-01 through 2025-12)
  assert.equal(suite.cohortAnalysis.totalCohorts, 24);
  assert.ok(suite.cohortAnalysis.observationWindowNotice.includes('Right-Censored'));
  const firstCohort = suite.cohortAnalysis.cohorts.find((c) => c.cohortMonth === '2024-01');
  assert.ok(firstCohort, 'Expected 2024-01 acquisition cohort');
  assert.equal(firstCohort.cells[0].retentionPct, 100);
  assert.equal(firstCohort.cells[0].isObserved, true);
  // Later cohort must have right-censored cells for future offsets
  const lastCohort =
    suite.cohortAnalysis.cohorts[suite.cohortAnalysis.cohorts.length - 1];
  const censoredCells = lastCohort.cells.filter((cell) => !cell.isObserved);
  assert.ok(
    censoredCells.length > 0,
    'Later cohort must mark offsets beyond datasetEndMonth as unobserved (right-censored)'
  );

  // MODULE 3: Delivery and Satisfaction Analysis
  assert.ok(suite.deliverySatisfaction.totalEvaluatedOrders >= 4000);
  assert.ok(
    suite.deliverySatisfaction.onTimeAvgReviewScore >
      suite.deliverySatisfaction.lateAvgReviewScore,
    `Expected on-time mean score (${suite.deliverySatisfaction.onTimeAvgReviewScore}) > late mean score (${suite.deliverySatisfaction.lateAvgReviewScore})`
  );
  assert.ok(suite.deliverySatisfaction.pearsonCorrelationDelayVsScore < -0.3);
  assert.ok(
    suite.deliverySatisfaction.correlationVsCausationAnalysis.confoundingVariables.length >= 3
  );
  assert.equal(suite.deliverySatisfaction.starDistributionComparison.length, 5);

  // MODULE 4: Seller Performance (with Small-Sample Protection across 65 sellers)
  assert.ok(suite.sellerPerformance.totalActiveSellers >= 50);
  assert.equal(suite.sellerPerformance.minOrderThreshold, 3);
  assert.ok(suite.sellerPerformance.qualifiedSellersCount >= 40);

  // MODULE 5: Business Opportunity Detection
  assert.equal(suite.businessOpportunities.totalOpportunitiesDetected, 5);
  const domains = suite.businessOpportunities.opportunities.map((o) => o.domain);
  assert.ok(domains.includes('DECLINING_CATEGORY_SALES'));
  assert.ok(domains.includes('REGIONAL_DELIVERY_BOTTLENECK'));
  assert.ok(domains.includes('WEAK_CUSTOMER_RETENTION'));
  assert.ok(domains.includes('UNUSUAL_SELLER_PERFORMANCE'));
  assert.ok(domains.includes('LOW_SATISFACTION_CATEGORY'));
  for (const opp of suite.businessOpportunities.opportunities) {
    assert.ok(opp.supportingSql.includes('SELECT'));
    assert.ok(opp.evidenceRecords.length > 0);
  }

  // MODULE 6: Sales Forecasting (24 historical months + 3-month forecast)
  assert.equal(suite.salesForecasting.totalHistoricalPeriods, 24);
  assert.ok(suite.salesForecasting.trainPeriodsCount >= 16);
  assert.ok(suite.salesForecasting.testPeriodsCount >= 4);
  assert.equal(suite.salesForecasting.forecastHorizonMonths, 3);
  assert.equal(suite.salesForecasting.series.length, 27);
  assert.ok(suite.salesForecasting.evaluationMetrics.modelMae >= 0);
  assert.ok(suite.salesForecasting.evaluationMetrics.modelMapePct >= 0);
  assert.ok(suite.salesForecasting.evaluationMetrics.baselineMae >= 0);
  assert.ok(suite.salesForecasting.limitationsAndAssumptions.length >= 3);
});

test('Gemini BI Assistant Approved Tools: all 10 read-only DuckDB tools execute cleanly and enforce strict parameter validation', async () => {
  await duckdbEngine.ensureInitialized();
  await duckdbEngine.seedDemonstrationData();

  assert.equal(
    APPROVED_BI_TOOLS_CATALOG.length,
    10,
    'Must expose all 10 approved read-only BI analytical tools'
  );

  // 1. Execute every approved read-only tool and verify DuckDB output & SQL lineage
  for (const toolMeta of APPROVED_BI_TOOLS_CATALOG) {
    const execution = await executeApprovedBiTool(toolMeta.name, {});
    assert.equal(execution.trace.toolName, toolMeta.name);
    assert.ok(
      execution.trace.executedSql.includes('SELECT'),
      `Tool ${toolMeta.name} must record its read-only SELECT SQL lineage`
    );
    assert.ok(
      execution.trace.rowCount > 0,
      `Tool ${toolMeta.name} must return verified rows from seeded DuckDB warehouse`
    );
    assert.ok(execution.trace.previewRows.length > 0);
    assert.equal(execution.trace.dataOrigin, 'DEMONSTRATION_DATA');
  }

  // 2. Verify strict security & parameter validation rejects unauthorized tools and malformed/malicious inputs
  const unknownTool = validateToolParameters('drop_all_tables', {});
  assert.equal(unknownTool.valid, false);
  assert.match(unknownTool.error || '', /not in the approved read-only analytical function registry/);

  const badLimit = validateToolParameters('get_highest_revenue_categories', { limit: 500 });
  assert.equal(badLimit.valid, false);
  assert.match(badLimit.error || '', /out of allowed range/);

  const badSort = validateToolParameters('get_highest_revenue_categories', {
    sortOrder: 'DESC; DROP TABLE orders'
  });
  assert.equal(badSort.valid, false);
  assert.match(badSort.error || '', /must be "DESC" or "ASC"/);

  const badSegment = validateToolParameters('get_at_risk_customers', {
    segmentFilter: "ALL' OR '1'='1"
  });
  assert.equal(badSegment.valid, false);
  assert.match(badSegment.error || '', /not an approved RFM segment filter/);

  const badScore = validateToolParameters('get_low_review_associated_factors', {
    scoreThreshold: 9
  });
  assert.equal(badScore.valid, false);
  assert.match(badScore.error || '', /out of allowed range/);

  const badSellerThreshold = validateToolParameters('get_sellers_requiring_investigation', {
    minOrderThreshold: 0
  });
  assert.equal(badSellerThreshold.valid, false);
  assert.match(badSellerThreshold.error || '', /out of allowed range/);

  await assert.rejects(
    async () => {
      await executeApprovedBiTool('drop_all_tables', {});
    },
    /not in the approved read-only analytical function registry/
  );
});

test('Gemini BI Assistant Guards: validates question length and returns insufficientData=true on empty DuckDB without inventing numbers', async () => {
  // 1. Empty or overlong question validation
  await assert.rejects(
    async () => {
      await askBiAssistant('   ');
    },
    /Please enter a business question/
  );

  await assert.rejects(
    async () => {
      await askBiAssistant('a'.repeat(1005));
    },
    /1,000-character validation limit/
  );

  // 2. Empty warehouse guard: must return structured 6-part insufficientData answer without calling LLM or fabricating metrics
  await duckdbEngine.clearAllTables();
  const emptyAnswer = await askBiAssistant('What were our highest revenue categories?');
  assert.equal(emptyAnswer.insufficientData, true);
  assert.equal(emptyAnswer.dataMode, 'EMPTY');
  assert.equal(emptyAnswer.toolTraces.length, 0);
  assert.equal(emptyAnswer.businessQuestion, 'What were our highest revenue categories?');
  assert.ok(emptyAnswer.analyticalResult.includes('0 rows across all tables'));
  assert.ok(emptyAnswer.supportingNumericalEvidence.length > 0);
  assert.ok(emptyAnswer.importantLimitations.length >= 1);
  assert.ok(emptyAnswer.correlationVsCausationNote.length > 10);

  // Restore clean demonstration dataset so warehouse remains populated
  await duckdbEngine.seedDemonstrationData();
});

test('Decision Lab Statistical Primitives: Welch t-test, Two-Proportion z-test, and Leave-One-Out Z/IQR Anomaly Detection', () => {
  const welch = computeWelchTTest({
    nA: 500,
    meanA: 2.35,
    stdDevA: 1.15,
    nB: 4000,
    meanB: 4.35,
    stdDevB: 0.85,
    alpha: 0.05,
    targetMdePct: 5
  });
  assert.equal(welch.isStatisticallySignificant, true);
  assert.ok(welch.pValue < 0.001, `Expected p < 0.001, got ${welch.pValue}`);
  assert.ok(welch.cohensD > 1.5, `Expected large effect size Cohen's d, got ${welch.cohensD}`);
  assert.ok(welch.achievedPowerPct >= 99);
  assert.ok(welch.powerCurve.length >= 5);

  const zTest = computeTwoProportionZTest({
    nA: 2500,
    successesA: 575,
    nB: 2500,
    successesB: 650,
    alpha: 0.05,
    targetMdePct: 10
  });
  assert.equal(zTest.isStatisticallySignificant, true);
  assert.ok(zTest.pValue < 0.05);
  assert.ok(zTest.relativeLiftPct > 10);

  const series = [100, 102, 98, 101, 99, 103, 97, 100, 104, 185, 101, 99];
  const detected = detectSeriesAnomalies(series);
  assert.equal(detected[9].isAnomaly, true, 'Expected index 9 spike (185) to trigger anomaly');
  assert.equal(detected[9].severity, 'HIGH');
  assert.equal(detected[0].isAnomaly, false);
});

test('Decision Lab Live DuckDB Suite: Anomaly Alerts, What-If Simulator, A/B Cohort Lab, Visual Lineage, and Executive Board Report', async () => {
  await duckdbEngine.ensureInitialized();
  await duckdbEngine.seedDemonstrationData();

  // 1. Statistical Anomaly Alerts (must detect planted anomalies across 24 months)
  const anomalies = await computeAnomalyAlerts();
  assert.equal(anomalies.monthsEvaluated, 24);
  assert.ok(anomalies.totalAnomalies >= 3, `Expected >= 3 anomalies, found ${anomalies.totalAnomalies}`);
  assert.ok(anomalies.highSeverityCount >= 2);
  assert.equal(anomalies.monthlySeries.length, 24);

  // 2. What-If Revenue & SLA Simulator
  const sim = await runWhatIfSimulation({
    lateDeliveryReductionPct: 40,
    freightReductionPct: 10,
    repeatRateLiftPct: 12,
    cancellationReductionPct: 35,
    targetState: 'ALL'
  });
  assert.ok(sim.baseline.annualizedGmv > 100000);
  assert.ok(sim.projectedAnnualGmvLift > 0);
  assert.ok(sim.projectedNewLateRatePct < sim.baseline.lateDeliveryRatePct);
  assert.ok(sim.projectedNewReviewScore > sim.baseline.avgReviewScore);
  assert.equal(sim.sensitivityTable.length, 3);
  assert.equal(sim.impactBreakdown.length, 4);

  // 3. Live A/B Cohort Hypothesis Lab (On-Time vs Late Review Score must be highly significant)
  const ab = await runAbCohortHypothesisTest({
    presetId: 'on_time_vs_late',
    metricKey: 'review_score',
    alpha: 0.05,
    targetMdePct: 5
  });
  assert.equal(ab.testMethod, 'WELCH_T_TEST');
  assert.equal(ab.isStatisticallySignificant, true);
  assert.equal(ab.verdict, 'SIGNIFICANT_LIFT');
  assert.ok(ab.variant.value > ab.control.value);
  assert.ok(ab.executedSql && ab.executedSql.includes('SELECT'));

  // 4. Visual Data Lineage & Metric Governance DAG
  const lineage = await computeLineageAndGovernance();
  assert.ok(lineage.nodes.length >= 20);
  assert.ok(lineage.edges.length >= 20);
  assert.equal(lineage.governanceChecks[0].status, 'PASS');

  // 5. One-Click Executive Board Report
  const report = await computeExecutiveBoardReport();
  assert.equal(report.headlineKpis.length, 6);
  assert.equal(report.observationWindow.totalMonths, 24);
  assert.ok(report.topCategories.length >= 5);
  assert.ok(report.executiveTakeaways.length >= 4);
});

test('Persistent File-Backed DuckDB Durability: persists seeded orders and custom saved SQL queries across close & reopen', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retailpulse-duckdb-'));
  const dbPath = path.join(tmpDir, 'test_warehouse.duckdb');

  try {
    // Session 1: Create file-backed warehouse, seed 5,200 orders, and save a custom SQL query
    const engine1 = new DuckDBAnalyticalEngine(dbPath);
    await engine1.ensureInitialized();
    const status1 = await engine1.getPersistenceStatus();
    assert.equal(status1.storageMode, 'PERSISTENT_FILE');
    assert.equal(status1.totalOrders, 5300);
    assert.ok(status1.fileSizeBytes > 0, 'Expected non-zero .duckdb file size on disk');

    const savedQ = await engine1.saveCustomSqlQuery({
      title: 'Durable Persistence Check',
      category: 'Sales Analysis',
      businessQuestion: 'Does my custom SQL survive server restarts?',
      sql: 'SELECT COUNT(*) AS cnt FROM fact_orders;',
      explanation: 'Counts orders.',
      expectedInterpretation: 'Returns 5300.'
    });
    await engine1.close();

    // Session 2: Re-open same .duckdb file and verify zero re-seed + custom query survived
    const engine2 = new DuckDBAnalyticalEngine(dbPath);
    await engine2.ensureInitialized();
    const status2 = await engine2.getPersistenceStatus();
    assert.equal(status2.storageMode, 'PERSISTENT_FILE');
    assert.equal(status2.totalOrders, 5300);
    assert.equal(status2.savedCustomQueriesCount, 1);

    const ws2 = await engine2.getSqlLabWorkspacePayload();
    assert.equal(ws2.savedCustomQueries[0].id, savedQ.id);
    assert.equal(ws2.savedCustomQueries[0].title, 'Durable Persistence Check');
    await engine2.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Automated Anomaly-to-Root-Cause Attribution Engine: decomposes revenue, SLA, cancellation, and regional anomalies across 3 dimensions with strict input validation', async () => {
  await duckdbEngine.ensureInitialized();
  await duckdbEngine.seedDemonstrationData();

  const anomalyPayload = await computeAnomalyAlerts();
  assert.ok(anomalyPayload.anomalies.length >= 3, 'Expected anomalies to investigate');

  // 1. Monthly revenue spike investigation
  const revAnomaly = anomalyPayload.anomalies.find((a) => a.metricKey === 'monthly_revenue');
  assert.ok(revAnomaly, 'Expected a detected monthly_revenue anomaly');
  const revRca = await investigateAnomalyRootCause({
    period: revAnomaly.period,
    metricKey: 'monthly_revenue'
  });
  assert.equal(revRca.period, revAnomaly.period);
  assert.equal(revRca.unit, 'currency');
  assert.equal(revRca.dimensions.length, 3);
  assert.ok(revRca.executiveVerdict.includes(revAnomaly.period));
  for (const dim of revRca.dimensions) {
    assert.ok(dim.drivers.length > 0, `Expected drivers for ${dim.dimensionKey}`);
    assert.ok(dim.executedSql.includes('SELECT'), `Expected SQL lineage for ${dim.dimensionKey}`);
    assert.ok(
      dim.top3ConcentrationPct >= 0 && dim.top3ConcentrationPct <= 100.1,
      `Top-3 concentration out of bounds: ${dim.top3ConcentrationPct}`
    );
  }

  // 2. Late delivery SLA spike investigation
  const slaAnomaly = anomalyPayload.anomalies.find((a) => a.metricKey === 'late_delivery_pct');
  if (slaAnomaly) {
    const slaRca = await investigateAnomalyRootCause({
      period: slaAnomaly.period,
      metricKey: 'late_delivery_pct'
    });
    assert.equal(slaRca.unit, 'percent');
    assert.equal(slaRca.dimensions.length, 3);
    assert.ok(slaRca.dimensions[0].drivers.length > 0);
  }

  // 3. Regional State SLA Outlier investigation (category, seller, payment)
  const stateRca = await investigateAnomalyRootCause({
    period: 'State BA',
    metricKey: 'state_late_delivery_pct',
    stateCode: 'BA'
  });
  assert.equal(stateRca.period, 'State BA');
  assert.equal(stateRca.dimensions.length, 3);
  assert.deepEqual(
    stateRca.dimensions.map((d) => d.dimensionKey),
    ['category', 'seller', 'payment_type']
  );

  // 4. Security & validation guardrails reject SQL injection attempts in period/state/metricKey
  await assert.rejects(
    async () => {
      await investigateAnomalyRootCause({
        period: "2025-11' OR '1'='1",
        metricKey: 'monthly_revenue'
      });
    },
    /Invalid anomaly period/
  );

  await assert.rejects(
    async () => {
      await investigateAnomalyRootCause({
        period: '2025-11',
        metricKey: 'drop_table_orders'
      });
    },
    /Unsupported root-cause metricKey/
  );
});

test('Monte Carlo Probabilistic What-If Simulator computes deterministic 5,000-trial P10/P50/P90 risk bands & 20-bin histogram', async () => {
  await duckdbEngine.ensureInitialized();
  await duckdbEngine.seedDemonstrationData();

  const scenario = {
    lateDeliveryReductionPct: 40,
    cancellationReductionPct: 30,
    repeatRateLiftPct: 12,
    freightReductionPct: 10,
    targetState: 'ALL'
  };

  const run1 = await runWhatIfSimulation(scenario);
  const run2 = await runWhatIfSimulation(scenario);

  assert.ok(run1.monteCarlo, 'Expected monteCarlo risk distribution summary on simulation payload');
  assert.equal(run1.monteCarlo.trials, 5000);
  assert.equal(run1.monteCarlo.histogram.length, 20);

  // Exact histogram trial conservation
  const totalBinTrials = run1.monteCarlo.histogram.reduce((acc, bin) => acc + bin.count, 0);
  assert.equal(totalBinTrials, 5000);

  // Monotonic quantile ordering & positive spread
  assert.ok(
    run1.monteCarlo.p10Lift <= run1.monteCarlo.p50Lift &&
      run1.monteCarlo.p50Lift <= run1.monteCarlo.p90Lift,
    `Expected P10 <= P50 <= P90, got ${run1.monteCarlo.p10Lift} / ${run1.monteCarlo.p50Lift} / ${run1.monteCarlo.p90Lift}`
  );
  assert.ok(run1.monteCarlo.stdDevLift > 0, 'Expected positive standard deviation for non-zero levers');

  // Probability bounds
  assert.ok(run1.monteCarlo.probPositivePct >= 0 && run1.monteCarlo.probPositivePct <= 100);
  assert.ok(run1.monteCarlo.probExceeds50kPct >= 0 && run1.monteCarlo.probExceeds50kPct <= 100);
  assert.ok(run1.monteCarlo.probExceeds100kPct >= 0 && run1.monteCarlo.probExceeds100kPct <= 100);
  assert.ok(run1.monteCarlo.probPositivePct >= run1.monteCarlo.probExceeds50kPct);
  assert.ok(run1.monteCarlo.probExceeds50kPct >= run1.monteCarlo.probExceeds100kPct);

  // Deterministic seed reproducibility
  assert.deepEqual(run1.monteCarlo, run2.monteCarlo);

  // Pure function zero-lever boundary check
  const zeroDist = runMonteCarloWhatIfDistribution({
    slaMeanLift: 0,
    cancellationMeanLift: 0,
    freightMeanLift: 0,
    repeatMeanLift: 0,
    scenario: {
      lateDeliveryReductionPct: 0,
      cancellationReductionPct: 0,
      repeatRateLiftPct: 0,
      freightReductionPct: 0,
      targetState: 'ALL'
    }
  });
  assert.equal(zeroDist.p50Lift, 0);
  assert.equal(zeroDist.probPositivePct, 0);
});

test('DuckDB EXPLAIN ANALYZE Query Plan Profiler parses physical operator tree, timings, and enforces read-only guard', async () => {
  await duckdbEngine.ensureInitialized();
  await duckdbEngine.seedDemonstrationData();

  const complexSql = CURATED_SQL_LIBRARY[0].sql;

  const plan = await duckdbEngine.profileReadOnlyQuery(complexSql, 250);
  assert.ok(plan.operators.length >= 2, `Expected multi-operator physical plan, got ${plan.operators.length}`);
  assert.ok(plan.totalLatencyMs >= 0, 'Expected non-negative total plan latency');
  assert.ok(plan.operatorCount === plan.operators.length);
  assert.ok(plan.hotspotOperator.length > 0, 'Expected identified CPU hotspot operator');
  assert.ok(plan.optimizationHints.length >= 1, 'Expected at least 1 optimization insight');
  assert.equal(
    plan.operators.filter((op) => op.isHotspot).length,
    1,
    'Expected exactly 1 primary hotspot operator'
  );

  // Verify read-only SQL security guard strictly blocks mutating queries from EXPLAIN ANALYZE
  await assert.rejects(
    async () => {
      await duckdbEngine.profileReadOnlyQuery('DELETE FROM orders;');
    },
    /Query must start with a read-only keyword/
  );
  await assert.rejects(
    async () => {
      await duckdbEngine.profileReadOnlyQuery('DROP TABLE orders;');
    },
    /Query must start with a read-only keyword/
  );
});

test('High-Scale Concurrency Stress: 50 simultaneous OLAP queries & BI dashboard bursts execute cleanly across DuckDB Read Pool', async () => {
  await duckdbEngine.ensureInitialized();
  await duckdbEngine.seedDemonstrationData();

  const readTasks = Array.from({ length: 40 }, (_, i) => {
    const state = i % 2 === 0 ? 'SP' : 'RJ';
    return duckdbEngine.executeReadOnlyQuery(
      `SELECT customer_state, COUNT(*) AS orders_cnt, ROUND(SUM(total_order_value), 2) AS gmv
       FROM fact_orders
       WHERE customer_state = '${state}'
       GROUP BY customer_state;`
    );
  });

  const dashboardTasks = Array.from({ length: 10 }, (_, i) =>
    computeBiDashboard(i % 2 === 0 ? 'executive-overview' : 'sales-intelligence', {})
  );

  const [sqlResults, dashResults] = await Promise.all([
    Promise.all(readTasks),
    Promise.all(dashboardTasks)
  ]);

  assert.equal(sqlResults.length, 40);
  const spExpected = sqlResults[0].rows[0].orders_cnt;
  const rjExpected = sqlResults[1].rows[0].orders_cnt;
  for (let i = 0; i < sqlResults.length; i++) {
    assert.equal(sqlResults[i].rowCount, 1);
    assert.equal(sqlResults[i].rows[0].orders_cnt, i % 2 === 0 ? spExpected : rjExpected);
  }

  assert.equal(dashResults.length, 10);
  for (const dash of dashResults) {
    assert.equal(dash.isReady, true);
    assert.equal(dash.kpis.length, 5);
  }

  const metrics = duckdbEngine.getEngineRuntimeMetrics();
  assert.ok(metrics.readPoolSize >= 2, `Expected read pool >= 2 connections, got ${metrics.readPoolSize}`);
  assert.ok(
    metrics.peakActiveReaders >= 2,
    `Expected parallel read pool utilization (>= 2 concurrent readers), got ${metrics.peakActiveReaders}`
  );
  assert.equal(metrics.activeReaders, 0, 'All read pool connections must be cleanly returned');
});

test('Thundering-Herd Protection: SingleFlightLruCache coalesces 25 concurrent requests into 1 computation and instantly invalidates on epoch bump', async () => {
  const cache = new SingleFlightLruCache({ maxEntries: 32, defaultTtlMs: 60_000 });
  let factoryCalls = 0;

  const computeExpensiveQuery = async () => {
    factoryCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { gmv: 123456.78, computedOnCall: factoryCalls };
  };

  // Fire 25 identical concurrent requests at epoch 1
  const burst = await Promise.all(
    Array.from({ length: 25 }, () => cache.getOrCompute(1, 'dashboard:executive', computeExpensiveQuery))
  );

  assert.equal(factoryCalls, 1, 'Single-flight coalescing must invoke factory exactly ONCE for 25 simultaneous callers');
  assert.equal(burst.filter((r) => r.cacheStatus === 'MISS').length, 1);
  assert.equal(burst.filter((r) => r.cacheStatus === 'COALESCED').length, 24);
  for (const r of burst) {
    assert.equal(r.value.gmv, 123456.78);
  }

  // Subsequent request at same epoch must be an immediate LRU HIT
  const cachedRead = await cache.getOrCompute(1, 'dashboard:executive', computeExpensiveQuery);
  assert.equal(cachedRead.cacheStatus, 'HIT');
  assert.equal(factoryCalls, 1);

  // Epoch bump (simulating CSV upload or remediation) must immediately invalidate prior cache
  const postMutation = await cache.getOrCompute(2, 'dashboard:executive', computeExpensiveQuery);
  assert.equal(postMutation.cacheStatus, 'MISS');
  assert.equal(factoryCalls, 2);
  assert.equal(postMutation.value.computedOnCall, 2);

  // Verify ConcurrencyBulkhead sheds load cleanly when capacity + queue are saturated
  const tightBulkhead = new ConcurrencyBulkhead({
    name: 'test-tight',
    maxConcurrent: 1,
    maxQueue: 1,
    queueTimeoutMs: 5000
  });
  const release1 = await tightBulkhead.acquire();
  const queuedPromise = tightBulkhead.acquire();
  await assert.rejects(() => tightBulkhead.acquire(), /SERVER_BUSY:test-tight/);
  release1();
  const release2 = await queuedPromise;
  release2();
  assert.equal(tightBulkhead.getStats().rejectedTotal, 1);
});

test('Large-Dataset ETL Stress: 10,000-row chunked transactional CSV upload + concurrent upload serialize cleanly via write lock', async () => {
  await duckdbEngine.ensureInitialized();
  const epochBefore = duckdbEngine.getWarehouseEpoch();

  // Generate 10,000 realistic Olist customer rows
  const customerLines = [
    'customer_id,customer_unique_id,customer_zip_code_prefix,customer_city,customer_state'
  ];
  const states = ['SP', 'RJ', 'MG', 'RS', 'PR', 'BA', 'SC', 'DF'];
  for (let i = 1; i <= 10_000; i++) {
    const st = states[i % states.length];
    customerLines.push(
      `bulk_cust_${i},bulk_uniq_${Math.ceil(i / 2)},${String(10000 + (i % 89999))},cidade_${i % 100},${st}`
    );
  }
  const bulkCustomersCsv = customerLines.join('\n');

  // Generate 500 sellers to upload simultaneously against the write mutex
  const sellerLines = ['seller_id,seller_zip_code_prefix,seller_city,seller_state'];
  for (let i = 1; i <= 500; i++) {
    sellerLines.push(`bulk_sell_${i},${String(20000 + i)},sao paulo,${states[i % states.length]}`);
  }
  const bulkSellersCsv = sellerLines.join('\n');

  const [custUpload, sellUpload] = await Promise.all([
    duckdbEngine.ingestCsv('customers', bulkCustomersCsv, 'replace', 'olist_customers_dataset.csv'),
    duckdbEngine.ingestCsv('sellers', bulkSellersCsv, 'replace', 'olist_sellers_dataset.csv')
  ]);

  assert.equal(custUpload.rowsInserted, 10_000);
  assert.equal(custUpload.rejectedRowsCount, 0);
  assert.equal(sellUpload.rowsInserted, 500);
  assert.equal(sellUpload.rejectedRowsCount, 0);

  const countCheck = await duckdbEngine.executeReadOnlyQuery(
    'SELECT (SELECT COUNT(*) FROM customers) AS cust_cnt, (SELECT COUNT(*) FROM sellers) AS sell_cnt;'
  );
  assert.equal(countCheck.rows[0].cust_cnt, 10_000);
  assert.equal(countCheck.rows[0].sell_cnt, 500);
  assert.ok(
    duckdbEngine.getWarehouseEpoch() >= epochBefore + 2,
    'Each transactional CSV ingestion must advance warehouseEpoch monotonically'
  );

  // Restore standard demonstration dataset for clean suite exit
  await duckdbEngine.seedDemonstrationData();
});








