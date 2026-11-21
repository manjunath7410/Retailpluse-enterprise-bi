export type SqlQueryCategory =
  | 'Sales Analysis'
  | 'Customer Analysis'
  | 'Product Analysis'
  | 'Seller Analysis'
  | 'Payment Analysis'
  | 'Delivery Analysis'
  | 'Review Analysis'
  | 'Advanced Window Functions';

export type SqlConceptTag =
  | 'INNER JOIN'
  | 'LEFT JOIN'
  | 'GROUP BY'
  | 'HAVING'
  | 'CASE WHEN'
  | 'Subqueries'
  | 'Common Table Expressions'
  | 'Window Functions'
  | 'ROW_NUMBER'
  | 'RANK'
  | 'DENSE_RANK'
  | 'LAG'
  | 'LEAD'
  | 'Running Totals'
  | 'Moving Averages'
  | 'Date Functions'
  | 'Conditional Aggregation';

export interface SavedSqlQueryItem {
  id: string;
  code: string;
  title: string;
  category: SqlQueryCategory;
  businessQuestion: string;
  sql: string;
  explanation: string;
  expectedInterpretation: string;
  sqlConcepts: SqlConceptTag[];
  isSystemPreset?: boolean;
  isAcceptanceBenchmark?: boolean;
  createdAt?: string;
}

export const SQL_QUERY_CATEGORIES: SqlQueryCategory[] = [
  'Sales Analysis',
  'Customer Analysis',
  'Product Analysis',
  'Seller Analysis',
  'Payment Analysis',
  'Delivery Analysis',
  'Review Analysis',
  'Advanced Window Functions'
];

export const ALL_SQL_CONCEPTS: SqlConceptTag[] = [
  'INNER JOIN',
  'LEFT JOIN',
  'GROUP BY',
  'HAVING',
  'CASE WHEN',
  'Subqueries',
  'Common Table Expressions',
  'Window Functions',
  'ROW_NUMBER',
  'RANK',
  'DENSE_RANK',
  'LAG',
  'LEAD',
  'Running Totals',
  'Moving Averages',
  'Date Functions',
  'Conditional Aggregation'
];

export const REQUIRED_SQL_CONCEPTS = ALL_SQL_CONCEPTS;


export const CURATED_SQL_LIBRARY: SavedSqlQueryItem[] = [
  // ===========================================================================
  // 1. SALES ANALYSIS (5 Queries)
  // ===========================================================================
  {
    id: 'sal-01-gmv-reconciliation',
    code: 'SAL-01',
    title: 'Executive GMV, Freight & Order-Grain Settlement Reconciliation',
    category: 'Sales Analysis',
    businessQuestion:
      'What are our total Gross Merchandise Value (GMV), Freight Revenue, Total Order Value, and Average Order Value (AOV) without multi-item or multi-payment double counting?',
    sql: `WITH item_rollup AS (
  SELECT
    order_id,
    COUNT(*) AS item_units,
    ROUND(SUM(price), 2) AS merchandise_gmv,
    ROUND(SUM(freight_value), 2) AS freight_revenue
  FROM order_items
  GROUP BY order_id
),
payment_rollup AS (
  SELECT
    order_id,
    COUNT(*) AS payment_rows,
    ROUND(SUM(payment_value), 2) AS settled_payment_value
  FROM payments
  GROUP BY order_id
)
SELECT
  COUNT(DISTINCT o.order_id) AS total_orders,
  SUM(COALESCE(ir.item_units, 0)) AS total_line_items,
  ROUND(SUM(COALESCE(ir.merchandise_gmv, 0)), 2) AS gross_merchandise_value,
  ROUND(SUM(COALESCE(ir.freight_revenue, 0)), 2) AS total_freight_revenue,
  ROUND(SUM(COALESCE(pr.settled_payment_value, 0)), 2) AS total_order_value,
  ROUND(AVG(NULLIF(pr.settled_payment_value, 0)), 2) AS average_order_value
FROM orders o
LEFT JOIN item_rollup ir ON o.order_id = ir.order_id
LEFT JOIN payment_rollup pr ON o.order_id = pr.order_id;`,
    explanation:
      'Uses two Common Table Expressions (item_rollup and payment_rollup) to aggregate line items and payment installments to the 1-row-per-order_id grain before performing LEFT JOINs to orders.',
    expectedInterpretation:
      'Total Order Value equals the sum of merchandise GMV plus freight revenue, and AOV reflects true mean order spend across distinct order_id records.',
    sqlConcepts: ['Common Table Expressions', 'LEFT JOIN', 'GROUP BY'],
    isSystemPreset: true,
    isAcceptanceBenchmark: true
  },
  {
    id: 'sal-02-monthly-trends',
    code: 'SAL-02',
    title: 'Monthly Revenue Velocity, Order Volume & Fulfilled Share',
    category: 'Sales Analysis',
    businessQuestion:
      'How do monthly order volume, merchandise GMV, freight revenue, and delivered revenue evolve over time?',
    sql: `SELECT
  SUBSTR(CAST(purchase_date_key AS VARCHAR), 1, 7) AS order_month,
  COUNT(DISTINCT order_id) AS total_orders,
  SUM(item_count) AS units_sold,
  ROUND(SUM(gmv_merchandise), 2) AS monthly_gmv,
  ROUND(SUM(freight_revenue), 2) AS monthly_freight,
  ROUND(SUM(total_order_value), 2) AS monthly_total_value,
  ROUND(AVG(total_order_value), 2) AS monthly_aov,
  ROUND(SUM(CASE WHEN order_status = 'delivered' THEN total_order_value ELSE 0 END), 2) AS delivered_order_value
FROM fact_orders
GROUP BY order_month
ORDER BY order_month ASC;`,
    explanation:
      'Extracts the YYYY-MM month key from purchase_date_key in fact_orders and applies conditional aggregation (CASE WHEN) to isolate delivered revenue alongside total monthly order value.',
    expectedInterpretation:
      'Highlights month-over-month commercial trajectory and compares total booked order value against completed delivered value.',
    sqlConcepts: ['Date Functions', 'GROUP BY', 'CASE WHEN', 'Conditional Aggregation'],
    isSystemPreset: true,
    isAcceptanceBenchmark: true
  },
  {
    id: 'sal-03-order-lifecycle-funnel',
    code: 'SAL-03',
    title: 'Order Lifecycle Status Funnel & Value Realization',
    category: 'Sales Analysis',
    businessQuestion:
      'How much revenue is locked in delivered, shipped, processing, or canceled lifecycle states?',
    sql: `SELECT
  order_status,
  COUNT(DISTINCT order_id) AS order_count,
  ROUND(COUNT(DISTINCT order_id) * 100.0 / SUM(COUNT(DISTINCT order_id)) OVER (), 2) AS order_share_pct,
  ROUND(SUM(gmv_merchandise), 2) AS merchandise_gmv,
  ROUND(SUM(freight_revenue), 2) AS freight_revenue,
  ROUND(SUM(total_order_value), 2) AS total_order_value,
  ROUND(AVG(total_order_value), 2) AS mean_order_value
FROM fact_orders
GROUP BY order_status
ORDER BY total_order_value DESC;`,
    explanation:
      'Groups fact_orders by order_status and combines aggregate functions with an analytic window denominator SUM(COUNT(*)) OVER () to compute each status share of total orders.',
    expectedInterpretation:
      'Shows the percentage of orders that successfully reach delivered status versus in-transit (shipped/processing) or lost (canceled/unavailable).',
    sqlConcepts: ['GROUP BY', 'Window Functions'],
    isSystemPreset: true
  },
  {
    id: 'sal-04-basket-size-tiers',
    code: 'SAL-04',
    title: 'Multi-Item Basket Size Distribution & Freight Elasticity',
    category: 'Sales Analysis',
    businessQuestion:
      'Do multi-item orders generate higher Average Order Value and lower relative freight ratios than single-item orders?',
    sql: `SELECT
  CASE
    WHEN item_count = 1 THEN '1 Item (Single-Unit Order)'
    WHEN item_count = 2 THEN '2 Items (Dual-Unit Basket)'
    WHEN item_count >= 3 THEN '3+ Items (Multi-Unit Basket)'
    ELSE '0 Items (Unlinked)'
  END AS basket_size_tier,
  COUNT(DISTINCT order_id) AS orders_count,
  SUM(item_count) AS total_units,
  ROUND(AVG(gmv_merchandise), 2) AS avg_merchandise_gmv,
  ROUND(AVG(freight_revenue), 2) AS avg_freight_cost,
  ROUND(SUM(freight_revenue) * 100.0 / NULLIF(SUM(gmv_merchandise), 0), 2) AS freight_to_gmv_pct
FROM fact_orders
GROUP BY basket_size_tier
ORDER BY orders_count DESC;`,
    explanation:
      'Classifies orders into basket tiers using CASE WHEN on item_count and evaluates average GMV, average freight, and freight-to-GMV ratio.',
    expectedInterpretation:
      'Reveals whether bundling multiple items into a single order amortizes shipping costs and improves unit economics.',
    sqlConcepts: ['CASE WHEN', 'GROUP BY'],
    isSystemPreset: true
  },
  {
    id: 'sal-05-above-average-orders-subquery',
    code: 'SAL-05',
    title: 'High-Value Enterprise Orders Exceeding Platform Mean AOV',
    category: 'Sales Analysis',
    businessQuestion:
      'Which individual orders exceed the platform-wide Average Order Value, and which states and categories drive them?',
    sql: `SELECT
  fo.order_id,
  fo.customer_unique_id,
  fo.customer_state,
  fo.order_status,
  fo.item_count,
  fo.gmv_merchandise,
  fo.freight_revenue,
  fo.total_order_value,
  ROUND(fo.total_order_value - (SELECT AVG(total_order_value) FROM fact_orders WHERE total_order_value > 0), 2) AS premium_above_aov
FROM fact_orders fo
WHERE fo.total_order_value > (
  SELECT AVG(total_order_value)
  FROM fact_orders
  WHERE total_order_value > 0
)
ORDER BY fo.total_order_value DESC;`,
    explanation:
      'Uses scalar subqueries in both the SELECT projection and WHERE filter to isolate orders whose total_order_value exceeds the global mean AOV.',
    expectedInterpretation:
      'Identifies flagship high-ticket orders and quantifies their dollar premium above the average order baseline.',
    sqlConcepts: ['Subqueries'],
    isSystemPreset: true
  },

  // ===========================================================================
  // 2. CUSTOMER ANALYSIS (5 Queries)
  // ===========================================================================
  {
    id: 'cus-01-repeat-customer-cohorts',
    code: 'CUS-01',
    title: 'Customer Entity Resolution & Repeat Purchase Cohorts (customer_unique_id)',
    category: 'Customer Analysis',
    businessQuestion:
      'When resolving order-scoped customer_id keys into permanent customer_unique_id identities, what is our true repeat customer rate and lifetime value by cohort?',
    sql: `WITH customer_rollup AS (
  SELECT
    c.customer_unique_id,
    COUNT(DISTINCT c.customer_id) AS order_scoped_keys_count,
    COUNT(DISTINCT fo.order_id) AS distinct_orders,
    ROUND(SUM(fo.total_order_value), 2) AS lifetime_spend,
    ROUND(AVG(fo.total_order_value), 2) AS avg_order_spend
  FROM customers c
  INNER JOIN fact_orders fo ON c.customer_id = fo.customer_id
  GROUP BY c.customer_unique_id
)
SELECT
  CASE
    WHEN distinct_orders = 1 THEN '1. One-Time Buyer (1 Order)'
    WHEN distinct_orders = 2 THEN '2. Repeat Buyer (2 Orders)'
    ELSE '3. Loyal Account (3+ Orders)'
  END AS retention_cohort,
  COUNT(*) AS unique_customers,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS customer_share_pct,
  SUM(distinct_orders) AS total_orders_placed,
  ROUND(SUM(lifetime_spend), 2) AS cohort_total_revenue,
  ROUND(AVG(lifetime_spend), 2) AS mean_customer_ltv
FROM customer_rollup
GROUP BY retention_cohort
ORDER BY retention_cohort ASC;`,
    explanation:
      'Joins customers to fact_orders via INNER JOIN on customer_id, groups by permanent customer_unique_id in a CTE, and segments accounts into One-Time, Repeat, and Loyal cohorts.',
    expectedInterpretation:
      'Demonstrates why customer_unique_id is required to measure repeat purchasing and quantifies the disproportionate LTV of repeat buyers.',
    sqlConcepts: ['Common Table Expressions', 'INNER JOIN', 'GROUP BY', 'CASE WHEN', 'Window Functions'],
    isSystemPreset: true,
    isAcceptanceBenchmark: true
  },
  {
    id: 'cus-02-repeat-buyers-having',
    code: 'CUS-02',
    title: 'High-Frequency Repeat Buyers Directory (HAVING Clause Filter)',
    category: 'Customer Analysis',
    businessQuestion:
      'Which permanent customer_unique_id accounts have placed 2 or more distinct orders, and what is their inter-order span?',
    sql: `SELECT
  c.customer_unique_id,
  MIN(c.customer_city) AS primary_city,
  MIN(c.customer_state) AS primary_state,
  COUNT(DISTINCT o.customer_id) AS distinct_customer_id_keys,
  COUNT(DISTINCT o.order_id) AS total_orders,
  ROUND(SUM(fo.total_order_value), 2) AS lifetime_order_value,
  ROUND(AVG(fo.total_order_value), 2) AS average_order_value,
  SUBSTR(CAST(MIN(o.order_purchase_timestamp) AS VARCHAR), 1, 10) AS first_order_date,
  SUBSTR(CAST(MAX(o.order_purchase_timestamp) AS VARCHAR), 1, 10) AS latest_order_date
FROM customers c
INNER JOIN orders o ON c.customer_id = o.customer_id
INNER JOIN fact_orders fo ON o.order_id = fo.order_id
GROUP BY c.customer_unique_id
HAVING COUNT(DISTINCT o.order_id) > 1
ORDER BY total_orders DESC, lifetime_order_value DESC;`,
    explanation:
      'Aggregates orders by c.customer_unique_id and applies HAVING COUNT(DISTINCT o.order_id) > 1 to filter strictly for repeat purchasing customers.',
    expectedInterpretation:
      'Lists every repeat customer entity along with proof that distinct_customer_id_keys equals total_orders in Olist.',
    sqlConcepts: ['INNER JOIN', 'GROUP BY', 'HAVING', 'Date Functions'],
    isSystemPreset: true
  },
  {
    id: 'cus-03-state-penetration',
    code: 'CUS-03',
    title: 'Geographic Customer Penetration & Revenue Density by Brazilian State',
    category: 'Customer Analysis',
    businessQuestion:
      'How are unique purchasing customers, order counts, and lifetime spend distributed across Brazilian states?',
    sql: `SELECT
  customer_state AS state_code,
  COUNT(DISTINCT customer_unique_id) AS unique_customers,
  SUM(total_orders) AS total_orders,
  SUM(CASE WHEN is_repeat_customer = 1 THEN 1 ELSE 0 END) AS repeat_customers,
  ROUND(SUM(lifetime_order_value), 2) AS state_total_revenue,
  ROUND(AVG(lifetime_order_value), 2) AS avg_revenue_per_customer,
  ROUND(SUM(lifetime_order_value) * 100.0 / SUM(SUM(lifetime_order_value)) OVER (), 2) AS national_revenue_share_pct
FROM dim_customers
GROUP BY customer_state
ORDER BY state_total_revenue DESC;`,
    explanation:
      'Queries dim_customers at the customer_unique_id grain, grouping by Brazilian state_code with conditional aggregation for repeat buyers and window share calculation.',
    expectedInterpretation:
      'Identifies core geographic revenue hubs (such as SP, RJ, MG, PR) and compares per-customer spend across states.',
    sqlConcepts: ['GROUP BY', 'Conditional Aggregation', 'Window Functions'],
    isSystemPreset: true
  },
  {
    id: 'cus-04-interpurchase-cadence',
    code: 'CUS-04',
    title: 'Customer Inter-Purchase Latency Between Consecutive Orders (LAG)',
    category: 'Customer Analysis',
    businessQuestion:
      'For repeat customers, how many days elapse between their first order and subsequent repeat orders?',
    sql: `WITH ordered_purchases AS (
  SELECT
    fo.customer_unique_id,
    fo.order_id,
    fo.purchase_date_key,
    TRY_CAST(fo.purchase_date_key AS DATE) AS order_date,
    fo.total_order_value,
    ROW_NUMBER() OVER (PARTITION BY fo.customer_unique_id ORDER BY fo.order_purchase_timestamp ASC) AS purchase_sequence,
    LAG(TRY_CAST(fo.purchase_date_key AS DATE)) OVER (PARTITION BY fo.customer_unique_id ORDER BY fo.order_purchase_timestamp ASC) AS previous_order_date
  FROM fact_orders fo
)
SELECT
  customer_unique_id,
  order_id,
  purchase_sequence,
  CAST(previous_order_date AS VARCHAR) AS previous_order_date,
  purchase_date_key AS current_order_date,
   DATE_DIFF('day', previous_order_date, order_date) AS days_since_previous_order,
  total_order_value
FROM ordered_purchases
WHERE previous_order_date IS NOT NULL
ORDER BY customer_unique_id ASC, purchase_sequence ASC;`,
    explanation:
      'Uses ROW_NUMBER() and LAG() partitioned by customer_unique_id together with DuckDB DATE_DIFF to measure exact calendar days between consecutive purchases.',
    expectedInterpretation:
      'Reveals the natural replenishment cycle and days-to-second-order latency for repeat accounts.',
    sqlConcepts: ['Common Table Expressions', 'Window Functions', 'ROW_NUMBER', 'LAG', 'Date Functions'],
    isSystemPreset: true
  },
  {
    id: 'cus-05-city-tier-pareto',
    code: 'CUS-05',
    title: 'Top Municipal Markets & Revenue Concentration by City',
    category: 'Customer Analysis',
    businessQuestion:
      'Which Brazilian municipalities generate the highest customer density and order value?',
    sql: `SELECT
  customer_city,
  customer_state,
  COUNT(DISTINCT customer_unique_id) AS unique_buyers,
  SUM(total_orders) AS orders_count,
  ROUND(SUM(lifetime_gmv), 2) AS city_merchandise_gmv,
  ROUND(SUM(lifetime_freight), 2) AS city_freight_revenue,
  ROUND(SUM(lifetime_order_value), 2) AS city_total_order_value
FROM dim_customers
GROUP BY customer_city, customer_state
ORDER BY city_total_order_value DESC
LIMIT 20;`,
    explanation:
      'Aggregates dim_customers by municipality and state to rank urban commercial centers by total order value.',
    expectedInterpretation:
      'Surfaces top metropolitan demand centers for regional marketing and fulfillment warehouse placement.',
    sqlConcepts: ['GROUP BY'],
    isSystemPreset: true
  },

  // ===========================================================================
  // 3. PRODUCT ANALYSIS (4 Queries)
  // ===========================================================================
  {
    id: 'prd-01-category-translation-performance',
    code: 'PRD-01',
    title: 'Translated English Product Category Revenue, Units & Review Score',
    category: 'Product Analysis',
    businessQuestion:
      'Which English-translated product categories generate the highest merchandise GMV, unit velocity, and customer satisfaction?',
    sql: `WITH order_review_avg AS (
  SELECT order_id, AVG(review_score) AS avg_order_rating
  FROM reviews
  GROUP BY order_id
)
SELECT
  COALESCE(ct.product_category_name_english, p.product_category_name, 'unclassified') AS category_english,
  p.product_category_name AS category_portuguese,
  COUNT(DISTINCT p.product_id) AS active_skus,
  COUNT(oi.order_item_id) AS units_sold,
  COUNT(DISTINCT oi.order_id) AS distinct_orders,
  ROUND(SUM(oi.price), 2) AS category_merchandise_gmv,
  ROUND(SUM(oi.freight_value), 2) AS category_freight_value,
  ROUND(AVG(ora.avg_order_rating), 2) AS avg_review_score
FROM order_items oi
INNER JOIN products p ON oi.product_id = p.product_id
LEFT JOIN category_translations ct ON p.product_category_name = ct.product_category_name
LEFT JOIN order_review_avg ora ON oi.order_id = ora.order_id
GROUP BY category_english, category_portuguese
ORDER BY category_merchandise_gmv DESC;`,
    explanation:
      'Joins order_items -> products (INNER JOIN) -> category_translations (LEFT JOIN) and pre-aggregates review scores by order_id to prevent multi-review fan-out.',
    expectedInterpretation:
      'Ranks product categories in English while preserving the original Portuguese key and showing category-level satisfaction.',
    sqlConcepts: ['Common Table Expressions', 'INNER JOIN', 'LEFT JOIN', 'GROUP BY'],
    isSystemPreset: true,
    isAcceptanceBenchmark: true
  },
  {
    id: 'prd-02-volumetric-weight-freight',
    code: 'PRD-02',
    title: 'Product Physical Dimensions, Volumetric Weight & Freight Burden',
    category: 'Product Analysis',
    businessQuestion:
      'How do product weight (grams) and cubic volume (cm³) impact per-unit shipping freight charges across SKUs?',
    sql: `SELECT
  product_id,
  category_english,
  product_weight_g,
  volume_cm3,
  units_sold,
  avg_selling_price,
  ROUND(total_freight_revenue / NULLIF(units_sold, 0), 2) AS avg_freight_per_unit,
  ROUND((total_freight_revenue / NULLIF(total_merchandise_gmv, 0)) * 100.0, 2) AS freight_to_price_ratio_pct
FROM dim_products
WHERE units_sold > 0
ORDER BY product_weight_g DESC, volume_cm3 DESC;`,
    explanation:
      'Queries dim_products to correlate physical weight (product_weight_g) and cubic volume (length * height * width) against unit freight cost and freight-to-price percentage.',
    expectedInterpretation:
      'Identifies heavy or bulky SKUs where logistics freight erodes customer price competitiveness.',
    sqlConcepts: ['CASE WHEN'],
    isSystemPreset: true
  },
  {
    id: 'prd-03-photo-description-conversion',
    code: 'PRD-03',
    title: 'Catalog Content Richness (Photo Count & Description Length) vs. Velocity',
    category: 'Product Analysis',
    businessQuestion:
      'Do products with more published photos and longer descriptions achieve higher unit sales and GMV per SKU?',
    sql: `SELECT
  CASE
    WHEN COALESCE(p.product_photos_qty, 0) >= 3 THEN 'High Visual Richness (3+ Photos)'
    WHEN COALESCE(p.product_photos_qty, 0) = 2 THEN 'Medium Visual Richness (2 Photos)'
    ELSE 'Low Visual Richness (1 Photo)'
  END AS catalog_photo_tier,
  COUNT(DISTINCT p.product_id) AS sku_count,
  ROUND(AVG(p.product_description_lenght), 0) AS avg_description_chars,
  SUM(dp.units_sold) AS total_units_sold,
  ROUND(AVG(dp.units_sold), 2) AS units_sold_per_sku,
  ROUND(SUM(dp.total_merchandise_gmv), 2) AS total_tier_gmv
FROM products p
INNER JOIN dim_products dp ON p.product_id = dp.product_id
GROUP BY catalog_photo_tier
ORDER BY total_tier_gmv DESC;`,
    explanation:
      'Segments catalog SKUs by product_photos_qty using CASE WHEN and compares average description length (product_description_lenght) against unit velocity per SKU.',
    expectedInterpretation:
      'Evaluates whether richer product detail pages correlate with higher sales conversion per SKU.',
    sqlConcepts: ['INNER JOIN', 'CASE WHEN', 'GROUP BY'],
    isSystemPreset: true
  },
  {
    id: 'prd-04-untranslated-or-missing-categories',
    code: 'PRD-04',
    title: 'Catalog Category Coverage & Translation Completeness Audit',
    category: 'Product Analysis',
    businessQuestion:
      'Are any products missing a Portuguese category name or lacking an English translation in category_translations?',
    sql: `SELECT
  p.product_id,
  COALESCE(p.product_category_name, 'NULL_CATEGORY') AS raw_category_portuguese,
  COALESCE(ct.product_category_name_english, 'MISSING_TRANSLATION') AS translated_category_english,
  CASE
    WHEN p.product_category_name IS NULL OR TRIM(p.product_category_name) = '' THEN 'MISSING_SOURCE_CATEGORY'
    WHEN ct.product_category_name_english IS NULL THEN 'UNTRANSLATED_PORTUGUESE_KEY'
    ELSE 'TRANSLATED_OK'
  END AS translation_audit_status,
  COUNT(oi.order_item_id) AS line_items_affected,
  ROUND(COALESCE(SUM(oi.price), 0), 2) AS affected_gmv
FROM products p
LEFT JOIN category_translations ct ON p.product_category_name = ct.product_category_name
LEFT JOIN order_items oi ON p.product_id = oi.product_id
GROUP BY p.product_id, raw_category_portuguese, translated_category_english, translation_audit_status
ORDER BY affected_gmv DESC;`,
    explanation:
      'Performs LEFT JOINs from products to category_translations and order_items to audit translation lookup completeness and revenue exposure.',
    expectedInterpretation:
      'Confirms whether all active SKUs map cleanly to English categories or require dictionary remediation.',
    sqlConcepts: ['LEFT JOIN', 'CASE WHEN', 'GROUP BY'],
    isSystemPreset: true
  },

  // ===========================================================================
  // 4. SELLER ANALYSIS (4 Queries)
  // ===========================================================================
  {
    id: 'sel-01-merchant-leaderboard',
    code: 'SEL-01',
    title: 'Seller Revenue Leaderboard, Order Fulfillment & Review Score',
    category: 'Seller Analysis',
    businessQuestion:
      'Which marketplace sellers generate the highest merchandise GMV, and how do they perform on customer satisfaction?',
    sql: `SELECT
  seller_id,
  seller_city,
  seller_state,
  orders_fulfilled,
  items_sold,
  distinct_products_sold,
  total_merchandise_gmv,
  total_freight_revenue,
  ROUND(total_merchandise_gmv + total_freight_revenue, 2) AS total_seller_volume,
  avg_review_score
FROM dim_sellers
ORDER BY total_merchandise_gmv DESC;`,
    explanation:
      'Queries dim_sellers, which pre-aggregates order reviews at the order_id level before rolling up order_items by seller_id.',
    expectedInterpretation:
      'Ranks fulfillment partners by merchandise GMV while surfacing their mean customer review score.',
    sqlConcepts: ['GROUP BY'],
    isSystemPreset: true
  },
  {
    id: 'sel-02-seller-sla-compliance',
    code: 'SEL-02',
    title: 'Seller Carrier Handoff & Customer Delivery SLA Compliance',
    category: 'Seller Analysis',
    businessQuestion:
      'Which sellers experience delayed shipments or miss carrier handoff shipping_limit_date deadlines?',
    sql: `SELECT
  s.seller_id,
  s.seller_state,
  COUNT(DISTINCT oi.order_id) AS total_orders_handled,
  SUM(CASE WHEN o.order_delivered_carrier_date > oi.shipping_limit_date THEN 1 ELSE 0 END) AS late_carrier_handoffs,
  SUM(CASE WHEN o.order_status = 'delivered' AND o.order_delivered_customer_date > o.order_estimated_delivery_date THEN 1 ELSE 0 END) AS late_customer_deliveries,
  ROUND(
    SUM(CASE WHEN o.order_status = 'delivered' AND o.order_delivered_customer_date <= o.order_estimated_delivery_date THEN 1 ELSE 0 END) * 100.0 /
    NULLIF(SUM(CASE WHEN o.order_status = 'delivered' THEN 1 ELSE 0 END), 0),
    2
  ) AS on_time_delivery_pct
FROM sellers s
INNER JOIN order_items oi ON s.seller_id = oi.seller_id
INNER JOIN orders o ON oi.order_id = o.order_id
GROUP BY s.seller_id, s.seller_state
ORDER BY total_orders_handled DESC;`,
    explanation:
      'Joins sellers, order_items, and orders and uses conditional aggregation to distinguish seller carrier handoff delays (order_delivered_carrier_date > shipping_limit_date) from final carrier delivery delays.',
    expectedInterpretation:
      'Pinpoints whether delivery SLA misses originate at the merchant dispatch warehouse or during last-mile carrier transit.',
    sqlConcepts: ['INNER JOIN', 'GROUP BY', 'CASE WHEN', 'Conditional Aggregation'],
    isSystemPreset: true
  },
  {
    id: 'sel-03-cross-state-corridors',
    code: 'SEL-03',
    title: 'Interstate vs. Intrastate Seller-to-Customer Trade Corridors',
    category: 'Seller Analysis',
    businessQuestion:
      'What proportion of line items are fulfilled intrastate (same state) versus interstate (cross-state), and how does that affect freight cost?',
    sql: `SELECT
  s.seller_state AS origin_seller_state,
  c.customer_state AS destination_customer_state,
  CASE
    WHEN s.seller_state = c.customer_state THEN 'Intrastate (Local State)'
    ELSE 'Interstate (Cross-State Corridor)'
  END AS corridor_type,
  COUNT(DISTINCT oi.order_id) AS orders_count,
  COUNT(oi.order_item_id) AS items_shipped,
  ROUND(SUM(oi.price), 2) AS corridor_gmv,
  ROUND(AVG(oi.freight_value), 2) AS avg_item_freight
FROM order_items oi
INNER JOIN sellers s ON oi.seller_id = s.seller_id
INNER JOIN orders o ON oi.order_id = o.order_id
INNER JOIN customers c ON o.customer_id = c.customer_id
GROUP BY origin_seller_state, destination_customer_state, corridor_type
ORDER BY corridor_gmv DESC;`,
    explanation:
      'Joins order_items with sellers, orders, and customers to map origin-to-destination state pairs and classify trade routes as Intrastate vs. Interstate.',
    expectedInterpretation:
      'Quantifies freight cost differences between local state fulfillment and long-haul interstate shipping.',
    sqlConcepts: ['INNER JOIN', 'CASE WHEN', 'GROUP BY'],
    isSystemPreset: true
  },
  {
    id: 'sel-04-high-gmv-sellers-having',
    code: 'SEL-04',
    title: 'Active Multi-Order Sellers Exceeding Revenue Threshold (HAVING)',
    category: 'Seller Analysis',
    businessQuestion:
      'Which sellers have fulfilled at least 2 distinct orders and generated over $1,000 in merchandise GMV?',
    sql: `SELECT
  s.seller_id,
  s.seller_city,
  s.seller_state,
  COUNT(DISTINCT oi.order_id) AS distinct_orders_fulfilled,
  COUNT(oi.order_item_id) AS total_items_shipped,
  ROUND(SUM(oi.price), 2) AS merchandise_gmv,
  ROUND(AVG(oi.price), 2) AS avg_unit_price
FROM sellers s
INNER JOIN order_items oi ON s.seller_id = oi.seller_id
GROUP BY s.seller_id, s.seller_city, s.seller_state
HAVING COUNT(DISTINCT oi.order_id) >= 2 AND SUM(oi.price) >= 1000
ORDER BY merchandise_gmv DESC;`,
    explanation:
      'Applies compound post-aggregation filtering in the HAVING clause (COUNT(DISTINCT order_id) >= 2 AND SUM(price) >= 1000).',
    expectedInterpretation:
      'Filters out low-volume merchants to focus account management on core commercial sellers.',
    sqlConcepts: ['INNER JOIN', 'GROUP BY', 'HAVING'],
    isSystemPreset: true
  },

  // ===========================================================================
  // 5. PAYMENT ANALYSIS (4 Queries)
  // ===========================================================================
  {
    id: 'pay-01-payment-method-mix',
    code: 'PAY-01',
    title: 'Payment Instrument Mix (Credit Card, Boleto, Voucher, Debit Card)',
    category: 'Payment Analysis',
    businessQuestion:
      'What share of total settlement value and transaction volume flows through each Brazilian payment instrument?',
    sql: `SELECT
  payment_type,
  COUNT(*) AS payment_transactions,
  COUNT(DISTINCT order_id) AS distinct_orders_paid,
  ROUND(AVG(payment_installments), 2) AS avg_installments,
  MAX(payment_installments) AS max_installments_used,
  ROUND(SUM(payment_value), 2) AS total_settled_value,
  ROUND(AVG(payment_value), 2) AS avg_transaction_value,
  ROUND(SUM(payment_value) * 100.0 / SUM(SUM(payment_value)) OVER (), 2) AS revenue_share_pct
FROM fact_payments
GROUP BY payment_type
ORDER BY total_settled_value DESC;`,
    explanation:
      'Aggregates fact_payments by payment_type and computes each payment method percentage share of total settled volume using SUM(SUM(payment_value)) OVER ().',
    expectedInterpretation:
      'Quantifies customer reliance on credit_card installments and boleto bancário versus vouchers and debit cards.',
    sqlConcepts: ['GROUP BY', 'Window Functions'],
    isSystemPreset: true
  },
  {
    id: 'pay-02-installment-leverage',
    code: 'PAY-02',
    title: 'Credit Installment Leverage vs. Average Ticket Size',
    category: 'Payment Analysis',
    businessQuestion:
      'Does offering higher payment installment counts unlock larger order ticket sizes?',
    sql: `SELECT
  payment_installments,
  COUNT(DISTINCT order_id) AS orders_count,
  COUNT(*) AS payment_rows,
  ROUND(SUM(payment_value), 2) AS total_payment_volume,
  ROUND(AVG(payment_value), 2) AS mean_payment_ticket,
  ROUND(AVG(payment_value / NULLIF(payment_installments, 0)), 2) AS avg_monthly_installment_charge
FROM fact_payments
GROUP BY payment_installments
ORDER BY payment_installments ASC;`,
    explanation:
      'Groups payment settlements by payment_installments and calculates both mean total ticket size and mean per-installment charge.',
    expectedInterpretation:
      'Shows how multi-installment financing (2x–12x+) correlates with higher-ticket hardware and electronics purchases.',
    sqlConcepts: ['GROUP BY'],
    isSystemPreset: true
  },
  {
    id: 'pay-03-split-payment-orders',
    code: 'PAY-03',
    title: 'Multi-Method Split Payment Orders (payment_sequential > 1)',
    category: 'Payment Analysis',
    businessQuestion:
      'Which orders used multiple sequential payment methods (such as combining a credit card with a voucher), and how did their settlements reconcile?',
    sql: `WITH multi_payment_orders AS (
  SELECT
    order_id,
    COUNT(*) AS payment_sequences_count,
    STRING_AGG(payment_type, ' + ' ORDER BY payment_sequential ASC) AS payment_Instrument_combo,
    ROUND(SUM(payment_value), 2) AS total_settled_value
  FROM payments
  GROUP BY order_id
  HAVING COUNT(*) > 1
)
SELECT
  mpo.order_id,
  fo.customer_unique_id,
  fo.order_status,
  mpo.payment_sequences_count,
  mpo.payment_Instrument_combo,
  fo.gmv_merchandise,
  fo.freight_revenue,
  mpo.total_settled_value
FROM multi_payment_orders mpo
INNER JOIN fact_orders fo ON mpo.order_id = fo.order_id
ORDER BY mpo.total_settled_value DESC;`,
    explanation:
      'Uses a CTE with HAVING COUNT(*) > 1 and STRING_AGG to identify orders paid via multiple sequential payment rows and reconciles them against fact_orders.',
    expectedInterpretation:
      'Demonstrates why payments has a composite primary key (order_id, payment_sequential) and must be pre-aggregated before joining to orders.',
    sqlConcepts: ['Common Table Expressions', 'HAVING', 'INNER JOIN', 'GROUP BY'],
    isSystemPreset: true
  },
  {
    id: 'pay-04-item-vs-payment-reconciliation',
    code: 'PAY-04',
    title: 'Order-Level Item GMV + Freight vs. Settled Payment Variance Audit',
    category: 'Payment Analysis',
    businessQuestion:
      'Do any orders exhibit a discrepancy between the sum of (price + freight_value) in order_items and sum of payment_value in payments?',
    sql: `SELECT
  order_id,
  customer_unique_id,
  order_status,
  item_count,
  gmv_merchandise,
  freight_revenue,
  ROUND(gmv_merchandise + freight_revenue, 2) AS expected_item_plus_freight,
  settled_payment_value,
  ROUND(settled_payment_value - (gmv_merchandise + freight_revenue), 2) AS settlement_variance
FROM fact_orders
ORDER BY ABS(settled_payment_value - (gmv_merchandise + freight_revenue)) DESC, order_id ASC;`,
    explanation:
      'Compares order-grain item totals (gmv_merchandise + freight_revenue) against settled_payment_value in fact_orders to detect rounding or voucher adjustments.',
    expectedInterpretation:
      'Verifies financial reconciliation integrity between line-item billing and payment processor settlement.',
    sqlConcepts: ['CASE WHEN'],
    isSystemPreset: true
  },

  // ===========================================================================
  // 6. DELIVERY ANALYSIS (4 Queries)
  // ===========================================================================
  {
    id: 'del-01-state-sla-delays',
    code: 'DEL-01',
    title: 'Regional Delivery SLA Compliance, Transit Days & Delay Rate by State',
    category: 'Delivery Analysis',
    businessQuestion:
      'What are the average transit days, on-time delivery percentage, and delayed order counts across destination states?',
    sql: `SELECT
  customer_state AS destination_state,
  COUNT(DISTINCT order_id) AS delivered_orders,
  SUM(CASE WHEN is_on_time = 1 THEN 1 ELSE 0 END) AS on_time_orders,
  SUM(CASE WHEN is_on_time = 0 THEN 1 ELSE 0 END) AS delayed_orders,
  ROUND(SUM(CASE WHEN is_on_time = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(DISTINCT order_id), 0), 2) AS on_time_sla_pct,
  ROUND(
    AVG(
      DATE_DIFF(
        'day',
        TRY_CAST(SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE),
        TRY_CAST(SUBSTR(CAST(order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE)
      )
    ),
    2
  ) AS avg_actual_transit_days,
  ROUND(AVG(freight_revenue), 2) AS avg_order_freight
FROM fact_orders
WHERE order_status = 'delivered'
GROUP BY customer_state
ORDER BY delivered_orders DESC, destination_state ASC;`,
    explanation:
      'Evaluates delivered orders in fact_orders using DATE_DIFF for transit days and conditional aggregation for on-time vs. delayed shipment counts.',
    expectedInterpretation:
      'Identifies regional logistics bottlenecks where actual delivery timestamps exceed estimated delivery dates.',
    sqlConcepts: ['Date Functions', 'GROUP BY', 'CASE WHEN', 'Conditional Aggregation'],
    isSystemPreset: true,
    isAcceptanceBenchmark: true
  },
  {
    id: 'del-02-stage-breakdown',
    code: 'DEL-02',
    title: 'End-to-End Fulfillment Stage Latency (Approval, Carrier Handoff, Last-Mile)',
    category: 'Delivery Analysis',
    businessQuestion:
      'How many days are spent in payment approval, warehouse-to-carrier handoff, and carrier last-mile transit, and how far ahead or behind the SLA estimate does each order arrive?',
    sql: `SELECT
  order_id,
  customer_state,
  SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 10) AS purchase_date,
  SUBSTR(CAST(order_delivered_customer_date AS VARCHAR), 1, 10) AS delivered_date,
  SUBSTR(CAST(order_estimated_delivery_date AS VARCHAR), 1, 10) AS estimated_date,
  DATE_DIFF(
    'day',
    TRY_CAST(SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE),
    TRY_CAST(SUBSTR(CAST(order_delivered_carrier_date AS VARCHAR), 1, 10) AS DATE)
  ) AS warehouse_dispatch_days,
  DATE_DIFF(
    'day',
    TRY_CAST(SUBSTR(CAST(order_delivered_carrier_date AS VARCHAR), 1, 10) AS DATE),
    TRY_CAST(SUBSTR(CAST(order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE)
  ) AS carrier_last_mile_days,
  DATE_DIFF(
    'day',
    TRY_CAST(SUBSTR(CAST(order_estimated_delivery_date AS VARCHAR), 1, 10) AS DATE),
    TRY_CAST(SUBSTR(CAST(order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE)
  ) AS days_vs_sla_estimate
FROM fact_orders
WHERE order_status = 'delivered'
ORDER BY days_vs_sla_estimate DESC;`,
    explanation:
      'Applies DuckDB DATE_DIFF across the 4 order lifecycle timestamps to decompose fulfillment time into warehouse dispatch vs. carrier transit.',
    expectedInterpretation:
      'Positive days_vs_sla_estimate values indicate late deliveries; negative values indicate early arrival ahead of the customer SLA.',
    sqlConcepts: ['Date Functions'],
    isSystemPreset: true
  },
  {
    id: 'del-03-delay-impact-on-reviews',
    code: 'DEL-03',
    title: 'Impact of SLA Delivery Delays on Customer Review Ratings',
    category: 'Delivery Analysis',
    businessQuestion:
      'How severely does missing the estimated delivery date degrade customer review scores?',
    sql: `SELECT
  CASE
    WHEN fo.is_on_time = 1 THEN 'On-Time Delivery (Arrived <= Estimated SLA)'
    ELSE 'Delayed Delivery (Arrived > Estimated SLA)'
  END AS sla_compliance_status,
  COUNT(DISTINCT fo.order_id) AS delivered_orders_count,
  ROUND(AVG(fr.review_score), 2) AS avg_review_score,
  SUM(CASE WHEN fr.review_score >= 4 THEN 1 ELSE 0 END) AS positive_reviews_count,
  SUM(CASE WHEN fr.review_score <= 2 THEN 1 ELSE 0 END) AS detractor_reviews_count,
  ROUND(AVG(fo.freight_revenue), 2) AS avg_freight_paid
FROM fact_orders fo
LEFT JOIN fact_reviews fr ON fo.order_id = fr.order_id
WHERE fo.order_status = 'delivered'
GROUP BY sla_compliance_status
ORDER BY avg_review_score DESC;`,
    explanation:
      'Joins fact_orders to fact_reviews via LEFT JOIN and compares average review scores and detractor counts between on-time and delayed deliveries.',
    expectedInterpretation:
      'Quantifies the direct customer satisfaction penalty caused by carrier SLA misses.',
    sqlConcepts: ['LEFT JOIN', 'CASE WHEN', 'GROUP BY', 'Conditional Aggregation'],
    isSystemPreset: true
  },
  {
    id: 'del-04-spatial-geolocation-corridors',
    code: 'DEL-04',
    title: 'Spatial Zip-Prefix Coordinates & Regional Order Density (dim_geography)',
    category: 'Delivery Analysis',
    businessQuestion:
      'How do customer and seller zip code prefixes map to geographic coordinates and regional order volume?',
    sql: `SELECT
  zip_code_prefix,
  city_name,
  state_code,
  avg_lat,
  avg_lng,
  unique_customers_count,
  sellers_count,
  total_orders_count,
  regional_order_value
FROM dim_geography
ORDER BY regional_order_value DESC, total_orders_count DESC;`,
    explanation:
      'Queries dim_geography, which deduplicates geolocation coordinate samples by zip_code_prefix before joining customer and seller counts.',
    expectedInterpretation:
      'Provides clean latitude/longitude centroids and commercial density per postal prefix without coordinate sample fan-out.',
    sqlConcepts: ['GROUP BY'],
    isSystemPreset: true
  },

  // ===========================================================================
  // 7. REVIEW ANALYSIS (4 Queries)
  // ===========================================================================
  {
    id: 'rev-01-score-distribution-nps',
    code: 'REV-01',
    title: 'Review Score Distribution (1 to 5 Stars) & Sentiment Stratification',
    category: 'Review Analysis',
    businessQuestion:
      'What is the distribution of 1-star to 5-star customer reviews, and what share of customers leave written feedback?',
    sql: `SELECT
  review_score,
  sentiment_tier,
  COUNT(*) AS review_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS share_of_reviews_pct,
  SUM(has_written_comment) AS reviews_with_comment,
  ROUND(SUM(has_written_comment) * 100.0 / NULLIF(COUNT(*), 0), 2) AS comment_rate_pct
FROM fact_reviews
GROUP BY review_score, sentiment_tier
ORDER BY review_score DESC;`,
    explanation:
      'Groups fact_reviews by review_score and sentiment_tier and uses a window sum denominator to calculate percentage distribution across star ratings.',
    expectedInterpretation:
      'Reveals overall customer satisfaction balance between Promoters (4-5 stars), Passives (3 stars), and Detractors (1-2 stars).',
    sqlConcepts: ['GROUP BY', 'Window Functions', 'Conditional Aggregation'],
    isSystemPreset: true
  },
  {
    id: 'rev-02-category-sentiment',
    code: 'REV-02',
    title: 'Product Category Satisfaction & Low-Rating Incidence',
    category: 'Review Analysis',
    businessQuestion:
      'Which product categories receive the highest and lowest average review scores?',
    sql: `SELECT
  foi.product_category_english AS category,
  COUNT(DISTINCT fr.review_id) AS total_reviews,
  ROUND(AVG(fr.review_score), 2) AS mean_review_score,
  SUM(CASE WHEN fr.review_score = 5 THEN 1 ELSE 0 END) AS five_star_count,
  SUM(CASE WHEN fr.review_score <= 3 THEN 1 ELSE 0 END) AS three_or_below_count,
  ROUND(SUM(foi.gmv_merchandise), 2) AS category_gmv
FROM fact_order_items foi
INNER JOIN fact_reviews fr ON foi.order_id = fr.order_id
GROUP BY foi.product_category_english
ORDER BY mean_review_score DESC, category_gmv DESC;`,
    explanation:
      'Joins fact_order_items with fact_reviews on order_id and uses conditional aggregation to count 5-star vs. <=3-star evaluations per translated category.',
    expectedInterpretation:
      'Highlights categories with strong product-market fit versus categories prone to customer complaints.',
    sqlConcepts: ['INNER JOIN', 'GROUP BY', 'CASE WHEN', 'Conditional Aggregation'],
    isSystemPreset: true
  },
  {
    id: 'rev-03-response-turnaround',
    code: 'REV-03',
    title: 'Review Survey Response Turnaround Latency (Creation to Answer)',
    category: 'Review Analysis',
    businessQuestion:
      'How quickly do customers respond to post-delivery review surveys, and does response speed vary by rating score?',
    sql: `SELECT
  review_id,
  order_id,
  review_score,
  sentiment_tier,
  review_comment_title,
  review_creation_date,
  review_answer_timestamp,
  ROUND(
    DATE_DIFF(
      'hour',
      TRY_CAST(review_creation_date AS TIMESTAMP),
      TRY_CAST(review_answer_timestamp AS TIMESTAMP)
    ),
    1
  ) AS response_turnaround_hours
FROM fact_reviews
WHERE review_creation_date IS NOT NULL AND review_answer_timestamp IS NOT NULL
ORDER BY response_turnaround_hours DESC;`,
    explanation:
      'Calculates the exact hour difference between survey dispatch (review_creation_date) and customer submission (review_answer_timestamp) using DATE_DIFF.',
    expectedInterpretation:
      'Measures survey engagement speed and shows whether dissatisfied or delighted buyers respond faster.',
    sqlConcepts: ['Date Functions'],
    isSystemPreset: true
  },
  {
    id: 'rev-04-verbatim-comment-audit',
    code: 'REV-04',
    title: 'Verbatim Customer Review Comment & Delivery Context Inspector',
    category: 'Review Analysis',
    businessQuestion:
      'What specific verbatim comments and titles did customers submit alongside their order value and SLA delivery status?',
    sql: `SELECT
  fr.review_id,
  fr.order_id,
  fo.customer_state,
  fr.review_score,
  CASE WHEN fo.is_on_time = 1 THEN 'On-Time' ELSE 'Delayed/In-Flight' END AS delivery_sla_state,
  fo.total_order_value,
  COALESCE(fr.review_comment_title, '(No Title)') AS comment_title,
  COALESCE(fr.review_comment_message, '(No Message)') AS comment_message
FROM fact_reviews fr
INNER JOIN fact_orders fo ON fr.order_id = fo.order_id
WHERE fr.has_written_comment = 1
ORDER BY fr.review_score ASC, fo.total_order_value DESC;`,
    explanation:
      'Joins fact_reviews and fact_orders to pair qualitative customer review text with quantitative order value and SLA delivery performance.',
    expectedInterpretation:
      'Surfaces actionable qualitative feedback prioritized by lower review scores and higher order value.',
    sqlConcepts: ['INNER JOIN', 'CASE WHEN'],
    isSystemPreset: true
  },

  // ===========================================================================
  // 8. ADVANCED WINDOW FUNCTIONS (6 Queries)
  // ===========================================================================
  {
    id: 'win-01-running-total-moving-avg',
    code: 'WIN-01',
    title: 'Cumulative Running Total GMV & 3-Period Moving Average by Date',
    category: 'Advanced Window Functions',
    businessQuestion:
      'What is our cumulative running total order value and 3-period moving average across the order timeline?',
    sql: `SELECT
  date_key,
  year_month,
  orders_placed,
  daily_gmv,
  daily_order_value,
  ROUND(
    SUM(daily_order_value) OVER (
      ORDER BY date_key ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ),
    2
  ) AS cumulative_running_order_value,
  ROUND(
    AVG(daily_order_value) OVER (
      ORDER BY date_key ASC
      ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    ),
    2
  ) AS moving_avg_3_period_value
FROM dim_date
WHERE orders_placed > 0
ORDER BY date_key ASC;`,
    explanation:
      'Demonstrates window frame specifications: ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW for a cumulative running total, and ROWS BETWEEN 2 PRECEDING AND CURRENT ROW for a 3-period moving average.',
    expectedInterpretation:
      'Smooths out single-day order volatility while tracking cumulative revenue build across the fiscal timeline.',
    sqlConcepts: ['Window Functions', 'Running Totals', 'Moving Averages', 'Date Functions'],
    isSystemPreset: true
  },
  {
    id: 'win-02-ranking-functions-comparison',
    code: 'WIN-02',
    title: 'Product Category SKU Ranking (ROW_NUMBER, RANK, DENSE_RANK)',
    category: 'Advanced Window Functions',
    businessQuestion:
      'How do products rank by merchandise GMV within each English product category using ROW_NUMBER, RANK, and DENSE_RANK?',
    sql: `SELECT
  category_english,
  product_id,
  units_sold,
  total_merchandise_gmv,
  ROW_NUMBER() OVER (PARTITION BY category_english ORDER BY total_merchandise_gmv DESC, product_id ASC) AS row_num_in_category,
  RANK() OVER (PARTITION BY category_english ORDER BY total_merchandise_gmv DESC) AS rank_in_category,
  DENSE_RANK() OVER (PARTITION BY category_english ORDER BY total_merchandise_gmv DESC) AS dense_rank_in_category,
  ROUND(
    total_merchandise_gmv * 100.0 / NULLIF(SUM(total_merchandise_gmv) OVER (PARTITION BY category_english), 0),
    2
  ) AS share_of_category_gmv_pct
FROM dim_products
ORDER BY category_english ASC, row_num_in_category ASC;`,
    explanation:
      'Partitions dim_products by category_english and applies ROW_NUMBER(), RANK(), DENSE_RANK(), and partitioned window sum share side-by-side.',
    expectedInterpretation:
      'Identifies the #1 top-selling hero SKU inside every category and illustrates tie-breaking differences between RANK and DENSE_RANK.',
    sqlConcepts: ['Window Functions', 'ROW_NUMBER', 'RANK', 'DENSE_RANK'],
    isSystemPreset: true
  },
  {
    id: 'win-03-mom-lag-lead-growth',
    code: 'WIN-03',
    title: 'Month-over-Month Revenue Growth Rate & Next-Month Outlook (LAG & LEAD)',
    category: 'Advanced Window Functions',
    businessQuestion:
      'What is the month-over-month (MoM) dollar and percentage change in order value using LAG, and what is the next period value using LEAD?',
    sql: `WITH monthly_series AS (
  SELECT
    SUBSTR(CAST(purchase_date_key AS VARCHAR), 1, 7) AS order_month,
    COUNT(DISTINCT order_id) AS orders_count,
    ROUND(SUM(total_order_value), 2) AS monthly_revenue
  FROM fact_orders
  GROUP BY order_month
)
SELECT
  order_month,
  orders_count,
  monthly_revenue,
  LAG(monthly_revenue, 1) OVER (ORDER BY order_month ASC) AS prev_month_revenue,
  LEAD(monthly_revenue, 1) OVER (ORDER BY order_month ASC) AS next_month_revenue,
  ROUND(monthly_revenue - LAG(monthly_revenue, 1) OVER (ORDER BY order_month ASC), 2) AS mom_revenue_delta,
  ROUND(
    (monthly_revenue - LAG(monthly_revenue, 1) OVER (ORDER BY order_month ASC)) * 100.0 /
    NULLIF(LAG(monthly_revenue, 1) OVER (ORDER BY order_month ASC), 0),
    2
  ) AS mom_growth_pct
FROM monthly_series
ORDER BY order_month ASC;`,
    explanation:
      'Aggregates monthly revenue in a CTE and applies LAG(monthly_revenue, 1) and LEAD(monthly_revenue, 1) ordered chronologically by order_month.',
    expectedInterpretation:
      'Measures sequential period-over-period growth acceleration and contraction without self-joins.',
    sqlConcepts: ['Common Table Expressions', 'GROUP BY', 'Window Functions', 'LAG', 'LEAD', 'Date Functions'],
    isSystemPreset: true
  },
  {
    id: 'win-04-customer-pareto-deciles',
    code: 'WIN-04',
    title: 'Cumulative Pareto Revenue Curve Across Customer Entities',
    category: 'Advanced Window Functions',
    businessQuestion:
      'What percentage of cumulative platform revenue is generated by our top-ranked customer_unique_id accounts?',
    sql: `WITH ranked_customers AS (
  SELECT
    customer_unique_id,
    customer_state,
    total_orders,
    lifetime_order_value,
    ROW_NUMBER() OVER (ORDER BY lifetime_order_value DESC, customer_unique_id ASC) AS customer_rank,
    COUNT(*) OVER () AS total_customers_count,
    SUM(lifetime_order_value) OVER (
      ORDER BY lifetime_order_value DESC, customer_unique_id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_revenue,
    SUM(lifetime_order_value) OVER () AS grand_total_revenue
  FROM dim_customers
  WHERE total_orders > 0
)
SELECT
  customer_rank,
  customer_unique_id,
  customer_state,
  total_orders,
  lifetime_order_value,
  ROUND(cumulative_revenue, 2) AS cumulative_revenue,
  ROUND((customer_rank * 100.0) / NULLIF(total_customers_count, 0), 2) AS cumulative_customer_pct,
  ROUND((cumulative_revenue * 100.0) / NULLIF(grand_total_revenue, 0), 2) AS cumulative_revenue_share_pct
FROM ranked_customers
ORDER BY customer_rank ASC;`,
    explanation:
      'Combines ROW_NUMBER(), cumulative running sum OVER (ORDER BY lifetime_order_value DESC), and grand total window functions to construct an exact Pareto concentration curve.',
    expectedInterpretation:
      'Shows the exact percentage of total revenue captured by the top 20% or 50% of unique buyers.',
    sqlConcepts: ['Common Table Expressions', 'Window Functions', 'ROW_NUMBER', 'Running Totals'],
    isSystemPreset: true
  },
  {
    id: 'win-05-seller-state-dominance',
    code: 'WIN-05',
    title: 'Regional Seller Dominance & Intra-State Market Share',
    category: 'Advanced Window Functions',
    businessQuestion:
      'How does each seller rank within their home Brazilian state, and what share of their state merchandise GMV do they capture?',
    sql: `SELECT
  seller_state,
  seller_id,
  seller_city,
  orders_fulfilled,
  total_merchandise_gmv,
  DENSE_RANK() OVER (PARTITION BY seller_state ORDER BY total_merchandise_gmv DESC) AS state_seller_rank,
  ROUND(SUM(total_merchandise_gmv) OVER (PARTITION BY seller_state), 2) AS state_total_seller_gmv,
  ROUND(
    total_merchandise_gmv * 100.0 / NULLIF(SUM(total_merchandise_gmv) OVER (PARTITION BY seller_state), 0),
    2
  ) AS state_gmv_share_pct
FROM dim_sellers
ORDER BY seller_state ASC, state_seller_rank ASC;`,
    explanation:
      'Uses DENSE_RANK() and SUM() OVER (PARTITION BY seller_state) to evaluate merchant leadership inside each Brazilian state.',
    expectedInterpretation:
      'Identifies regional fulfillment champions and single-seller dependency risks by state.',
    sqlConcepts: ['Window Functions', 'DENSE_RANK'],
    isSystemPreset: true
  },
  {
    id: 'win-06-order-deviation-from-customer-mean',
    code: 'WIN-06',
    title: 'Order Spend Deviation vs. Customer Historical Mean & Next Order Preview',
    category: 'Advanced Window Functions',
    businessQuestion:
      'How does each individual order compare to that customer_unique_id personal average order value and their next chronological order?',
    sql: `SELECT
  order_id,
  customer_unique_id,
  purchase_date_key,
  total_order_value,
  COUNT(order_id) OVER (PARTITION BY customer_unique_id) AS customer_lifetime_orders,
  ROUND(AVG(total_order_value) OVER (PARTITION BY customer_unique_id), 2) AS customer_personal_aov,
  ROUND(
    total_order_value - AVG(total_order_value) OVER (PARTITION BY customer_unique_id),
    2
  ) AS delta_vs_personal_aov,
  LEAD(total_order_value, 1) OVER (
    PARTITION BY customer_unique_id
    ORDER BY order_purchase_timestamp ASC
  ) AS next_order_value
FROM fact_orders
ORDER BY customer_lifetime_orders DESC, customer_unique_id ASC, purchase_date_key ASC;`,
    explanation:
      'Partitions fact_orders by customer_unique_id to compute each buyer personal mean AOV and uses LEAD() to inspect whether subsequent orders expand or contract in value.',
    expectedInterpretation:
      'Tracks account expansion (upsell on repeat purchases) at the individual buyer entity level.',
    sqlConcepts: ['Window Functions', 'LEAD'],
    isSystemPreset: true
  }
];
