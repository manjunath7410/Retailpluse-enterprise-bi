import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { parse } from 'csv-parse/sync';
import {
  AnalyticalModelMetadata,
  ColumnSchema,
  CustomerIdentityAudit,
  DataMode,
  DataQualityAndModelingPayload,
  DataQualityIssueReportItem,
  ImportBatchReport,
  IngestionSummaryPayload,
  KpiDictionaryEntry,
  ModuleId,
  ModuleMetricItem,
  ModulePreviewPayload,
  OlistTableKey,
  QualityCheckItem,
  RejectedRecordItem,
  RelationshipVerificationItem,
  RemediationResultPayload,
  SaveCustomSqlQueryRequest,
  SavedCustomSqlQuery,
  SqlBenchmarkMetricComparison,
  SqlBenchmarkVerificationItem,
  SqlExecutionHistoryItem,
  SqlLabWorkspacePayload,
  SqlPlanOperatorNode,
  SqlQueryPlanProfile,
  SqlQueryResult,
  TableQualitySummary,
  TableStatus,
  WarehousePersistenceStatus
} from '../../src/types/analytics';
import {
  BENCHMARK_DATASET_VERSION,
  generateProductionBenchmarkBatches
} from './seedDemoData';
import { ANALYTICAL_MODEL_DEFINITIONS, KPI_DICTIONARY_DEFINITIONS } from './analyticalModels';
import { getModuleById } from '../../src/config/modules';
import {
  CURATED_SQL_LIBRARY,
  REQUIRED_SQL_CONCEPTS,
  SQL_QUERY_CATEGORIES
} from '../../src/config/sqlCatalog';
import {
  detectOlistTableFromFileAndHeaders,
  isValidDateOrTimestamp,
  normalizeCsvHeader,
  validateSqlQuery
} from '../../src/utils/validators';

export interface TableDefinition {
  tableName: OlistTableKey;
  stagingTableName: string;
  expectedOlistFilename: string;
  isOptional?: boolean;
  displayName: string;
  grainDescription: string;
  description: string;
  stagingDdl: string;
  ddl: string;
  primaryKeyColumns: string[];
  requiredColumns: string[];
  dateColumns: { name: string; required: boolean }[];
  numericColumns: { name: string; type: 'INTEGER' | 'DOUBLE'; allowNegative?: boolean }[];
  columns: ColumnSchema[];
}

export const TABLE_DEFINITIONS: TableDefinition[] = [
  {
    tableName: 'orders',
    stagingTableName: 'stg_orders',
    expectedOlistFilename: 'olist_orders_dataset.csv',
    displayName: 'Olist Orders Dataset',
    grainDescription: '1 row per order_id',
    description:
      'Core order lifecycle timestamps, approval dates, carrier handoff, actual delivery, and customer foreign keys.',
    stagingDdl: `CREATE TABLE IF NOT EXISTS stg_orders (
      order_id VARCHAR,
      customer_id VARCHAR,
      order_status VARCHAR,
      order_purchase_timestamp VARCHAR,
      order_approved_at VARCHAR,
      order_delivered_carrier_date VARCHAR,
      order_delivered_customer_date VARCHAR,
      order_estimated_delivery_date VARCHAR,
      _ingest_batch_id VARCHAR,
      _source_filename VARCHAR,
      _row_number INTEGER,
      _ingested_at VARCHAR
    );`,
    ddl: `CREATE TABLE IF NOT EXISTS orders (
      order_id VARCHAR PRIMARY KEY,
      customer_id VARCHAR NOT NULL,
      order_status VARCHAR NOT NULL,
      order_purchase_timestamp VARCHAR NOT NULL,
      order_approved_at VARCHAR,
      order_delivered_carrier_date VARCHAR,
      order_delivered_customer_date VARCHAR,
      order_estimated_delivery_date VARCHAR
    );`,
    primaryKeyColumns: ['order_id'],
    requiredColumns: ['order_id', 'customer_id', 'order_status', 'order_purchase_timestamp'],
    dateColumns: [
      { name: 'order_purchase_timestamp', required: true },
      { name: 'order_approved_at', required: false },
      { name: 'order_delivered_carrier_date', required: false },
      { name: 'order_delivered_customer_date', required: false },
      { name: 'order_estimated_delivery_date', required: false }
    ],
    numericColumns: [],
    columns: [
      { name: 'order_id', type: 'VARCHAR', nullable: false, description: 'Unique order identifier (PK)', isPrimaryKey: true },
      { name: 'customer_id', type: 'VARCHAR', nullable: false, description: 'Order-scoped customer key (FK -> customers.customer_id)', foreignKeyTo: 'customers.customer_id' },
      { name: 'order_status', type: 'VARCHAR', nullable: false, description: 'Order status (delivered, shipped, canceled, etc.)' },
      { name: 'order_purchase_timestamp', type: 'VARCHAR', nullable: false, description: 'Purchase timestamp' },
      { name: 'order_approved_at', type: 'VARCHAR', nullable: true, description: 'Payment approval timestamp' },
      { name: 'order_delivered_carrier_date', type: 'VARCHAR', nullable: true, description: 'Logistics carrier handoff timestamp' },
      { name: 'order_delivered_customer_date', type: 'VARCHAR', nullable: true, description: 'Actual customer delivery timestamp' },
      { name: 'order_estimated_delivery_date', type: 'VARCHAR', nullable: true, description: 'Estimated delivery date communicated at purchase' }
    ]
  },
  {
    tableName: 'customers',
    stagingTableName: 'stg_customers',
    expectedOlistFilename: 'olist_customers_dataset.csv',
    displayName: 'Olist Customers Dataset',
    grainDescription: '1 row per order-scoped customer_id (maps to customer_unique_id)',
    description:
      'Order-scoped customer_id keys, permanent customer_unique_id buyer entities, Brazilian zip prefixes, cities, and states.',
    stagingDdl: `CREATE TABLE IF NOT EXISTS stg_customers (
      customer_id VARCHAR,
      customer_unique_id VARCHAR,
      customer_zip_code_prefix VARCHAR,
      customer_city VARCHAR,
      customer_state VARCHAR,
      customer_segment VARCHAR,
      _ingest_batch_id VARCHAR,
      _source_filename VARCHAR,
      _row_number INTEGER,
      _ingested_at VARCHAR
    );`,
    ddl: `CREATE TABLE IF NOT EXISTS customers (
      customer_id VARCHAR PRIMARY KEY,
      customer_unique_id VARCHAR NOT NULL,
      customer_zip_code_prefix VARCHAR,
      customer_city VARCHAR,
      customer_state VARCHAR,
      customer_segment VARCHAR
    );`,
    primaryKeyColumns: ['customer_id'],
    requiredColumns: ['customer_id', 'customer_unique_id'],
    dateColumns: [],
    numericColumns: [],
    columns: [
      { name: 'customer_id', type: 'VARCHAR', nullable: false, description: 'Order-scoped customer key (PK)', isPrimaryKey: true },
      { name: 'customer_unique_id', type: 'VARCHAR', nullable: false, description: 'Permanent customer entity identifier' },
      { name: 'customer_zip_code_prefix', type: 'VARCHAR', nullable: true, description: 'First 5 digits of customer zip code' },
      { name: 'customer_city', type: 'VARCHAR', nullable: true, description: 'Customer city name' },
      { name: 'customer_state', type: 'VARCHAR', nullable: true, description: 'Customer Brazilian state code (SP, RJ, MG, etc.)' },
      { name: 'customer_segment', type: 'VARCHAR', nullable: true, description: 'Optional account segment label' }
    ]
  },
  {
    tableName: 'order_items',
    stagingTableName: 'stg_order_items',
    expectedOlistFilename: 'olist_order_items_dataset.csv',
    displayName: 'Olist Order Items Dataset',
    grainDescription: '1 row per (order_id, order_item_id) line item',
    description:
      'Individual items purchased within each order, linking orders to products and sellers with item price and freight value.',
    stagingDdl: `CREATE TABLE IF NOT EXISTS stg_order_items (
      order_id VARCHAR,
      order_item_id VARCHAR,
      product_id VARCHAR,
      seller_id VARCHAR,
      shipping_limit_date VARCHAR,
      price VARCHAR,
      freight_value VARCHAR,
      _ingest_batch_id VARCHAR,
      _source_filename VARCHAR,
      _row_number INTEGER,
      _ingested_at VARCHAR
    );`,
    ddl: `CREATE TABLE IF NOT EXISTS order_items (
      order_id VARCHAR NOT NULL,
      order_item_id INTEGER NOT NULL,
      product_id VARCHAR NOT NULL,
      seller_id VARCHAR NOT NULL,
      shipping_limit_date VARCHAR,
      price DOUBLE NOT NULL,
      freight_value DOUBLE NOT NULL
    );`,
    primaryKeyColumns: ['order_id', 'order_item_id'],
    requiredColumns: ['order_id', 'order_item_id', 'product_id', 'seller_id', 'price', 'freight_value'],
    dateColumns: [{ name: 'shipping_limit_date', required: false }],
    numericColumns: [
      { name: 'order_item_id', type: 'INTEGER' },
      { name: 'price', type: 'DOUBLE' },
      { name: 'freight_value', type: 'DOUBLE' }
    ],
    columns: [
      { name: 'order_id', type: 'VARCHAR', nullable: false, description: 'Order identifier (FK -> orders.order_id)', isPrimaryKey: true, foreignKeyTo: 'orders.order_id' },
      { name: 'order_item_id', type: 'INTEGER', nullable: false, description: 'Sequential item number within order (1..N)', isPrimaryKey: true },
      { name: 'product_id', type: 'VARCHAR', nullable: false, description: 'Product identifier (FK -> products.product_id)', foreignKeyTo: 'products.product_id' },
      { name: 'seller_id', type: 'VARCHAR', nullable: false, description: 'Seller identifier (FK -> sellers.seller_id)', foreignKeyTo: 'sellers.seller_id' },
      { name: 'shipping_limit_date', type: 'VARCHAR', nullable: true, description: 'Seller shipping handoff deadline' },
      { name: 'price', type: 'DOUBLE', nullable: false, description: 'Item merchandise price' },
      { name: 'freight_value', type: 'DOUBLE', nullable: false, description: 'Item freight value' }
    ]
  },
  {
    tableName: 'payments',
    stagingTableName: 'stg_payments',
    expectedOlistFilename: 'olist_order_payments_dataset.csv',
    displayName: 'Olist Order Payments Dataset',
    grainDescription: '1 row per (order_id, payment_sequential) settlement method',
    description:
      'Order payment settlements and installment splits. One order can have multiple payment records (e.g. credit_card + voucher).',
    stagingDdl: `CREATE TABLE IF NOT EXISTS stg_payments (
      order_id VARCHAR,
      payment_sequential VARCHAR,
      payment_type VARCHAR,
      payment_installments VARCHAR,
      payment_value VARCHAR,
      _ingest_batch_id VARCHAR,
      _source_filename VARCHAR,
      _row_number INTEGER,
      _ingested_at VARCHAR
    );`,
    ddl: `CREATE TABLE IF NOT EXISTS payments (
      order_id VARCHAR NOT NULL,
      payment_sequential INTEGER NOT NULL,
      payment_type VARCHAR NOT NULL,
      payment_installments INTEGER NOT NULL,
      payment_value DOUBLE NOT NULL
    );`,
    primaryKeyColumns: ['order_id', 'payment_sequential'],
    requiredColumns: ['order_id', 'payment_sequential', 'payment_type', 'payment_installments', 'payment_value'],
    dateColumns: [],
    numericColumns: [
      { name: 'payment_sequential', type: 'INTEGER' },
      { name: 'payment_installments', type: 'INTEGER' },
      { name: 'payment_value', type: 'DOUBLE' }
    ],
    columns: [
      { name: 'order_id', type: 'VARCHAR', nullable: false, description: 'Order identifier (FK -> orders.order_id)', isPrimaryKey: true, foreignKeyTo: 'orders.order_id' },
      { name: 'payment_sequential', type: 'INTEGER', nullable: false, description: 'Sequence of payment method on the order', isPrimaryKey: true },
      { name: 'payment_type', type: 'VARCHAR', nullable: false, description: 'Payment method (credit_card, boleto, voucher, debit_card)' },
      { name: 'payment_installments', type: 'INTEGER', nullable: false, description: 'Number of installments chosen' },
      { name: 'payment_value', type: 'DOUBLE', nullable: false, description: 'Transaction settlement value' }
    ]
  },
  {
    tableName: 'reviews',
    stagingTableName: 'stg_reviews',
    expectedOlistFilename: 'olist_order_reviews_dataset.csv',
    displayName: 'Olist Order Reviews Dataset',
    grainDescription: '1 row per (review_id, order_id) customer evaluation',
    description:
      'Customer satisfaction scores (1-5), review titles, comment messages, creation dates, and answer timestamps.',
    stagingDdl: `CREATE TABLE IF NOT EXISTS stg_reviews (
      review_id VARCHAR,
      order_id VARCHAR,
      review_score VARCHAR,
      review_comment_title VARCHAR,
      review_comment_message VARCHAR,
      review_creation_date VARCHAR,
      review_answer_timestamp VARCHAR,
      _ingest_batch_id VARCHAR,
      _source_filename VARCHAR,
      _row_number INTEGER,
      _ingested_at VARCHAR
    );`,
    ddl: `CREATE TABLE IF NOT EXISTS reviews (
      review_id VARCHAR NOT NULL,
      order_id VARCHAR NOT NULL,
      review_score INTEGER NOT NULL,
      review_comment_title VARCHAR,
      review_comment_message VARCHAR,
      review_creation_date VARCHAR,
      review_answer_timestamp VARCHAR
    );`,
    primaryKeyColumns: ['review_id', 'order_id'],
    requiredColumns: ['review_id', 'order_id', 'review_score'],
    dateColumns: [
      { name: 'review_creation_date', required: false },
      { name: 'review_answer_timestamp', required: false }
    ],
    numericColumns: [{ name: 'review_score', type: 'INTEGER' }],
    columns: [
      { name: 'review_id', type: 'VARCHAR', nullable: false, description: 'Unique review identifier', isPrimaryKey: true },
      { name: 'order_id', type: 'VARCHAR', nullable: false, description: 'Order identifier (FK -> orders.order_id)', isPrimaryKey: true, foreignKeyTo: 'orders.order_id' },
      { name: 'review_score', type: 'INTEGER', nullable: false, description: 'Satisfaction rating from 1 to 5' },
      { name: 'review_comment_title', type: 'VARCHAR', nullable: true, description: 'Comment title left by user' },
      { name: 'review_comment_message', type: 'VARCHAR', nullable: true, description: 'Detailed review message body' },
      { name: 'review_creation_date', type: 'VARCHAR', nullable: true, description: 'Survey creation timestamp' },
      { name: 'review_answer_timestamp', type: 'VARCHAR', nullable: true, description: 'Survey submission answer timestamp' }
    ]
  },
  {
    tableName: 'products',
    stagingTableName: 'stg_products',
    expectedOlistFilename: 'olist_products_dataset.csv',
    displayName: 'Olist Products Dataset',
    grainDescription: '1 row per product_id',
    description:
      'Product catalog with Portuguese category names (joining to category_translations), dimensions (cm), weight (g), and photo counts.',
    stagingDdl: `CREATE TABLE IF NOT EXISTS stg_products (
      product_id VARCHAR,
      product_category_name VARCHAR,
      product_name VARCHAR,
      product_name_lenght VARCHAR,
      product_description_lenght VARCHAR,
      product_photos_qty VARCHAR,
      product_weight_g VARCHAR,
      product_length_cm VARCHAR,
      product_height_cm VARCHAR,
      product_width_cm VARCHAR,
      unit_cost_estimate VARCHAR,
      _ingest_batch_id VARCHAR,
      _source_filename VARCHAR,
      _row_number INTEGER,
      _ingested_at VARCHAR
    );`,
    ddl: `CREATE TABLE IF NOT EXISTS products (
      product_id VARCHAR PRIMARY KEY,
      product_category_name VARCHAR,
      product_name VARCHAR,
      product_name_lenght INTEGER,
      product_description_lenght INTEGER,
      product_photos_qty INTEGER,
      product_weight_g INTEGER,
      product_length_cm INTEGER,
      product_height_cm INTEGER,
      product_width_cm INTEGER,
      unit_cost_estimate DOUBLE
    );`,
    primaryKeyColumns: ['product_id'],
    requiredColumns: ['product_id'],
    dateColumns: [],
    numericColumns: [
      { name: 'product_name_lenght', type: 'INTEGER' },
      { name: 'product_description_lenght', type: 'INTEGER' },
      { name: 'product_photos_qty', type: 'INTEGER' },
      { name: 'product_weight_g', type: 'INTEGER' },
      { name: 'product_length_cm', type: 'INTEGER' },
      { name: 'product_height_cm', type: 'INTEGER' },
      { name: 'product_width_cm', type: 'INTEGER' },
      { name: 'unit_cost_estimate', type: 'DOUBLE' }
    ],
    columns: [
      { name: 'product_id', type: 'VARCHAR', nullable: false, description: 'Unique product identifier (PK)', isPrimaryKey: true },
      { name: 'product_category_name', type: 'VARCHAR', nullable: true, description: 'Root category in Portuguese (FK -> category_translations)', foreignKeyTo: 'category_translations.product_category_name' },
      { name: 'product_name', type: 'VARCHAR', nullable: true, description: 'Optional display label' },
      { name: 'product_name_lenght', type: 'INTEGER', nullable: true, description: 'Number of characters in product name (Olist column)' },
      { name: 'product_description_lenght', type: 'INTEGER', nullable: true, description: 'Number of characters in product description' },
      { name: 'product_photos_qty', type: 'INTEGER', nullable: true, description: 'Number of published product photos' },
      { name: 'product_weight_g', type: 'INTEGER', nullable: true, description: 'Product weight in grams' },
      { name: 'product_length_cm', type: 'INTEGER', nullable: true, description: 'Product length in centimeters' },
      { name: 'product_height_cm', type: 'INTEGER', nullable: true, description: 'Product height in centimeters' },
      { name: 'product_width_cm', type: 'INTEGER', nullable: true, description: 'Product width in centimeters' },
      { name: 'unit_cost_estimate', type: 'DOUBLE', nullable: true, description: 'Optional unit cost baseline' }
    ]
  },
  {
    tableName: 'sellers',
    stagingTableName: 'stg_sellers',
    expectedOlistFilename: 'olist_sellers_dataset.csv',
    displayName: 'Olist Sellers Dataset',
    grainDescription: '1 row per seller_id',
    description:
      'Merchant fulfillment partners fulfilling order items, with Brazilian postal prefix, city, and state.',
    stagingDdl: `CREATE TABLE IF NOT EXISTS stg_sellers (
      seller_id VARCHAR,
      seller_zip_code_prefix VARCHAR,
      seller_city VARCHAR,
      seller_state VARCHAR,
      seller_name VARCHAR,
      fulfillment_tier VARCHAR,
      _ingest_batch_id VARCHAR,
      _source_filename VARCHAR,
      _row_number INTEGER,
      _ingested_at VARCHAR
    );`,
    ddl: `CREATE TABLE IF NOT EXISTS sellers (
      seller_id VARCHAR PRIMARY KEY,
      seller_zip_code_prefix VARCHAR,
      seller_city VARCHAR,
      seller_state VARCHAR,
      seller_name VARCHAR,
      fulfillment_tier VARCHAR
    );`,
    primaryKeyColumns: ['seller_id'],
    requiredColumns: ['seller_id'],
    dateColumns: [],
    numericColumns: [],
    columns: [
      { name: 'seller_id', type: 'VARCHAR', nullable: false, description: 'Unique seller identifier (PK)', isPrimaryKey: true },
      { name: 'seller_zip_code_prefix', type: 'VARCHAR', nullable: true, description: 'First 5 digits of seller zip code' },
      { name: 'seller_city', type: 'VARCHAR', nullable: true, description: 'Seller city name' },
      { name: 'seller_state', type: 'VARCHAR', nullable: true, description: 'Seller state code' },
      { name: 'seller_name', type: 'VARCHAR', nullable: true, description: 'Optional merchant name' },
      { name: 'fulfillment_tier', type: 'VARCHAR', nullable: true, description: 'Optional merchant tier' }
    ]
  },
  {
    tableName: 'category_translations',
    stagingTableName: 'stg_category_translations',
    expectedOlistFilename: 'product_category_name_translation.csv',
    displayName: 'Product Category Name Translation',
    grainDescription: '1 row per product_category_name',
    description:
      'Maps Portuguese product_category_name values from olist_products_dataset.csv to English category names.',
    stagingDdl: `CREATE TABLE IF NOT EXISTS stg_category_translations (
      product_category_name VARCHAR,
      product_category_name_english VARCHAR,
      _ingest_batch_id VARCHAR,
      _source_filename VARCHAR,
      _row_number INTEGER,
      _ingested_at VARCHAR
    );`,
    ddl: `CREATE TABLE IF NOT EXISTS category_translations (
      product_category_name VARCHAR PRIMARY KEY,
      product_category_name_english VARCHAR NOT NULL
    );`,
    primaryKeyColumns: ['product_category_name'],
    requiredColumns: ['product_category_name', 'product_category_name_english'],
    dateColumns: [],
    numericColumns: [],
    columns: [
      { name: 'product_category_name', type: 'VARCHAR', nullable: false, description: 'Category name in Portuguese (PK)', isPrimaryKey: true },
      { name: 'product_category_name_english', type: 'VARCHAR', nullable: false, description: 'Category name translated to English' }
    ]
  },
  {
    tableName: 'geolocation',
    stagingTableName: 'stg_geolocation',
    expectedOlistFilename: 'olist_geolocation_dataset.csv',
    isOptional: true,
    displayName: 'Olist Geolocation Dataset (Optional)',
    grainDescription: 'Coordinate samples per Brazilian zip_code_prefix',
    description:
      'Optional zip code prefix latitude/longitude coordinate mapping for spatial logistics analysis.',
    stagingDdl: `CREATE TABLE IF NOT EXISTS stg_geolocation (
      geolocation_zip_code_prefix VARCHAR,
      geolocation_lat VARCHAR,
      geolocation_lng VARCHAR,
      geolocation_city VARCHAR,
      geolocation_state VARCHAR,
      _ingest_batch_id VARCHAR,
      _source_filename VARCHAR,
      _row_number INTEGER,
      _ingested_at VARCHAR
    );`,
    ddl: `CREATE TABLE IF NOT EXISTS geolocation (
      geolocation_zip_code_prefix VARCHAR NOT NULL,
      geolocation_lat DOUBLE NOT NULL,
      geolocation_lng DOUBLE NOT NULL,
      geolocation_city VARCHAR,
      geolocation_state VARCHAR
    );`,
    primaryKeyColumns: [],
    requiredColumns: ['geolocation_zip_code_prefix', 'geolocation_lat', 'geolocation_lng'],
    dateColumns: [],
    numericColumns: [
      { name: 'geolocation_lat', type: 'DOUBLE', allowNegative: true },
      { name: 'geolocation_lng', type: 'DOUBLE', allowNegative: true }
    ],
    columns: [
      { name: 'geolocation_zip_code_prefix', type: 'VARCHAR', nullable: false, description: 'First 5 digits of zip code' },
      { name: 'geolocation_lat', type: 'DOUBLE', nullable: false, description: 'Latitude coordinate' },
      { name: 'geolocation_lng', type: 'DOUBLE', nullable: false, description: 'Longitude coordinate' },
      { name: 'geolocation_city', type: 'VARCHAR', nullable: true, description: 'City name' },
      { name: 'geolocation_state', type: 'VARCHAR', nullable: true, description: 'State code' }
    ]
  }
];

function serializeValue(val: unknown): string | number | boolean | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') return String(val);
  return String(val);
}

function sqlLiteral(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : 'NULL';
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

function resolveDefaultDuckDbPath(): string {
  if (process.env.DUCKDB_PATH && process.env.DUCKDB_PATH.trim().length > 0) {
    return process.env.DUCKDB_PATH.trim();
  }
  const isTestRun =
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.argv.some((arg) => arg.includes('.test.ts') || arg === '--test');
  if (isTestRun) {
    return ':memory:';
  }
  return path.resolve(process.cwd(), 'data', 'retailpulse.duckdb');
}

const READ_POOL_SIZE = Math.max(
  2,
  Math.min(8, Number(process.env.DUCKDB_READ_POOL_SIZE || 4))
);
const DEFAULT_QUERY_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.DUCKDB_QUERY_TIMEOUT_MS || 15000)
);
const MAX_CSV_INGEST_ROWS = Math.max(
  10000,
  Number(process.env.MAX_CSV_ROWS || 250000)
);

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

export class DuckDBAnalyticalEngine {
  private instance: DuckDBInstance | null = null;
  private connection: DuckDBConnection | null = null;
  private readPool: DuckDBConnection[] = [];
  private idleReadConnections: DuckDBConnection[] = [];
  private readWaiters: Array<(conn: DuckDBConnection) => void> = [];
  private activeReaders = 0;
  private peakActiveReaders = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private writeLockBusy = false;
  private warehouseEpoch = 1;
  private readonly queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS;
  private dbFilePath: string;
  private storageMode: 'PERSISTENT_FILE' | 'IN_MEMORY' = 'IN_MEMORY';
  private lastPersistedAt: string | null = null;
  private dataMode: DataMode = 'DEMONSTRATION_DATA';
  private tableUpdatedAt: Map<OlistTableKey, string> = new Map();
  private tableImportedFile: Map<OlistTableKey, string | null> = new Map();
  private tableSources: Map<OlistTableKey, 'EMPTY' | 'DEMONSTRATION DATA' | 'OLIST CSV IMPORT'> =
    new Map();
  private tableQualityMap: Map<OlistTableKey, TableQualitySummary> = new Map();
  private importHistory: ImportBatchReport[] = [];
  private sqlExecutionHistory: SqlExecutionHistoryItem[] = [];
  private savedCustomQueries: SavedCustomSqlQuery[] = [];
  private initPromise: Promise<void> | null = null;

  constructor(customDbPath?: string) {
    this.dbFilePath = customDbPath || resolveDefaultDuckDbPath();
  }

  public getWarehouseEpoch(): number {
    return this.warehouseEpoch;
  }

  private bumpWarehouseEpoch(): void {
    this.warehouseEpoch += 1;
  }

  public getEngineRuntimeMetrics(): {
    warehouseEpoch: number;
    readPoolSize: number;
    activeReaders: number;
    queuedReaders: number;
    peakActiveReaders: number;
    writeLockBusy: boolean;
    queryTimeoutMs: number;
    maxCsvRows: number;
  } {
    return {
      warehouseEpoch: this.warehouseEpoch,
      readPoolSize: this.readPool.length,
      activeReaders: this.activeReaders,
      queuedReaders: this.readWaiters.length,
      peakActiveReaders: this.peakActiveReaders,
      writeLockBusy: this.writeLockBusy,
      queryTimeoutMs: this.queryTimeoutMs,
      maxCsvRows: MAX_CSV_INGEST_ROWS
    };
  }

  /**
   * Serializes mutating DuckDB transactions so concurrent uploads/remediations
   * never interleave BEGIN/COMMIT state or corrupt warehouse metadata.
   */
  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.writeChain;
    this.writeChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    this.writeLockBusy = true;
    try {
      return await fn();
    } finally {
      this.writeLockBusy = false;
      release();
    }
  }

  /**
   * Leases a dedicated read connection from the bounded DuckDB read pool so
   * multiple analytical queries execute concurrently without connection contention.
   */
  private async withReadConnection<T>(
    fn: (conn: DuckDBConnection) => Promise<T>
  ): Promise<T> {
    if (this.readPool.length === 0) {
      if (!this.connection) {
        throw new Error('DuckDB analytical connection is not initialized.');
      }
      return fn(this.connection);
    }

    let conn = this.idleReadConnections.pop();
    if (!conn) {
      conn = await new Promise<DuckDBConnection>((resolve) => {
        this.readWaiters.push(resolve);
      });
    }

    this.activeReaders += 1;
    if (this.activeReaders > this.peakActiveReaders) {
      this.peakActiveReaders = this.activeReaders;
    }

    try {
      return await fn(conn);
    } finally {
      this.activeReaders = Math.max(0, this.activeReaders - 1);
      const nextWaiter = this.readWaiters.shift();
      if (nextWaiter) {
        nextWaiter(conn);
      } else {
        this.idleReadConnections.push(conn);
      }
    }
  }

  /**
   * Executes a read query with a strict timeout guard, interrupting runaway
   * DuckDB scans via native `connection.interrupt()` so no query can wedge a worker.
   */
  private async runReadWithTimeout(conn: DuckDBConnection, sql: string) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          conn.interrupt();
        } catch {
          // Ignore interrupt errors if connection already finished
        }
        reject(
          new Error(
            `Query exceeded the ${Math.round(this.queryTimeoutMs / 1000)}s execution timeout limit. Add selective WHERE filters or LIMIT to reduce scan scope.`
          )
        );
      }, this.queryTimeoutMs);
      timer.unref?.();
    });

    try {
      return await Promise.race([conn.runAndReadAll(sql), timeoutPromise]);
    } catch (err) {
      if (timedOut) {
        throw new Error(
          `Query exceeded the ${Math.round(this.queryTimeoutMs / 1000)}s execution timeout limit. Add selective WHERE filters or LIMIT to reduce scan scope.`
        );
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async upsertWarehouseMeta(key: string, value: string): Promise<void> {
    if (!this.connection) return;
    await this.connection.run(`
      INSERT OR REPLACE INTO _rp_warehouse_meta (meta_key, meta_value)
      VALUES (${sqlLiteral(key)}, ${sqlLiteral(value)});
    `);
  }

  private async persistWarehouseStateMetadata(): Promise<void> {
    if (!this.connection) return;
    const now = new Date().toISOString();
    this.lastPersistedAt = now;

    const tableMetaSnapshot: Record<
      string,
      { updatedAt: string | null; importedFile: string | null; source: string }
    > = {};
    for (const def of TABLE_DEFINITIONS) {
      tableMetaSnapshot[def.tableName] = {
        updatedAt: this.tableUpdatedAt.get(def.tableName) || null,
        importedFile: this.tableImportedFile.get(def.tableName) || null,
        source: this.tableSources.get(def.tableName) || 'EMPTY'
      };
    }

    await this.upsertWarehouseMeta('data_mode', this.dataMode);
    await this.upsertWarehouseMeta('benchmark_version', BENCHMARK_DATASET_VERSION);
    await this.upsertWarehouseMeta('last_persisted_at', now);
    await this.upsertWarehouseMeta('table_metadata_json', JSON.stringify(tableMetaSnapshot));
  }

  private async readWarehouseMetaMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!this.connection) return map;
    const reader = await this.connection.runAndReadAll(
      `SELECT meta_key, meta_value FROM _rp_warehouse_meta;`
    );
    for (const row of reader.getRowObjects()) {
      const k = String(serializeValue(row.meta_key) ?? '');
      const v = String(serializeValue(row.meta_value) ?? '');
      if (k) map.set(k, v);
    }
    return map;
  }

  private async loadPersistedSavedQueries(): Promise<void> {
    if (!this.connection) return;
    const reader = await this.connection.runAndReadAll(`
      SELECT payload_json
      FROM _rp_saved_queries
      ORDER BY created_at DESC;
    `);
    const loaded: SavedCustomSqlQuery[] = [];
    for (const row of reader.getRowObjects()) {
      const raw = String(serializeValue(row.payload_json) ?? '');
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as SavedCustomSqlQuery;
        if (parsed && parsed.id && parsed.sql) {
          loaded.push(parsed);
        }
      } catch {
        // Ignore malformed legacy row
      }
    }
    this.savedCustomQueries = loaded;
  }

  public async close(): Promise<void> {
    for (const readConn of this.readPool) {
      try {
        readConn.closeSync();
      } catch {
        // Ignore pool close errors
      }
    }
    this.readPool = [];
    this.idleReadConnections = [];
    this.readWaiters = [];
    this.activeReaders = 0;

    if (this.connection) {
      try {
        this.connection.closeSync();
      } catch {
        // Ignore close errors
      }
      this.connection = null;
    }
    if (this.instance) {
      try {
        this.instance.closeSync();
      } catch {
        // Ignore close errors
      }
      this.instance = null;
    }
    this.initPromise = null;
  }

  public async ensureInitialized(): Promise<void> {
    if (this.connection) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const targetPath = this.dbFilePath;
      if (targetPath !== ':memory:') {
        try {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          this.instance = await DuckDBInstance.create(targetPath);
          this.storageMode = 'PERSISTENT_FILE';
        } catch (err) {
          console.warn(
            `[RetailPulse DuckDB] Persistent file open failed (${targetPath}); falling back to :memory:.`,
            err instanceof Error ? err.message : err
          );
          this.instance = await DuckDBInstance.create(':memory:');
          this.dbFilePath = ':memory:';
          this.storageMode = 'IN_MEMORY';
        }
      } else {
        this.instance = await DuckDBInstance.create(':memory:');
        this.storageMode = 'IN_MEMORY';
      }

      this.connection = await this.instance.connect();

      // Configure DuckDB resource bounds & out-of-core disk spilling for large datasets
      try {
        const cpuThreads = Math.min(4, Math.max(2, os.cpus()?.length || 2));
        const rawMemoryLimit = (process.env.DUCKDB_MEMORY_LIMIT || '768MB').trim();
        const safeMemoryLimit = /^\d+(MB|GB|MiB|GiB)$/i.test(rawMemoryLimit)
          ? rawMemoryLimit
          : '768MB';
        await this.connection.run(`SET threads = ${cpuThreads};`);
        await this.connection.run(`SET memory_limit = ${sqlLiteral(safeMemoryLimit)};`);
        if (this.storageMode === 'PERSISTENT_FILE') {
          const tempDir = path.join(path.dirname(this.dbFilePath), '.duckdb_tmp');
          fs.mkdirSync(tempDir, { recursive: true });
          await this.connection.run(`SET temp_directory = ${sqlLiteral(tempDir)};`);
        }
      } catch {
        // Non-fatal on restricted environments
      }

      // Initialize bounded read connection pool for parallel multi-user OLAP traffic
      this.readPool = [];
      this.idleReadConnections = [];
      for (let i = 0; i < READ_POOL_SIZE; i++) {
        const readConn = await this.instance.connect();
        this.readPool.push(readConn);
        this.idleReadConnections.push(readConn);
      }

      // Internal persistence metadata and custom saved query tables
      await this.connection.run(`
        CREATE TABLE IF NOT EXISTS _rp_warehouse_meta (
          meta_key VARCHAR PRIMARY KEY,
          meta_value VARCHAR
        );
      `);

      await this.connection.run(`
        CREATE TABLE IF NOT EXISTS _rp_saved_queries (
          id VARCHAR PRIMARY KEY,
          payload_json VARCHAR NOT NULL,
          created_at VARCHAR NOT NULL
        );
      `);

      // Create audit tables for rejected records and batch logs
      await this.connection.run(`
        CREATE TABLE IF NOT EXISTS audit_rejected_records (
          rejection_id VARCHAR,
          batch_id VARCHAR,
          source_file VARCHAR,
          target_table VARCHAR,
          row_number INTEGER,
          record_key VARCHAR,
          rejection_reason VARCHAR,
          details VARCHAR,
          raw_payload VARCHAR,
          detected_at VARCHAR
        );
      `);

      await this.connection.run(`
        CREATE TABLE IF NOT EXISTS audit_import_batches (
          batch_id VARCHAR,
          file_name VARCHAR,
          file_size_bytes BIGINT,
          target_table VARCHAR,
          status VARCHAR,
          staging_rows_read INTEGER,
          cleaned_rows_inserted INTEGER,
          rejected_rows_count INTEGER,
          duplicate_count INTEGER,
          missing_value_count INTEGER,
          invalid_date_count INTEGER,
          imported_at VARCHAR,
          duration_ms DOUBLE
        );
      `);

      for (const def of TABLE_DEFINITIONS) {
        await this.connection.run(def.stagingDdl);
        await this.connection.run(def.ddl);
        this.tableUpdatedAt.set(def.tableName, new Date().toISOString());
        this.tableImportedFile.set(def.tableName, null);
        this.tableSources.set(def.tableName, 'EMPTY');
        this.tableQualityMap.set(def.tableName, {
          duplicateKeysCount: 0,
          missingRequiredCount: 0,
          missingOptionalCount: 0,
          invalidDateCount: 0,
          invalidNumericCount: 0,
          rejectedRowCount: 0,
          warnings: []
        });
      }

      // Create grain-safe analytical view joining orders, pre-aggregated items, and pre-aggregated payments
      await this.connection.run(`
        CREATE OR REPLACE VIEW vw_order_grain_summary AS
        WITH items_agg AS (
          SELECT
            order_id,
            COUNT(*) AS item_count,
            ROUND(SUM(price), 2) AS merchandise_value,
            ROUND(SUM(freight_value), 2) AS freight_value,
            ROUND(SUM(price + freight_value), 2) AS total_order_gmv
          FROM order_items
          GROUP BY order_id
        ),
        payments_agg AS (
          SELECT
            order_id,
            COUNT(*) AS payment_methods_count,
            MAX(payment_installments) AS max_installments,
            ROUND(SUM(payment_value), 2) AS settled_payment_value
          FROM payments
          GROUP BY order_id
        )
        SELECT
          o.order_id,
          o.customer_id,
          o.order_status,
          o.order_purchase_timestamp,
          o.order_delivered_customer_date,
          o.order_estimated_delivery_date,
          COALESCE(ia.item_count, 0) AS item_count,
          COALESCE(ia.merchandise_value, 0) AS merchandise_value,
          COALESCE(ia.freight_value, 0) AS freight_value,
          COALESCE(ia.total_order_gmv, 0) AS total_order_gmv,
          COALESCE(pa.payment_methods_count, 0) AS payment_methods_count,
          COALESCE(pa.settled_payment_value, 0) AS settled_payment_value
        FROM orders o
        LEFT JOIN items_agg ia ON o.order_id = ia.order_id
        LEFT JOIN payments_agg pa ON o.order_id = pa.order_id;
      `);

      // Create all 9 reusable Star-Schema Analytical Views (Fact & Dimension models)
      for (const model of ANALYTICAL_MODEL_DEFINITIONS) {
        await this.connection.run(model.viewSqlDdl);
      }

      // Restore persisted saved SQL queries & check whether persistent warehouse already has valid data
      await this.loadPersistedSavedQueries();
      const meta = await this.readWarehouseMetaMap();
      const persistedMode = meta.get('data_mode') as DataMode | undefined;
      const persistedVersion = meta.get('benchmark_version');
      const existingOrderCount = await this.scalarCount(`SELECT COUNT(*) AS cnt FROM orders;`);
      const shouldReusePersistedState =
        persistedMode === 'CUSTOM_UPLOAD' ||
        persistedMode === 'EMPTY' ||
        (persistedMode === 'DEMONSTRATION_DATA' &&
          persistedVersion === BENCHMARK_DATASET_VERSION &&
          existingOrderCount >= 1000);

      if (shouldReusePersistedState && persistedMode) {
        this.dataMode = persistedMode;
        this.lastPersistedAt = meta.get('last_persisted_at') || null;
        const rawTableMeta = meta.get('table_metadata_json');
        if (rawTableMeta) {
          try {
            const parsed = JSON.parse(rawTableMeta) as Record<
              string,
              {
                updatedAt: string | null;
                importedFile: string | null;
                source: 'EMPTY' | 'DEMONSTRATION DATA' | 'OLIST CSV IMPORT';
              }
            >;
            for (const def of TABLE_DEFINITIONS) {
              const info = parsed[def.tableName];
              if (info) {
                if (info.updatedAt) this.tableUpdatedAt.set(def.tableName, info.updatedAt);
                this.tableImportedFile.set(def.tableName, info.importedFile);
                this.tableSources.set(def.tableName, info.source);
              }
            }
          } catch {
            // Keep default initialized table maps
          }
        }
      } else {
        await this.seedDemonstrationData();
      }
    })();

    return this.initPromise;
  }

  public getDataMode(): DataMode {
    return this.dataMode;
  }

  public isDemonstrationData(): boolean {
    return this.dataMode === 'DEMONSTRATION_DATA';
  }

  public getDatabasePath(): string {
    return this.dbFilePath;
  }

  public async getPersistenceStatus(): Promise<WarehousePersistenceStatus> {
    await this.ensureInitialized();
    const statuses = await this.getDatasetStatuses();
    const totalRows = statuses.reduce((acc, s) => acc + s.rowCount, 0);
    const totalOrders = statuses.find((s) => s.tableName === 'orders')?.rowCount ?? 0;

    let fileSizeBytes = 0;
    if (this.storageMode === 'PERSISTENT_FILE' && this.dbFilePath !== ':memory:') {
      try {
        const stat = fs.statSync(this.dbFilePath);
        fileSizeBytes = stat.size;
      } catch {
        fileSizeBytes = 0;
      }
    }

    const displayPath =
      this.storageMode === 'PERSISTENT_FILE'
        ? path.relative(process.cwd(), this.dbFilePath) || this.dbFilePath
        : ':memory:';

    return {
      storageMode: this.storageMode,
      dbFilePath: displayPath,
      fileSizeBytes,
      benchmarkVersion: BENCHMARK_DATASET_VERSION,
      totalRows,
      totalOrders,
      savedCustomQueriesCount: this.savedCustomQueries.length,
      lastPersistedAt: this.lastPersistedAt,
      dataMode: this.dataMode
    };
  }

  public recordSqlExecutionHistory(
    entry: Omit<SqlExecutionHistoryItem, 'historyId' | 'executedAt' | 'dataMode'>
  ): SqlExecutionHistoryItem {
    const matchedCurated = CURATED_SQL_LIBRARY.find(
      (q) => q.sql.trim() === entry.sql.trim()
    );
    const matchedCustom = this.savedCustomQueries.find(
      (q) => q.sql.trim() === entry.sql.trim()
    );

    const record: SqlExecutionHistoryItem = {
      historyId: `HIST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      queryCode: entry.queryCode || matchedCurated?.code || matchedCustom?.code,
      queryTitle: entry.queryTitle || matchedCurated?.title || matchedCustom?.title,
      sql: entry.sql,
      status: entry.status,
      rowCount: entry.rowCount,
      executionTimeMs: entry.executionTimeMs,
      errorMessage: entry.errorMessage,
      executedAt: new Date().toISOString(),
      dataMode: this.dataMode
    };

    this.sqlExecutionHistory = [record, ...this.sqlExecutionHistory].slice(0, 60);
    return record;
  }

  public async executeReadOnlyQuery(
    rawSql: string,
    maxRows = 500,
    recordInHistory = true
  ): Promise<SqlQueryResult> {
    await this.ensureInitialized();
    const validation = validateSqlQuery(rawSql);
    if (!validation.valid || !validation.normalizedValue) {
      if (recordInHistory) {
        this.recordSqlExecutionHistory({
          sql: rawSql,
          status: 'VALIDATION_BLOCKED',
          rowCount: 0,
          executionTimeMs: 0,
          errorMessage: validation.error || 'Invalid SQL query.'
        });
      }
      throw new Error(validation.error || 'Invalid SQL query.');
    }

    const start = performance.now();
    const safeMaxRows = Math.max(1, Math.min(100000, Math.floor(maxRows)));
    const cleanSql = validation.normalizedValue.replace(/;+\s*$/, '').trim();
    const boundedSql = `SELECT * FROM (${cleanSql}) AS _rp_bounded LIMIT ${safeMaxRows};`;

    try {
      const reader = await this.withReadConnection(async (conn) => {
        try {
          return await this.runReadWithTimeout(conn, boundedSql);
        } catch (wrapErr) {
          const msg = wrapErr instanceof Error ? wrapErr.message : '';
          // Only fall back to direct execution if subquery wrapping hit a duplicate-alias binder edge case
          if (msg.includes('timeout')) {
            throw wrapErr;
          }
          return this.runReadWithTimeout(conn, `${cleanSql};`);
        }
      });
      const durationMs = Math.round((performance.now() - start) * 100) / 100;

      const colNames = reader.columnNames();
      const colTypes = reader.columnTypes().map((t) => String(t));
      const rawRows = reader.getRowObjects();

      const columns = colNames.map((name, idx) => ({
        name,
        type: colTypes[idx] || 'VARCHAR'
      }));

      const slicedRows = rawRows.slice(0, safeMaxRows).map((rowObj) => {
        const cleanRow: Record<string, string | number | boolean | null> = {};
        for (const col of colNames) {
          cleanRow[col] = serializeValue(rowObj[col]);
        }
        return cleanRow;
      });

      if (recordInHistory) {
        this.recordSqlExecutionHistory({
          sql: validation.normalizedValue,
          status: 'SUCCEEDED',
          rowCount: slicedRows.length,
          executionTimeMs: durationMs
        });
      }

      return {
        sql: validation.normalizedValue,
        columns,
        rows: slicedRows,
        rowCount: slicedRows.length,
        executionTimeMs: durationMs,
        isDemonstrationData: this.isDemonstrationData(),
        dataMode: this.dataMode
      };
    } catch (err) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      const errMsg = err instanceof Error ? err.message : 'DuckDB SQL execution error';
      if (recordInHistory) {
        this.recordSqlExecutionHistory({
          sql: validation.normalizedValue,
          status: 'EXECUTION_ERROR',
          rowCount: 0,
          executionTimeMs: durationMs,
          errorMessage: errMsg
        });
      }
      throw err;
    }
  }

  /**
   * Executes DuckDB's native `EXPLAIN (ANALYZE, FORMAT JSON)` physical query plan profiler
   * on a validated read-only SELECT/WITH query, extracting operator-level timings,
   * cardinalities, bottleneck hotspots, and automated query optimization hints.
   */
  public async profileReadOnlyQuery(
    rawSql: string,
    maxRows = 250
  ): Promise<SqlQueryPlanProfile> {
    await this.ensureInitialized();
    const validation = validateSqlQuery(rawSql);
    if (!validation.valid || !validation.normalizedValue) {
      throw new Error(validation.error || 'Invalid SQL query.');
    }

    const cleanSql = validation.normalizedValue.replace(/;+\s*$/, '').trim();
    const explainSql = `EXPLAIN (ANALYZE, FORMAT JSON) ${cleanSql};`;

    const wallStart = performance.now();
    const reader = await this.withReadConnection((conn) =>
      this.runReadWithTimeout(conn, explainSql)
    );
    const wallElapsedMs = Math.round((performance.now() - wallStart) * 100) / 100;
    const rawRows = reader.getRowObjects();

    // Extract JSON string from DuckDB EXPLAIN output (handles explain_value or single column)
    let rawJsonText = '';
    for (const rowObj of rawRows) {
      const explainKey = String(rowObj.explain_key ?? '').toLowerCase();
      const explainVal = rowObj.explain_value ?? Object.values(rowObj).find((v) => typeof v === 'string' && v.trim().startsWith('{'));
      if (typeof explainVal === 'string' && explainVal.trim().startsWith('{')) {
        if (explainKey.includes('analyzed') || !rawJsonText) {
          rawJsonText = explainVal.trim();
        }
      }
    }

    interface RawDuckDbPlanNode {
      name?: string;
      type?: string;
      operator_name?: string;
      operator_type?: string;
      timing?: number;
      operator_timing?: number;
      latency?: number;
      cpu_time?: number;
      cardinality?: number;
      operator_cardinality?: number;
      intermediate_rows?: number;
      rows_scanned?: number;
      rows_returned?: number;
      extra_info?: unknown;
      children?: RawDuckDbPlanNode[];
      operator?: RawDuckDbPlanNode[];
      query?: {
        total_time?: number;
        cpu_time?: number;
        total_rows_scanned?: number;
        total_intermediate_rows?: number;
      };
    }

    let parsedRoot: RawDuckDbPlanNode | null = null;
    if (rawJsonText) {
      try {
        parsedRoot = JSON.parse(rawJsonText) as RawDuckDbPlanNode;
      } catch {
        parsedRoot = null;
      }
    }

    const flattened: Array<{
      id: string;
      depth: number;
      operatorName: string;
      operatorType: string;
      timingMs: number;
      cardinality: number;
      rowsScanned: number;
      extraInfo: string;
    }> = [];

    const formatExtraInfo = (info: unknown): string => {
      if (info === null || info === undefined) return '';
      if (typeof info === 'string') {
        return info.replace(/\s+/g, ' ').trim().slice(0, 180);
      }
      if (typeof info === 'object') {
        const parts: string[] = [];
        for (const [k, v] of Object.entries(info as Record<string, unknown>)) {
          if (v === null || v === undefined || v === '') continue;
          if (k === 'Estimated Cardinality') continue;
          const formattedVal = Array.isArray(v)
            ? v.slice(0, 4).map(String).join(', ') + (v.length > 4 ? ` (+${v.length - 4})` : '')
            : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v);
          parts.push(`${k}: ${formattedVal}`);
          if (parts.length >= 3) break;
        }
        return parts.join(' · ').slice(0, 180);
      }
      return String(info).slice(0, 180);
    };

    const SKIP_WRAPPER_TYPES = new Set(['QUERY', 'EXPLAIN_ANALYZE', 'RESULT_COLLECTOR']);

    const walkPlan = (node: RawDuckDbPlanNode, depth: number) => {
      const rawName = (
        node.type ||
        node.operator_name ||
        node.operator_type ||
        node.name ||
        'OPERATOR'
      ).trim();
      const rawType = rawName.toUpperCase().replace(/\s+/g, '_');
      const isWrapperNode = SKIP_WRAPPER_TYPES.has(rawType);

      const timingSec =
        typeof node.operator_timing === 'number'
          ? node.operator_timing
          : typeof node.timing === 'number'
          ? node.timing
          : 0;
      const cardinality =
        typeof node.intermediate_rows === 'number'
          ? node.intermediate_rows
          : typeof node.operator_cardinality === 'number'
          ? node.operator_cardinality
          : typeof node.cardinality === 'number'
          ? node.cardinality
          : typeof node.rows_returned === 'number'
          ? node.rows_returned
          : 0;
      const nodeRowsScanned =
        typeof node.rows_scanned === 'number'
          ? node.rows_scanned
          : rawType.includes('SCAN')
          ? cardinality
          : 0;

      if (!isWrapperNode) {
        flattened.push({
          id: `op-${flattened.length + 1}`,
          depth,
          operatorName: rawName.replace(/_/g, ' '),
          operatorType: rawType,
          timingMs: Math.round(Math.max(0, timingSec * 1000) * 1000) / 1000,
          cardinality: Math.max(0, Math.round(cardinality)),
          rowsScanned: Math.max(0, Math.round(nodeRowsScanned)),
          extraInfo: formatExtraInfo(node.extra_info)
        });
      }

      const nextDepth = isWrapperNode ? depth : depth + 1;
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          walkPlan(child, nextDepth);
        }
      }
    };

    if (parsedRoot) {
      if (Array.isArray(parsedRoot.operator) && parsedRoot.operator.length > 0) {
        for (const rootOp of parsedRoot.operator) {
          walkPlan(rootOp, 0);
        }
      } else {
        walkPlan(parsedRoot, 0);
      }
    }

    // Fallback if DuckDB returned an unexpected non-JSON plan shape
    if (flattened.length === 0) {
      flattened.push({
        id: 'op-1',
        depth: 0,
        operatorName: 'QUERY EXECUTION',
        operatorType: 'QUERY_EXECUTION',
        timingMs: wallElapsedMs,
        cardinality: 0,
        rowsScanned: 0,
        extraInfo: `Physical plan executed cleanly in ${wallElapsedMs} ms`
      });
    }

    const totalOperatorTimeMs =
      Math.round(flattened.reduce((acc, op) => acc + op.timingMs, 0) * 1000) / 1000;
    const rootLatencySec =
      typeof parsedRoot?.query?.total_time === 'number'
        ? parsedRoot.query.total_time
        : typeof parsedRoot?.latency === 'number'
        ? parsedRoot.latency
        : typeof parsedRoot?.cpu_time === 'number'
        ? parsedRoot.cpu_time
        : null;
    const totalLatencyMs =
      rootLatencySec !== null && rootLatencySec > 0
        ? Math.round(rootLatencySec * 1000 * 100) / 100
        : Math.max(wallElapsedMs, Math.round(totalOperatorTimeMs * 100) / 100);

    let maxTiming = -1;
    let hotspotIdx = 0;
    let scannedFromNodes = 0;
    let peakCardinality = 0;

    flattened.forEach((op, idx) => {
      if (op.timingMs > maxTiming) {
        maxTiming = op.timingMs;
        hotspotIdx = idx;
      }
      if (op.rowsScanned > 0) {
        scannedFromNodes += op.rowsScanned;
      }
      if (op.cardinality > peakCardinality) {
        peakCardinality = op.cardinality;
      }
    });

    const totalRowsScanned =
      typeof parsedRoot?.query?.total_rows_scanned === 'number'
        ? Math.round(parsedRoot.query.total_rows_scanned)
        : scannedFromNodes;

    const timingDenominator = totalOperatorTimeMs > 0 ? totalOperatorTimeMs : 1;
    const operators: SqlPlanOperatorNode[] = flattened.map((op, idx) => ({
      id: op.id,
      depth: op.depth,
      operatorName: op.operatorName,
      operatorType: op.operatorType,
      timingMs: op.timingMs,
      cardinality: op.cardinality,
      extraInfo: op.extraInfo,
      timingSharePct:
        totalOperatorTimeMs > 0
          ? Math.round((op.timingMs / timingDenominator) * 1000) / 10
          : idx === hotspotIdx
          ? 100
          : 0,
      isHotspot: idx === hotspotIdx
    }));

    const hotspot = operators[hotspotIdx];
    const rowsReturned =
      typeof parsedRoot?.rows_returned === 'number'
        ? Math.round(parsedRoot.rows_returned)
        : operators[0]?.cardinality ?? 0;

    // Deterministic BigQuery-style automated SQL optimization hints
    const optimizationHints: string[] = [];
    const upperSql = cleanSql.toUpperCase();
    const scanNodes = operators.filter((o) => o.operatorType.includes('SCAN'));
    const joinNodes = operators.filter((o) => o.operatorType.includes('JOIN'));
    const groupNodes = operators.filter((o) => o.operatorType.includes('GROUP_BY'));

    if (upperSql.includes('SELECT *')) {
      optimizationHints.push(
        'Columnar Pruning Opportunity: Replace `SELECT *` with explicit columns so DuckDB only decompresses required column vectors.'
      );
    }
    if (!/\bLIMIT\s+\d+/i.test(cleanSql) && rowsReturned > maxRows) {
      optimizationHints.push(
        `Unbounded Result Set: Query materialized ${rowsReturned.toLocaleString()} rows (UI preview capped at ${maxRows}). Add an explicit \`LIMIT\` or \`ORDER BY ... LIMIT\` for Top-N heap pushdown.`
      );
    }
    if (joinNodes.length >= 2) {
      optimizationHints.push(
        `Multi-Join Pipeline (${joinNodes.length} join operators): Verify join grain alignment—pre-aggregate 1:N child tables (order_items, order_payments, order_reviews) in CTEs before joining to fact_orders.`
      );
    }
    if (hotspot && hotspot.timingSharePct >= 45) {
      optimizationHints.push(
        `Primary CPU Bottleneck: \`${hotspot.operatorName}\` consumed ${hotspot.timingSharePct}% (${hotspot.timingMs.toFixed(2)} ms) of operator CPU time across ${hotspot.cardinality.toLocaleString()} tuples.`
      );
    }
    if (scanNodes.length > 0 && totalRowsScanned > 0 && rowsReturned > 0) {
      const selectivityRatio = totalRowsScanned / Math.max(1, rowsReturned);
      if (selectivityRatio >= 50) {
        optimizationHints.push(
          `High Scan-to-Output Ratio (${Math.round(selectivityRatio)}:1): ${totalRowsScanned.toLocaleString()} rows scanned to produce ${rowsReturned.toLocaleString()} output rows; DuckDB vectorized filter/aggregation pushdown compressed intermediate state cleanly.`
        );
      }
    }
    if (groupNodes.length > 0 && optimizationHints.length < 3) {
      optimizationHints.push(
        `Vectorized Hash Aggregation: ${groupNodes.length} hash-group operator(s) executed in-process with peak intermediate cardinality of ${peakCardinality.toLocaleString()} rows.`
      );
    }
    if (optimizationHints.length === 0) {
      optimizationHints.push(
        `Optimal Execution Profile: Physical plan completed in ${totalLatencyMs.toFixed(2)} ms across ${operators.length} vectorized operators with no material bottlenecks detected.`
      );
    }

    return {
      executedSql: cleanSql,
      totalLatencyMs,
      totalOperatorTimeMs,
      rowsReturned,
      totalRowsScanned,
      peakCardinality,
      operatorCount: operators.length,
      hotspotOperator: hotspot?.operatorName || 'QUERY EXECUTION',
      hotspotSharePct: hotspot?.timingSharePct ?? 100,
      operators,
      optimizationHints: optimizationHints.slice(0, 4),
      dataMode: this.dataMode,
      isDemonstrationData: this.isDemonstrationData()
    };
  }

  public async clearAllTables(): Promise<TableStatus[]> {
    await this.ensureInitialized();
    await this.withWriteLock(async () => {
      await this.connection!.run('BEGIN TRANSACTION;');
      try {
        for (const def of TABLE_DEFINITIONS) {
          await this.connection!.run(`DELETE FROM ${def.stagingTableName};`);
          await this.connection!.run(`DELETE FROM ${def.tableName};`);
          this.tableUpdatedAt.set(def.tableName, new Date().toISOString());
          this.tableImportedFile.set(def.tableName, null);
          this.tableSources.set(def.tableName, 'EMPTY');
          this.tableQualityMap.set(def.tableName, {
            duplicateKeysCount: 0,
            missingRequiredCount: 0,
            missingOptionalCount: 0,
            invalidDateCount: 0,
            invalidNumericCount: 0,
            rejectedRowCount: 0,
            warnings: []
          });
        }
        await this.connection!.run(`DELETE FROM audit_rejected_records;`);
        await this.connection!.run(`DELETE FROM audit_import_batches;`);
        await this.connection!.run('COMMIT;');
      } catch (err) {
        try {
          await this.connection!.run('ROLLBACK;');
        } catch {
          // Ignore rollback failure
        }
        throw err;
      }
      this.importHistory = [];
      this.dataMode = 'EMPTY';
      await this.persistWarehouseStateMetadata();
      this.bumpWarehouseEpoch();
    });
    return this.getDatasetStatuses();
  }

  public async seedDemonstrationData(): Promise<TableStatus[]> {
    await this.ensureInitialized();
    const batches = generateProductionBenchmarkBatches();

    await this.withWriteLock(async () => {
      await this.connection!.run('BEGIN TRANSACTION;');
      try {
        for (const def of TABLE_DEFINITIONS) {
          await this.connection!.run(`DELETE FROM ${def.stagingTableName};`);
          await this.connection!.run(`DELETE FROM ${def.tableName};`);
        }
        await this.connection!.run(`DELETE FROM audit_rejected_records;`);
        await this.connection!.run(`DELETE FROM audit_import_batches;`);
        this.importHistory = [];

        for (const batch of batches) {
          for (const stmt of batch.stagingStatements) {
            await this.connection!.run(stmt);
          }
          for (const stmt of batch.cleanedStatements) {
            await this.connection!.run(stmt);
          }
        }
        await this.connection!.run('COMMIT;');
      } catch (err) {
        try {
          await this.connection!.run('ROLLBACK;');
        } catch {
          // Ignore rollback failure
        }
        throw err;
      }

      const nullDeliveryCount = await this.scalarCount(
        `SELECT COUNT(*) AS cnt FROM orders WHERE order_delivered_customer_date IS NULL;`
      );

      const now = new Date().toISOString();
      for (const def of TABLE_DEFINITIONS) {
        this.tableUpdatedAt.set(def.tableName, now);
        this.tableImportedFile.set(
          def.tableName,
          `${def.expectedOlistFilename} (5,200-Order 24M Benchmark)`
        );
        this.tableSources.set(def.tableName, 'DEMONSTRATION DATA');
        this.tableQualityMap.set(def.tableName, {
          duplicateKeysCount: 0,
          missingRequiredCount: 0,
          missingOptionalCount: def.tableName === 'orders' ? nullDeliveryCount : 0,
          invalidDateCount: 0,
          invalidNumericCount: 0,
          rejectedRowCount: 0,
          warnings:
            def.tableName === 'orders' && nullDeliveryCount > 0
              ? [
                  `${nullDeliveryCount} non-delivered orders (shipped/processing/canceled) legitimately have NULL order_delivered_customer_date.`
                ]
              : []
        });
      }

      this.dataMode = 'DEMONSTRATION_DATA';
      await this.persistWarehouseStateMetadata();
      this.bumpWarehouseEpoch();
    });
    return this.getDatasetStatuses();
  }

  private async scalarCount(sql: string): Promise<number> {
    const reader = await this.withReadConnection((conn) =>
      this.runReadWithTimeout(conn, sql)
    );
    const rows = reader.getRowObjects();
    return Number(serializeValue(rows[0]?.cnt) ?? 0);
  }

  public async getDatasetStatuses(): Promise<TableStatus[]> {
    await this.ensureInitialized();
    const statuses: TableStatus[] = [];

    for (const def of TABLE_DEFINITIONS) {
      const cleanedCount = await this.scalarCount(`SELECT COUNT(*) AS cnt FROM ${def.tableName};`);
      const stagingCount = await this.scalarCount(
        `SELECT COUNT(*) AS cnt FROM ${def.stagingTableName};`
      );
      const rejectedCount = await this.scalarCount(
        `SELECT COUNT(*) AS cnt FROM audit_rejected_records WHERE target_table = '${def.tableName}';`
      );

      const qSummary = this.tableQualityMap.get(def.tableName) || {
        duplicateKeysCount: 0,
        missingRequiredCount: 0,
        missingOptionalCount: 0,
        invalidDateCount: 0,
        invalidNumericCount: 0,
        rejectedRowCount: rejectedCount,
        warnings: []
      };
      qSummary.rejectedRowCount = rejectedCount;

      const hasWarnings =
        rejectedCount > 0 ||
        qSummary.duplicateKeysCount > 0 ||
        qSummary.invalidDateCount > 0 ||
        qSummary.warnings.length > 0;

      statuses.push({
        tableName: def.tableName,
        stagingTableName: def.stagingTableName,
        expectedOlistFilename: def.expectedOlistFilename,
        isOptional: def.isOptional,
        displayName: def.displayName,
        grainDescription: def.grainDescription,
        description: def.description,
        stagingRowCount: stagingCount,
        rowCount: cleanedCount,
        rejectedRowCount: rejectedCount,
        columnCount: def.columns.length,
        columns: def.columns,
        isPopulated: cleanedCount > 0,
        lastUpdated: this.tableUpdatedAt.get(def.tableName) || null,
        lastImportedFile: this.tableImportedFile.get(def.tableName) || null,
        processingStatus:
          cleanedCount === 0 && stagingCount === 0
            ? 'EMPTY'
            : hasWarnings
            ? 'READY_WITH_WARNINGS'
            : 'READY',
        sourceLabel:
          cleanedCount === 0 && stagingCount === 0
            ? 'EMPTY'
            : this.tableSources.get(def.tableName) || 'DEMONSTRATION DATA',
        qualitySummary: qSummary
      });
    }

    return statuses;
  }

  public async getRejectedRecords(limit = 200): Promise<RejectedRecordItem[]> {
    await this.ensureInitialized();
    const reader = await this.connection!.runAndReadAll(`
      SELECT
        rejection_id,
        batch_id,
        source_file,
        target_table,
        row_number,
        record_key,
        rejection_reason,
        details,
        raw_payload,
        detected_at
      FROM audit_rejected_records
      ORDER BY detected_at DESC, row_number ASC
      LIMIT ${Math.min(limit, 1000)};
    `);
    return reader.getRowObjects().map((r) => ({
      rejectionId: String(serializeValue(r.rejection_id) ?? ''),
      batchId: String(serializeValue(r.batch_id) ?? ''),
      sourceFile: String(serializeValue(r.source_file) ?? ''),
      targetTable: String(serializeValue(r.target_table) ?? ''),
      rowNumber: Number(serializeValue(r.row_number) ?? 0),
      recordKey: String(serializeValue(r.record_key) ?? ''),
      rejectionReason: (String(serializeValue(r.rejection_reason)) ||
        'SCHEMA_MISMATCH') as RejectedRecordItem['rejectionReason'],
      details: String(serializeValue(r.details) ?? ''),
      rawPayload: String(serializeValue(r.raw_payload) ?? ''),
      detectedAt: String(serializeValue(r.detected_at) ?? '')
    }));
  }

  public getImportHistory(): ImportBatchReport[] {
    return this.importHistory;
  }

  public async verifyRelationships(): Promise<RelationshipVerificationItem[]> {
    await this.ensureInitialized();
    const specs: {
      id: string;
      relationshipName: string;
      childTable: OlistTableKey;
      parentTable: OlistTableKey;
      joinKey: string;
      grainNote: string;
    }[] = [
      {
        id: 'rel-orders-customers',
        relationshipName: 'Orders -> Customers',
        childTable: 'orders',
        parentTable: 'customers',
        joinKey: 'customer_id',
        grainNote: '1:1 order-scoped customer_id mapping to customer_unique_id'
      },
      {
        id: 'rel-items-orders',
        relationshipName: 'Order Items -> Orders',
        childTable: 'order_items',
        parentTable: 'orders',
        joinKey: 'order_id',
        grainNote: 'N:1 line items per order (aggregate items before joining to orders)'
      },
      {
        id: 'rel-items-products',
        relationshipName: 'Order Items -> Products',
        childTable: 'order_items',
        parentTable: 'products',
        joinKey: 'product_id',
        grainNote: 'N:1 line items referencing master product_id'
      },
      {
        id: 'rel-items-sellers',
        relationshipName: 'Order Items -> Sellers',
        childTable: 'order_items',
        parentTable: 'sellers',
        joinKey: 'seller_id',
        grainNote: 'N:1 line items fulfilled by merchant seller_id'
      },
      {
        id: 'rel-payments-orders',
        relationshipName: 'Payments -> Orders',
        childTable: 'payments',
        parentTable: 'orders',
        joinKey: 'order_id',
        grainNote: 'N:1 payment settlements per order (pre-aggregate payment_value by order_id)'
      },
      {
        id: 'rel-reviews-orders',
        relationshipName: 'Reviews -> Orders',
        childTable: 'reviews',
        parentTable: 'orders',
        joinKey: 'order_id',
        grainNote: 'N:1 customer review records per order_id'
      },
      {
        id: 'rel-products-translations',
        relationshipName: 'Products -> Category Translations',
        childTable: 'products',
        parentTable: 'category_translations',
        joinKey: 'product_category_name',
        grainNote: 'N:1 Portuguese product_category_name to English translation lookup'
      }
    ];

    const results: RelationshipVerificationItem[] = [];

    for (const spec of specs) {
      const totalChildRows = await this.scalarCount(`SELECT COUNT(*) AS cnt FROM ${spec.childTable};`);
      const totalParentRows = await this.scalarCount(`SELECT COUNT(*) AS cnt FROM ${spec.parentTable};`);

      if (totalChildRows === 0 || totalParentRows === 0) {
        results.push({
          ...spec,
          totalChildRows,
          matchedRows: 0,
          unmatchedOrphanRows: 0,
          matchRatePercent: null,
          status: 'SKIPPED_EMPTY'
        });
        continue;
      }

      const matchedRows = await this.scalarCount(`
        SELECT COUNT(*) AS cnt
        FROM ${spec.childTable} c
        INNER JOIN (SELECT DISTINCT ${spec.joinKey} FROM ${spec.parentTable} WHERE ${spec.joinKey} IS NOT NULL) p
          ON c.${spec.joinKey} = p.${spec.joinKey}
      `);

      const unmatchedOrphanRows = Math.max(0, totalChildRows - matchedRows);
      const matchRatePercent =
        Math.round((matchedRows / totalChildRows) * 1000) / 10;

      results.push({
        ...spec,
        totalChildRows,
        matchedRows,
        unmatchedOrphanRows,
        matchRatePercent,
        status: unmatchedOrphanRows === 0 ? 'VERIFIED' : 'PARTIAL_MATCH'
      });
    }

    return results;
  }

  public async getIngestionSummary(): Promise<IngestionSummaryPayload> {
    const [tables, rejectedRecords, relationships] = await Promise.all([
      this.getDatasetStatuses(),
      this.getRejectedRecords(200),
      this.verifyRelationships()
    ]);

    return {
      tables,
      importHistory: this.importHistory,
      rejectedRecords,
      relationships
    };
  }

  public async ingestCsv(
    requestedTableName: string | undefined,
    csvContent: string,
    mode: 'append' | 'replace' = 'replace',
    fileName?: string,
    fileSizeBytes?: number
  ): Promise<{
    batchReport: ImportBatchReport;
    tableName: OlistTableKey;
    rowsInserted: number;
    stagingRowsRead: number;
    rejectedRowsCount: number;
    totalRowsAfter: number;
    columnsMatched: string[];
    dataMode: DataMode;
  }> {
    await this.ensureInitialized();
    const startMs = performance.now();
    const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const effectiveFileName = fileName || `${requestedTableName || 'dataset'}.csv`;
    const effectiveSize = fileSizeBytes ?? Buffer.byteLength(csvContent || '', 'utf8');

    // Parse CSV with BOM support and relaxed quotes for Olist review messages
    let rawRecords: Record<string, string>[] = [];
    try {
      rawRecords = parse(csvContent, {
        bom: true,
        columns: (header: string[]) => header.map(normalizeCsvHeader),
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true,
        relax_column_count: true
      }) as Record<string, string>[];
    } catch (parseErr) {
      const errMsg = parseErr instanceof Error ? parseErr.message : 'Malformed CSV syntax';
      const failedReport: ImportBatchReport = {
        batchId,
        fileName: effectiveFileName,
        fileSizeBytes: effectiveSize,
        targetTable: (requestedTableName as OlistTableKey) || 'unknown',
        status: 'FAILED',
        stagingRowsRead: 0,
        cleanedRowsInserted: 0,
        rejectedRowsCount: 0,
        duplicateCount: 0,
        missingValueCount: 0,
        invalidDateCount: 0,
        detectedColumns: [],
        columnCount: 0,
        warnings: [],
        errorMessage: `CSV Parse Error: ${errMsg}`,
        importedAt: new Date().toISOString(),
        durationMs: Math.round((performance.now() - startMs) * 100) / 100
      };
      this.importHistory.unshift(failedReport);
      throw new Error(failedReport.errorMessage);
    }

    if (!rawRecords.length) {
      throw new Error(`File "${effectiveFileName}" contains no data records.`);
    }

    if (rawRecords.length > MAX_CSV_INGEST_ROWS) {
      throw new Error(
        `CSV upload "${effectiveFileName}" contains ${rawRecords.length.toLocaleString()} rows, exceeding the per-batch safety ceiling (${MAX_CSV_INGEST_ROWS.toLocaleString()} rows). Split into smaller files and upload in "append" mode.`
      );
    }

    const csvHeaders = Object.keys(rawRecords[0]);
    const autoDetectedTable = detectOlistTableFromFileAndHeaders(effectiveFileName, csvHeaders);
    const resolvedTableKey = (
      (requestedTableName && requestedTableName.trim().toLowerCase()) ||
      autoDetectedTable ||
      ''
    ) as OlistTableKey;

    const targetDef = TABLE_DEFINITIONS.find((t) => t.tableName === resolvedTableKey);
    if (!targetDef) {
      const errMsg = `Could not match "${effectiveFileName}" (headers: ${csvHeaders.join(', ')}) to a supported Olist dataset table.`;
      const failedReport: ImportBatchReport = {
        batchId,
        fileName: effectiveFileName,
        fileSizeBytes: effectiveSize,
        targetTable: 'unknown',
        status: 'FAILED',
        stagingRowsRead: rawRecords.length,
        cleanedRowsInserted: 0,
        rejectedRowsCount: rawRecords.length,
        duplicateCount: 0,
        missingValueCount: 0,
        invalidDateCount: 0,
        detectedColumns: csvHeaders,
        columnCount: csvHeaders.length,
        warnings: [],
        errorMessage: errMsg,
        importedAt: new Date().toISOString(),
        durationMs: Math.round((performance.now() - startMs) * 100) / 100
      };
      this.importHistory.unshift(failedReport);
      throw new Error(errMsg);
    }

    // Also support product_name_length -> product_name_lenght alias if user uploads normalized header
    const normalizeRecordAliases = (row: Record<string, string>): Record<string, string> => {
      if (targetDef.tableName === 'products') {
        if (row.product_name_length !== undefined && row.product_name_lenght === undefined) {
          row.product_name_lenght = row.product_name_length;
        }
        if (
          row.product_description_length !== undefined &&
          row.product_description_lenght === undefined
        ) {
          row.product_description_lenght = row.product_description_length;
        }
      }
      return row;
    };

    const schemaColNames = targetDef.columns.map((c) => c.name);
    const colTypeMap = new Map<string, string>(
      targetDef.columns.map((c) => [c.name, c.type])
    );
    const requiredColSet = new Set(targetDef.requiredColumns);
    const sampleNormalized = normalizeRecordAliases({ ...rawRecords[0] });
    const normalizedHeaders = Object.keys(sampleNormalized);
    const matchedCols = schemaColNames.filter((col) => normalizedHeaders.includes(col));
    const matchedColSet = new Set(matchedCols);

    if (matchedCols.length === 0) {
      throw new Error(
        `CSV headers (${csvHeaders.join(', ')}) do not match any columns in "${targetDef.tableName}" (${schemaColNames.join(', ')}).`
      );
    }

    const activeNumericCols = targetDef.numericColumns.filter((nc) => matchedColSet.has(nc.name));

    return this.withWriteLock(async () => {
      const nowIso = new Date().toISOString();
      const stagingCols = [
        ...matchedCols,
        '_ingest_batch_id',
        '_source_filename',
        '_row_number',
        '_ingested_at'
      ];
      const stagingPrefix = `INSERT INTO ${targetDef.stagingTableName} (${stagingCols.join(', ')}) VALUES `;
      const cleanedPrefix = `INSERT INTO ${targetDef.tableName} (${matchedCols.join(', ')}) VALUES `;
      const rejectedPrefix = `INSERT INTO audit_rejected_records (rejection_id, batch_id, source_file, target_table, row_number, record_key, rejection_reason, details, raw_payload, detected_at) VALUES `;

      let stagingRowsRead = 0;
      let cleanedRowsInserted = 0;
      let rejectedRowsCount = 0;
      let duplicateCount = 0;
      let missingRequiredCount = 0;
      let missingOptionalCount = 0;
      let invalidDateCount = 0;
      let invalidNumericCount = 0;

      const FLUSH_BATCH_SIZE = 1000;
      const stagingBuf: string[] = [];
      const cleanedBuf: string[] = [];
      const rejectedBuf: string[] = [];

      const flushBuffers = async () => {
        if (stagingBuf.length > 0) {
          await this.connection!.run(`${stagingPrefix}${stagingBuf.join(', ')};`);
          stagingBuf.length = 0;
        }
        if (cleanedBuf.length > 0) {
          await this.connection!.run(`${cleanedPrefix}${cleanedBuf.join(', ')};`);
          cleanedBuf.length = 0;
        }
        if (rejectedBuf.length > 0) {
          await this.connection!.run(`${rejectedPrefix}${rejectedBuf.join(', ')};`);
          rejectedBuf.length = 0;
        }
      };

      await this.connection!.run('BEGIN TRANSACTION;');
      try {
        // If first custom upload while still in DEMONSTRATION_DATA mode, clear demo seed from all tables
        // so mock/demo records never mix with real user Olist imports!
        if (this.dataMode === 'DEMONSTRATION_DATA') {
          for (const def of TABLE_DEFINITIONS) {
            await this.connection!.run(`DELETE FROM ${def.stagingTableName};`);
            await this.connection!.run(`DELETE FROM ${def.tableName};`);
            this.tableSources.set(def.tableName, 'EMPTY');
            this.tableImportedFile.set(def.tableName, null);
          }
          await this.connection!.run(`DELETE FROM audit_rejected_records;`);
        }

        if (mode === 'replace') {
          await this.connection!.run(`DELETE FROM ${targetDef.stagingTableName};`);
          await this.connection!.run(`DELETE FROM ${targetDef.tableName};`);
          await this.connection!.run(
            `DELETE FROM audit_rejected_records WHERE target_table = '${targetDef.tableName}';`
          );
        }

        // Load existing primary keys if appending
        const seenPrimaryKeys = new Set<string>();
        if (mode === 'append' && targetDef.primaryKeyColumns.length > 0) {
          const pkExpr = targetDef.primaryKeyColumns.join(" || '::' || ");
          const existingPkRes = await this.connection!.runAndReadAll(
            `SELECT (${pkExpr}) AS pk FROM ${targetDef.tableName};`
          );
          for (const r of existingPkRes.getRowObjects()) {
            const pkVal = serializeValue(r.pk);
            if (pkVal !== null) seenPrimaryKeys.add(String(pkVal));
          }
        }

        for (let i = 0; i < rawRecords.length; i++) {
          const rowNumber = i + 2; // 1-indexed + header row
          const row = normalizeRecordAliases(rawRecords[i]);

          // 1. Always stage the raw row into stg_<tableName> to preserve original data
          const stgVals = [
            ...matchedCols.map((col) => {
              const v = row[col];
              return v === undefined || v === null || v === '' ? 'NULL' : sqlLiteral(v);
            }),
            sqlLiteral(batchId),
            sqlLiteral(effectiveFileName),
            String(rowNumber),
            sqlLiteral(nowIso)
          ];
          stagingBuf.push(`(${stgVals.join(', ')})`);
          stagingRowsRead++;

          // Compute record key for reporting
          const recordKey =
            targetDef.primaryKeyColumns.length > 0
              ? targetDef.primaryKeyColumns.map((k) => row[k] || 'NULL').join('::')
              : `ROW-${rowNumber}`;

          // 2. Check required columns
          const missingReq = targetDef.requiredColumns.filter((reqCol) => {
            const val = row[reqCol];
            return val === undefined || val === null || String(val).trim() === '';
          });

          if (missingReq.length > 0) {
            missingRequiredCount++;
            rejectedRowsCount++;
            rejectedBuf.push(
              `(${[
                sqlLiteral(`${batchId}-R${rowNumber}`),
                sqlLiteral(batchId),
                sqlLiteral(effectiveFileName),
                sqlLiteral(targetDef.tableName),
                String(rowNumber),
                sqlLiteral(recordKey),
                sqlLiteral('MISSING_REQUIRED_KEY'),
                sqlLiteral(`Missing required column(s): ${missingReq.join(', ')}`),
                sqlLiteral(JSON.stringify(row).slice(0, 600)),
                sqlLiteral(nowIso)
              ].join(', ')})`
            );
            if (stagingBuf.length >= FLUSH_BATCH_SIZE) {
              await flushBuffers();
              await yieldToEventLoop();
            }
            continue;
          }

          // 3. Check duplicate primary/composite key
          if (targetDef.primaryKeyColumns.length > 0 && seenPrimaryKeys.has(recordKey)) {
            duplicateCount++;
            rejectedRowsCount++;
            rejectedBuf.push(
              `(${[
                sqlLiteral(`${batchId}-R${rowNumber}`),
                sqlLiteral(batchId),
                sqlLiteral(effectiveFileName),
                sqlLiteral(targetDef.tableName),
                String(rowNumber),
                sqlLiteral(recordKey),
                sqlLiteral('DUPLICATE_PRIMARY_KEY'),
                sqlLiteral(
                  `Duplicate primary key (${targetDef.primaryKeyColumns.join(', ')}) = "${recordKey}"`
                ),
                sqlLiteral(JSON.stringify(row).slice(0, 600)),
                sqlLiteral(nowIso)
              ].join(', ')})`
            );
            if (stagingBuf.length >= FLUSH_BATCH_SIZE) {
              await flushBuffers();
              await yieldToEventLoop();
            }
            continue;
          }

          // 4. Check date columns
          let dateRejected = false;
          for (const dateCol of targetDef.dateColumns) {
            const rawDate = row[dateCol.name];
            const isEmpty = rawDate === undefined || rawDate === null || String(rawDate).trim() === '';
            if (isEmpty) {
              if (dateCol.required) {
                invalidDateCount++;
                rejectedRowsCount++;
                dateRejected = true;
                rejectedBuf.push(
                  `(${[
                    sqlLiteral(`${batchId}-R${rowNumber}`),
                    sqlLiteral(batchId),
                    sqlLiteral(effectiveFileName),
                    sqlLiteral(targetDef.tableName),
                    String(rowNumber),
                    sqlLiteral(recordKey),
                    sqlLiteral('INVALID_DATE_FORMAT'),
                    sqlLiteral(`Required timestamp "${dateCol.name}" is empty.`),
                    sqlLiteral(JSON.stringify(row).slice(0, 600)),
                    sqlLiteral(nowIso)
                  ].join(', ')})`
                );
                break;
              }
            } else if (!isValidDateOrTimestamp(rawDate)) {
              invalidDateCount++;
              rejectedRowsCount++;
              dateRejected = true;
              rejectedBuf.push(
                `(${[
                  sqlLiteral(`${batchId}-R${rowNumber}`),
                  sqlLiteral(batchId),
                  sqlLiteral(effectiveFileName),
                  sqlLiteral(targetDef.tableName),
                  String(rowNumber),
                  sqlLiteral(recordKey),
                  sqlLiteral('INVALID_DATE_FORMAT'),
                  sqlLiteral(`Invalid date/timestamp "${rawDate}" in column "${dateCol.name}".`),
                  sqlLiteral(JSON.stringify(row).slice(0, 600)),
                  sqlLiteral(nowIso)
                ].join(', ')})`
              );
              break;
            }
          }
          if (dateRejected) {
            if (stagingBuf.length >= FLUSH_BATCH_SIZE) {
              await flushBuffers();
              await yieldToEventLoop();
            }
            continue;
          }

          // 5. Check numeric columns
          let numericRejected = false;
          for (const numCol of activeNumericCols) {
            const rawNum = row[numCol.name];
            const isEmpty = rawNum === undefined || rawNum === null || String(rawNum).trim() === '';
            if (isEmpty) continue;
            const parsedNum = Number(rawNum);
            const isNegForbidden = !numCol.allowNegative && parsedNum < 0;
            if (Number.isNaN(parsedNum) || isNegForbidden) {
              invalidNumericCount++;
              rejectedRowsCount++;
              numericRejected = true;
              rejectedBuf.push(
                `(${[
                  sqlLiteral(`${batchId}-R${rowNumber}`),
                  sqlLiteral(batchId),
                  sqlLiteral(effectiveFileName),
                  sqlLiteral(targetDef.tableName),
                  String(rowNumber),
                  sqlLiteral(recordKey),
                  sqlLiteral('INVALID_NUMERIC_VALUE'),
                  sqlLiteral(
                    `Invalid numeric value "${rawNum}" for column "${numCol.name}" (${numCol.type}).`
                  ),
                  sqlLiteral(JSON.stringify(row).slice(0, 600)),
                  sqlLiteral(nowIso)
                ].join(', ')})`
              );
              break;
            }
          }
          if (numericRejected) {
            if (stagingBuf.length >= FLUSH_BATCH_SIZE) {
              await flushBuffers();
              await yieldToEventLoop();
            }
            continue;
          }

          // Count missing optional fields for data quality warnings
          for (const colName of matchedCols) {
            if (!requiredColSet.has(colName)) {
              const val = row[colName];
              if (val === undefined || val === null || String(val).trim() === '') {
                missingOptionalCount++;
              }
            }
          }

          if (targetDef.primaryKeyColumns.length > 0) {
            seenPrimaryKeys.add(recordKey);
          }

          // Build cleaned row tuple with O(1) column type lookup
          const cleanVals = matchedCols.map((col) => {
            const colType = colTypeMap.get(col);
            const rawVal = row[col];
            if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
              return 'NULL';
            }
            if (colType === 'INTEGER' || colType === 'DOUBLE') {
              const num = Number(rawVal);
              return colType === 'INTEGER' ? String(Math.trunc(num)) : String(num);
            }
            return sqlLiteral(String(rawVal));
          });

          cleanedBuf.push(`(${cleanVals.join(', ')})`);
          cleanedRowsInserted++;

          // Incrementally flush chunks inside the single atomic transaction & yield event loop
          if (stagingBuf.length >= FLUSH_BATCH_SIZE) {
            await flushBuffers();
            await yieldToEventLoop();
          }
        }

        // Flush any remaining rows
        await flushBuffers();

        const durationMs = Math.round((performance.now() - startMs) * 100) / 100;

        await this.connection!.run(`
          INSERT INTO audit_import_batches VALUES (
            ${sqlLiteral(batchId)},
            ${sqlLiteral(effectiveFileName)},
            ${effectiveSize},
            ${sqlLiteral(targetDef.tableName)},
            ${sqlLiteral(rejectedRowsCount > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED')},
            ${stagingRowsRead},
            ${cleanedRowsInserted},
            ${rejectedRowsCount},
            ${duplicateCount},
            ${missingRequiredCount + missingOptionalCount},
            ${invalidDateCount},
            ${sqlLiteral(nowIso)},
            ${durationMs}
          );
        `);

        await this.connection!.run('COMMIT;');
      } catch (err) {
        try {
          await this.connection!.run('ROLLBACK;');
        } catch {
          // Ignore rollback failure
        }
        throw err;
      }

      const warnings: string[] = [];
      if (duplicateCount > 0) {
        warnings.push(`${duplicateCount} duplicate primary key record(s) isolated in audit_rejected_records.`);
      }
      if (missingRequiredCount > 0) {
        warnings.push(`${missingRequiredCount} record(s) missing required keys isolated in audit_rejected_records.`);
      }
      if (invalidDateCount > 0) {
        warnings.push(`${invalidDateCount} record(s) with invalid date formats isolated in audit_rejected_records.`);
      }
      if (invalidNumericCount > 0) {
        warnings.push(`${invalidNumericCount} record(s) with invalid numeric values isolated in audit_rejected_records.`);
      }
      if (missingOptionalCount > 0) {
        warnings.push(`${missingOptionalCount} optional cell value(s) were empty and stored as NULL.`);
      }

      const durationMs = Math.round((performance.now() - startMs) * 100) / 100;

      this.tableUpdatedAt.set(targetDef.tableName, nowIso);
      this.tableImportedFile.set(targetDef.tableName, effectiveFileName);
      this.tableSources.set(targetDef.tableName, 'OLIST CSV IMPORT');
      this.tableQualityMap.set(targetDef.tableName, {
        duplicateKeysCount: duplicateCount,
        missingRequiredCount,
        missingOptionalCount,
        invalidDateCount,
        invalidNumericCount,
        rejectedRowCount: rejectedRowsCount,
        warnings
      });
      this.dataMode = 'CUSTOM_UPLOAD';
      await this.persistWarehouseStateMetadata();
      this.bumpWarehouseEpoch();

      const batchReport: ImportBatchReport = {
        batchId,
        fileName: effectiveFileName,
        fileSizeBytes: effectiveSize,
        targetTable: targetDef.tableName,
        status: rejectedRowsCount > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED',
        stagingRowsRead,
        cleanedRowsInserted,
        rejectedRowsCount,
        duplicateCount,
        missingValueCount: missingRequiredCount + missingOptionalCount,
        invalidDateCount,
        detectedColumns: csvHeaders,
        columnCount: matchedCols.length,
        warnings,
        importedAt: nowIso,
        durationMs
      };
      this.importHistory.unshift(batchReport);

      const totalRowsAfter = await this.scalarCount(
        `SELECT COUNT(*) AS cnt FROM ${targetDef.tableName};`
      );

      return {
        batchReport,
        tableName: targetDef.tableName,
        rowsInserted: cleanedRowsInserted,
        stagingRowsRead,
        rejectedRowsCount,
        totalRowsAfter,
        columnsMatched: matchedCols,
        dataMode: this.dataMode
      };
    });
  }

  public async runDataQualityChecks(): Promise<QualityCheckItem[]> {
    await this.ensureInitialized();
    const checks: {
      id: string;
      tableName: string;
      checkName: string;
      category: QualityCheckItem['category'];
      description: string;
      totalSql: string;
      issueSql: string;
      sqlAssertion: string;
    }[] = [
      {
        id: 'dq-orders-pk',
        tableName: 'orders',
        checkName: 'Order Primary Key Uniqueness & Non-Null',
        category: 'UNIQUENESS',
        description: 'Ensures every record in cleaned orders has a non-null, unique order_id.',
        totalSql: 'SELECT COUNT(*) AS cnt FROM orders',
        issueSql:
          'SELECT (COUNT(*) - COUNT(DISTINCT order_id)) + SUM(CASE WHEN order_id IS NULL THEN 1 ELSE 0 END) AS issues FROM orders',
        sqlAssertion: 'COUNT(*) = COUNT(DISTINCT order_id) AND order_id IS NOT NULL'
      },
      {
        id: 'dq-orders-customer-fk',
        tableName: 'orders',
        checkName: 'Orders -> Customers Referential Integrity',
        category: 'REFERENTIAL_INTEGRITY',
        description: 'Verifies every order_id connects to an existing customer_id in customers.',
        totalSql: 'SELECT COUNT(*) AS cnt FROM orders',
        issueSql:
          'SELECT COUNT(*) AS issues FROM orders o LEFT JOIN customers c ON o.customer_id = c.customer_id WHERE c.customer_id IS NULL',
        sqlAssertion: 'orders.customer_id IN (SELECT customer_id FROM customers)'
      },
      {
        id: 'dq-items-order-fk',
        tableName: 'order_items',
        checkName: 'Order Items -> Orders Referential Integrity',
        category: 'REFERENTIAL_INTEGRITY',
        description: 'Verifies all line items connect to a valid parent order_id.',
        totalSql: 'SELECT COUNT(*) AS cnt FROM order_items',
        issueSql:
          'SELECT COUNT(*) AS issues FROM order_items oi LEFT JOIN orders o ON oi.order_id = o.order_id WHERE o.order_id IS NULL',
        sqlAssertion: 'order_items.order_id IN (SELECT order_id FROM orders)'
      },
      {
        id: 'dq-items-product-fk',
        tableName: 'order_items',
        checkName: 'Order Items -> Products Referential Integrity',
        category: 'REFERENTIAL_INTEGRITY',
        description: 'Verifies all line items reference an existing product_id in products.',
        totalSql: 'SELECT COUNT(*) AS cnt FROM order_items',
        issueSql:
          'SELECT COUNT(*) AS issues FROM order_items oi LEFT JOIN products p ON oi.product_id = p.product_id WHERE p.product_id IS NULL',
        sqlAssertion: 'order_items.product_id IN (SELECT product_id FROM products)'
      },
      {
        id: 'dq-items-seller-fk',
        tableName: 'order_items',
        checkName: 'Order Items -> Sellers Referential Integrity',
        category: 'REFERENTIAL_INTEGRITY',
        description: 'Verifies all line items reference an existing seller_id in sellers.',
        totalSql: 'SELECT COUNT(*) AS cnt FROM order_items',
        issueSql:
          'SELECT COUNT(*) AS issues FROM order_items oi LEFT JOIN sellers s ON oi.seller_id = s.seller_id WHERE s.seller_id IS NULL',
        sqlAssertion: 'order_items.seller_id IN (SELECT seller_id FROM sellers)'
      },
      {
        id: 'dq-products-translation-fk',
        tableName: 'products',
        checkName: 'Products -> Category Translations Lookup Coverage',
        category: 'REFERENTIAL_INTEGRITY',
        description:
          'Checks that non-null Portuguese product_category_name values map to English translations.',
        totalSql: 'SELECT COUNT(*) AS cnt FROM products WHERE product_category_name IS NOT NULL',
        issueSql:
          'SELECT COUNT(*) AS issues FROM products p LEFT JOIN category_translations ct ON p.product_category_name = ct.product_category_name WHERE p.product_category_name IS NOT NULL AND ct.product_category_name IS NULL',
        sqlAssertion:
          'products.product_category_name IN (SELECT product_category_name FROM category_translations)'
      },
      {
        id: 'dq-grain-safety-payments',
        tableName: 'payments',
        checkName: 'Order-Grain Payment Reconciliation (Anti-Multiplication Guard)',
        category: 'GRAIN_SAFETY',
        description:
          'Proves that joining vw_order_grain_summary preserves exact payment_value totals without multi-item fan-out.',
        totalSql: 'SELECT COUNT(DISTINCT order_id) AS cnt FROM payments',
        issueSql: `
          SELECT CASE
            WHEN ABS(
              (SELECT COALESCE(SUM(payment_value), 0) FROM payments WHERE order_id IN (SELECT order_id FROM orders)) -
              (SELECT COALESCE(SUM(settled_payment_value), 0) FROM vw_order_grain_summary)
            ) > 0.01 THEN 1 ELSE 0 END AS issues
        `,
        sqlAssertion: 'SUM(payments.payment_value) == SUM(vw_order_grain_summary.settled_payment_value)'
      },
      {
        id: 'dq-reviews-score-bounds',
        tableName: 'reviews',
        checkName: 'Review Score Domain Range [1..5]',
        category: 'VALIDITY',
        description: 'Asserts customer review scores fall strictly within the integer range 1 through 5.',
        totalSql: 'SELECT COUNT(*) AS cnt FROM reviews',
        issueSql:
          'SELECT COUNT(*) AS issues FROM reviews WHERE review_score < 1 OR review_score > 5 OR review_score IS NULL',
        sqlAssertion: 'reviews.review_score BETWEEN 1 AND 5'
      }
    ];

    const results: QualityCheckItem[] = [];

    for (const chk of checks) {
      const totalRes = await this.connection!.runAndReadAll(chk.totalSql);
      const totalChecked = Number(serializeValue(totalRes.getRowObjects()[0]?.cnt) ?? 0);

      if (totalChecked === 0) {
        results.push({
          id: chk.id,
          tableName: chk.tableName,
          checkName: chk.checkName,
          category: chk.category,
          sqlAssertion: chk.sqlAssertion,
          status: 'SKIPPED_EMPTY',
          issueCount: 0,
          totalChecked: 0,
          passRatePercent: null,
          description: chk.description
        });
        continue;
      }

      const issueRes = await this.connection!.runAndReadAll(chk.issueSql);
      const issueCount = Number(serializeValue(issueRes.getRowObjects()[0]?.issues) ?? 0);
      const passRate =
        Math.max(0, Math.round(((totalChecked - issueCount) / totalChecked) * 1000) / 10);

      results.push({
        id: chk.id,
        tableName: chk.tableName,
        checkName: chk.checkName,
        category: chk.category,
        sqlAssertion: chk.sqlAssertion,
        status: issueCount === 0 ? 'PASSED' : issueCount <= 2 ? 'WARNING' : 'FAILED',
        issueCount,
        totalChecked,
        passRatePercent: passRate,
        description: chk.description
      });
    }

    return results;
  }

  public async getModulePreview(moduleId: ModuleId): Promise<ModulePreviewPayload> {
    await this.ensureInitialized();
    const modConfig = getModuleById(moduleId);
    if (!modConfig) {
      throw new Error(`Module "${moduleId}" is not registered.`);
    }

    const statuses = await this.getDatasetStatuses();
    const requiredTables = modConfig.requiredTables.map((reqName) => {
      const found = statuses.find((s) => s.tableName === reqName);
      return {
        tableName: reqName,
        rowCount: found?.rowCount ?? 0,
        isPopulated: (found?.rowCount ?? 0) > 0
      };
    });

    const isReady = requiredTables.every((t) => t.isPopulated);

    if (!isReady) {
      return {
        moduleId,
        title: modConfig.title,
        dataMode: this.dataMode,
        isDemonstrationData: this.isDemonstrationData(),
        isReady: false,
        requiredTables,
        metrics: [
          {
            id: 'm1',
            label: 'Required Tables Populated',
            value: `${requiredTables.filter((t) => t.isPopulated).length} / ${requiredTables.length}`,
            unit: 'number',
            sqlSource: 'SHOW TABLES',
            subtitle: 'Awaiting Olist CSV ingestion or demonstration seed'
          }
        ],
        chartData: [],
        chartConfig: {
          xKey: 'label',
          yKey: 'value',
          chartType: 'bar',
          xLabel: 'Dimension',
          yLabel: 'Metric'
        },
        executedSql: modConfig.defaultSql,
        sampleRows: []
      };
    }

    const queryResult = await this.executeReadOnlyQuery(modConfig.defaultSql, 50);
    const metrics = await this.computeModuleMetrics(moduleId);
    const chartMeta = this.deriveChartMeta(moduleId, queryResult.rows);

    return {
      moduleId,
      title: modConfig.title,
      dataMode: this.dataMode,
      isDemonstrationData: this.isDemonstrationData(),
      isReady: true,
      requiredTables,
      metrics,
      chartData: chartMeta.data,
      chartConfig: chartMeta.config,
      executedSql: modConfig.defaultSql,
      sampleRows: queryResult.rows
    };
  }

  private async scalarNumber(sql: string): Promise<number | null> {
    const res = await this.connection!.runAndReadAll(sql);
    const rows = res.getRowObjects();
    if (!rows.length) return null;
    const firstKey = Object.keys(rows[0])[0];
    const val = serializeValue(rows[0][firstKey]);
    return typeof val === 'number' ? val : val !== null ? Number(val) : null;
  }

  private async computeModuleMetrics(moduleId: ModuleId): Promise<ModuleMetricItem[]> {
    switch (moduleId) {
      case 'executive-overview':
      case 'sales-intelligence': {
        // Strictly grain-safe: compute order-level payment total first!
        const totalRev = await this.scalarNumber(
          'SELECT ROUND(SUM(settled_payment_value), 2) FROM vw_order_grain_summary'
        );
        const orderCnt = await this.scalarNumber('SELECT COUNT(DISTINCT order_id) FROM orders');
        const aov = await this.scalarNumber(
          'SELECT ROUND(AVG(settled_payment_value), 2) FROM vw_order_grain_summary WHERE settled_payment_value > 0'
        );
        const freightRatio = await this.scalarNumber(
          'SELECT ROUND((SUM(freight_value) / NULLIF(SUM(price), 0)) * 100, 1) FROM order_items'
        );
        return [
          {
            id: 'rev',
            label: 'Total Settled Revenue',
            value: totalRev,
            unit: 'currency',
            sqlSource: 'SELECT SUM(settled_payment_value) FROM vw_order_grain_summary',
            subtitle: 'Order-grain reconciled payment volume'
          },
          {
            id: 'orders',
            label: 'Total Orders Processed',
            value: orderCnt,
            unit: 'number',
            sqlSource: 'SELECT COUNT(DISTINCT order_id) FROM orders',
            subtitle: 'Distinct order_id transactions'
          },
          {
            id: 'aov',
            label: 'Average Order Settlement',
            value: aov,
            unit: 'currency',
            sqlSource: 'SELECT AVG(settled_payment_value) FROM vw_order_grain_summary',
            subtitle: 'Mean order-level settlement value'
          },
          {
            id: 'freight',
            label: 'Freight-to-Merchandise Ratio',
            value: freightRatio,
            unit: 'percent',
            sqlSource: 'SELECT SUM(freight_value)/SUM(price) FROM order_items',
            subtitle: 'Shipping cost share of net item price'
          }
        ];
      }
      case 'customer-intelligence':
      case 'customer-retention': {
        const uniqueBuyers = await this.scalarNumber(
          'SELECT COUNT(DISTINCT customer_unique_id) FROM customers'
        );
        const totalOrders = await this.scalarNumber('SELECT COUNT(DISTINCT order_id) FROM orders');
        const repeatBuyers = await this.scalarNumber(`
          SELECT COUNT(*) FROM (
            SELECT c.customer_unique_id
            FROM customers c JOIN orders o ON c.customer_id = o.customer_id
            GROUP BY c.customer_unique_id HAVING COUNT(DISTINCT o.order_id) > 1
          )
        `);
        const repeatRate =
          uniqueBuyers && uniqueBuyers > 0 && repeatBuyers !== null
            ? Math.round((repeatBuyers / uniqueBuyers) * 1000) / 10
            : null;
        const avgLtv = await this.scalarNumber(`
          SELECT ROUND(AVG(spend), 2) FROM (
            SELECT c.customer_unique_id, SUM(v.settled_payment_value) AS spend
            FROM customers c
            JOIN vw_order_grain_summary v ON c.customer_id = v.customer_id
            GROUP BY c.customer_unique_id
          )
        `);
        return [
          {
            id: 'uniq-cust',
            label: 'Unique Customer Entities',
            value: uniqueBuyers,
            unit: 'number',
            sqlSource: 'SELECT COUNT(DISTINCT customer_unique_id) FROM customers',
            subtitle: 'Deduplicated customer_unique_id count'
          },
          {
            id: 'repeat-rate',
            label: 'Repeat Buyer Rate',
            value: repeatRate,
            unit: 'percent',
            sqlSource: 'HAVING COUNT(DISTINCT order_id) > 1',
            subtitle: 'Accounts with 2+ distinct orders'
          },
          {
            id: 'avg-ltv',
            label: 'Mean Account Lifetime Spend',
            value: avgLtv,
            unit: 'currency',
            sqlSource: 'AVG(SUM(settled_payment_value)) GROUP BY customer_unique_id',
            subtitle: 'Grain-safe revenue per unique buyer'
          },
          {
            id: 'total-ord',
            label: 'Active Order Records',
            value: totalOrders,
            unit: 'number',
            sqlSource: 'SELECT COUNT(DISTINCT order_id) FROM orders',
            subtitle: 'Linked customer order rows'
          }
        ];
      }
      case 'product-intelligence':
      case 'seller-performance': {
        const skuCount = await this.scalarNumber('SELECT COUNT(DISTINCT product_id) FROM products');
        const sellerCount = await this.scalarNumber('SELECT COUNT(DISTINCT seller_id) FROM sellers');
        const unitsSold = await this.scalarNumber('SELECT COUNT(*) FROM order_items');
        const avgRating = await this.scalarNumber('SELECT ROUND(AVG(review_score), 2) FROM reviews');
        return [
          {
            id: 'skus',
            label: 'Active Catalog SKUs',
            value: skuCount,
            unit: 'number',
            sqlSource: 'SELECT COUNT(DISTINCT product_id) FROM products',
            subtitle: 'Registered products in catalog'
          },
          {
            id: 'sellers',
            label: 'Active Fulfillment Sellers',
            value: sellerCount,
            unit: 'number',
            sqlSource: 'SELECT COUNT(DISTINCT seller_id) FROM sellers',
            subtitle: 'Partner nodes in sellers table'
          },
          {
            id: 'units',
            label: 'Line Item Units Sold',
            value: unitsSold,
            unit: 'number',
            sqlSource: 'SELECT COUNT(*) FROM order_items',
            subtitle: 'Total order_items records'
          },
          {
            id: 'rating',
            label: 'Mean Review Score',
            value: avgRating,
            unit: 'score',
            sqlSource: 'SELECT AVG(review_score) FROM reviews',
            subtitle: 'Customer review rating across orders'
          }
        ];
      }
      case 'delivery-analytics':
      default: {
        const deliveredCnt = await this.scalarNumber(
          "SELECT COUNT(*) FROM orders WHERE order_status = 'delivered'"
        );
        const delayedCnt = await this.scalarNumber(
          "SELECT COUNT(*) FROM orders WHERE order_status = 'delivered' AND order_delivered_customer_date > order_estimated_delivery_date"
        );
        const onTimeRate =
          deliveredCnt && deliveredCnt > 0 && delayedCnt !== null
            ? Math.round(((deliveredCnt - delayedCnt) / deliveredCnt) * 1000) / 10
            : null;
        const avgFreight = await this.scalarNumber(
          'SELECT ROUND(AVG(freight_value), 2) FROM vw_order_grain_summary WHERE item_count > 0'
        );
        return [
          {
            id: 'delivered',
            label: 'Delivered Orders',
            value: deliveredCnt,
            unit: 'number',
            sqlSource: "WHERE order_status = 'delivered'",
            subtitle: 'Completed customer deliveries'
          },
          {
            id: 'ontime',
            label: 'On-Time SLA Compliance',
            value: onTimeRate,
            unit: 'percent',
            sqlSource: 'delivered_date <= estimated_delivery_date',
            subtitle: 'Orders arriving on or before SLA date'
          },
          {
            id: 'delayed',
            label: 'SLA Delayed Shipments',
            value: delayedCnt,
            unit: 'number',
            sqlSource: 'delivered_date > estimated_delivery_date',
            subtitle: 'Shipments exceeding estimated date'
          },
          {
            id: 'avg-freight',
            label: 'Mean Order Freight Cost',
            value: avgFreight,
            unit: 'currency',
            sqlSource: 'SELECT AVG(freight_value) FROM vw_order_grain_summary',
            subtitle: 'Average shipping fee per order'
          }
        ];
      }
    }
  }

  private deriveChartMeta(
    moduleId: ModuleId,
    rows: Record<string, string | number | boolean | null>[]
  ): {
    data: Record<string, string | number | null>[];
    config: ModulePreviewPayload['chartConfig'];
  } {
    const cleanData = rows.map((r) => {
      const obj: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(r)) {
        obj[k] = typeof v === 'boolean' ? String(v) : v;
      }
      return obj;
    });

    switch (moduleId) {
      case 'sales-intelligence':
        return {
          data: cleanData,
          config: {
            xKey: 'order_month',
            yKey: 'gross_revenue',
            secondaryKey: 'total_orders',
            chartType: 'area',
            xLabel: 'Order Month',
            yLabel: 'Gross Revenue'
          }
        };
      case 'customer-intelligence':
        return {
          data: cleanData,
          config: {
            xKey: 'state',
            yKey: 'total_spend',
            secondaryKey: 'unique_customers',
            chartType: 'bar',
            xLabel: 'Customer State',
            yLabel: 'Total Spend'
          }
        };
      case 'customer-retention':
        return {
          data: cleanData,
          config: {
            xKey: 'cohort_bucket',
            yKey: 'customer_count',
            secondaryKey: 'avg_ltv',
            chartType: 'bar',
            xLabel: 'Purchase Frequency Cohort',
            yLabel: 'Customer Count'
          }
        };
      case 'product-intelligence':
        return {
          data: cleanData,
          config: {
            xKey: 'category',
            yKey: 'category_revenue',
            secondaryKey: 'units_sold',
            chartType: 'bar',
            xLabel: 'Translated Product Category',
            yLabel: 'Category Revenue'
          }
        };
      case 'seller-performance':
        return {
          data: cleanData,
          config: {
            xKey: 'seller_id',
            yKey: 'total_sales',
            secondaryKey: 'orders_fulfilled',
            chartType: 'bar',
            xLabel: 'Seller ID',
            yLabel: 'Total Sales'
          }
        };
      case 'delivery-analytics':
        return {
          data: cleanData,
          config: {
            xKey: 'state',
            yKey: 'delivered_orders',
            secondaryKey: 'delayed_orders',
            chartType: 'bar',
            xLabel: 'Destination State',
            yLabel: 'Delivered Orders'
          }
        };
      default:
        return {
          data: cleanData,
          config: {
            xKey: 'status',
            yKey: 'total_revenue',
            secondaryKey: 'order_count',
            chartType: 'bar',
            xLabel: 'Order Lifecycle Status',
            yLabel: 'Total Revenue'
          }
        };
    }
  }

  public async getAnalyticalModels(): Promise<AnalyticalModelMetadata[]> {
    await this.ensureInitialized();
    const models: AnalyticalModelMetadata[] = [];

    for (const def of ANALYTICAL_MODEL_DEFINITIONS) {
      const rowCount = await this.scalarCount(`SELECT COUNT(*) AS cnt FROM ${def.viewName};`);
      const descReader = await this.connection!.runAndReadAll(`DESCRIBE ${def.viewName};`);
      const descRows = descReader.getRowObjects();
      const columns = descRows.map((r) => ({
        name: String(serializeValue(r.column_name) ?? ''),
        type: String(serializeValue(r.column_type) ?? 'VARCHAR')
      }));

      models.push({
        ...def,
        rowCount,
        columnCount: columns.length,
        columns
      });
    }

    return models;
  }

  public async getKpiDictionary(): Promise<KpiDictionaryEntry[]> {
    await this.ensureInitialized();
    const entries: KpiDictionaryEntry[] = [];

    for (const spec of KPI_DICTIONARY_DEFINITIONS) {
      const val = await this.scalarNumber(spec.scalarSql);
      entries.push({
        id: spec.id,
        metricName: spec.metricName,
        category: spec.category,
        currentValue: val,
        unit: spec.unit,
        businessDefinition: spec.businessDefinition,
        grainAndJoinRule: spec.grainAndJoinRule,
        formulaExpression: spec.formulaExpression,
        reproducibleSql: spec.reproducibleSql,
        sourceAnalyticalModel: spec.sourceAnalyticalModel
      });
    }

    return entries;
  }

  public async getCustomerIdentityAudit(): Promise<CustomerIdentityAudit> {
    await this.ensureInitialized();
    const distinctCustomerIdsCount = await this.scalarCount(
      `SELECT COUNT(DISTINCT customer_id) AS cnt FROM customers;`
    );
    const distinctCustomerUniqueIdsCount = await this.scalarCount(
      `SELECT COUNT(DISTINCT customer_unique_id) AS cnt FROM customers WHERE customer_unique_id IS NOT NULL AND TRIM(customer_unique_id) <> '';`
    );
    const repeatCustomerUniqueIdsCount = await this.scalarCount(
      `SELECT COUNT(*) AS cnt FROM dim_customers WHERE is_repeat_customer = 1;`
    );

    const repeatByCustomerIdCount = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT customer_id FROM orders GROUP BY customer_id HAVING COUNT(DISTINCT order_id) > 1
      );
    `);

    const repeatRateByUniqueIdPercent =
      distinctCustomerUniqueIdsCount > 0
        ? Math.round((repeatCustomerUniqueIdsCount / distinctCustomerUniqueIdsCount) * 10000) / 100
        : 0;

    const repeatRateIfMisusingCustomerIdPercent =
      distinctCustomerIdsCount > 0
        ? Math.round((repeatByCustomerIdCount / distinctCustomerIdsCount) * 10000) / 100
        : 0;

    return {
      distinctCustomerIdsCount,
      distinctCustomerUniqueIdsCount,
      repeatCustomerUniqueIdsCount,
      repeatRateByUniqueIdPercent,
      repeatRateIfMisusingCustomerIdPercent,
      verificationSql: `SELECT
  COUNT(DISTINCT c.customer_id) AS order_scoped_customer_ids,
  COUNT(DISTINCT c.customer_unique_id) AS permanent_customer_unique_ids,
  COUNT(DISTINCT CASE WHEN dc.is_repeat_customer = 1 THEN dc.customer_unique_id END) AS repeat_customers_by_unique_id
FROM customers c
LEFT JOIN dim_customers dc ON c.customer_unique_id = dc.customer_unique_id;`
    };
  }

  public async evaluateIssueCategories(): Promise<DataQualityIssueReportItem[]> {
    await this.ensureInitialized();

    // Total counts across staging and cleaned layers for percentage calculations
    const totalStagingAll = await this.scalarCount(`
      SELECT (
        (SELECT COUNT(*) FROM stg_orders) +
        (SELECT COUNT(*) FROM stg_customers) +
        (SELECT COUNT(*) FROM stg_order_items) +
        (SELECT COUNT(*) FROM stg_payments) +
        (SELECT COUNT(*) FROM stg_reviews) +
        (SELECT COUNT(*) FROM stg_products) +
        (SELECT COUNT(*) FROM stg_sellers)
      ) AS cnt;
    `);
    const totalCleanedAll = await this.scalarCount(`
      SELECT (
        (SELECT COUNT(*) FROM orders) +
        (SELECT COUNT(*) FROM customers) +
        (SELECT COUNT(*) FROM order_items) +
        (SELECT COUNT(*) FROM payments) +
        (SELECT COUNT(*) FROM reviews) +
        (SELECT COUNT(*) FROM products) +
        (SELECT COUNT(*) FROM sellers)
      ) AS cnt;
    `);
    const baseTotalAll = Math.max(totalStagingAll, totalCleanedAll);

    // 1. Missing Values
    const quarantinedMissing = await this.scalarCount(
      `SELECT COUNT(*) AS cnt FROM audit_rejected_records WHERE rejection_reason = 'MISSING_REQUIRED_KEY';`
    );
    const cleanedMissingDeliveredDate = await this.scalarCount(
      `SELECT COUNT(*) AS cnt FROM orders WHERE order_status = 'delivered' AND (order_delivered_customer_date IS NULL OR TRIM(order_delivered_customer_date) = '');`
    );
    const cleanedMissingCustomerLoc = await this.scalarCount(
      `SELECT COUNT(*) AS cnt FROM customers WHERE customer_city IS NULL OR TRIM(customer_city) = '' OR customer_state IS NULL OR TRIM(customer_state) = '';`
    );
    const unresolvedMissing = cleanedMissingDeliveredDate + cleanedMissingCustomerLoc;
    const totalMissingAffected = quarantinedMissing + unresolvedMissing;

    // 2. Duplicate Primary Keys
    const quarantinedDuplicates = await this.scalarCount(
      `SELECT COUNT(*) AS cnt FROM audit_rejected_records WHERE rejection_reason = 'DUPLICATE_PRIMARY_KEY';`
    );
    const cleanedDuplicatePks = await this.scalarCount(`
      SELECT (
        (SELECT COUNT(*) - COUNT(DISTINCT order_id) FROM orders) +
        (SELECT COUNT(*) - COUNT(DISTINCT customer_id) FROM customers) +
        (SELECT COUNT(*) - COUNT(DISTINCT (order_id || '::' || CAST(order_item_id AS VARCHAR))) FROM order_items) +
        (SELECT COUNT(*) - COUNT(DISTINCT (order_id || '::' || CAST(payment_sequential AS VARCHAR))) FROM payments) +
        (SELECT COUNT(*) - COUNT(DISTINCT product_id) FROM products) +
        (SELECT COUNT(*) - COUNT(DISTINCT seller_id) FROM sellers)
      ) AS cnt;
    `);
    const totalDuplicatesAffected = quarantinedDuplicates + cleanedDuplicatePks;

    // 3. Invalid Foreign Keys
    const customersPopulated = (await this.scalarCount(`SELECT COUNT(*) AS cnt FROM customers;`)) > 0;
    const ordersPopulated = (await this.scalarCount(`SELECT COUNT(*) AS cnt FROM orders;`)) > 0;
    const productsPopulated = (await this.scalarCount(`SELECT COUNT(*) AS cnt FROM products;`)) > 0;
    const sellersPopulated = (await this.scalarCount(`SELECT COUNT(*) AS cnt FROM sellers;`)) > 0;

    let orphanFkCount = 0;
    if (ordersPopulated && customersPopulated) {
      orphanFkCount += await this.scalarCount(
        `SELECT COUNT(*) AS cnt FROM orders o LEFT JOIN customers c ON o.customer_id = c.customer_id WHERE c.customer_id IS NULL;`
      );
    }
    if (ordersPopulated) {
      orphanFkCount += await this.scalarCount(
        `SELECT COUNT(*) AS cnt FROM order_items oi LEFT JOIN orders o ON oi.order_id = o.order_id WHERE o.order_id IS NULL;`
      );
      orphanFkCount += await this.scalarCount(
        `SELECT COUNT(*) AS cnt FROM payments p LEFT JOIN orders o ON p.order_id = o.order_id WHERE o.order_id IS NULL;`
      );
      orphanFkCount += await this.scalarCount(
        `SELECT COUNT(*) AS cnt FROM reviews r LEFT JOIN orders o ON r.order_id = o.order_id WHERE o.order_id IS NULL;`
      );
    }
    if (productsPopulated) {
      orphanFkCount += await this.scalarCount(
        `SELECT COUNT(*) AS cnt FROM order_items oi LEFT JOIN products p ON oi.product_id = p.product_id WHERE p.product_id IS NULL;`
      );
    }
    if (sellersPopulated) {
      orphanFkCount += await this.scalarCount(
        `SELECT COUNT(*) AS cnt FROM order_items oi LEFT JOIN sellers s ON oi.seller_id = s.seller_id WHERE s.seller_id IS NULL;`
      );
    }
    const quarantinedFk = await this.scalarCount(
      `SELECT COUNT(*) AS cnt FROM audit_rejected_records WHERE details LIKE '%Foreign key%';`
    );
    const totalFkEvaluated = await this.scalarCount(`
      SELECT (
        (SELECT COUNT(*) FROM orders) +
        (SELECT COUNT(*) FROM order_items) +
        (SELECT COUNT(*) FROM payments) +
        (SELECT COUNT(*) FROM reviews)
      ) AS cnt;
    `);
    const totalFkAffected = orphanFkCount + quarantinedFk;

    // 4. Invalid Timestamps
    const quarantinedDates = await this.scalarCount(
      `SELECT COUNT(*) AS cnt FROM audit_rejected_records WHERE rejection_reason = 'INVALID_DATE_FORMAT';`
    );
    const chronologicalInversions = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM orders
      WHERE (order_delivered_customer_date IS NOT NULL AND order_delivered_customer_date < order_purchase_timestamp)
         OR (order_approved_at IS NOT NULL AND order_approved_at < order_purchase_timestamp);
    `);
    const totalTimestampRows = await this.scalarCount(`
      SELECT GREATEST(
        (SELECT COUNT(*) FROM stg_orders) + (SELECT COUNT(*) FROM stg_reviews),
        (SELECT COUNT(*) FROM orders) + (SELECT COUNT(*) FROM reviews)
      ) AS cnt;
    `);
    const totalTimestampsAffected = quarantinedDates + chronologicalInversions;

    // 5. Negative Prices
    const quarantinedNegativePrices = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM audit_rejected_records
      WHERE target_table = 'order_items' AND (rejection_reason = 'INVALID_NUMERIC_VALUE' OR details LIKE '%price%' OR details LIKE '%freight%');
    `);
    const cleanedNegativePrices = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM order_items WHERE price <= 0 OR freight_value < 0;
    `);
    const totalItemsEvaluated = await this.scalarCount(`
      SELECT GREATEST((SELECT COUNT(*) FROM stg_order_items), (SELECT COUNT(*) FROM order_items)) AS cnt;
    `);
    const totalNegativePricesAffected = quarantinedNegativePrices + cleanedNegativePrices;

    // 6. Missing Product Categories
    const totalProductsEvaluated = await this.scalarCount(`
      SELECT GREATEST((SELECT COUNT(*) FROM stg_products), (SELECT COUNT(*) FROM products)) AS cnt;
    `);
    const translationsPopulated =
      (await this.scalarCount(`SELECT COUNT(*) AS cnt FROM category_translations;`)) > 0;
    const unresolvedMissingCategories = await this.scalarCount(`
      SELECT COUNT(*) AS cnt
      FROM products p
      LEFT JOIN category_translations ct ON p.product_category_name = ct.product_category_name
      WHERE p.product_category_name IS NULL
         OR TRIM(p.product_category_name) = ''
         ${translationsPopulated ? "OR (p.product_category_name <> 'unclassified' AND ct.product_category_name IS NULL)" : ''};
    `);
    const remediatedCategories = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM products WHERE product_category_name = 'unclassified';
    `);
    const totalMissingCategoriesAffected = unresolvedMissingCategories + remediatedCategories;

    // 7. Invalid Order Statuses
    const totalOrdersEvaluated = await this.scalarCount(`
      SELECT GREATEST((SELECT COUNT(*) FROM stg_orders), (SELECT COUNT(*) FROM orders)) AS cnt;
    `);
    const unresolvedOrderStatuses = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM orders
      WHERE LOWER(TRIM(order_status)) NOT IN (
        'delivered', 'shipped', 'canceled', 'unavailable', 'invoiced', 'processing', 'created', 'approved'
      );
    `);
    const quarantinedOrderStatuses = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM audit_rejected_records WHERE target_table = 'orders' AND details LIKE '%order_status%';
    `);
    const totalInvalidStatusesAffected = unresolvedOrderStatuses + quarantinedOrderStatuses;

    // 8. Inconsistent Customer References
    const totalCustomersEvaluated = await this.scalarCount(`
      SELECT GREATEST((SELECT COUNT(*) FROM stg_customers), (SELECT COUNT(*) FROM customers)) AS cnt;
    `);
    const unresolvedCustomerRefs = await this.scalarCount(`
      SELECT (
        (SELECT COUNT(*) FROM customers WHERE customer_unique_id IS NULL OR TRIM(customer_unique_id) = '' OR LENGTH(TRIM(COALESCE(customer_state, ''))) <> 2) +
        (SELECT COUNT(*) FROM (SELECT customer_id FROM customers GROUP BY customer_id HAVING COUNT(DISTINCT customer_unique_id) > 1))
      ) AS cnt;
    `);
    const quarantinedCustomerRefs = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM audit_rejected_records WHERE target_table = 'customers';
    `);
    const totalCustomerRefsAffected = unresolvedCustomerRefs + quarantinedCustomerRefs;

    // 9. Invalid Payment Records
    const totalPaymentsEvaluated = await this.scalarCount(`
      SELECT GREATEST((SELECT COUNT(*) FROM stg_payments), (SELECT COUNT(*) FROM payments)) AS cnt;
    `);
    const unresolvedInvalidPayments = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM payments
      WHERE payment_value <= 0
         OR payment_installments < 1
         OR payment_type IS NULL
         OR LOWER(TRIM(payment_type)) IN ('not_defined', 'unknown', '');
    `);
    const quarantinedInvalidPayments = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM audit_rejected_records WHERE target_table = 'payments';
    `);
    const totalInvalidPaymentsAffected = unresolvedInvalidPayments + quarantinedInvalidPayments;

    const pct = (affected: number, total: number): number => {
      if (total <= 0) return 0;
      return Math.round((affected / total) * 10000) / 100;
    };

    const resolveStatus = (
      unresolved: number,
      quarantinedOrRemediated: number,
      mode: 'QUARANTINE' | 'REMEDIATE'
    ): {
      isResolved: boolean;
      label: DataQualityIssueReportItem['resolutionStatusLabel'];
    } => {
      if (unresolved > 0) {
        return { isResolved: false, label: 'UNRESOLVED (ACTION REQUIRED)' };
      }
      if (quarantinedOrRemediated > 0) {
        return {
          isResolved: true,
          label: mode === 'QUARANTINE' ? 'RESOLVED (STAGING QUARANTINE)' : 'RESOLVED (REMEDIATED)'
        };
      }
      return { isResolved: true, label: 'RESOLVED (0 ISSUES)' };
    };

    const m1 = resolveStatus(unresolvedMissing, quarantinedMissing, 'QUARANTINE');
    const m2 = resolveStatus(cleanedDuplicatePks, quarantinedDuplicates, 'QUARANTINE');
    const m3 = resolveStatus(orphanFkCount, quarantinedFk, 'QUARANTINE');
    const m4 = resolveStatus(chronologicalInversions, quarantinedDates, 'QUARANTINE');
    const m5 = resolveStatus(cleanedNegativePrices, quarantinedNegativePrices, 'QUARANTINE');
    const m6 = resolveStatus(unresolvedMissingCategories, remediatedCategories, 'REMEDIATE');
    const m7 = resolveStatus(unresolvedOrderStatuses, quarantinedOrderStatuses, 'REMEDIATE');
    const m8 = resolveStatus(unresolvedCustomerRefs, quarantinedCustomerRefs, 'QUARANTINE');
    const m9 = resolveStatus(unresolvedInvalidPayments, quarantinedInvalidPayments, 'QUARANTINE');

    return [
      {
        id: 'issue-missing-values',
        issueCategory: 'Missing Values',
        targetTable: 'stg_* / orders / customers',
        affectedRecords: totalMissingAffected,
        totalRecordsEvaluated: baseTotalAll,
        affectedPercentage: pct(totalMissingAffected, baseTotalAll),
        severity: unresolvedMissing > 0 ? 'HIGH' : 'MEDIUM',
        recommendedCorrection:
          'Isolate rows missing primary/required keys in audit_rejected_records and backfill optional location/delivery attributes.',
        isResolved: m1.isResolved,
        resolutionStatusLabel: m1.label,
        diagnosticSql: `SELECT * FROM audit_rejected_records WHERE rejection_reason = 'MISSING_REQUIRED_KEY';`
      },
      {
        id: 'issue-duplicate-pks',
        issueCategory: 'Duplicate Primary Keys',
        targetTable: 'orders / customers / order_items / payments',
        affectedRecords: totalDuplicatesAffected,
        totalRecordsEvaluated: baseTotalAll,
        affectedPercentage: pct(totalDuplicatesAffected, baseTotalAll),
        severity: 'CRITICAL',
        recommendedCorrection:
          'Deduplicate by primary/composite key during staging->cleaned ingestion and quarantine duplicate rows in audit_rejected_records.',
        isResolved: m2.isResolved,
        resolutionStatusLabel: m2.label,
        diagnosticSql: `SELECT target_table, record_key, details FROM audit_rejected_records WHERE rejection_reason = 'DUPLICATE_PRIMARY_KEY';`
      },
      {
        id: 'issue-invalid-fks',
        issueCategory: 'Invalid Foreign Keys',
        targetTable: 'orders / order_items / payments / reviews',
        affectedRecords: totalFkAffected,
        totalRecordsEvaluated: totalFkEvaluated,
        affectedPercentage: pct(totalFkAffected, totalFkEvaluated),
        severity: 'HIGH',
        recommendedCorrection:
          'Verify parent dimension/order keys exist or quarantine orphan child records into audit_rejected_records.',
        isResolved: m3.isResolved,
        resolutionStatusLabel: m3.label,
        diagnosticSql: `SELECT oi.order_id, oi.product_id, oi.seller_id FROM order_items oi LEFT JOIN orders o ON oi.order_id = o.order_id WHERE o.order_id IS NULL;`
      },
      {
        id: 'issue-invalid-timestamps',
        issueCategory: 'Invalid Timestamps',
        targetTable: 'stg_orders / orders / reviews',
        affectedRecords: totalTimestampsAffected,
        totalRecordsEvaluated: totalTimestampRows,
        affectedPercentage: pct(totalTimestampsAffected, totalTimestampRows),
        severity: 'HIGH',
        recommendedCorrection:
          'Reject unparseable ISO dates during staging and nullify corrupted delivery timestamps that precede order_purchase_timestamp.',
        isResolved: m4.isResolved,
        resolutionStatusLabel: m4.label,
        diagnosticSql: `SELECT order_id, order_purchase_timestamp, order_delivered_customer_date FROM orders WHERE order_delivered_customer_date < order_purchase_timestamp;`
      },
      {
        id: 'issue-negative-prices',
        issueCategory: 'Negative Prices',
        targetTable: 'stg_order_items / order_items',
        affectedRecords: totalNegativePricesAffected,
        totalRecordsEvaluated: totalItemsEvaluated,
        affectedPercentage: pct(totalNegativePricesAffected, totalItemsEvaluated),
        severity: 'CRITICAL',
        recommendedCorrection:
          'Enforce price > 0 and freight_value >= 0 constraints; quarantine negative or zero-priced line items into audit_rejected_records.',
        isResolved: m5.isResolved,
        resolutionStatusLabel: m5.label,
        diagnosticSql: `SELECT order_id, order_item_id, price, freight_value FROM order_items WHERE price <= 0 OR freight_value < 0;`
      },
      {
        id: 'issue-missing-categories',
        issueCategory: 'Missing Product Categories',
        targetTable: 'products / category_translations',
        affectedRecords: totalMissingCategoriesAffected,
        totalRecordsEvaluated: totalProductsEvaluated,
        affectedPercentage: pct(totalMissingCategoriesAffected, totalProductsEvaluated),
        severity: 'MEDIUM',
        recommendedCorrection:
          "Impute NULL or untranslated product_category_name values to 'unclassified' and register in category_translations.",
        isResolved: m6.isResolved,
        resolutionStatusLabel: m6.label,
        diagnosticSql: `SELECT p.product_id, p.product_category_name, ct.product_category_name_english FROM products p LEFT JOIN category_translations ct ON p.product_category_name = ct.product_category_name WHERE p.product_category_name IS NULL OR ct.product_category_name IS NULL;`
      },
      {
        id: 'issue-invalid-statuses',
        issueCategory: 'Invalid Order Statuses',
        targetTable: 'orders',
        affectedRecords: totalInvalidStatusesAffected,
        totalRecordsEvaluated: totalOrdersEvaluated,
        affectedPercentage: pct(totalInvalidStatusesAffected, totalOrdersEvaluated),
        severity: 'MEDIUM',
        recommendedCorrection:
          'Validate order_status against the 8 canonical Olist states (delivered, shipped, canceled, unavailable, invoiced, processing, created, approved).',
        isResolved: m7.isResolved,
        resolutionStatusLabel: m7.label,
        diagnosticSql: `SELECT order_id, order_status FROM orders WHERE LOWER(TRIM(order_status)) NOT IN ('delivered','shipped','canceled','unavailable','invoiced','processing','created','approved');`
      },
      {
        id: 'issue-inconsistent-customers',
        issueCategory: 'Inconsistent Customer References',
        targetTable: 'customers',
        affectedRecords: totalCustomerRefsAffected,
        totalRecordsEvaluated: totalCustomersEvaluated,
        affectedPercentage: pct(totalCustomerRefsAffected, totalCustomersEvaluated),
        severity: 'HIGH',
        recommendedCorrection:
          'Ensure every customer_id maps to a non-empty permanent customer_unique_id and valid 2-letter Brazilian state code.',
        isResolved: m8.isResolved,
        resolutionStatusLabel: m8.label,
        diagnosticSql: `SELECT customer_id, customer_unique_id, customer_state FROM customers WHERE customer_unique_id IS NULL OR TRIM(customer_unique_id) = '' OR LENGTH(TRIM(COALESCE(customer_state, ''))) <> 2;`
      },
      {
        id: 'issue-invalid-payments',
        issueCategory: 'Invalid Payment Records',
        targetTable: 'payments',
        affectedRecords: totalInvalidPaymentsAffected,
        totalRecordsEvaluated: totalPaymentsEvaluated,
        affectedPercentage: pct(totalInvalidPaymentsAffected, totalPaymentsEvaluated),
        severity: 'HIGH',
        recommendedCorrection:
          "Quarantine payment records where payment_value <= 0, payment_installments < 1, or payment_type = 'not_defined'.",
        isResolved: m9.isResolved,
        resolutionStatusLabel: m9.label,
        diagnosticSql: `SELECT order_id, payment_sequential, payment_type, payment_installments, payment_value FROM payments WHERE payment_value <= 0 OR payment_installments < 1 OR LOWER(TRIM(payment_type)) = 'not_defined';`
      }
    ];
  }

  public async getDataQualityAndModelingDashboard(): Promise<DataQualityAndModelingPayload> {
    await this.ensureInitialized();
    const [issues, checks, analyticalModels, kpiDictionary, customerIdentityAudit] =
      await Promise.all([
        this.evaluateIssueCategories(),
        this.runDataQualityChecks(),
        this.getAnalyticalModels(),
        this.getKpiDictionary(),
        this.getCustomerIdentityAudit()
      ]);

    const totalRecordsEvaluated = issues[0]?.totalRecordsEvaluated ?? 0;
    const totalIssuesDetected = issues.reduce((acc, item) => acc + item.affectedRecords, 0);
    const unresolvedRecordsCount = issues
      .filter((item) => !item.isResolved)
      .reduce((acc, item) => acc + item.affectedRecords, 0);

    const resolvedIssuesCount = issues.filter((i) => i.isResolved).length;
    const unresolvedIssuesCount = issues.filter((i) => !i.isResolved).length;

    const overallQualityScorePercent =
      totalRecordsEvaluated > 0
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round(
                ((totalRecordsEvaluated - unresolvedRecordsCount) / totalRecordsEvaluated) * 10000
              ) / 100
            )
          )
        : 100;

    return {
      overallQualityScorePercent,
      totalRecordsEvaluated,
      totalIssuesDetected,
      resolvedIssuesCount,
      unresolvedIssuesCount,
      issues,
      checks,
      analyticalModels,
      kpiDictionary,
      customerIdentityAudit
    };
  }

  public async injectSampleQualityAnomalies(): Promise<DataQualityAndModelingPayload> {
    await this.ensureInitialized();
    const nowIso = new Date().toISOString();

    await this.withWriteLock(async () => {
      // Clean any prior injected test anomalies so injection is idempotent
      await this.connection!.run(`DELETE FROM products WHERE product_id = 'PROD-ANOMALY-999';`);
      await this.connection!.run(`DELETE FROM orders WHERE order_id = 'ORD-ANOMALY-999';`);
      await this.connection!.run(`DELETE FROM order_items WHERE order_id = 'ORD-ANOMALY-999';`);
      await this.connection!.run(`DELETE FROM payments WHERE order_id = 'ORD-ANOMALY-999';`);
      await this.connection!.run(`DELETE FROM customers WHERE customer_id = 'CUST-ANOMALY-999';`);
      await this.connection!.run(
        `DELETE FROM audit_rejected_records WHERE batch_id = 'BATCH-ANOMALY-TEST';`
      );

      // 1. Missing Product Category in products
      await this.connection!.run(`
        INSERT INTO products (product_id, product_category_name, product_name, product_name_lenght, product_description_lenght, product_photos_qty, product_weight_g, product_length_cm, product_height_cm, product_width_cm, unit_cost_estimate)
        VALUES ('PROD-ANOMALY-999', NULL, 'Uncategorized Optical Transceiver', 33, 210, 1, 250, 14, 5, 10, 95.00);
      `);

      // 2. Customer with invalid 3-letter state code
      await this.connection!.run(`
        INSERT INTO customers (customer_id, customer_unique_id, customer_zip_code_prefix, customer_city, customer_state, customer_segment)
        VALUES ('CUST-ANOMALY-999', 'UNIQ-ANOMALY-999', '01310', 'sao paulo', 'SPX', 'SMB');
      `);

      // 3. Order with invalid order_status ('pending_audit') AND inverted delivery timestamp (< purchase timestamp)
      await this.connection!.run(`
        INSERT INTO orders (order_id, customer_id, order_status, order_purchase_timestamp, order_approved_at, order_delivered_carrier_date, order_delivered_customer_date, order_estimated_delivery_date)
        VALUES ('ORD-ANOMALY-999', 'CUST-ANOMALY-999', 'pending_audit', '2026-11-10 12:00:00', '2026-11-10 12:30:00', '2026-11-11 09:00:00', '2026-11-01 08:00:00', '2026-11-16 00:00:00');
      `);

      // 4. Order Item with negative price (-45.00) and orphan seller_id ('SELL-ORPHAN-999')
      await this.connection!.run(`
        INSERT INTO order_items (order_id, order_item_id, product_id, seller_id, shipping_limit_date, price, freight_value)
        VALUES ('ORD-ANOMALY-999', 1, 'PROD-ANOMALY-999', 'SELL-ORPHAN-999', '2026-11-14 12:00:00', -45.00, 12.00);
      `);

      // 5. Payment with invalid payment_type ('not_defined') and 0 payment_value
      await this.connection!.run(`
        INSERT INTO payments (order_id, payment_sequential, payment_type, payment_installments, payment_value)
        VALUES ('ORD-ANOMALY-999', 1, 'not_defined', 0, 0.00);
      `);

      // 6. Log a duplicate PK and missing required value in audit_rejected_records
      await this.connection!.run(`
        INSERT INTO audit_rejected_records VALUES
        ('REJ-ANOM-1', 'BATCH-ANOMALY-TEST', 'olist_orders_dataset.csv', 'orders', 991, 'ORD-9001', 'DUPLICATE_PRIMARY_KEY', 'Duplicate primary key (order_id) = "ORD-9001"', '{"order_id":"ORD-9001"}', '${nowIso}'),
        ('REJ-ANOM-2', 'BATCH-ANOMALY-TEST', 'olist_orders_dataset.csv', 'orders', 992, 'NULL', 'MISSING_REQUIRED_KEY', 'Missing required column(s): order_id', '{"order_id":""}', '${nowIso}');
      `);

      this.bumpWarehouseEpoch();
    });
    return this.getDataQualityAndModelingDashboard();
  }

  public async remediateDataQualityIssues(): Promise<RemediationResultPayload> {
    await this.ensureInitialized();
    const actionsExecuted: string[] = [];
    let rowsRemediated = 0;
    const nowIso = new Date().toISOString();

    await this.withWriteLock(async () => {
    // 1. Remediate Missing / Untranslated Product Categories
    const missingCatCnt = await this.scalarCount(`
      SELECT COUNT(*) AS cnt
      FROM products p
      LEFT JOIN category_translations ct ON p.product_category_name = ct.product_category_name
      WHERE p.product_category_name IS NULL
         OR TRIM(p.product_category_name) = ''
         OR (p.product_category_name <> 'unclassified' AND ct.product_category_name IS NULL);
    `);
    if (missingCatCnt > 0) {
      await this.connection!.run(`
        INSERT INTO category_translations (product_category_name, product_category_name_english)
        SELECT 'unclassified', 'unclassified'
        WHERE NOT EXISTS (SELECT 1 FROM category_translations WHERE product_category_name = 'unclassified');
      `);
      await this.connection!.run(`
        UPDATE products
        SET product_category_name = 'unclassified'
        WHERE product_category_name IS NULL
           OR TRIM(product_category_name) = ''
           OR product_category_name NOT IN (SELECT product_category_name FROM category_translations);
      `);
      rowsRemediated += missingCatCnt;
      actionsExecuted.push(
        `Imputed ${missingCatCnt} product(s) with missing/untranslated categories to 'unclassified'.`
      );
    }

    // 2. Quarantine and remove Negative or Zero Prices in order_items
    const negPriceCnt = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM order_items WHERE price <= 0 OR freight_value < 0;
    `);
    if (negPriceCnt > 0) {
      await this.connection!.run(`
        INSERT INTO audit_rejected_records
        SELECT
          'REM-NEG-' || order_id || '-' || CAST(order_item_id AS VARCHAR),
          'AUTOMATED-REMEDIATION',
          'olist_order_items_dataset.csv',
          'order_items',
          0,
          order_id || '::' || CAST(order_item_id AS VARCHAR),
          'INVALID_NUMERIC_VALUE',
          'Quarantined negative/zero price (' || CAST(price AS VARCHAR) || ') or freight (' || CAST(freight_value AS VARCHAR) || ')',
          '{"order_id":"' || order_id || '","price":' || CAST(price AS VARCHAR) || '}',
          '${nowIso}'
        FROM order_items
        WHERE price <= 0 OR freight_value < 0;
      `);
      await this.connection!.run(`DELETE FROM order_items WHERE price <= 0 OR freight_value < 0;`);
      rowsRemediated += negPriceCnt;
      actionsExecuted.push(
        `Quarantined ${negPriceCnt} line item(s) with negative/zero price into audit_rejected_records.`
      );
    }

    // 3. Quarantine and remove Invalid Payment Records
    const invalidPayCnt = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM payments
      WHERE payment_value <= 0
         OR payment_installments < 1
         OR payment_type IS NULL
         OR LOWER(TRIM(payment_type)) IN ('not_defined', 'unknown', '');
    `);
    if (invalidPayCnt > 0) {
      await this.connection!.run(`
        INSERT INTO audit_rejected_records
        SELECT
          'REM-PAY-' || order_id || '-' || CAST(payment_sequential AS VARCHAR),
          'AUTOMATED-REMEDIATION',
          'olist_order_payments_dataset.csv',
          'payments',
          0,
          order_id || '::' || CAST(payment_sequential AS VARCHAR),
          'INVALID_NUMERIC_VALUE',
          'Quarantined invalid payment record: type=' || COALESCE(payment_type, 'NULL') || ', value=' || CAST(payment_value AS VARCHAR),
          '{"order_id":"' || order_id || '","payment_type":"' || COALESCE(payment_type, '') || '"}',
          '${nowIso}'
        FROM payments
        WHERE payment_value <= 0
           OR payment_installments < 1
           OR payment_type IS NULL
           OR LOWER(TRIM(payment_type)) IN ('not_defined', 'unknown', '');
      `);
      await this.connection!.run(`
        DELETE FROM payments
        WHERE payment_value <= 0
           OR payment_installments < 1
           OR payment_type IS NULL
           OR LOWER(TRIM(payment_type)) IN ('not_defined', 'unknown', '');
      `);
      rowsRemediated += invalidPayCnt;
      actionsExecuted.push(
        `Quarantined ${invalidPayCnt} invalid payment record(s) (payment_value <= 0 or not_defined) into audit_rejected_records.`
      );
    }

    // 4. Normalize Invalid Order Statuses
    const invalidStatusCnt = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM orders
      WHERE LOWER(TRIM(order_status)) NOT IN (
        'delivered', 'shipped', 'canceled', 'unavailable', 'invoiced', 'processing', 'created', 'approved'
      );
    `);
    if (invalidStatusCnt > 0) {
      await this.connection!.run(`
        UPDATE orders
        SET order_status = 'processing'
        WHERE LOWER(TRIM(order_status)) NOT IN (
          'delivered', 'shipped', 'canceled', 'unavailable', 'invoiced', 'processing', 'created', 'approved'
        );
      `);
      rowsRemediated += invalidStatusCnt;
      actionsExecuted.push(
        `Normalized ${invalidStatusCnt} order(s) with non-canonical status to 'processing'.`
      );
    }

    // 5. Fix Chronological Timestamp Inversions in orders
    const invertedTsCnt = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM orders
      WHERE (order_delivered_customer_date IS NOT NULL AND order_delivered_customer_date < order_purchase_timestamp)
         OR (order_approved_at IS NOT NULL AND order_approved_at < order_purchase_timestamp);
    `);
    if (invertedTsCnt > 0) {
      await this.connection!.run(`
        UPDATE orders
        SET order_delivered_customer_date = order_estimated_delivery_date
        WHERE order_delivered_customer_date IS NOT NULL
          AND order_delivered_customer_date < order_purchase_timestamp;
      `);
      await this.connection!.run(`
        UPDATE orders
        SET order_approved_at = order_purchase_timestamp
        WHERE order_approved_at IS NOT NULL
          AND order_approved_at < order_purchase_timestamp;
      `);
      rowsRemediated += invertedTsCnt;
      actionsExecuted.push(
        `Corrected ${invertedTsCnt} order(s) with inverted delivery/approval timestamps.`
      );
    }

    // 6. Fix Inconsistent Customer State / Missing City or Unique ID
    const badCustCnt = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM customers
      WHERE customer_unique_id IS NULL
         OR TRIM(customer_unique_id) = ''
         OR LENGTH(TRIM(COALESCE(customer_state, ''))) <> 2
         OR customer_city IS NULL
         OR TRIM(customer_city) = '';
    `);
    if (badCustCnt > 0) {
      await this.connection!.run(`
        UPDATE customers
        SET
          customer_unique_id = COALESCE(NULLIF(TRIM(customer_unique_id), ''), customer_id),
          customer_city = COALESCE(NULLIF(TRIM(customer_city), ''), 'sao paulo'),
          customer_state = CASE
            WHEN LENGTH(TRIM(COALESCE(customer_state, ''))) = 2 THEN UPPER(TRIM(customer_state))
            WHEN LENGTH(TRIM(COALESCE(customer_state, ''))) > 2 THEN UPPER(SUBSTR(TRIM(customer_state), 1, 2))
            ELSE 'SP'
          END
        WHERE customer_unique_id IS NULL
           OR TRIM(customer_unique_id) = ''
           OR LENGTH(TRIM(COALESCE(customer_state, ''))) <> 2
           OR customer_city IS NULL
           OR TRIM(customer_city) = '';
      `);
      rowsRemediated += badCustCnt;
      actionsExecuted.push(
        `Standardized ${badCustCnt} customer record(s) with inconsistent state codes or missing attributes.`
      );
    }

    // 7. Quarantine Orphan Foreign Key records in order_items
    const orphanItemsCnt = await this.scalarCount(`
      SELECT COUNT(*) AS cnt FROM order_items oi
      LEFT JOIN orders o ON oi.order_id = o.order_id
      LEFT JOIN products p ON oi.product_id = p.product_id
      LEFT JOIN sellers s ON oi.seller_id = s.seller_id
      WHERE o.order_id IS NULL OR p.product_id IS NULL OR s.seller_id IS NULL;
    `);
    if (orphanItemsCnt > 0) {
      await this.connection!.run(`
        INSERT INTO audit_rejected_records
        SELECT
          'REM-FK-' || oi.order_id || '-' || CAST(oi.order_item_id AS VARCHAR),
          'AUTOMATED-REMEDIATION',
          'olist_order_items_dataset.csv',
          'order_items',
          0,
          oi.order_id || '::' || CAST(oi.order_item_id AS VARCHAR),
          'SCHEMA_MISMATCH',
          'Foreign key violation: orphan order_id, product_id, or seller_id',
          '{"order_id":"' || oi.order_id || '","seller_id":"' || oi.seller_id || '"}',
          '${nowIso}'
        FROM order_items oi
        LEFT JOIN orders o ON oi.order_id = o.order_id
        LEFT JOIN products p ON oi.product_id = p.product_id
        LEFT JOIN sellers s ON oi.seller_id = s.seller_id
        WHERE o.order_id IS NULL OR p.product_id IS NULL OR s.seller_id IS NULL;
      `);
      await this.connection!.run(`
        DELETE FROM order_items
        WHERE order_id NOT IN (SELECT order_id FROM orders)
           OR product_id NOT IN (SELECT product_id FROM products)
           OR seller_id NOT IN (SELECT seller_id FROM sellers);
      `);
      rowsRemediated += orphanItemsCnt;
      actionsExecuted.push(
        `Quarantined ${orphanItemsCnt} orphan order_items record(s) with invalid foreign keys into audit_rejected_records.`
      );
    }

    if (actionsExecuted.length === 0) {
      actionsExecuted.push('All 9 data quality categories are already clean and resolved.');
    }

    this.bumpWarehouseEpoch();
    });
    const updatedDashboard = await this.getDataQualityAndModelingDashboard();
    return {
      actionsExecuted,
      rowsRemediated,
      updatedQualityScorePercent: updatedDashboard.overallQualityScorePercent
    };
  }

  public async getSqlLabWorkspacePayload(): Promise<SqlLabWorkspacePayload> {
    await this.ensureInitialized();
    return {
      totalCuratedQueries: CURATED_SQL_LIBRARY.length,
      totalCategories: SQL_QUERY_CATEGORIES.length,
      totalSqlConcepts: REQUIRED_SQL_CONCEPTS.length,
      savedCustomQueries: this.savedCustomQueries,
      executionHistory: this.sqlExecutionHistory,
      dataMode: this.dataMode,
      isDemonstrationData: this.isDemonstrationData()
    };
  }

  public async saveCustomSqlQuery(
    req: SaveCustomSqlQueryRequest
  ): Promise<SavedCustomSqlQuery> {
    await this.ensureInitialized();
    const validation = validateSqlQuery(req.sql || '');
    if (!validation.valid || !validation.normalizedValue) {
      throw new Error(validation.error || 'Invalid SQL statement.');
    }

    const title = (req.title || '').trim();
    const businessQuestion = (req.businessQuestion || '').trim();
    const explanation = (req.explanation || '').trim();
    const expectedInterpretation = (req.expectedInterpretation || '').trim();

    if (!title || !businessQuestion) {
      throw new Error('Both a query title and a business question are required to save a query.');
    }

    const nextIndex = this.savedCustomQueries.length + 1;
    const saved: SavedCustomSqlQuery = {
      id: `custom-sql-${Date.now()}-${nextIndex}`,
      code: `USR-${String(nextIndex).padStart(2, '0')}`,
      category: req.category || 'Sales Analysis',
      title,
      businessQuestion,
      sql: validation.normalizedValue,
      explanation:
        explanation ||
        'Custom analyst SQL query validated and saved in the RetailPulse SQL Analytics Lab.',
      expectedInterpretation:
        expectedInterpretation ||
        'Review returned columns and row grain against the target analytical view or base Olist table.',
      sqlConcepts:
        req.sqlConcepts && req.sqlConcepts.length > 0 ? req.sqlConcepts : ['GROUP BY'],
      createdAt: new Date().toISOString(),
      isCustom: true
    };

    this.savedCustomQueries = [saved, ...this.savedCustomQueries];
    await this.connection!.run(`
      INSERT OR REPLACE INTO _rp_saved_queries (id, payload_json, created_at)
      VALUES (${sqlLiteral(saved.id)}, ${sqlLiteral(JSON.stringify(saved))}, ${sqlLiteral(saved.createdAt)});
    `);
    await this.persistWarehouseStateMetadata();
    return saved;
  }

  public async deleteCustomSqlQuery(id: string): Promise<SavedCustomSqlQuery[]> {
    await this.ensureInitialized();
    this.savedCustomQueries = this.savedCustomQueries.filter((q) => q.id !== id);
    await this.connection!.run(`DELETE FROM _rp_saved_queries WHERE id = ${sqlLiteral(id)};`);
    await this.persistWarehouseStateMetadata();
    return this.savedCustomQueries;
  }

  public async verifySqlBenchmarksAgainstIndependentCalc(): Promise<
    SqlBenchmarkVerificationItem[]
  > {
    await this.ensureInitialized();

    const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
    const isClose = (a: number, b: number, tol = 0.05): boolean => Math.abs(a - b) <= tol;

    // Fetch raw rows from base tables to compute independent TypeScript calculations
    const [
      ordersReader,
      customersReader,
      itemsReader,
      paymentsReader,
      productsReader,
      translationsReader
    ] = await Promise.all([
      this.connection!.runAndReadAll(`SELECT * FROM orders;`),
      this.connection!.runAndReadAll(`SELECT * FROM customers;`),
      this.connection!.runAndReadAll(`SELECT * FROM order_items;`),
      this.connection!.runAndReadAll(`SELECT * FROM payments;`),
      this.connection!.runAndReadAll(`SELECT * FROM products;`),
      this.connection!.runAndReadAll(`SELECT * FROM category_translations;`)
    ]);

    const rawOrders = ordersReader.getRowObjects();
    const rawCustomers = customersReader.getRowObjects();
    const rawItems = itemsReader.getRowObjects();
    const rawPayments = paymentsReader.getRowObjects();
    const rawProducts = productsReader.getRowObjects();
    const rawTranslations = translationsReader.getRowObjects();

    // Build base lookups in pure TypeScript
    const validOrderIds = new Set<string>();
    for (const o of rawOrders) {
      const oid = String(serializeValue(o.order_id) ?? '');
      if (oid) validOrderIds.add(oid);
    }

    const itemRollupByOrder = new Map<
      string,
      { units: number; gmv: number; freight: number }
    >();
    for (const it of rawItems) {
      const oid = String(serializeValue(it.order_id) ?? '');
      const price = Number(serializeValue(it.price) ?? 0);
      const freight = Number(serializeValue(it.freight_value) ?? 0);
      const curr = itemRollupByOrder.get(oid) || { units: 0, gmv: 0, freight: 0 };
      curr.units += 1;
      curr.gmv = round2(curr.gmv + price);
      curr.freight = round2(curr.freight + freight);
      itemRollupByOrder.set(oid, curr);
    }

    const paymentRollupByOrder = new Map<string, { rows: number; settled: number }>();
    for (const p of rawPayments) {
      const oid = String(serializeValue(p.order_id) ?? '');
      const val = Number(serializeValue(p.payment_value) ?? 0);
      const curr = paymentRollupByOrder.get(oid) || { rows: 0, settled: 0 };
      curr.rows += 1;
      curr.settled = round2(curr.settled + val);
      paymentRollupByOrder.set(oid, curr);
    }

    const results: SqlBenchmarkVerificationItem[] = [];

    // =========================================================================
    // BENCHMARK 1: REVENUE (SAL-01)
    // =========================================================================
    const sal01Def = CURATED_SQL_LIBRARY.find((q) => q.code === 'SAL-01')!;
    const sal01Exec = await this.executeReadOnlyQuery(sal01Def.sql, 100, false);
    const sal01Row = sal01Exec.rows[0] || {};

    let indTotalOrders = 0;
    let indTotalGmv = 0;
    let indTotalFreight = 0;
    let indTotalSettled = 0;
    const nonZeroSettledValues: number[] = [];

    for (const oid of validOrderIds) {
      indTotalOrders += 1;
      const ir = itemRollupByOrder.get(oid);
      const pr = paymentRollupByOrder.get(oid);
      if (ir) {
        indTotalGmv = round2(indTotalGmv + round2(ir.gmv));
        indTotalFreight = round2(indTotalFreight + round2(ir.freight));
      }
      if (pr) {
        const s = round2(pr.settled);
        indTotalSettled = round2(indTotalSettled + s);
        if (s > 0) nonZeroSettledValues.push(s);
      }
    }
    const indAov =
      nonZeroSettledValues.length > 0
        ? round2(
            nonZeroSettledValues.reduce((a, b) => a + b, 0) / nonZeroSettledValues.length
          )
        : 0;

    const sqlTotalOrders = Number(sal01Row.total_orders ?? 0);
    const sqlGmv = Number(sal01Row.gross_merchandise_value ?? 0);
    const sqlFreight = Number(sal01Row.total_freight_revenue ?? 0);
    const sqlTotalVal = Number(sal01Row.total_order_value ?? 0);
    const sqlAov = Number(sal01Row.average_order_value ?? 0);

    const revComparisons: SqlBenchmarkMetricComparison[] = [
      {
        metricKey: 'total_orders',
        metricLabel: 'Distinct Orders (Grain Count)',
        sqlValue: sqlTotalOrders,
        independentValue: indTotalOrders,
        delta: round2(sqlTotalOrders - indTotalOrders),
        unit: 'number',
        isMatch: sqlTotalOrders === indTotalOrders
      },
      {
        metricKey: 'gross_merchandise_value',
        metricLabel: 'Gross Merchandise Value (GMV)',
        sqlValue: sqlGmv,
        independentValue: indTotalGmv,
        delta: round2(sqlGmv - indTotalGmv),
        unit: 'currency',
        isMatch: isClose(sqlGmv, indTotalGmv)
      },
      {
        metricKey: 'total_freight_revenue',
        metricLabel: 'Total Freight Revenue',
        sqlValue: sqlFreight,
        independentValue: indTotalFreight,
        delta: round2(sqlFreight - indTotalFreight),
        unit: 'currency',
        isMatch: isClose(sqlFreight, indTotalFreight)
      },
      {
        metricKey: 'total_order_value',
        metricLabel: 'Total Settled Order Value',
        sqlValue: sqlTotalVal,
        independentValue: indTotalSettled,
        delta: round2(sqlTotalVal - indTotalSettled),
        unit: 'currency',
        isMatch: isClose(sqlTotalVal, indTotalSettled)
      },
      {
        metricKey: 'average_order_value',
        metricLabel: 'Average Order Value (AOV)',
        sqlValue: sqlAov,
        independentValue: indAov,
        delta: round2(sqlAov - indAov),
        unit: 'currency',
        isMatch: isClose(sqlAov, indAov)
      }
    ];

    results.push({
      benchmarkId: 'revenue',
      queryId: sal01Def.id,
      queryCode: sal01Def.code,
      category: sal01Def.category,
      title: sal01Def.title,
      businessQuestion: sal01Def.businessQuestion,
      sql: sal01Def.sql,
      explanation: sal01Def.explanation,
      expectedInterpretation: sal01Def.expectedInterpretation,
      executionTimeMs: sal01Exec.executionTimeMs,
      rowCount: sal01Exec.rowCount,
      columns: sal01Exec.columns,
      actualRows: sal01Exec.rows,
      comparisons: revComparisons,
      allMatched: revComparisons.every((c) => c.isMatch),
      independentCalculationMethod:
        'Pure TypeScript Map reduction over raw order_items and payments rows pre-aggregated by order_id before joining to distinct orders.'
    });

    // =========================================================================
    // BENCHMARK 2: REPEAT CUSTOMERS (CUS-01)
    // =========================================================================
    const cus01Def = CURATED_SQL_LIBRARY.find((q) => q.code === 'CUS-01')!;
    const cus01Exec = await this.executeReadOnlyQuery(cus01Def.sql, 100, false);

    // Map customer_id -> customer_unique_id
    const custIdToUniqueId = new Map<string, string>();
    for (const c of rawCustomers) {
      const cid = String(serializeValue(c.customer_id) ?? '');
      const uid = String(serializeValue(c.customer_unique_id) ?? '');
      if (cid && uid) custIdToUniqueId.set(cid, uid);
    }

    // Compute total_order_value per order_id matching fact_orders
    const orderTotalValueMap = new Map<string, number>();
    for (const o of rawOrders) {
      const oid = String(serializeValue(o.order_id) ?? '');
      const ir = itemRollupByOrder.get(oid);
      const pr = paymentRollupByOrder.get(oid);
      const gmvPlusFreight = round2((ir?.gmv ?? 0) + (ir?.freight ?? 0));
      const settled = pr?.settled ?? 0;
      const totalOrderVal = settled > 0 ? round2(settled) : gmvPlusFreight;
      orderTotalValueMap.set(oid, totalOrderVal);
    }

    const uniqueCustomerOrders = new Map<
      string,
      { orders: Set<string>; spend: number }
    >();
    for (const o of rawOrders) {
      const oid = String(serializeValue(o.order_id) ?? '');
      const cid = String(serializeValue(o.customer_id) ?? '');
      const uid = custIdToUniqueId.get(cid);
      if (!uid) continue;
      const entry = uniqueCustomerOrders.get(uid) || {
        orders: new Set<string>(),
        spend: 0
      };
      if (!entry.orders.has(oid)) {
        entry.orders.add(oid);
        entry.spend = round2(entry.spend + (orderTotalValueMap.get(oid) ?? 0));
      }
      uniqueCustomerOrders.set(uid, entry);
    }

    let indOneTimeCount = 0;
    let indRepeatCount = 0;
    let indRepeatSpend = 0;
    for (const [, data] of uniqueCustomerOrders) {
      const cnt = data.orders.size;
      if (cnt === 1) {
        indOneTimeCount += 1;
      } else if (cnt >= 2) {
        indRepeatCount += 1;
        indRepeatSpend = round2(indRepeatSpend + data.spend);
      }
    }
    const indTotalUniqueBuyers = indOneTimeCount + indRepeatCount;
    const indRepeatRatePct =
      indTotalUniqueBuyers > 0
        ? round2((indRepeatCount / indTotalUniqueBuyers) * 100)
        : 0;

    // Extract SQL totals from CUS-01 cohort rows
    const sqlTotalUniqueBuyers = cus01Exec.rows.reduce(
      (sum, r) => sum + Number(r.unique_customers ?? 0),
      0
    );
    const sqlOneTimeBuyers = cus01Exec.rows
      .filter((r) => String(r.retention_cohort).startsWith('1.'))
      .reduce((sum, r) => sum + Number(r.unique_customers ?? 0), 0);
    const sqlRepeatBuyers = cus01Exec.rows
      .filter((r) => !String(r.retention_cohort).startsWith('1.'))
      .reduce((sum, r) => sum + Number(r.unique_customers ?? 0), 0);
    const sqlRepeatSpend = round2(
      cus01Exec.rows
        .filter((r) => !String(r.retention_cohort).startsWith('1.'))
        .reduce((sum, r) => sum + Number(r.cohort_total_revenue ?? 0), 0)
    );
    const sqlRepeatRatePct =
      sqlTotalUniqueBuyers > 0
        ? round2((sqlRepeatBuyers / sqlTotalUniqueBuyers) * 100)
        : 0;

    const cusComparisons: SqlBenchmarkMetricComparison[] = [
      {
        metricKey: 'unique_purchasing_customers',
        metricLabel: 'Unique Purchasing Customers (customer_unique_id)',
        sqlValue: sqlTotalUniqueBuyers,
        independentValue: indTotalUniqueBuyers,
        delta: sqlTotalUniqueBuyers - indTotalUniqueBuyers,
        unit: 'number',
        isMatch: sqlTotalUniqueBuyers === indTotalUniqueBuyers
      },
      {
        metricKey: 'one_time_buyers',
        metricLabel: 'One-Time Buyers (1 Order)',
        sqlValue: sqlOneTimeBuyers,
        independentValue: indOneTimeCount,
        delta: sqlOneTimeBuyers - indOneTimeCount,
        unit: 'number',
        isMatch: sqlOneTimeBuyers === indOneTimeCount
      },
      {
        metricKey: 'repeat_buyers',
        metricLabel: 'Repeat Buyers (2+ Orders)',
        sqlValue: sqlRepeatBuyers,
        independentValue: indRepeatCount,
        delta: sqlRepeatBuyers - indRepeatCount,
        unit: 'number',
        isMatch: sqlRepeatBuyers === indRepeatCount
      },
      {
        metricKey: 'repeat_customer_rate_pct',
        metricLabel: 'Repeat Customer Rate (%)',
        sqlValue: sqlRepeatRatePct,
        independentValue: indRepeatRatePct,
        delta: round2(sqlRepeatRatePct - indRepeatRatePct),
        unit: 'percent',
        isMatch: isClose(sqlRepeatRatePct, indRepeatRatePct)
      },
      {
        metricKey: 'repeat_cohort_revenue',
        metricLabel: 'Repeat Buyer Cohort Revenue',
        sqlValue: sqlRepeatSpend,
        independentValue: indRepeatSpend,
        delta: round2(sqlRepeatSpend - indRepeatSpend),
        unit: 'currency',
        isMatch: isClose(sqlRepeatSpend, indRepeatSpend)
      }
    ];

    results.push({
      benchmarkId: 'repeat_customers',
      queryId: cus01Def.id,
      queryCode: cus01Def.code,
      category: cus01Def.category,
      title: cus01Def.title,
      businessQuestion: cus01Def.businessQuestion,
      sql: cus01Def.sql,
      explanation: cus01Def.explanation,
      expectedInterpretation: cus01Def.expectedInterpretation,
      executionTimeMs: cus01Exec.executionTimeMs,
      rowCount: cus01Exec.rowCount,
      columns: cus01Exec.columns,
      actualRows: cus01Exec.rows,
      comparisons: cusComparisons,
      allMatched: cusComparisons.every((c) => c.isMatch),
      independentCalculationMethod:
        'Pure TypeScript entity resolution mapping order-scoped customer_id -> permanent customer_unique_id and grouping distinct order_ids.'
    });

    // =========================================================================
    // BENCHMARK 3: CATEGORY PERFORMANCE (PRD-01)
    // =========================================================================
    const prd01Def = CURATED_SQL_LIBRARY.find((q) => q.code === 'PRD-01')!;
    const prd01Exec = await this.executeReadOnlyQuery(prd01Def.sql, 100, false);

    const translationMap = new Map<string, string>();
    for (const tr of rawTranslations) {
      const pt = String(serializeValue(tr.product_category_name) ?? '');
      const en = String(serializeValue(tr.product_category_name_english) ?? '');
      if (pt && en) translationMap.set(pt, en);
    }

    const productCatMap = new Map<string, { pt: string | null; en: string }>();
    for (const prd of rawProducts) {
      const pid = String(serializeValue(prd.product_id) ?? '');
      const rawPt = serializeValue(prd.product_category_name);
      const pt = rawPt !== null && String(rawPt).trim() !== '' ? String(rawPt) : null;
      const en = (pt && translationMap.get(pt)) || pt || 'unclassified';
      productCatMap.set(pid, { pt, en });
    }

    const catAgg = new Map<
      string,
      { en: string; units: number; gmv: number; freight: number }
    >();
    for (const it of rawItems) {
      const pid = String(serializeValue(it.product_id) ?? '');
      const catInfo = productCatMap.get(pid);
      if (!catInfo) continue; // INNER JOIN products
      const key = `${catInfo.en}::${catInfo.pt ?? 'NULL'}`;
      const price = Number(serializeValue(it.price) ?? 0);
      const freight = Number(serializeValue(it.freight_value) ?? 0);
      const curr = catAgg.get(key) || {
        en: catInfo.en,
        units: 0,
        gmv: 0,
        freight: 0
      };
      curr.units += 1;
      curr.gmv = round2(curr.gmv + price);
      curr.freight = round2(curr.freight + freight);
      catAgg.set(key, curr);
    }

    const sortedCats = Array.from(catAgg.values()).sort((a, b) => b.gmv - a.gmv);
    const indTopCat = sortedCats[0] || { en: 'N/A', units: 0, gmv: 0, freight: 0 };
    const indTotalCatalogGmv = round2(
      sortedCats.reduce((sum, c) => sum + c.gmv, 0)
    );

    const sqlTopRow = prd01Exec.rows[0] || {};
    const sqlTopCatName = String(sqlTopRow.category_english ?? 'N/A');
    const sqlTopCatGmv = Number(sqlTopRow.category_merchandise_gmv ?? 0);
    const sqlTopCatUnits = Number(sqlTopRow.units_sold ?? 0);
    const sqlTotalCatalogGmv = round2(
      prd01Exec.rows.reduce(
        (sum, r) => sum + Number(r.category_merchandise_gmv ?? 0),
        0
      )
    );

    const prdComparisons: SqlBenchmarkMetricComparison[] = [
      {
        metricKey: 'top_category_english',
        metricLabel: 'Top Revenue Category (English)',
        sqlValue: sqlTopCatName,
        independentValue: indTopCat.en,
        delta: 0,
        unit: 'text',
        isMatch: sqlTopCatName === indTopCat.en
      },
      {
        metricKey: 'top_category_gmv',
        metricLabel: 'Top Category Merchandise GMV',
        sqlValue: sqlTopCatGmv,
        independentValue: indTopCat.gmv,
        delta: round2(sqlTopCatGmv - indTopCat.gmv),
        unit: 'currency',
        isMatch: isClose(sqlTopCatGmv, indTopCat.gmv)
      },
      {
        metricKey: 'top_category_units',
        metricLabel: 'Top Category Units Sold',
        sqlValue: sqlTopCatUnits,
        independentValue: indTopCat.units,
        delta: sqlTopCatUnits - indTopCat.units,
        unit: 'number',
        isMatch: sqlTopCatUnits === indTopCat.units
      },
      {
        metricKey: 'total_catalog_gmv',
        metricLabel: 'Total Catalog Merchandise GMV Across Categories',
        sqlValue: sqlTotalCatalogGmv,
        independentValue: indTotalCatalogGmv,
        delta: round2(sqlTotalCatalogGmv - indTotalCatalogGmv),
        unit: 'currency',
        isMatch: isClose(sqlTotalCatalogGmv, indTotalCatalogGmv)
      }
    ];

    results.push({
      benchmarkId: 'category_performance',
      queryId: prd01Def.id,
      queryCode: prd01Def.code,
      category: prd01Def.category,
      title: prd01Def.title,
      businessQuestion: prd01Def.businessQuestion,
      sql: prd01Def.sql,
      explanation: prd01Def.explanation,
      expectedInterpretation: prd01Def.expectedInterpretation,
      executionTimeMs: prd01Exec.executionTimeMs,
      rowCount: prd01Exec.rowCount,
      columns: prd01Exec.columns,
      actualRows: prd01Exec.rows,
      comparisons: prdComparisons,
      allMatched: prdComparisons.every((c) => c.isMatch),
      independentCalculationMethod:
        'Pure TypeScript dictionary lookup joining order_items -> products -> category_translations and summing price & units by translated category.'
    });

    // =========================================================================
    // BENCHMARK 4: DELIVERY DELAYS (DEL-01)
    // =========================================================================
    const del01Def = CURATED_SQL_LIBRARY.find((q) => q.code === 'DEL-01')!;
    const del01Exec = await this.executeReadOnlyQuery(del01Def.sql, 100, false);

    const custStateMap = new Map<string, string>();
    for (const c of rawCustomers) {
      const cid = String(serializeValue(c.customer_id) ?? '');
      const st = String(serializeValue(c.customer_state) ?? 'UNKNOWN');
      if (cid) custStateMap.set(cid, st);
    }

    let indDeliveredTotal = 0;
    let indOnTimeTotal = 0;
    let indDelayedTotal = 0;

    for (const o of rawOrders) {
      const status = String(serializeValue(o.order_status) ?? '');
      if (status !== 'delivered') continue;
      indDeliveredTotal += 1;
      const delivTs = serializeValue(o.order_delivered_customer_date);
      const estTs = serializeValue(o.order_estimated_delivery_date);
      const isOnTime =
        delivTs !== null &&
        estTs !== null &&
        String(delivTs) <= String(estTs);
      if (isOnTime) {
        indOnTimeTotal += 1;
      } else {
        indDelayedTotal += 1;
      }
    }

    const indGlobalOnTimePct =
      indDeliveredTotal > 0
        ? round2((indOnTimeTotal / indDeliveredTotal) * 100)
        : 0;

    const sqlDeliveredTotal = del01Exec.rows.reduce(
      (sum, r) => sum + Number(r.delivered_orders ?? 0),
      0
    );
    const sqlOnTimeTotal = del01Exec.rows.reduce(
      (sum, r) => sum + Number(r.on_time_orders ?? 0),
      0
    );
    const sqlDelayedTotal = del01Exec.rows.reduce(
      (sum, r) => sum + Number(r.delayed_orders ?? 0),
      0
    );
    const sqlGlobalOnTimePct =
      sqlDeliveredTotal > 0
        ? round2((sqlOnTimeTotal / sqlDeliveredTotal) * 100)
        : 0;

    const delComparisons: SqlBenchmarkMetricComparison[] = [
      {
        metricKey: 'delivered_orders',
        metricLabel: 'Total Delivered Orders Evaluated',
        sqlValue: sqlDeliveredTotal,
        independentValue: indDeliveredTotal,
        delta: sqlDeliveredTotal - indDeliveredTotal,
        unit: 'number',
        isMatch: sqlDeliveredTotal === indDeliveredTotal
      },
      {
        metricKey: 'on_time_orders',
        metricLabel: 'On-Time Delivered Orders (<= Estimated SLA)',
        sqlValue: sqlOnTimeTotal,
        independentValue: indOnTimeTotal,
        delta: sqlOnTimeTotal - indOnTimeTotal,
        unit: 'number',
        isMatch: sqlOnTimeTotal === indOnTimeTotal
      },
      {
        metricKey: 'delayed_orders',
        metricLabel: 'SLA Delayed Orders (> Estimated SLA)',
        sqlValue: sqlDelayedTotal,
        independentValue: indDelayedTotal,
        delta: sqlDelayedTotal - indDelayedTotal,
        unit: 'number',
        isMatch: sqlDelayedTotal === indDelayedTotal
      },
      {
        metricKey: 'on_time_sla_pct',
        metricLabel: 'Platform On-Time SLA Compliance (%)',
        sqlValue: sqlGlobalOnTimePct,
        independentValue: indGlobalOnTimePct,
        delta: round2(sqlGlobalOnTimePct - indGlobalOnTimePct),
        unit: 'percent',
        isMatch: isClose(sqlGlobalOnTimePct, indGlobalOnTimePct)
      }
    ];

    results.push({
      benchmarkId: 'delivery_delays',
      queryId: del01Def.id,
      queryCode: del01Def.code,
      category: del01Def.category,
      title: del01Def.title,
      businessQuestion: del01Def.businessQuestion,
      sql: del01Def.sql,
      explanation: del01Def.explanation,
      expectedInterpretation: del01Def.expectedInterpretation,
      executionTimeMs: del01Exec.executionTimeMs,
      rowCount: del01Exec.rowCount,
      columns: del01Exec.columns,
      actualRows: del01Exec.rows,
      comparisons: delComparisons,
      allMatched: delComparisons.every((c) => c.isMatch),
      independentCalculationMethod:
        "Pure TypeScript timestamp comparison over delivered orders evaluating order_delivered_customer_date <= order_estimated_delivery_date."
    });

    // =========================================================================
    // BENCHMARK 5: MONTHLY TRENDS (SAL-02)
    // =========================================================================
    const sal02Def = CURATED_SQL_LIBRARY.find((q) => q.code === 'SAL-02')!;
    const sal02Exec = await this.executeReadOnlyQuery(sal02Def.sql, 100, false);

    const monthAgg = new Map<
      string,
      { orders: number; gmv: number; totalVal: number; deliveredVal: number }
    >();

    for (const o of rawOrders) {
      const oid = String(serializeValue(o.order_id) ?? '');
      const ts = String(serializeValue(o.order_purchase_timestamp) ?? '');
      const status = String(serializeValue(o.order_status) ?? '');
      const ym = ts.slice(0, 7);
      if (!ym) continue;

      const ir = itemRollupByOrder.get(oid);
      const totalVal = orderTotalValueMap.get(oid) ?? 0;
      const curr = monthAgg.get(ym) || {
        orders: 0,
        gmv: 0,
        totalVal: 0,
        deliveredVal: 0
      };
      curr.orders += 1;
      curr.gmv = round2(curr.gmv + (ir?.gmv ?? 0));
      curr.totalVal = round2(curr.totalVal + totalVal);
      if (status === 'delivered') {
        curr.deliveredVal = round2(curr.deliveredVal + totalVal);
      }
      monthAgg.set(ym, curr);
    }

    const sortedMonths = Array.from(monthAgg.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
    const indMonthCount = sortedMonths.length;
    const indPeakMonthVal = sortedMonths.reduce(
      (max, [, m]) => Math.max(max, m.totalVal),
      0
    );
    const indCumTotalVal = round2(
      sortedMonths.reduce((sum, [, m]) => sum + m.totalVal, 0)
    );
    const indCumDeliveredVal = round2(
      sortedMonths.reduce((sum, [, m]) => sum + m.deliveredVal, 0)
    );

    const sqlMonthCount = sal02Exec.rows.length;
    const sqlPeakMonthVal = sal02Exec.rows.reduce(
      (max, r) => Math.max(max, Number(r.monthly_total_value ?? 0)),
      0
    );
    const sqlCumTotalVal = round2(
      sal02Exec.rows.reduce((sum, r) => sum + Number(r.monthly_total_value ?? 0), 0)
    );
    const sqlCumDeliveredVal = round2(
      sal02Exec.rows.reduce(
        (sum, r) => sum + Number(r.delivered_order_value ?? 0),
        0
      )
    );

    const trendComparisons: SqlBenchmarkMetricComparison[] = [
      {
        metricKey: 'active_months',
        metricLabel: 'Active Calendar Months in Dataset',
        sqlValue: sqlMonthCount,
        independentValue: indMonthCount,
        delta: sqlMonthCount - indMonthCount,
        unit: 'number',
        isMatch: sqlMonthCount === indMonthCount
      },
      {
        metricKey: 'peak_monthly_order_value',
        metricLabel: 'Peak Monthly Total Order Value',
        sqlValue: sqlPeakMonthVal,
        independentValue: indPeakMonthVal,
        delta: round2(sqlPeakMonthVal - indPeakMonthVal),
        unit: 'currency',
        isMatch: isClose(sqlPeakMonthVal, indPeakMonthVal)
      },
      {
        metricKey: 'cumulative_total_value',
        metricLabel: 'Cumulative Multi-Month Order Value',
        sqlValue: sqlCumTotalVal,
        independentValue: indCumTotalVal,
        delta: round2(sqlCumTotalVal - indCumTotalVal),
        unit: 'currency',
        isMatch: isClose(sqlCumTotalVal, indCumTotalVal)
      },
      {
        metricKey: 'cumulative_delivered_value',
        metricLabel: 'Cumulative Delivered Order Value',
        sqlValue: sqlCumDeliveredVal,
        independentValue: indCumDeliveredVal,
        delta: round2(sqlCumDeliveredVal - indCumDeliveredVal),
        unit: 'currency',
        isMatch: isClose(sqlCumDeliveredVal, indCumDeliveredVal)
      }
    ];

    results.push({
      benchmarkId: 'monthly_trends',
      queryId: sal02Def.id,
      queryCode: sal02Def.code,
      category: sal02Def.category,
      title: sal02Def.title,
      businessQuestion: sal02Def.businessQuestion,
      sql: sal02Def.sql,
      explanation: sal02Def.explanation,
      expectedInterpretation: sal02Def.expectedInterpretation,
      executionTimeMs: sal02Exec.executionTimeMs,
      rowCount: sal02Exec.rowCount,
      columns: sal02Exec.columns,
      actualRows: sal02Exec.rows,
      comparisons: trendComparisons,
      allMatched: trendComparisons.every((c) => c.isMatch),
      independentCalculationMethod:
        'Pure TypeScript YYYY-MM string slicing on order_purchase_timestamp and chronological reduction over order-grain totals.'
    });

    return results;
  }
}

export const duckdbEngine = new DuckDBAnalyticalEngine();

