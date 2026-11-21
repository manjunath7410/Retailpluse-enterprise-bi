import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSqlQuery,
  validateCsvInput,
  validateCsvFileMetadata,
  detectOlistTableFromFileAndHeaders,
  isValidDateOrTimestamp,
  normalizeCsvHeader,
  computeModuleReadiness,
  formatAnalyticalMetric,
  convertRowsToCsv
} from './validators';
import { MODULE_REGISTRY, getModuleById } from '../config/modules';

test('normalizeCsvHeader strips UTF-8 BOM, quotes, and whitespace', () => {
  assert.equal(normalizeCsvHeader('\uFEFF"product_category_name" '), 'product_category_name');
  assert.equal(normalizeCsvHeader("'order_id'"), 'order_id');
});

test('detectOlistTableFromFileAndHeaders detects all 8 Olist CSV files + geolocation by filename and headers', () => {
  assert.equal(detectOlistTableFromFileAndHeaders('olist_orders_dataset.csv', []), 'orders');
  assert.equal(detectOlistTableFromFileAndHeaders('olist_customers_dataset.csv', []), 'customers');
  assert.equal(detectOlistTableFromFileAndHeaders('olist_order_items_dataset.csv', []), 'order_items');
  assert.equal(detectOlistTableFromFileAndHeaders('olist_order_payments_dataset.csv', []), 'payments');
  assert.equal(detectOlistTableFromFileAndHeaders('olist_order_reviews_dataset.csv', []), 'reviews');
  assert.equal(detectOlistTableFromFileAndHeaders('olist_products_dataset.csv', []), 'products');
  assert.equal(detectOlistTableFromFileAndHeaders('olist_sellers_dataset.csv', []), 'sellers');
  assert.equal(
    detectOlistTableFromFileAndHeaders('product_category_name_translation.csv', []),
    'category_translations'
  );
  assert.equal(
    detectOlistTableFromFileAndHeaders('olist_geolocation_dataset.csv', []),
    'geolocation'
  );

  // Header-based detection when filename is generic
  assert.equal(
    detectOlistTableFromFileAndHeaders('export1.csv', [
      'product_category_name',
      'product_category_name_english'
    ]),
    'category_translations'
  );
  assert.equal(
    detectOlistTableFromFileAndHeaders('export2.csv', [
      'order_id',
      'payment_sequential',
      'payment_type',
      'payment_value'
    ]),
    'payments'
  );
  assert.equal(
    detectOlistTableFromFileAndHeaders('export3.csv', [
      'order_id',
      'order_item_id',
      'product_id',
      'seller_id'
    ]),
    'order_items'
  );
  assert.equal(detectOlistTableFromFileAndHeaders('unknown.csv', ['foo', 'bar']), null);
});

test('validateCsvFileMetadata validates file extension and size bounds', () => {
  assert.equal(validateCsvFileMetadata('olist_orders_dataset.csv', 1024).valid, true);
  assert.equal(validateCsvFileMetadata('archive.xlsx', 1024).valid, false);
  assert.equal(validateCsvFileMetadata('empty.csv', 0).valid, false);
  assert.equal(validateCsvFileMetadata('huge.csv', 250 * 1024 * 1024, 200 * 1024 * 1024).valid, false);
});

test('isValidDateOrTimestamp validates ISO and Olist timestamps and rejects invalid calendar dates', () => {
  assert.equal(isValidDateOrTimestamp('2017-10-02 10:56:33'), true);
  assert.equal(isValidDateOrTimestamp('2018-07-24'), true);
  assert.equal(isValidDateOrTimestamp('2018-02-30 10:00:00'), false);
  assert.equal(isValidDateOrTimestamp('2018-99-45 25:00:00'), false);
  assert.equal(isValidDateOrTimestamp('not-a-timestamp'), false);
  assert.equal(isValidDateOrTimestamp(''), false);
});

test('validateSqlQuery allows valid SELECT and WITH analytical queries', () => {
  const selectRes = validateSqlQuery('SELECT order_id, order_status FROM orders LIMIT 10;');
  assert.equal(selectRes.valid, true);
  assert.equal(selectRes.normalizedValue, 'SELECT order_id, order_status FROM orders LIMIT 10');

  const cteRes = validateSqlQuery(`
    -- Monthly revenue CTE
    WITH monthly AS (SELECT * FROM orders)
    SELECT COUNT(*) FROM monthly;
  `);
  assert.equal(cteRes.valid, true);
});

test('validateSqlQuery blocks empty, stacked, or mutating DDL/DML statements', () => {
  assert.equal(validateSqlQuery('   ').valid, false);
  assert.equal(validateSqlQuery('-- only a comment').valid, false);
  assert.equal(validateSqlQuery('SELECT 1; DROP TABLE orders;').valid, false);
  assert.equal(validateSqlQuery('DROP TABLE orders').valid, false);
  assert.equal(validateSqlQuery('DELETE FROM orders WHERE 1=1').valid, false);
  assert.equal(validateSqlQuery('SELECT * FROM orders; SELECT * FROM customers').valid, false);
  assert.equal(validateSqlQuery('INSERT INTO orders VALUES (1)').valid, false);
});

test('validateSqlQuery permits keywords inside string literals', () => {
  const res = validateSqlQuery("SELECT * FROM orders WHERE order_status = 'DELETE_REQUESTED'");
  assert.equal(res.valid, true);
});

test('validateCsvInput validates table names, headers, and data rows', () => {
  const allowed = ['orders', 'customers'];
  const expectedCols = ['order_id', 'customer_id', 'order_status'];

  const validCsv =
    'order_id,customer_id,order_status\nord_1,cust_1,delivered\nord_2,cust_2,shipped';
  const res = validateCsvInput('orders', validCsv, allowed, expectedCols);
  assert.equal(res.valid, true);
  assert.equal(res.estimatedRowCount, 2);
  assert.deepEqual(res.headers, ['order_id', 'customer_id', 'order_status']);

  const badTable = validateCsvInput('unknown_table', validCsv, allowed, expectedCols);
  assert.equal(badTable.valid, false);

  const headerOnly = validateCsvInput('orders', 'order_id,customer_id', allowed, expectedCols);
  assert.equal(headerOnly.valid, false);

  const mismatchedCols = validateCsvInput('orders', 'foo,bar\n1,2', allowed, expectedCols);
  assert.equal(mismatchedCols.valid, false);
});

test('computeModuleReadiness calculates accurate table readiness percentages', () => {
  const statuses = [
    { tableName: 'orders', rowCount: 25 },
    { tableName: 'order_items', rowCount: 40 },
    { tableName: 'customers', rowCount: 0 },
    { tableName: 'payments', rowCount: 25 }
  ];

  const partial = computeModuleReadiness(
    ['orders', 'order_items', 'customers', 'payments'],
    statuses
  );
  assert.equal(partial.isReady, false);
  assert.equal(partial.readyCount, 3);
  assert.equal(partial.totalRequired, 4);
  assert.equal(partial.readinessPercent, 75);
  assert.deepEqual(partial.missingTables, ['customers']);

  const full = computeModuleReadiness(['orders', 'payments'], statuses);
  assert.equal(full.isReady, true);
  assert.equal(full.readinessPercent, 100);
  assert.deepEqual(full.missingTables, []);
});

test('formatAnalyticalMetric formats values without fabricating missing data', () => {
  assert.equal(formatAnalyticalMetric(null, 'currency'), '—');
  assert.equal(formatAnalyticalMetric(undefined, 'number'), '—');
  assert.equal(formatAnalyticalMetric(1250.5, 'currency'), '$1,250.50');
  assert.equal(formatAnalyticalMetric(94.26, 'percent'), '94.3%');
  assert.equal(formatAnalyticalMetric(4.65, 'score'), '4.65 / 5.00');
  assert.equal(formatAnalyticalMetric(14200, 'number'), '14,200');
});

test('convertRowsToCsv escapes commas and quotes properly', () => {
  const cols = [{ name: 'order_id' }, { name: 'note' }];
  const rows = [
    { order_id: 'ORD-01', note: 'Fast, reliable delivery' },
    { order_id: 'ORD-02', note: 'Includes "Fragile" label' }
  ];
  const csv = convertRowsToCsv(cols, rows);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'order_id,note');
  assert.equal(lines[1], 'ORD-01,"Fast, reliable delivery"');
  assert.equal(lines[2], 'ORD-02,"Includes ""Fragile"" label"');
});

test('MODULE_REGISTRY contains all 13 required enterprise modules with valid routes', () => {
  assert.equal(MODULE_REGISTRY.length, 13);
  const executive = getModuleById('executive-overview');
  assert.ok(executive);
  assert.equal(executive.route, '/executive-overview');

  const decisionLab = getModuleById('decision-lab');
  assert.ok(decisionLab);
  assert.equal(decisionLab.route, '/decision-lab');

  for (const mod of MODULE_REGISTRY) {
    const sqlValidation = validateSqlQuery(mod.defaultSql);
    assert.equal(
      sqlValidation.valid,
      true,
      `Module ${mod.id} defaultSql should be valid read-only SQL`
    );
  }
});
