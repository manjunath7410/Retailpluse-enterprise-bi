import { OlistTableKey } from '../types/analytics';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  normalizedValue?: string;
}

const FORBIDDEN_SQL_KEYWORDS = [
  'DROP',
  'DELETE',
  'TRUNCATE',
  'UPDATE',
  'INSERT',
  'ALTER',
  'CREATE',
  'REPLACE',
  'GRANT',
  'REVOKE',
  'ATTACH',
  'DETACH',
  'COPY',
  'EXPORT',
  'INSTALL',
  'LOAD'
];

const ALLOWED_SQL_PREFIXES = [
  'SELECT',
  'WITH',
  'SHOW',
  'DESCRIBE',
  'EXPLAIN',
  'SUMMARIZE',
  'PRAGMA'
];

/**
 * Strips UTF-8 BOM, surrounding quotes, and whitespace from a CSV column header.
 */
export function normalizeCsvHeader(rawHeader: string): string {
  return (rawHeader || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Automatically detects the target Olist dataset table from the filename or CSV headers.
 */
export function detectOlistTableFromFileAndHeaders(
  fileName: string,
  headers: string[]
): OlistTableKey | null {
  const lowerName = (fileName || '').trim().toLowerCase();
  const normHeaders = headers.map(normalizeCsvHeader);

  // 1. Exact or canonical Olist filename detection
  if (lowerName.includes('olist_orders_dataset') || lowerName === 'orders.csv') {
    return 'orders';
  }
  if (lowerName.includes('olist_customers_dataset') || lowerName === 'customers.csv') {
    return 'customers';
  }
  if (lowerName.includes('olist_order_items_dataset') || lowerName === 'order_items.csv') {
    return 'order_items';
  }
  if (lowerName.includes('olist_order_payments_dataset') || lowerName === 'payments.csv') {
    return 'payments';
  }
  if (lowerName.includes('olist_order_reviews_dataset') || lowerName === 'reviews.csv') {
    return 'reviews';
  }
  if (lowerName.includes('olist_products_dataset') || lowerName === 'products.csv') {
    return 'products';
  }
  if (lowerName.includes('olist_sellers_dataset') || lowerName === 'sellers.csv') {
    return 'sellers';
  }
  if (
    lowerName.includes('product_category_name_translation') ||
    lowerName.includes('category_translation')
  ) {
    return 'category_translations';
  }
  if (lowerName.includes('olist_geolocation_dataset') || lowerName.includes('geolocation')) {
    return 'geolocation';
  }

  // 2. Column signature detection
  const has = (col: string) => normHeaders.includes(col);

  if (has('product_category_name') && has('product_category_name_english')) {
    return 'category_translations';
  }
  if (has('geolocation_zip_code_prefix') && has('geolocation_lat') && has('geolocation_lng')) {
    return 'geolocation';
  }
  if (has('order_id') && has('order_item_id') && has('product_id') && has('seller_id')) {
    return 'order_items';
  }
  if (has('order_id') && has('payment_sequential') && has('payment_type') && has('payment_value')) {
    return 'payments';
  }
  if (has('review_id') && has('order_id') && has('review_score')) {
    return 'reviews';
  }
  if (has('order_id') && has('customer_id') && has('order_status') && has('order_purchase_timestamp')) {
    return 'orders';
  }
  if (has('customer_id') && has('customer_unique_id') && has('customer_state')) {
    return 'customers';
  }
  if (has('product_id') && has('product_category_name') && (has('product_weight_g') || has('product_name_lenght'))) {
    return 'products';
  }
  if (has('seller_id') && has('seller_state') && has('seller_city')) {
    return 'sellers';
  }

  return null;
}

/**
 * Validates file type (.csv) and file size limits (default 200 MB max per file).
 */
export function validateCsvFileMetadata(
  fileName: string,
  fileSizeBytes: number,
  maxBytes = 200 * 1024 * 1024
): ValidationResult {
  const cleanName = (fileName || '').trim();
  if (!cleanName) {
    return { valid: false, error: 'File name is required.' };
  }
  if (!cleanName.toLowerCase().endsWith('.csv')) {
    return {
      valid: false,
      error: `Unsupported file type for "${cleanName}". Only .csv files are accepted.`
    };
  }
  if (typeof fileSizeBytes !== 'number' || fileSizeBytes <= 0) {
    return {
      valid: false,
      error: `File "${cleanName}" is empty (0 bytes).`
    };
  }
  if (fileSizeBytes > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    const actualMb = (fileSizeBytes / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File "${cleanName}" (${actualMb} MB) exceeds the ${maxMb} MB per-file upload limit.`
    };
  }
  return { valid: true, normalizedValue: cleanName };
}

/**
 * Checks whether a timestamp or date string is a valid ISO / Olist date (e.g. "2017-10-02 10:56:33").
 */
export function isValidDateOrTimestamp(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  // Must start with YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?/.test(trimmed)) {
    return false;
  }
  const isoCandidate = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T') + 'Z';
  const parsed = Date.parse(isoCandidate);
  if (Number.isNaN(parsed)) return false;

  // Verify month and day bounds (e.g., reject 2017-02-30 or 2017-13-45)
  const [datePart] = trimmed.split(/[ T]/);
  const [y, m, d] = datePart.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Validates that a user-submitted SQL query is non-empty, within length limits,
 * and strictly read-only for the DuckDB analytical workbench.
 */
export function validateSqlQuery(rawSql: string): ValidationResult {
  if (typeof rawSql !== 'string') {
    return { valid: false, error: 'SQL query must be a string.' };
  }

  const trimmed = rawSql.trim();
  if (!trimmed) {
    return { valid: false, error: 'SQL query cannot be empty.' };
  }

  if (trimmed.length > 10000) {
    return { valid: false, error: 'SQL query exceeds maximum length of 10,000 characters.' };
  }

  // Strip SQL comments for inspection
  const withoutComments = trimmed
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  if (!withoutComments) {
    return { valid: false, error: 'SQL query contains only comments and no executable statement.' };
  }

  // Disallow multiple stacked statements separated by semicolons
  const statements = withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (statements.length > 1) {
    return {
      valid: false,
      error: 'Only a single read-only SQL statement may be executed per request.'
    };
  }

  const statement = statements[0];
  const firstToken = statement.split(/\s+/)[0]?.toUpperCase() || '';

  if (!ALLOWED_SQL_PREFIXES.includes(firstToken)) {
    return {
      valid: false,
      error: `Query must start with a read-only keyword (${ALLOWED_SQL_PREFIXES.join(', ')}). Found: ${firstToken || 'UNKNOWN'}`
    };
  }

  // Check for forbidden DDL/DML tokens as standalone words outside string literals
  const withoutStringLiterals = statement.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  for (const keyword of FORBIDDEN_SQL_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(withoutStringLiterals)) {
      return {
        valid: false,
        error: `Forbidden mutating or administrative keyword "${keyword}" detected. SQL Lab is strictly read-only.`
      };
    }
  }

  return { valid: true, normalizedValue: statement };
}

export interface CsvValidationResult {
  valid: boolean;
  error?: string;
  headers: string[];
  estimatedRowCount: number;
  detectedTable?: OlistTableKey | null;
}

/**
 * Validates CSV upload payload, target table whitelist, and column headers.
 */
export function validateCsvInput(
  tableName: string,
  csvContent: string,
  allowedTables: string[],
  expectedColumns?: string[],
  fileName?: string
): CsvValidationResult {
  if (typeof csvContent !== 'string' || !csvContent.trim()) {
    return {
      valid: false,
      error: 'CSV content cannot be empty.',
      headers: [],
      estimatedRowCount: 0
    };
  }

  const trimmedContent = csvContent.replace(/^\uFEFF/, '').trim();
  const firstNewlineIdx = trimmedContent.indexOf('\n');
  if (firstNewlineIdx === -1) {
    return {
      valid: false,
      error: 'CSV payload must include a header row and at least one data record.',
      headers: [],
      estimatedRowCount: 0
    };
  }

  const headerLine = trimmedContent.slice(0, firstNewlineIdx).replace(/\r$/, '');
  const rawHeaders = headerLine
    .split(',')
    .map(normalizeCsvHeader)
    .filter((h) => h.length > 0);

  if (rawHeaders.length === 0) {
    return {
      valid: false,
      error: 'CSV header row contains no valid column names.',
      headers: [],
      estimatedRowCount: 0
    };
  }

  // Count non-empty lines efficiently without allocating millions of substrings on huge files
  let lineCount = 0;
  for (let i = 0; i < trimmedContent.length; i++) {
    if (trimmedContent.charCodeAt(i) === 10) lineCount++;
  }
  const estimatedRowCount = Math.max(0, lineCount);
  if (estimatedRowCount < 1) {
    return {
      valid: false,
      error: 'CSV payload must include a header row and at least one data record.',
      headers: rawHeaders,
      estimatedRowCount: 0
    };
  }

  const detectedTable = detectOlistTableFromFileAndHeaders(fileName || '', rawHeaders);
  const cleanTable = (tableName || detectedTable || '').trim().toLowerCase();

  if (!cleanTable || !allowedTables.includes(cleanTable)) {
    return {
      valid: false,
      error: `Invalid or unrecognized target table "${tableName}". Allowed Olist tables: ${allowedTables.join(', ')}.`,
      headers: rawHeaders,
      estimatedRowCount,
      detectedTable
    };
  }

  if (expectedColumns && expectedColumns.length > 0) {
    const normalizedExpected = expectedColumns.map((c) => c.toLowerCase());
    const matched = rawHeaders.filter((h) => normalizedExpected.includes(h));
    if (matched.length === 0) {
      return {
        valid: false,
        error: `None of the CSV headers (${rawHeaders.join(', ')}) match target table "${cleanTable}" schema (${expectedColumns.join(', ')}).`,
        headers: rawHeaders,
        estimatedRowCount,
        detectedTable
      };
    }
  }

  return {
    valid: true,
    headers: rawHeaders,
    estimatedRowCount,
    detectedTable: cleanTable as OlistTableKey
  };
}

export interface ModuleReadinessSummary {
  isReady: boolean;
  readyCount: number;
  totalRequired: number;
  readinessPercent: number;
  missingTables: string[];
}

/**
 * Evaluates whether the required DuckDB tables for an analytical module are populated.
 */
export function computeModuleReadiness(
  requiredTables: string[],
  tableStatuses: { tableName: string; rowCount: number }[]
): ModuleReadinessSummary {
  if (requiredTables.length === 0) {
    return {
      isReady: true,
      readyCount: 0,
      totalRequired: 0,
      readinessPercent: 100,
      missingTables: []
    };
  }

  const statusMap = new Map<string, number>();
  for (const t of tableStatuses) {
    statusMap.set(t.tableName.toLowerCase(), t.rowCount);
  }

  const missingTables: string[] = [];
  let readyCount = 0;

  for (const req of requiredTables) {
    const count = statusMap.get(req.toLowerCase()) ?? 0;
    if (count > 0) {
      readyCount++;
    } else {
      missingTables.push(req);
    }
  }

  const readinessPercent = Math.round((readyCount / requiredTables.length) * 100);
  return {
    isReady: missingTables.length === 0,
    readyCount,
    totalRequired: requiredTables.length,
    readinessPercent,
    missingTables
  };
}

/**
 * Formats analytical metric values cleanly without fabricating numbers when null/undefined.
 */
export function formatAnalyticalMetric(
  value: number | string | null | undefined,
  unit: 'currency' | 'number' | 'percent' | 'days' | 'score'
): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(numeric)) {
    return String(value);
  }

  switch (unit) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(numeric);
    case 'percent':
      return `${numeric.toFixed(1)}%`;
    case 'days':
      return `${numeric.toFixed(1)} d`;
    case 'score':
      return `${numeric.toFixed(2)} / 5.00`;
    case 'number':
    default:
      return new Intl.NumberFormat('en-US').format(numeric);
  }
}

/**
 * Converts tabular query rows into an RFC 4180 compliant CSV string.
 */
export function convertRowsToCsv(
  columns: { name: string }[],
  rows: Record<string, unknown>[]
): string {
  if (!columns.length) return '';

  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = columns.map((c) => escapeCell(c.name)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCell(row[c.name])).join(',')
  );

  return [headerLine, ...dataLines].join('\n');
}
