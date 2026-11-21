import { AnalyticalModelMetadata, AnalyticalModelName, KpiDictionaryEntry } from '../../src/types/analytics';

export interface AnalyticalModelDefinition
  extends Omit<AnalyticalModelMetadata, 'rowCount' | 'columnCount' | 'columns'> {}

export const ANALYTICAL_MODEL_DEFINITIONS: AnalyticalModelDefinition[] = [
  {
    viewName: 'fact_orders',
    displayName: 'Fact Orders',
    modelType: 'FACT',
    grain: '1 row per order_id',
    primaryKey: 'order_id',
    sourceTables: ['orders', 'customers', 'order_items', 'payments', 'reviews'],
    foreignKeys: [
      'customer_id -> customers.customer_id',
      'customer_unique_id -> dim_customers.customer_unique_id',
      'purchase_date_key -> dim_date.date_key'
    ],
    antiMultiplicationRule:
      'Pre-aggregates order_items, payments, and reviews into order_id CTEs before joining to orders so 1:N line items and payment installments never multiply order revenue.',
    sampleQuerySql: `SELECT order_id, customer_unique_id, order_status, item_count, gmv_merchandise, freight_revenue, total_order_value, is_on_time FROM fact_orders ORDER BY total_order_value DESC LIMIT 25;`,
    viewSqlDdl: `CREATE OR REPLACE VIEW fact_orders AS
WITH items_agg AS (
  SELECT
    order_id,
    COUNT(*) AS item_count,
    COUNT(DISTINCT product_id) AS distinct_products_count,
    COUNT(DISTINCT seller_id) AS distinct_sellers_count,
    ROUND(COALESCE(SUM(price), 0), 2) AS gmv_merchandise,
    ROUND(COALESCE(SUM(freight_value), 0), 2) AS freight_revenue,
    ROUND(COALESCE(SUM(price + freight_value), 0), 2) AS total_item_value
  FROM order_items
  GROUP BY order_id
),
payments_agg AS (
  SELECT
    order_id,
    COUNT(*) AS payment_methods_count,
    MAX(payment_installments) AS max_installments,
    ROUND(COALESCE(SUM(payment_value), 0), 2) AS settled_payment_value
  FROM payments
  GROUP BY order_id
),
reviews_agg AS (
  SELECT
    order_id,
    COUNT(*) AS review_count,
    ROUND(AVG(review_score), 2) AS avg_review_score
  FROM reviews
  GROUP BY order_id
)
SELECT
  o.order_id,
  o.customer_id,
  COALESCE(c.customer_unique_id, o.customer_id) AS customer_unique_id,
  c.customer_city,
  c.customer_state,
  c.customer_zip_code_prefix,
  o.order_status,
  SUBSTR(CAST(o.order_purchase_timestamp AS VARCHAR), 1, 10) AS purchase_date_key,
  o.order_purchase_timestamp,
  o.order_approved_at,
  o.order_delivered_carrier_date,
  o.order_delivered_customer_date,
  o.order_estimated_delivery_date,
  COALESCE(ia.item_count, 0) AS item_count,
  COALESCE(ia.gmv_merchandise, 0) AS gmv_merchandise,
  COALESCE(ia.freight_revenue, 0) AS freight_revenue,
  ROUND(COALESCE(NULLIF(pa.settled_payment_value, 0), ia.total_item_value, 0), 2) AS total_order_value,
  COALESCE(pa.settled_payment_value, 0) AS settled_payment_value,
  COALESCE(pa.payment_methods_count, 0) AS payment_methods_count,
  COALESCE(pa.max_installments, 1) AS max_installments,
  ra.avg_review_score,
  CASE WHEN o.order_status = 'delivered' THEN 1 ELSE 0 END AS is_completed,
  CASE WHEN o.order_status IN ('canceled', 'unavailable') THEN 1 ELSE 0 END AS is_cancelled,
  CASE
    WHEN o.order_status = 'delivered'
     AND o.order_delivered_customer_date IS NOT NULL
     AND o.order_estimated_delivery_date IS NOT NULL
     AND o.order_delivered_customer_date <= o.order_estimated_delivery_date
    THEN 1
    ELSE 0
  END AS is_on_time
FROM orders o
LEFT JOIN customers c ON o.customer_id = c.customer_id
LEFT JOIN items_agg ia ON o.order_id = ia.order_id
LEFT JOIN payments_agg pa ON o.order_id = pa.order_id
LEFT JOIN reviews_agg ra ON o.order_id = ra.order_id;`
  },
  {
    viewName: 'fact_order_items',
    displayName: 'Fact Order Items',
    modelType: 'FACT',
    grain: '1 row per (order_id, order_item_id) line item',
    primaryKey: '(order_id, order_item_id)',
    sourceTables: ['order_items', 'orders', 'customers', 'products', 'category_translations', 'sellers'],
    foreignKeys: [
      'order_id -> fact_orders.order_id',
      'product_id -> dim_products.product_id',
      'seller_id -> dim_sellers.seller_id',
      'customer_unique_id -> dim_customers.customer_unique_id'
    ],
    antiMultiplicationRule:
      'Preserves atomic item-level grain (1..N per order). Never join payments directly to fact_order_items without allocating by item share.',
    sampleQuerySql: `SELECT order_id, order_item_id, product_id, product_category_english, seller_id, gmv_merchandise, freight_revenue, total_line_value FROM fact_order_items ORDER BY total_line_value DESC LIMIT 25;`,
    viewSqlDdl: `CREATE OR REPLACE VIEW fact_order_items AS
SELECT
  oi.order_id,
  oi.order_item_id,
  oi.product_id,
  oi.seller_id,
  o.customer_id,
  c.customer_unique_id,
  o.order_status,
  SUBSTR(CAST(o.order_purchase_timestamp AS VARCHAR), 1, 10) AS purchase_date_key,
  oi.shipping_limit_date,
  COALESCE(ct.product_category_name_english, p.product_category_name, 'unclassified') AS product_category_english,
  p.product_category_name AS product_category_portuguese,
  s.seller_city,
  s.seller_state,
  ROUND(oi.price, 2) AS gmv_merchandise,
  ROUND(oi.freight_value, 2) AS freight_revenue,
  ROUND(oi.price + oi.freight_value, 2) AS total_line_value
FROM order_items oi
LEFT JOIN orders o ON oi.order_id = o.order_id
LEFT JOIN customers c ON o.customer_id = c.customer_id
LEFT JOIN products p ON oi.product_id = p.product_id
LEFT JOIN category_translations ct ON p.product_category_name = ct.product_category_name
LEFT JOIN sellers s ON oi.seller_id = s.seller_id;`
  },
  {
    viewName: 'fact_payments',
    displayName: 'Fact Payments',
    modelType: 'FACT',
    grain: '1 row per (order_id, payment_sequential) settlement record',
    primaryKey: '(order_id, payment_sequential)',
    sourceTables: ['payments', 'orders', 'customers'],
    foreignKeys: [
      'order_id -> fact_orders.order_id',
      'customer_unique_id -> dim_customers.customer_unique_id',
      'purchase_date_key -> dim_date.date_key'
    ],
    antiMultiplicationRule:
      'Maintains payment transaction grain (credit_card, boleto, voucher, debit_card). Does not join raw order_items to prevent M*N Cartesian product.',
    sampleQuerySql: `SELECT order_id, payment_sequential, payment_type, payment_installments, payment_value, order_status FROM fact_payments ORDER BY payment_value DESC LIMIT 25;`,
    viewSqlDdl: `CREATE OR REPLACE VIEW fact_payments AS
SELECT
  pay.order_id,
  pay.payment_sequential,
  o.customer_id,
  c.customer_unique_id,
  o.order_status,
  SUBSTR(CAST(o.order_purchase_timestamp AS VARCHAR), 1, 10) AS purchase_date_key,
  pay.payment_type,
  pay.payment_installments,
  ROUND(pay.payment_value, 2) AS payment_value
FROM payments pay
LEFT JOIN orders o ON pay.order_id = o.order_id
LEFT JOIN customers c ON o.customer_id = c.customer_id;`
  },
  {
    viewName: 'fact_reviews',
    displayName: 'Fact Reviews',
    modelType: 'FACT',
    grain: '1 row per (review_id, order_id) customer evaluation',
    primaryKey: '(review_id, order_id)',
    sourceTables: ['reviews', 'orders', 'customers'],
    foreignKeys: [
      'order_id -> fact_orders.order_id',
      'customer_unique_id -> dim_customers.customer_unique_id'
    ],
    antiMultiplicationRule:
      'Evaluated at the review survey response grain. When joining to product or seller line items, pre-aggregate by order_id first.',
    sampleQuerySql: `SELECT review_id, order_id, customer_unique_id, review_score, sentiment_tier, review_comment_title, review_creation_date FROM fact_reviews ORDER BY review_creation_date DESC LIMIT 25;`,
    viewSqlDdl: `CREATE OR REPLACE VIEW fact_reviews AS
SELECT
  r.review_id,
  r.order_id,
  o.customer_id,
  c.customer_unique_id,
  o.order_status,
  r.review_score,
  CASE
    WHEN r.review_score >= 4 THEN 'Positive (4-5)'
    WHEN r.review_score = 3 THEN 'Neutral (3)'
    ELSE 'Negative (1-2)'
  END AS sentiment_tier,
  CASE
    WHEN r.review_comment_message IS NOT NULL AND TRIM(r.review_comment_message) <> '' THEN 1
    ELSE 0
  END AS has_written_comment,
  r.review_comment_title,
  r.review_comment_message,
  r.review_creation_date,
  r.review_answer_timestamp
FROM reviews r
LEFT JOIN orders o ON r.order_id = o.order_id
LEFT JOIN customers c ON o.customer_id = c.customer_id;`
  },
  {
    viewName: 'dim_customers',
    displayName: 'Dimension Customers',
    modelType: 'DIMENSION',
    grain: '1 row per permanent customer entity (customer_unique_id)',
    primaryKey: 'customer_unique_id',
    sourceTables: ['customers', 'fact_orders'],
    foreignKeys: ['customer_zip_code_prefix -> dim_geography.zip_code_prefix'],
    antiMultiplicationRule:
      'Resolves order-scoped customer_id keys into permanent customer_unique_id identities before aggregating lifetime orders and repeat purchase flags.',
    sampleQuerySql: `SELECT customer_unique_id, customer_city, customer_state, distinct_customer_id_keys, total_orders, lifetime_order_value, avg_order_value, is_repeat_customer, retention_cohort FROM dim_customers ORDER BY lifetime_order_value DESC LIMIT 25;`,
    viewSqlDdl: `CREATE OR REPLACE VIEW dim_customers AS
WITH customer_order_stats AS (
  SELECT
    c.customer_unique_id,
    MIN(c.customer_city) AS customer_city,
    MIN(c.customer_state) AS customer_state,
    MIN(c.customer_zip_code_prefix) AS customer_zip_code_prefix,
    COUNT(DISTINCT c.customer_id) AS distinct_customer_id_keys,
    COUNT(DISTINCT fo.order_id) AS total_orders,
    SUM(COALESCE(fo.is_completed, 0)) AS completed_orders,
    SUM(COALESCE(fo.is_cancelled, 0)) AS cancelled_orders,
    ROUND(COALESCE(SUM(fo.gmv_merchandise), 0), 2) AS lifetime_gmv,
    ROUND(COALESCE(SUM(fo.freight_revenue), 0), 2) AS lifetime_freight,
    ROUND(COALESCE(SUM(fo.total_order_value), 0), 2) AS lifetime_order_value,
    ROUND(COALESCE(AVG(NULLIF(fo.total_order_value, 0)), 0), 2) AS avg_order_value,
    MIN(fo.order_purchase_timestamp) AS first_order_timestamp,
    MAX(fo.order_purchase_timestamp) AS last_order_timestamp
  FROM customers c
  LEFT JOIN fact_orders fo ON c.customer_id = fo.customer_id
  GROUP BY c.customer_unique_id
)
SELECT
  customer_unique_id,
  customer_city,
  customer_state,
  customer_zip_code_prefix,
  distinct_customer_id_keys,
  total_orders,
  completed_orders,
  cancelled_orders,
  lifetime_gmv,
  lifetime_freight,
  lifetime_order_value,
  avg_order_value,
  first_order_timestamp,
  last_order_timestamp,
  CASE WHEN total_orders > 1 THEN 1 ELSE 0 END AS is_repeat_customer,
  CASE
    WHEN total_orders >= 3 THEN 'Loyal (3+ Orders)'
    WHEN total_orders = 2 THEN 'Repeat (2 Orders)'
    WHEN total_orders = 1 THEN 'One-Time (1 Order)'
    ELSE 'Registered (0 Orders)'
  END AS retention_cohort
FROM customer_order_stats;`
  },
  {
    viewName: 'dim_products',
    displayName: 'Dimension Products',
    modelType: 'DIMENSION',
    grain: '1 row per master product_id',
    primaryKey: 'product_id',
    sourceTables: ['products', 'category_translations', 'order_items'],
    foreignKeys: ['category_portuguese -> category_translations.product_category_name'],
    antiMultiplicationRule:
      'Aggregates order_items at the product_id grain prior to joining with products and category_translations.',
    sampleQuerySql: `SELECT product_id, category_english, category_portuguese, units_sold, total_merchandise_gmv, total_freight_revenue, product_weight_g, volume_cm3 FROM dim_products ORDER BY total_merchandise_gmv DESC LIMIT 25;`,
    viewSqlDdl: `CREATE OR REPLACE VIEW dim_products AS
WITH item_metrics AS (
  SELECT
    oi.product_id,
    COUNT(*) AS units_sold,
    COUNT(DISTINCT oi.order_id) AS distinct_orders_count,
    ROUND(COALESCE(SUM(oi.price), 0), 2) AS total_merchandise_gmv,
    ROUND(COALESCE(SUM(oi.freight_value), 0), 2) AS total_freight_revenue,
    ROUND(COALESCE(AVG(oi.price), 0), 2) AS avg_selling_price
  FROM order_items oi
  GROUP BY oi.product_id
)
SELECT
  p.product_id,
  p.product_category_name AS category_portuguese,
  COALESCE(ct.product_category_name_english, p.product_category_name, 'unclassified') AS category_english,
  p.product_photos_qty,
  p.product_weight_g,
  p.product_length_cm,
  p.product_height_cm,
  p.product_width_cm,
  COALESCE(p.product_length_cm * p.product_height_cm * p.product_width_cm, 0) AS volume_cm3,
  COALESCE(im.units_sold, 0) AS units_sold,
  COALESCE(im.distinct_orders_count, 0) AS distinct_orders_count,
  COALESCE(im.total_merchandise_gmv, 0) AS total_merchandise_gmv,
  COALESCE(im.total_freight_revenue, 0) AS total_freight_revenue,
  COALESCE(im.avg_selling_price, 0) AS avg_selling_price
FROM products p
LEFT JOIN category_translations ct ON p.product_category_name = ct.product_category_name
LEFT JOIN item_metrics im ON p.product_id = im.product_id;`
  },
  {
    viewName: 'dim_sellers',
    displayName: 'Dimension Sellers',
    modelType: 'DIMENSION',
    grain: '1 row per merchant seller_id',
    primaryKey: 'seller_id',
    sourceTables: ['sellers', 'order_items', 'reviews'],
    foreignKeys: ['seller_zip_code_prefix -> dim_geography.zip_code_prefix'],
    antiMultiplicationRule:
      'Pre-aggregates order reviews by order_id before rolling up order_items by seller_id.',
    sampleQuerySql: `SELECT seller_id, seller_city, seller_state, orders_fulfilled, items_sold, total_merchandise_gmv, total_freight_revenue, avg_review_score FROM dim_sellers ORDER BY total_merchandise_gmv DESC LIMIT 25;`,
    viewSqlDdl: `CREATE OR REPLACE VIEW dim_sellers AS
WITH order_rev AS (
  SELECT order_id, AVG(review_score) AS order_review_score
  FROM reviews
  GROUP BY order_id
),
seller_metrics AS (
  SELECT
    oi.seller_id,
    COUNT(DISTINCT oi.order_id) AS orders_fulfilled,
    COUNT(*) AS items_sold,
    COUNT(DISTINCT oi.product_id) AS distinct_products_sold,
    ROUND(COALESCE(SUM(oi.price), 0), 2) AS total_merchandise_gmv,
    ROUND(COALESCE(SUM(oi.freight_value), 0), 2) AS total_freight_revenue,
    ROUND(AVG(orv.order_review_score), 2) AS avg_review_score
  FROM order_items oi
  LEFT JOIN order_rev orv ON oi.order_id = orv.order_id
  GROUP BY oi.seller_id
)
SELECT
  s.seller_id,
  s.seller_city,
  s.seller_state,
  s.seller_zip_code_prefix,
  COALESCE(sm.orders_fulfilled, 0) AS orders_fulfilled,
  COALESCE(sm.items_sold, 0) AS items_sold,
  COALESCE(sm.distinct_products_sold, 0) AS distinct_products_sold,
  COALESCE(sm.total_merchandise_gmv, 0) AS total_merchandise_gmv,
  COALESCE(sm.total_freight_revenue, 0) AS total_freight_revenue,
  sm.avg_review_score
FROM sellers s
LEFT JOIN seller_metrics sm ON s.seller_id = sm.seller_id;`
  },
  {
    viewName: 'dim_date',
    displayName: 'Dimension Date',
    modelType: 'DIMENSION',
    grain: '1 row per calendar date (date_key YYYY-MM-DD)',
    primaryKey: 'date_key',
    sourceTables: ['orders', 'fact_orders'],
    foreignKeys: [],
    antiMultiplicationRule:
      'Constructs a deduplicated calendar spine from observed order lifecycle timestamps and joins order-grain daily totals.',
    sampleQuerySql: `SELECT date_key, year_num, quarter_num, year_month, is_weekend, orders_placed, daily_gmv, daily_order_value FROM dim_date ORDER BY date_key DESC LIMIT 25;`,
    viewSqlDdl: `CREATE OR REPLACE VIEW dim_date AS
WITH raw_dates AS (
  SELECT DISTINCT SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 10) AS date_key
  FROM orders
  WHERE order_purchase_timestamp IS NOT NULL AND LENGTH(TRIM(CAST(order_purchase_timestamp AS VARCHAR))) >= 10
  UNION
  SELECT DISTINCT SUBSTR(CAST(order_delivered_customer_date AS VARCHAR), 1, 10) AS date_key
  FROM orders
  WHERE order_delivered_customer_date IS NOT NULL AND LENGTH(TRIM(CAST(order_delivered_customer_date AS VARCHAR))) >= 10
  UNION
  SELECT DISTINCT SUBSTR(CAST(order_estimated_delivery_date AS VARCHAR), 1, 10) AS date_key
  FROM orders
  WHERE order_estimated_delivery_date IS NOT NULL AND LENGTH(TRIM(CAST(order_estimated_delivery_date AS VARCHAR))) >= 10
),
parsed_dates AS (
  SELECT
    date_key,
    TRY_CAST(date_key AS DATE) AS calendar_date
  FROM raw_dates
  WHERE TRY_CAST(date_key AS DATE) IS NOT NULL
),
daily_orders AS (
  SELECT
    purchase_date_key,
    COUNT(DISTINCT order_id) AS orders_placed,
    ROUND(COALESCE(SUM(gmv_merchandise), 0), 2) AS daily_gmv,
    ROUND(COALESCE(SUM(total_order_value), 0), 2) AS daily_order_value
  FROM fact_orders
  GROUP BY purchase_date_key
)
SELECT
  pd.date_key,
  CAST(pd.calendar_date AS VARCHAR) AS calendar_date,
  EXTRACT(YEAR FROM pd.calendar_date) AS year_num,
  EXTRACT(QUARTER FROM pd.calendar_date) AS quarter_num,
  EXTRACT(MONTH FROM pd.calendar_date) AS month_num,
  SUBSTR(pd.date_key, 1, 7) AS year_month,
  EXTRACT(DAY FROM pd.calendar_date) AS day_of_month,
  EXTRACT(DOW FROM pd.calendar_date) AS day_of_week,
  CASE WHEN EXTRACT(DOW FROM pd.calendar_date) IN (0, 6) THEN 1 ELSE 0 END AS is_weekend,
  COALESCE(do_agg.orders_placed, 0) AS orders_placed,
  COALESCE(do_agg.daily_gmv, 0) AS daily_gmv,
  COALESCE(do_agg.daily_order_value, 0) AS daily_order_value
FROM parsed_dates pd
LEFT JOIN daily_orders do_agg ON pd.date_key = do_agg.purchase_date_key
ORDER BY pd.date_key ASC;`
  },
  {
    viewName: 'dim_geography',
    displayName: 'Dimension Geography',
    modelType: 'DIMENSION',
    grain: '1 row per Brazilian (zip_code_prefix, state_code) region',
    primaryKey: '(zip_code_prefix, state_code)',
    sourceTables: ['geolocation', 'customers', 'sellers', 'fact_orders'],
    foreignKeys: [],
    antiMultiplicationRule:
      'Deduplicates multi-sample geolocation coordinates by zip_code_prefix before joining customer and seller counts so coordinate samples never multiply orders.',
    sampleQuerySql: `SELECT zip_code_prefix, city_name, state_code, avg_lat, avg_lng, unique_customers_count, sellers_count, total_orders_count, regional_order_value FROM dim_geography ORDER BY regional_order_value DESC LIMIT 25;`,
    viewSqlDdl: `CREATE OR REPLACE VIEW dim_geography AS
WITH geo_coords AS (
  SELECT
    geolocation_zip_code_prefix AS zip_code_prefix,
    geolocation_state AS state_code,
    MIN(geolocation_city) AS geo_city,
    ROUND(AVG(geolocation_lat), 4) AS avg_lat,
    ROUND(AVG(geolocation_lng), 4) AS avg_lng
  FROM geolocation
  WHERE geolocation_zip_code_prefix IS NOT NULL
  GROUP BY geolocation_zip_code_prefix, geolocation_state
),
cust_geo AS (
  SELECT
    c.customer_zip_code_prefix AS zip_code_prefix,
    c.customer_state AS state_code,
    MIN(c.customer_city) AS cust_city,
    COUNT(DISTINCT c.customer_unique_id) AS unique_customers_count,
    COUNT(DISTINCT fo.order_id) AS customer_orders_count,
    ROUND(COALESCE(SUM(fo.total_order_value), 0), 2) AS regional_order_value
  FROM customers c
  LEFT JOIN fact_orders fo ON c.customer_id = fo.customer_id
  WHERE c.customer_zip_code_prefix IS NOT NULL
  GROUP BY c.customer_zip_code_prefix, c.customer_state
),
seller_geo AS (
  SELECT
    seller_zip_code_prefix AS zip_code_prefix,
    seller_state AS state_code,
    MIN(seller_city) AS sell_city,
    COUNT(DISTINCT seller_id) AS sellers_count
  FROM sellers
  WHERE seller_zip_code_prefix IS NOT NULL
  GROUP BY seller_zip_code_prefix, seller_state
),
all_zip_keys AS (
  SELECT zip_code_prefix, state_code FROM geo_coords
  UNION
  SELECT zip_code_prefix, state_code FROM cust_geo
  UNION
  SELECT zip_code_prefix, state_code FROM seller_geo
)
SELECT
  k.zip_code_prefix,
  k.state_code,
  COALESCE(cg.cust_city, sg.sell_city, gc.geo_city, 'unknown') AS city_name,
  gc.avg_lat,
  gc.avg_lng,
  COALESCE(cg.unique_customers_count, 0) AS unique_customers_count,
  COALESCE(sg.sellers_count, 0) AS sellers_count,
  COALESCE(cg.customer_orders_count, 0) AS total_orders_count,
  COALESCE(cg.regional_order_value, 0) AS regional_order_value
FROM all_zip_keys k
LEFT JOIN geo_coords gc ON k.zip_code_prefix = gc.zip_code_prefix AND k.state_code = gc.state_code
LEFT JOIN cust_geo cg ON k.zip_code_prefix = cg.zip_code_prefix AND k.state_code = cg.state_code
LEFT JOIN seller_geo sg ON k.zip_code_prefix = sg.zip_code_prefix AND k.state_code = sg.state_code
ORDER BY regional_order_value DESC, k.zip_code_prefix ASC;`
  }
];

export interface KpiDefinitionSpec extends Omit<KpiDictionaryEntry, 'currentValue'> {
  scalarSql: string;
}

export const KPI_DICTIONARY_DEFINITIONS: KpiDefinitionSpec[] = [
  {
    id: 'kpi-gmv',
    metricName: 'Gross Merchandise Value (GMV)',
    category: 'Revenue & Order Economics',
    unit: 'currency',
    sourceAnalyticalModel: 'fact_order_items',
    businessDefinition:
      'Sum of item merchandise prices (excluding shipping freight) across all order line items.',
    grainAndJoinRule:
      'Aggregated directly from fact_order_items (1 row per order_id, order_item_id) without joining to payments.',
    formulaExpression: 'SUM(order_items.price)',
    reproducibleSql: `SELECT ROUND(COALESCE(SUM(gmv_merchandise), 0), 2) AS gross_merchandise_value FROM fact_order_items;`,
    scalarSql: `SELECT ROUND(COALESCE(SUM(gmv_merchandise), 0), 2) FROM fact_order_items`
  },
  {
    id: 'kpi-freight-revenue',
    metricName: 'Freight Revenue',
    category: 'Revenue & Order Economics',
    unit: 'currency',
    sourceAnalyticalModel: 'fact_order_items',
    businessDefinition:
      'Total shipping and logistics freight charges billed across all order line items.',
    grainAndJoinRule:
      'Aggregated from fact_order_items (1 row per order_id, order_item_id) without payment fan-out.',
    formulaExpression: 'SUM(order_items.freight_value)',
    reproducibleSql: `SELECT ROUND(COALESCE(SUM(freight_revenue), 0), 2) AS freight_revenue FROM fact_order_items;`,
    scalarSql: `SELECT ROUND(COALESCE(SUM(freight_revenue), 0), 2) FROM fact_order_items`
  },
  {
    id: 'kpi-total-order-value',
    metricName: 'Total Order Value',
    category: 'Revenue & Order Economics',
    unit: 'currency',
    sourceAnalyticalModel: 'fact_orders',
    businessDefinition:
      'Combined order value (reconciled payment settlement / merchandise GMV + freight revenue) across all orders.',
    grainAndJoinRule:
      'Evaluated at the 1-row-per-order_id grain in fact_orders so multi-item and multi-installment orders are never double-counted.',
    formulaExpression: 'SUM(fact_orders.total_order_value)',
    reproducibleSql: `SELECT ROUND(COALESCE(SUM(total_order_value), 0), 2) AS total_order_value FROM fact_orders;`,
    scalarSql: `SELECT ROUND(COALESCE(SUM(total_order_value), 0), 2) FROM fact_orders`
  },
  {
    id: 'kpi-completed-orders',
    metricName: 'Completed Orders',
    category: 'Order Lifecycle',
    unit: 'number',
    sourceAnalyticalModel: 'fact_orders',
    businessDefinition:
      'Count of distinct orders that have reached final customer delivery (order_status = delivered).',
    grainAndJoinRule:
      'Evaluated at the order_id grain (COUNT(DISTINCT order_id) WHERE order_status = delivered).',
    formulaExpression: "COUNT(DISTINCT order_id) WHERE order_status = 'delivered'",
    reproducibleSql: `SELECT COUNT(DISTINCT order_id) AS completed_orders FROM fact_orders WHERE order_status = 'delivered';`,
    scalarSql: `SELECT COUNT(DISTINCT order_id) FROM fact_orders WHERE order_status = 'delivered'`
  },
  {
    id: 'kpi-cancelled-orders',
    metricName: 'Cancelled Orders',
    category: 'Order Lifecycle',
    unit: 'number',
    sourceAnalyticalModel: 'fact_orders',
    businessDefinition:
      'Count of distinct orders terminated prior to fulfillment (order_status IN canceled, unavailable).',
    grainAndJoinRule:
      'Evaluated at the order_id grain in fact_orders.',
    formulaExpression: "COUNT(DISTINCT order_id) WHERE order_status IN ('canceled', 'unavailable')",
    reproducibleSql: `SELECT COUNT(DISTINCT order_id) AS cancelled_orders FROM fact_orders WHERE order_status IN ('canceled', 'unavailable');`,
    scalarSql: `SELECT COUNT(DISTINCT order_id) FROM fact_orders WHERE order_status IN ('canceled', 'unavailable')`
  },
  {
    id: 'kpi-aov',
    metricName: 'Average Order Value (AOV)',
    category: 'Revenue & Order Economics',
    unit: 'currency',
    sourceAnalyticalModel: 'fact_orders',
    businessDefinition:
      'Mean Total Order Value per distinct order_id (never per item row or per payment installment row).',
    grainAndJoinRule:
      'Pre-aggregates order value to 1 row per order_id in fact_orders before taking AVG(total_order_value).',
    formulaExpression: 'SUM(fact_orders.total_order_value) / NULLIF(COUNT(DISTINCT fact_orders.order_id), 0)',
    reproducibleSql: `SELECT ROUND(COALESCE(AVG(total_order_value), 0), 2) AS average_order_value FROM fact_orders WHERE total_order_value > 0;`,
    scalarSql: `SELECT ROUND(COALESCE(AVG(total_order_value), 0), 2) FROM fact_orders WHERE total_order_value > 0`
  },
  {
    id: 'kpi-unique-customers',
    metricName: 'Unique Purchasing Customers',
    category: 'Customer Identity & Retention',
    unit: 'number',
    sourceAnalyticalModel: 'dim_customers',
    businessDefinition:
      'Count of permanent real-world customer identities (customer_unique_id) who have placed at least one order.',
    grainAndJoinRule:
      'Uses customer_unique_id from dim_customers. Never uses customer_id, which Olist generates fresh for every single order.',
    formulaExpression: 'COUNT(DISTINCT customer_unique_id) WHERE total_orders >= 1',
    reproducibleSql: `SELECT COUNT(DISTINCT customer_unique_id) AS unique_purchasing_customers FROM dim_customers WHERE total_orders >= 1;`,
    scalarSql: `SELECT COUNT(DISTINCT customer_unique_id) FROM dim_customers WHERE total_orders >= 1`
  },
  {
    id: 'kpi-repeat-customer-rate',
    metricName: 'Repeat Customer Rate',
    category: 'Customer Identity & Retention',
    unit: 'percent',
    sourceAnalyticalModel: 'dim_customers',
    businessDefinition:
      'Percentage of unique purchasing customers (customer_unique_id) who have placed 2 or more distinct orders.',
    grainAndJoinRule:
      'Groups orders by permanent customer_unique_id in dim_customers before testing total_orders > 1.',
    formulaExpression: '(COUNT(DISTINCT customer_unique_id WHERE total_orders > 1) / COUNT(DISTINCT customer_unique_id)) * 100',
    reproducibleSql: `SELECT ROUND(COALESCE(SUM(CASE WHEN is_repeat_customer = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 0), 2) AS repeat_customer_rate_pct FROM dim_customers WHERE total_orders >= 1;`,
    scalarSql: `SELECT ROUND(COALESCE(SUM(CASE WHEN is_repeat_customer = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 0), 2) FROM dim_customers WHERE total_orders >= 1`
  },
  {
    id: 'kpi-avg-review-score',
    metricName: 'Average Review Score',
    category: 'Experience & Fulfillment SLA',
    unit: 'score',
    sourceAnalyticalModel: 'fact_reviews',
    businessDefinition:
      'Arithmetic mean of customer satisfaction ratings (1 to 5 scale) across all submitted order reviews.',
    grainAndJoinRule:
      'Evaluated directly from fact_reviews (1 row per review_id, order_id) without joining to order_items (which would overweight multi-item orders).',
    formulaExpression: 'AVG(fact_reviews.review_score)',
    reproducibleSql: `SELECT ROUND(COALESCE(AVG(review_score), 0), 2) AS average_review_score FROM fact_reviews;`,
    scalarSql: `SELECT ROUND(COALESCE(AVG(review_score), 0), 2) FROM fact_reviews`
  },
  {
    id: 'kpi-ontime-delivery-pct',
    metricName: 'On-Time Delivery Percentage',
    category: 'Experience & Fulfillment SLA',
    unit: 'percent',
    sourceAnalyticalModel: 'fact_orders',
    businessDefinition:
      'Percentage of completed (delivered) orders where actual customer delivery timestamp was on or before the estimated delivery date.',
    grainAndJoinRule:
      'Evaluated at the 1-row-per-order_id grain in fact_orders where is_completed = 1.',
    formulaExpression: '(SUM(is_on_time) / COUNT(delivered_orders)) * 100',
    reproducibleSql: `SELECT ROUND(COALESCE(SUM(is_on_time) * 100.0 / NULLIF(COUNT(*), 0), 0), 2) AS on_time_delivery_pct FROM fact_orders WHERE is_completed = 1;`,
    scalarSql: `SELECT ROUND(COALESCE(SUM(is_on_time) * 100.0 / NULLIF(COUNT(*), 0), 0), 2) FROM fact_orders WHERE is_completed = 1`
  }
];
