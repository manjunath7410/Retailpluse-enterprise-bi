import { ModuleId, OlistTableKey } from '../types/analytics';

export interface ModuleConfig {
  id: ModuleId;
  number: string;
  title: string;
  shortTitle: string;
  route: string;
  category: 'Core Platform' | 'Commercial Analytics' | 'Operations & Lab';
  description: string;
  requiredTables: OlistTableKey[];
  defaultSql: string;
  architecturalNotes: string;
}

export const MODULE_REGISTRY: ModuleConfig[] = [
  {
    id: 'executive-overview',
    number: '01',
    title: 'Executive Overview',
    shortTitle: 'Executive Overview',
    route: '/executive-overview',
    category: 'Core Platform',
    description:
      'Platform-wide analytical readiness, Olist relational schema inventory (Staging + Cleaned Analytical layers), and grain-safe KPIs computed from DuckDB.',
    requiredTables: ['orders', 'order_items', 'customers', 'payments'],
    defaultSql: `WITH order_payments AS (
  SELECT order_id, SUM(payment_value) AS order_payment_value
  FROM payments
  GROUP BY order_id
)
SELECT 
  o.order_status AS status,
  COUNT(DISTINCT o.order_id) AS order_count,
  ROUND(COALESCE(SUM(op.order_payment_value), 0), 2) AS total_revenue,
  ROUND(COALESCE(AVG(op.order_payment_value), 0), 2) AS avg_order_value
FROM orders o
LEFT JOIN order_payments op ON o.order_id = op.order_id
GROUP BY o.order_status
ORDER BY total_revenue DESC;`,
    architecturalNotes:
      'Pre-aggregates payments at the order_id grain before joining to orders to prevent multi-installment revenue multiplication.'
  },
  {
    id: 'data-management',
    number: '02',
    title: 'Data Management',
    shortTitle: 'Data Management',
    route: '/data-management',
    category: 'Core Platform',
    description:
      'Multi-file Olist CSV ingestion pipeline, Staging vs. Cleaned Analytical layer inspector, rejected-record audit log, and relational join verification.',
    requiredTables: [
      'orders',
      'customers',
      'order_items',
      'payments',
      'reviews',
      'products',
      'sellers',
      'category_translations'
    ],
    defaultSql: `SHOW TABLES;`,
    architecturalNotes:
      'Preserves raw rows in stg_* tables, validates types/dates/keys into cleaned analytical tables, and logs rejected records without silent deletion.'
  },
  {
    id: 'data-quality',
    number: '03',
    title: 'Data Quality Center',
    shortTitle: 'Data Quality Center',
    route: '/data-quality',
    category: 'Core Platform',
    description:
      'Automated SQL integrity assertions verifying primary key uniqueness, foreign key relationships, date validity, and grain-safety across Olist tables.',
    requiredTables: ['orders', 'order_items', 'customers', 'products'],
    defaultSql: `SELECT 
  target_table,
  rejection_reason,
  COUNT(*) AS rejected_count
FROM audit_rejected_records
GROUP BY target_table, rejection_reason
ORDER BY rejected_count DESC;`,
    architecturalNotes:
      'Audits both cleaned analytical tables and staging rejection logs to surface duplicates, missing keys, and invalid timestamps.'
  },
  {
    id: 'sales-intelligence',
    number: '04',
    title: 'Sales Intelligence',
    shortTitle: 'Sales Intelligence',
    route: '/sales-intelligence',
    category: 'Commercial Analytics',
    description:
      'Grain-safe gross merchandise value (GMV), monthly order velocity, item price vs. freight split, and payment settlement reconciliation.',
    requiredTables: ['orders', 'order_items', 'payments'],
    defaultSql: `WITH order_item_totals AS (
  SELECT 
    order_id,
    COUNT(*) AS item_units,
    SUM(price) AS merchandise_value,
    SUM(freight_value) AS freight_total
  FROM order_items
  GROUP BY order_id
)
SELECT 
  SUBSTR(CAST(o.order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month,
  COUNT(DISTINCT o.order_id) AS total_orders,
  ROUND(SUM(oit.merchandise_value + oit.freight_total), 2) AS gross_revenue,
  ROUND(AVG(oit.merchandise_value), 2) AS avg_item_price
FROM orders o
JOIN order_item_totals oit ON o.order_id = oit.order_id
GROUP BY order_month
ORDER BY order_month ASC;`,
    architecturalNotes:
      'Aggregates order_items to order_id grain prior to joining with orders so multi-item orders never inflate order counts.'
  },
  {
    id: 'customer-intelligence',
    number: '05',
    title: 'Customer Intelligence',
    shortTitle: 'Customer Intelligence',
    route: '/customer-intelligence',
    category: 'Commercial Analytics',
    description:
      'Geographic customer distribution across Brazilian states, unique buyer entity resolution (customer_unique_id), and regional spend.',
    requiredTables: ['customers', 'orders', 'payments'],
    defaultSql: `WITH order_payments AS (
  SELECT order_id, SUM(payment_value) AS settled_amount
  FROM payments
  GROUP BY order_id
)
SELECT 
  c.customer_state AS state,
  COUNT(DISTINCT c.customer_unique_id) AS unique_customers,
  COUNT(DISTINCT o.order_id) AS total_orders,
  ROUND(COALESCE(SUM(op.settled_amount), 0), 2) AS total_spend
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
LEFT JOIN order_payments op ON o.order_id = op.order_id
GROUP BY c.customer_state
ORDER BY total_spend DESC
LIMIT 12;`,
    architecturalNotes:
      'Connects orders to customers via customer_id while aggregating unique buyers via customer_unique_id and pre-aggregating payments per order_id.'
  },
  {
    id: 'customer-retention',
    number: '06',
    title: 'Customer Retention',
    shortTitle: 'Customer Retention',
    route: '/customer-retention',
    category: 'Commercial Analytics',
    description:
      'Repeat purchase frequency cohorts resolved at the customer_unique_id grain and customer lifetime revenue stratification.',
    requiredTables: ['customers', 'orders', 'payments'],
    defaultSql: `WITH order_payments AS (
  SELECT order_id, SUM(payment_value) AS settled_amount
  FROM payments
  GROUP BY order_id
),
customer_orders AS (
  SELECT 
    c.customer_unique_id,
    COUNT(DISTINCT o.order_id) AS order_count,
    ROUND(COALESCE(SUM(op.settled_amount), 0), 2) AS lifetime_spend
  FROM customers c
  JOIN orders o ON c.customer_id = o.customer_id
  LEFT JOIN order_payments op ON o.order_id = op.order_id
  GROUP BY c.customer_unique_id
)
SELECT 
  CASE WHEN order_count = 1 THEN '1 Order (Single)'
       WHEN order_count = 2 THEN '2 Orders (Repeat)'
       ELSE '3+ Orders (Loyal)' END AS cohort_bucket,
  COUNT(*) AS customer_count,
  ROUND(AVG(lifetime_spend), 2) AS avg_ltv
FROM customer_orders
GROUP BY cohort_bucket
ORDER BY customer_count DESC;`,
    architecturalNotes:
      'Resolves Olist order-scoped customer_id to permanent customer_unique_id before computing repeat purchase cohorts.'
  },
  {
    id: 'product-intelligence',
    number: '07',
    title: 'Product Intelligence',
    shortTitle: 'Product Intelligence',
    route: '/product-intelligence',
    category: 'Commercial Analytics',
    description:
      'Category revenue performance with Portuguese-to-English category translation joins, unit velocity, physical dimensions, and review scores.',
    requiredTables: ['products', 'order_items', 'category_translations'],
    defaultSql: `WITH order_review_avg AS (
  SELECT order_id, AVG(review_score) AS order_review_score
  FROM reviews
  GROUP BY order_id
)
SELECT 
  COALESCE(ct.product_category_name_english, p.product_category_name, 'unclassified') AS category,
  COUNT(oi.order_item_id) AS units_sold,
  ROUND(SUM(oi.price), 2) AS category_revenue,
  ROUND(AVG(ora.order_review_score), 2) AS avg_review_score
FROM order_items oi
JOIN products p ON oi.product_id = p.product_id
LEFT JOIN category_translations ct ON p.product_category_name = ct.product_category_name
LEFT JOIN order_review_avg ora ON oi.order_id = ora.order_id
GROUP BY category
ORDER BY category_revenue DESC
LIMIT 12;`,
    architecturalNotes:
      'Connects order_items -> products (via product_id) -> category_translations (via product_category_name) with pre-aggregated order review scores.'
  },
  {
    id: 'seller-performance',
    number: '08',
    title: 'Seller Performance',
    shortTitle: 'Seller Performance',
    route: '/seller-performance',
    category: 'Commercial Analytics',
    description:
      'Merchant fulfillment volume, seller revenue rankings, regional state distribution, and post-delivery review satisfaction.',
    requiredTables: ['sellers', 'order_items', 'reviews'],
    defaultSql: `WITH order_review_avg AS (
  SELECT order_id, AVG(review_score) AS order_review_score
  FROM reviews
  GROUP BY order_id
)
SELECT 
  s.seller_id,
  s.seller_state AS state,
  COUNT(DISTINCT oi.order_id) AS orders_fulfilled,
  ROUND(SUM(oi.price), 2) AS total_sales,
  ROUND(AVG(ora.order_review_score), 2) AS avg_rating
FROM sellers s
JOIN order_items oi ON s.seller_id = oi.seller_id
LEFT JOIN order_review_avg ora ON oi.order_id = ora.order_id
GROUP BY s.seller_id, s.seller_state
ORDER BY total_sales DESC
LIMIT 12;`,
    architecturalNotes:
      'Connects order_items to sellers via seller_id and joins pre-aggregated order-level review scores to avoid review fan-out.'
  },
  {
    id: 'delivery-analytics',
    number: '09',
    title: 'Delivery Analytics',
    shortTitle: 'Delivery Analytics',
    route: '/delivery-analytics',
    category: 'Operations & Lab',
    description:
      'Logistics lead times, actual vs. estimated delivery SLA compliance, and order-level freight cost efficiency across states.',
    requiredTables: ['orders', 'order_items', 'customers'],
    defaultSql: `WITH order_freight AS (
  SELECT order_id, SUM(freight_value) AS order_freight_total
  FROM order_items
  GROUP BY order_id
)
SELECT 
  c.customer_state AS state,
  COUNT(DISTINCT o.order_id) AS delivered_orders,
  ROUND(AVG(of_agg.order_freight_total), 2) AS avg_freight_cost,
  SUM(CASE WHEN o.order_delivered_customer_date > o.order_estimated_delivery_date THEN 1 ELSE 0 END) AS delayed_orders
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
LEFT JOIN order_freight of_agg ON o.order_id = of_agg.order_id
WHERE o.order_status = 'delivered'
GROUP BY c.customer_state
ORDER BY delivered_orders DESC
LIMIT 12;`,
    architecturalNotes:
      'Pre-aggregates freight_value per order_id before joining orders and customers so multi-item orders are counted once in delivery SLAs.'
  },
  {
    id: 'sql-lab',
    number: '10',
    title: 'SQL Analytics Lab',
    shortTitle: 'SQL Analytics Lab',
    route: '/sql-lab',
    category: 'Operations & Lab',
    description:
      'Interactive DuckDB SQL query workbench with access to both Cleaned Analytical tables and Staging (stg_*) tables, plus rejected-record audit tables.',
    requiredTables: ['orders', 'customers', 'order_items', 'payments'],
    defaultSql: `WITH order_payments AS (
  SELECT order_id, SUM(payment_value) AS total_paid, COUNT(*) AS installments_rows
  FROM payments
  GROUP BY order_id
),
order_items_agg AS (
  SELECT order_id, COUNT(*) AS item_count, SUM(price) AS merchandise_total, SUM(freight_value) AS freight_total
  FROM order_items
  GROUP BY order_id
)
SELECT 
  o.order_id,
  c.customer_city,
  c.customer_state,
  o.order_status,
  COALESCE(oia.item_count, 0) AS items,
  ROUND(COALESCE(oia.merchandise_total, 0), 2) AS merchandise_usd,
  ROUND(COALESCE(op.total_paid, 0), 2) AS settled_usd
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
LEFT JOIN order_items_agg oia ON o.order_id = oia.order_id
LEFT JOIN order_payments op ON o.order_id = op.order_id
ORDER BY settled_usd DESC
LIMIT 20;`,
    architecturalNotes:
      'Demonstrates grain-safe CTE joins across orders, customers, order_items, and payments inside DuckDB.'
  },
  {
    id: 'business-insights',
    number: '11',
    title: 'Business Insights',
    shortTitle: 'Business Insights',
    route: '/business-insights',
    category: 'Operations & Lab',
    description:
      'Server-side Gemini AI analytical synthesis grounded strictly on grain-safe DuckDB SQL aggregations and data quality telemetry.',
    requiredTables: ['orders', 'order_items', 'customers', 'payments'],
    defaultSql: `SELECT order_status, COUNT(*) AS count FROM orders GROUP BY order_status;`,
    architecturalNotes:
      'Routes grain-verified DuckDB query outputs through /api/insights/analyze to Gemini on the server.'
  },
  {
    id: 'reports-exports',
    number: '12',
    title: 'Reports and Exports',
    shortTitle: 'Reports & Exports',
    route: '/reports-exports',
    category: 'Operations & Lab',
    description:
      'Structured dataset extracts, rejected-record CSV reports, and on-demand exports of cleaned analytical tables or staging tables.',
    requiredTables: ['orders', 'customers', 'order_items', 'payments'],
    defaultSql: `SELECT * FROM orders LIMIT 50;`,
    architecturalNotes:
      'Streams live DuckDB analytical and audit tables into downloadable CSV and JSON packages.'
  },
  {
    id: 'decision-lab',
    number: '13',
    title: 'Decision Lab',
    shortTitle: 'Decision Lab',
    route: '/decision-lab',
    category: 'Operations & Lab',
    description:
      'Statistical anomaly alerts (Z-score + Tukey IQR), DuckDB-grounded What-If revenue & SLA simulator, and frequentist A/B hypothesis testing lab.',
    requiredTables: ['orders', 'order_items', 'customers', 'payments', 'reviews'],
    defaultSql: `SELECT SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month, COUNT(*) AS orders FROM orders GROUP BY 1 ORDER BY 1;`,
    architecturalNotes:
      'Executes leave-one-out Z-score monitoring, empirical scenario sensitivity modeling, and Welch t-test / two-proportion z-test computations over live DuckDB cohorts.'
  }
];

export function getModuleById(id: string): ModuleConfig | undefined {
  return MODULE_REGISTRY.find((m) => m.id === id);
}
