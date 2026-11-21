import {
  BiDashboardId,
  BiDashboardPayload,
  DashboardDrilldownRequest,
  DashboardDrilldownResult,
  DashboardFilterOptions,
  DashboardFilterState,
  DashboardKpiItem,
  DashboardVisualSection
} from '../../src/types/analytics';
import { duckdbEngine } from './duckdbEngine';

function sanitizeSqlToken(val: string | undefined | null): string {
  if (!val) return '';
  return String(val).replace(/'/g, "''").trim();
}

export function normalizeFilterState(
  raw: Partial<DashboardFilterState> | undefined,
  options: DashboardFilterOptions
): DashboardFilterState {
  const startDate =
    raw?.startDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate.trim())
      ? raw.startDate.trim()
      : options.minDate || '';
  const endDate =
    raw?.endDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.endDate.trim())
      ? raw.endDate.trim()
      : options.maxDate || '';
  const category =
    raw?.category && raw.category.trim() !== '' && raw.category !== 'ALL'
      ? raw.category.trim()
      : 'ALL';
  const state =
    raw?.state && raw.state.trim() !== '' && raw.state !== 'ALL'
      ? raw.state.trim()
      : 'ALL';
  const orderStatus =
    raw?.orderStatus && raw.orderStatus.trim() !== '' && raw.orderStatus !== 'ALL'
      ? raw.orderStatus.trim()
      : 'ALL';

  return {
    startDate,
    endDate,
    category,
    state,
    orderStatus
  };
}

function buildOrderWhereClause(filters: DashboardFilterState, alias = 'fo'): string {
  const clauses: string[] = ['1=1'];
  if (filters.startDate) {
    clauses.push(
      `SUBSTR(CAST(${alias}.order_purchase_timestamp AS VARCHAR), 1, 10) >= '${sanitizeSqlToken(
        filters.startDate
      )}'`
    );
  }
  if (filters.endDate) {
    clauses.push(
      `SUBSTR(CAST(${alias}.order_purchase_timestamp AS VARCHAR), 1, 10) <= '${sanitizeSqlToken(
        filters.endDate
      )}'`
    );
  }
  if (filters.state && filters.state !== 'ALL') {
    clauses.push(`${alias}.customer_state = '${sanitizeSqlToken(filters.state)}'`);
  }
  if (filters.orderStatus && filters.orderStatus !== 'ALL') {
    clauses.push(`${alias}.order_status = '${sanitizeSqlToken(filters.orderStatus)}'`);
  }
  if (filters.category && filters.category !== 'ALL') {
    clauses.push(
      `${alias}.order_id IN (SELECT DISTINCT order_id FROM fact_order_items WHERE product_category_english = '${sanitizeSqlToken(
        filters.category
      )}')`
    );
  }
  return clauses.join(' AND ');
}

function buildItemWhereClause(
  filters: DashboardFilterState,
  itemAlias = 'foi',
  orderAlias = 'fo'
): string {
  const clauses: string[] = [buildOrderWhereClause(filters, orderAlias)];
  if (filters.category && filters.category !== 'ALL') {
    clauses.push(`${itemAlias}.product_category_english = '${sanitizeSqlToken(filters.category)}'`);
  }
  return clauses.join(' AND ');
}

async function queryRows(
  sql: string,
  limit = 500
): Promise<Record<string, string | number | boolean | null>[]> {
  const res = await duckdbEngine.executeReadOnlyQuery(sql, limit, false);
  return res.rows;
}

async function queryScalar(sql: string): Promise<number | null> {
  const rows = await queryRows(sql, 1);
  if (!rows.length) return null;
  const key = Object.keys(rows[0])[0];
  const val = rows[0][key];
  return typeof val === 'number' ? val : val !== null ? Number(val) : null;
}

export async function getDashboardFilterOptions(): Promise<DashboardFilterOptions> {
  await duckdbEngine.ensureInitialized();
  const [dateBoundsRows, catRows, stateRows, statusRows] = await Promise.all([
    queryRows(
      `SELECT
        COALESCE(MIN(SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 10)), '') AS min_date,
        COALESCE(MAX(SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 10)), '') AS max_date
      FROM orders;`
    ),
    queryRows(
      `SELECT DISTINCT category_english
       FROM dim_products
       WHERE category_english IS NOT NULL AND TRIM(category_english) <> ''
       ORDER BY category_english ASC;`
    ),
    queryRows(
      `SELECT DISTINCT customer_state
       FROM customers
       WHERE customer_state IS NOT NULL AND TRIM(customer_state) <> ''
       ORDER BY customer_state ASC;`
    ),
    queryRows(
      `SELECT DISTINCT order_status
       FROM orders
       WHERE order_status IS NOT NULL AND TRIM(order_status) <> ''
       ORDER BY order_status ASC;`
    )
  ]);

  return {
    minDate: String(dateBoundsRows[0]?.min_date ?? ''),
    maxDate: String(dateBoundsRows[0]?.max_date ?? ''),
    categories: catRows.map((r) => String(r.category_english)),
    states: stateRows.map((r) => String(r.customer_state)),
    orderStatuses: statusRows.map((r) => String(r.order_status))
  };
}

export async function computeBiDashboard(
  dashboardId: BiDashboardId,
  rawFilters?: Partial<DashboardFilterState>
): Promise<BiDashboardPayload> {
  await duckdbEngine.ensureInitialized();
  const statuses = await duckdbEngine.getDatasetStatuses();
  const totalOrdersCount = statuses.find((s) => s.tableName === 'orders')?.rowCount ?? 0;
  const isReady = totalOrdersCount > 0;

  const filterOptions = await getDashboardFilterOptions();
  const appliedFilters = normalizeFilterState(rawFilters, filterOptions);

  const metaMap: Record<
    BiDashboardId,
    { number: number; title: string; description: string }
  > = {
    'executive-overview': {
      number: 1,
      title: 'Dashboard 1: Executive Overview',
      description:
        'Enterprise commercial command center displaying grain-safe Total GMV, Total & Completed Orders, Unique Purchasing Customers, Average Order Value, Monthly Revenue Trends, Category Revenue, Regional State Performance, and Order Status Distribution.'
    },
    'sales-intelligence': {
      number: 2,
      title: 'Dashboard 2: Sales Intelligence',
      description:
        'Deep commercial revenue analytics covering Monthly Sales Trends, Period-over-Period / YoY Comparisons, Category & State Sales Contribution Percentages, Average Order Value trajectory, and Payment Method Distribution.'
    },
    'customer-intelligence': {
      number: 3,
      title: 'Dashboard 3: Customer Intelligence & Retention',
      description:
        'Permanent customer identity analytics (customer_unique_id) tracking Unique, First-Time, and Repeat Customers, Purchase Frequency Cohorts, Recency-Frequency-Monetary (RFM) Segmentation, Customer Value Distribution, and Geographic Penetration.'
    },
    'product-intelligence': {
      number: 4,
      title: 'Dashboard 4: Product Intelligence',
      description:
        'SKU and translated English category performance featuring Top-Selling Products, Top Revenue Categories, Low-Performing Categories, Product Price Distribution, Freight Contribution Ratios, and Monthly Category Revenue Trends.'
    },
    'delivery-performance': {
      number: 5,
      title: 'Dashboard 5: Delivery Performance & Seller SLA',
      description:
        'Logistics fulfillment telemetry measuring Average Delivery Duration, On-Time vs. Late Delivery Percentages, Estimated vs. Actual Delivery Lead Times, Regional State Delivery Performance, and Merchant Seller SLA Rankings.'
    },
    'customer-satisfaction': {
      number: 6,
      title: 'Dashboard 6: Customer Satisfaction & Review Intelligence',
      description:
        'Post-delivery customer experience analytics evaluating Average Review Score, 1-to-5 Star Distribution, Delivery SLA Delay Impact on Ratings, Review Scores by Product Category, and Review Scores by Order Lifecycle Status.'
    }
  };

  const info = metaMap[dashboardId] || metaMap['executive-overview'];

  if (!isReady) {
    return {
      dashboardId,
      dashboardNumber: info.number,
      title: info.title,
      description: info.description,
      isReady: false,
      dataMode: duckdbEngine.getDataMode(),
      isDemonstrationData: duckdbEngine.isDemonstrationData(),
      appliedFilters,
      filterOptions,
      kpis: [],
      sections: []
    };
  }

  const orderWhere = buildOrderWhereClause(appliedFilters, 'fo');
  const itemWhere = buildItemWhereClause(appliedFilters, 'foi', 'fo');

  switch (dashboardId) {
    // =========================================================================
    // DASHBOARD 1: EXECUTIVE OVERVIEW
    // =========================================================================
    case 'executive-overview': {
      const gmvSql = `SELECT ROUND(COALESCE(SUM(fo.total_order_value), 0), 2) AS val FROM fact_orders fo WHERE ${orderWhere};`;
      const ordersSql = `SELECT COUNT(DISTINCT fo.order_id) AS val FROM fact_orders fo WHERE ${orderWhere};`;
      const completedSql = `SELECT COUNT(DISTINCT CASE WHEN fo.order_status = 'delivered' THEN fo.order_id END) AS val FROM fact_orders fo WHERE ${orderWhere};`;
      const uniqueCustSql = `SELECT COUNT(DISTINCT fo.customer_unique_id) AS val FROM fact_orders fo WHERE ${orderWhere};`;
      const aovSql = `SELECT ROUND(COALESCE(AVG(NULLIF(fo.total_order_value, 0)), 0), 2) AS val FROM fact_orders fo WHERE ${orderWhere};`;

      const [totalGmv, totalOrders, completedOrders, uniqueCustomers, aov] =
        await Promise.all([
          queryScalar(gmvSql),
          queryScalar(ordersSql),
          queryScalar(completedSql),
          queryScalar(uniqueCustSql),
          queryScalar(aovSql)
        ]);

      const kpis: DashboardKpiItem[] = [
        {
          id: 'exec-total-gmv',
          label: 'Total Order GMV (Settled Value)',
          value: totalGmv,
          unit: 'currency',
          subtitle: 'Merchandise GMV + Freight settled value',
          definition:
            'Total gross order value across filtered orders, pre-aggregated at the order_id grain to prevent multi-item or multi-payment inflation.',
          sqlSource: gmvSql,
          grainNote: '1 row per order_id (fact_orders)'
        },
        {
          id: 'exec-total-orders',
          label: 'Total Orders',
          value: totalOrders,
          unit: 'number',
          subtitle: 'Distinct order_id transactions',
          definition:
            'Count of unique customer orders matching active date, category, state, and status filters.',
          sqlSource: ordersSql,
          grainNote: 'COUNT(DISTINCT order_id)'
        },
        {
          id: 'exec-completed-orders',
          label: 'Completed Orders',
          value: completedOrders,
          unit: 'number',
          subtitle: "Orders in 'delivered' status",
          definition:
            "Count of distinct orders that have completed final customer delivery (order_status = 'delivered').",
          sqlSource: completedSql,
          grainNote: "WHERE order_status = 'delivered'"
        },
        {
          id: 'exec-unique-customers',
          label: 'Unique Purchasing Customers',
          value: uniqueCustomers,
          unit: 'number',
          subtitle: 'Deduplicated via customer_unique_id',
          definition:
            'Count of distinct permanent customer identities (customer_unique_id), avoiding overcounting repeat orders that generate new customer_id keys.',
          sqlSource: uniqueCustSql,
          grainNote: 'COUNT(DISTINCT customer_unique_id)'
        },
        {
          id: 'exec-aov',
          label: 'Average Order Value (AOV)',
          value: aov,
          unit: 'currency',
          subtitle: 'Mean revenue per distinct order_id',
          definition:
            'Total Order Value divided by distinct non-zero orders in fact_orders.',
          sqlSource: aovSql,
          grainNote: 'AVG(total_order_value) per order_id'
        }
      ];

      const monthlyTrendSql = `SELECT
  SUBSTR(CAST(fo.purchase_date_key AS VARCHAR), 1, 7) AS order_month,
  COUNT(DISTINCT fo.order_id) AS total_orders,
  ROUND(SUM(fo.gmv_merchandise), 2) AS merchandise_gmv,
  ROUND(SUM(fo.freight_revenue), 2) AS freight_revenue,
  ROUND(SUM(fo.total_order_value), 2) AS total_gmv,
  ROUND(AVG(fo.total_order_value), 2) AS avg_order_value
FROM fact_orders fo
WHERE ${orderWhere}
GROUP BY order_month
ORDER BY order_month ASC;`;

      const categoryRevSql = `SELECT
  foi.product_category_english AS category,
  COUNT(DISTINCT foi.order_id) AS orders_count,
  COUNT(foi.order_item_id) AS units_sold,
  ROUND(SUM(foi.gmv_merchandise), 2) AS merchandise_gmv,
  ROUND(SUM(foi.total_line_value), 2) AS total_revenue,
  ROUND(SUM(foi.total_line_value) * 100.0 / NULLIF(SUM(SUM(foi.total_line_value)) OVER (), 0), 2) AS share_pct
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
WHERE ${itemWhere}
GROUP BY foi.product_category_english
ORDER BY total_revenue DESC;`;

      const regionalPerfSql = `SELECT
  fo.customer_state AS state,
  COUNT(DISTINCT fo.order_id) AS total_orders,
  COUNT(DISTINCT fo.customer_unique_id) AS unique_customers,
  ROUND(SUM(fo.total_order_value), 2) AS total_revenue,
  ROUND(AVG(fo.total_order_value), 2) AS avg_order_value,
  ROUND(SUM(CASE WHEN fo.is_on_time = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN fo.order_status = 'delivered' THEN 1 ELSE 0 END), 0), 1) AS on_time_sla_pct
FROM fact_orders fo
WHERE ${orderWhere}
GROUP BY fo.customer_state
ORDER BY total_revenue DESC;`;

      const statusDistSql = `SELECT
  fo.order_status AS status,
  COUNT(DISTINCT fo.order_id) AS order_count,
  ROUND(SUM(fo.total_order_value), 2) AS total_revenue,
  ROUND(COUNT(DISTINCT fo.order_id) * 100.0 / NULLIF(SUM(COUNT(DISTINCT fo.order_id)) OVER (), 0), 2) AS order_share_pct
FROM fact_orders fo
WHERE ${orderWhere}
GROUP BY fo.order_status
ORDER BY total_revenue DESC;`;

      const [monthlyRows, categoryRows, regionalRows, statusRows] = await Promise.all([
        queryRows(monthlyTrendSql),
        queryRows(categoryRevSql),
        queryRows(regionalPerfSql),
        queryRows(statusDistSql)
      ]);

      const sections: DashboardVisualSection[] = [
        {
          id: 'exec-monthly-trends',
          title: 'Monthly Revenue & Order Velocity Trends',
          subtitle: 'Chronological GMV, merchandise value, and order count progression (Click any month to drill down)',
          chartType: 'composed',
          xKey: 'order_month',
          yKey: 'total_gmv',
          yLabel: 'Total GMV ($)',
          secondaryKey: 'total_orders',
          secondaryLabel: 'Orders Count',
          yUnit: 'currency',
          secondaryUnit: 'number',
          drilldownDimension: 'month',
          executedSql: monthlyTrendSql,
          rows: monthlyRows
        },
        {
          id: 'exec-category-revenue',
          title: 'Revenue by Product Category (English Translated)',
          subtitle: 'Total landed revenue and unit velocity across translated product categories (Click to filter or drill down)',
          chartType: 'horizontal-bar',
          xKey: 'category',
          yKey: 'total_revenue',
          yLabel: 'Category Revenue ($)',
          secondaryKey: 'share_pct',
          secondaryLabel: 'Revenue Share (%)',
          yUnit: 'currency',
          secondaryUnit: 'percent',
          drilldownDimension: 'category',
          executedSql: categoryRevSql,
          rows: categoryRows
        },
        {
          id: 'exec-regional-performance',
          title: 'Regional Performance by Brazilian State',
          subtitle: 'Order volume, unique buyers, total revenue, and SLA compliance by state (Click any state to drill down)',
          chartType: 'bar',
          xKey: 'state',
          yKey: 'total_revenue',
          yLabel: 'State Revenue ($)',
          secondaryKey: 'total_orders',
          secondaryLabel: 'Orders',
          yUnit: 'currency',
          secondaryUnit: 'number',
          drilldownDimension: 'state',
          executedSql: regionalPerfSql,
          rows: regionalRows
        },
        {
          id: 'exec-order-status',
          title: 'Order Lifecycle Status Distribution',
          subtitle: 'Breakdown of orders and revenue across delivered, shipped, processing, and canceled states',
          chartType: 'bar',
          xKey: 'status',
          yKey: 'order_count',
          yLabel: 'Order Count',
          secondaryKey: 'total_revenue',
          secondaryLabel: 'Total Revenue ($)',
          yUnit: 'number',
          secondaryUnit: 'currency',
          drilldownDimension: 'status',
          executedSql: statusDistSql,
          rows: statusRows
        }
      ];

      return {
        dashboardId,
        dashboardNumber: info.number,
        title: info.title,
        description: info.description,
        isReady: true,
        dataMode: duckdbEngine.getDataMode(),
        isDemonstrationData: duckdbEngine.isDemonstrationData(),
        appliedFilters,
        filterOptions,
        kpis,
        sections
      };
    }

    // =========================================================================
    // DASHBOARD 2: SALES INTELLIGENCE
    // =========================================================================
    case 'sales-intelligence': {
      const netMerchSql = `SELECT ROUND(COALESCE(SUM(fo.gmv_merchandise), 0), 2) AS val FROM fact_orders fo WHERE ${orderWhere};`;
      const freightRevSql = `SELECT ROUND(COALESCE(SUM(fo.freight_revenue), 0), 2) AS val FROM fact_orders fo WHERE ${orderWhere};`;
      const totalValSql = `SELECT ROUND(COALESCE(SUM(fo.total_order_value), 0), 2) AS val FROM fact_orders fo WHERE ${orderWhere};`;
      const aovSql = `SELECT ROUND(COALESCE(AVG(NULLIF(fo.total_order_value, 0)), 0), 2) AS val FROM fact_orders fo WHERE ${orderWhere};`;
      const creditShareSql = `SELECT ROUND(COALESCE(SUM(CASE WHEN fp.payment_type = 'credit_card' THEN fp.payment_value ELSE 0 END) * 100.0 / NULLIF(SUM(fp.payment_value), 0), 0), 1) AS val FROM fact_payments fp INNER JOIN fact_orders fo ON fp.order_id = fo.order_id WHERE ${orderWhere};`;

      const [netMerch, freightRev, totalVal, aov, creditShare] = await Promise.all([
        queryScalar(netMerchSql),
        queryScalar(freightRevSql),
        queryScalar(totalValSql),
        queryScalar(aovSql),
        queryScalar(creditShareSql)
      ]);

      const kpis: DashboardKpiItem[] = [
        {
          id: 'sales-net-merch',
          label: 'Gross Merchandise Value (Net Price)',
          value: netMerch,
          unit: 'currency',
          subtitle: 'Excludes shipping freight charges',
          definition:
            'Sum of item selling prices (order_items.price) across filtered orders.',
          sqlSource: netMerchSql,
          grainNote: 'SUM(gmv_merchandise) in fact_orders'
        },
        {
          id: 'sales-freight-rev',
          label: 'Total Freight Billing',
          value: freightRev,
          unit: 'currency',
          subtitle: 'Logistics shipping fees billed',
          definition:
            'Sum of order_items.freight_value aggregated at the order grain.',
          sqlSource: freightRevSql,
          grainNote: 'SUM(freight_revenue) in fact_orders'
        },
        {
          id: 'sales-total-val',
          label: 'Total Settled Sales Volume',
          value: totalVal,
          unit: 'currency',
          subtitle: 'Reconciled order settlement value',
          definition:
            'Total customer payment settlement (or GMV + Freight) across filtered orders.',
          sqlSource: totalValSql,
          grainNote: 'SUM(total_order_value) in fact_orders'
        },
        {
          id: 'sales-aov',
          label: 'Average Order Value (AOV)',
          value: aov,
          unit: 'currency',
          subtitle: 'Mean ticket size per order_id',
          definition:
            'Mean total_order_value across distinct orders matching active filters.',
          sqlSource: aovSql,
          grainNote: 'AVG(total_order_value) per order_id'
        },
        {
          id: 'sales-cc-share',
          label: 'Credit Card Settlement Share',
          value: creditShare,
          unit: 'percent',
          subtitle: 'Share of volume settled via credit_card',
          definition:
            'Percentage of total payment volume processed via credit card installments.',
          sqlSource: creditShareSql,
          grainNote: 'fact_payments joined to filtered fact_orders'
        }
      ];

      const monthlyComparisonSql = `WITH monthly_base AS (
  SELECT
    SUBSTR(CAST(fo.purchase_date_key AS VARCHAR), 1, 7) AS order_month,
    SUBSTR(CAST(fo.purchase_date_key AS VARCHAR), 1, 4) AS order_year,
    COUNT(DISTINCT fo.order_id) AS total_orders,
    ROUND(SUM(fo.gmv_merchandise), 2) AS merchandise_gmv,
    ROUND(SUM(fo.total_order_value), 2) AS monthly_sales,
    ROUND(AVG(fo.total_order_value), 2) AS avg_order_value
  FROM fact_orders fo
  WHERE ${orderWhere}
  GROUP BY order_month, order_year
)
SELECT
  order_month,
  order_year,
  total_orders,
  merchandise_gmv,
  monthly_sales,
  avg_order_value,
  LAG(monthly_sales) OVER (ORDER BY order_month ASC) AS prior_period_sales,
  ROUND(
    (monthly_sales - LAG(monthly_sales) OVER (ORDER BY order_month ASC)) * 100.0 /
    NULLIF(LAG(monthly_sales) OVER (ORDER BY order_month ASC), 0),
    2
  ) AS period_growth_pct,
  ROUND(SUM(monthly_sales) OVER (PARTITION BY order_year ORDER BY order_month ASC), 2) AS ytd_cumulative_sales
FROM monthly_base
ORDER BY order_month ASC;`;

      const categoryContributionSql = `SELECT
  foi.product_category_english AS category,
  COUNT(DISTINCT foi.order_id) AS orders_count,
  COUNT(foi.order_item_id) AS units_sold,
  ROUND(SUM(foi.gmv_merchandise), 2) AS merchandise_revenue,
  ROUND(SUM(foi.freight_revenue), 2) AS freight_revenue,
  ROUND(SUM(foi.total_line_value), 2) AS total_sales,
  ROUND(SUM(foi.total_line_value) * 100.0 / NULLIF(SUM(SUM(foi.total_line_value)) OVER (), 0), 2) AS sales_contribution_pct
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
WHERE ${itemWhere}
GROUP BY foi.product_category_english
ORDER BY total_sales DESC;`;

      const stateContributionSql = `SELECT
  fo.customer_state AS state,
  COUNT(DISTINCT fo.order_id) AS orders_count,
  ROUND(SUM(fo.gmv_merchandise), 2) AS merchandise_gmv,
  ROUND(SUM(fo.total_order_value), 2) AS state_sales,
  ROUND(AVG(fo.total_order_value), 2) AS avg_order_value,
  ROUND(SUM(fo.total_order_value) * 100.0 / NULLIF(SUM(SUM(fo.total_order_value)) OVER (), 0), 2) AS sales_contribution_pct
FROM fact_orders fo
WHERE ${orderWhere}
GROUP BY fo.customer_state
ORDER BY state_sales DESC;`;

      const paymentDistSql = `SELECT
  fp.payment_type,
  COUNT(DISTINCT fp.order_id) AS distinct_orders,
  COUNT(*) AS payment_transactions,
  ROUND(AVG(fp.payment_installments), 1) AS avg_installments,
  ROUND(SUM(fp.payment_value), 2) AS payment_volume,
  ROUND(SUM(fp.payment_value) * 100.0 / NULLIF(SUM(SUM(fp.payment_value)) OVER (), 0), 2) AS sales_contribution_pct
FROM fact_payments fp
INNER JOIN fact_orders fo ON fp.order_id = fo.order_id
WHERE ${orderWhere}
GROUP BY fp.payment_type
ORDER BY payment_volume DESC;`;

      const [monthlyRows, catRows, stateRows, payRows] = await Promise.all([
        queryRows(monthlyComparisonSql),
        queryRows(categoryContributionSql),
        queryRows(stateContributionSql),
        queryRows(paymentDistSql)
      ]);

      const sections: DashboardVisualSection[] = [
        {
          id: 'sales-monthly-yoy',
          title: 'Monthly Sales Trends, Period-over-Period Comparison & AOV',
          subtitle: 'Monthly sales volume vs. prior period baseline (LAG) and cumulative YTD progression',
          chartType: 'composed',
          xKey: 'order_month',
          yKey: 'monthly_sales',
          yLabel: 'Monthly Sales ($)',
          secondaryKey: 'prior_period_sales',
          secondaryLabel: 'Prior Period Sales ($)',
          tertiaryKey: 'avg_order_value',
          tertiaryLabel: 'AOV ($)',
          yUnit: 'currency',
          secondaryUnit: 'currency',
          drilldownDimension: 'month',
          executedSql: monthlyComparisonSql,
          rows: monthlyRows
        },
        {
          id: 'sales-category-contribution',
          title: 'Revenue by Category & Sales Contribution (%)',
          subtitle: 'Category revenue and percentage contribution to total filtered platform sales',
          chartType: 'horizontal-bar',
          xKey: 'category',
          yKey: 'total_sales',
          yLabel: 'Total Sales ($)',
          secondaryKey: 'sales_contribution_pct',
          secondaryLabel: 'Contribution (%)',
          yUnit: 'currency',
          secondaryUnit: 'percent',
          drilldownDimension: 'category',
          executedSql: categoryContributionSql,
          rows: catRows
        },
        {
          id: 'sales-state-contribution',
          title: 'Revenue by State, AOV & Regional Contribution (%)',
          subtitle: 'Regional sales volume, average order value, and national share across Brazilian states',
          chartType: 'bar',
          xKey: 'state',
          yKey: 'state_sales',
          yLabel: 'State Sales ($)',
          secondaryKey: 'avg_order_value',
          secondaryLabel: 'State AOV ($)',
          yUnit: 'currency',
          secondaryUnit: 'currency',
          drilldownDimension: 'state',
          executedSql: stateContributionSql,
          rows: stateRows
        },
        {
          id: 'sales-payment-distribution',
          title: 'Payment Method Distribution & Installment Depth',
          subtitle: 'Settlement volume, contribution percentage, and mean installment count by payment instrument',
          chartType: 'bar',
          xKey: 'payment_type',
          yKey: 'payment_volume',
          yLabel: 'Payment Volume ($)',
          secondaryKey: 'sales_contribution_pct',
          secondaryLabel: 'Share (%)',
          yUnit: 'currency',
          secondaryUnit: 'percent',
          drilldownDimension: 'payment_type',
          executedSql: paymentDistSql,
          rows: payRows
        }
      ];

      return {
        dashboardId,
        dashboardNumber: info.number,
        title: info.title,
        description: info.description,
        isReady: true,
        dataMode: duckdbEngine.getDataMode(),
        isDemonstrationData: duckdbEngine.isDemonstrationData(),
        appliedFilters,
        filterOptions,
        kpis,
        sections
      };
    }

    // =========================================================================
    // DASHBOARD 3: CUSTOMER INTELLIGENCE
    // =========================================================================
    case 'customer-intelligence': {
      const customerCte = `WITH filtered_cust AS (
  SELECT
    fo.customer_unique_id,
    MIN(fo.customer_state) AS customer_state,
    COUNT(DISTINCT fo.order_id) AS order_count,
    ROUND(SUM(fo.total_order_value), 2) AS lifetime_spend,
    ROUND(AVG(fo.total_order_value), 2) AS avg_order_value,
    MAX(TRY_CAST(fo.purchase_date_key AS DATE)) AS last_order_date
  FROM fact_orders fo
  WHERE ${orderWhere}
  GROUP BY fo.customer_unique_id
)`;

      const uniqCustSql = `${customerCte} SELECT COUNT(*) AS val FROM filtered_cust;`;
      const firstTimeSql = `${customerCte} SELECT COUNT(*) AS val FROM filtered_cust WHERE order_count = 1;`;
      const repeatCustSql = `${customerCte} SELECT COUNT(*) AS val FROM filtered_cust WHERE order_count > 1;`;
      const repeatRateSql = `${customerCte} SELECT ROUND(COALESCE(SUM(CASE WHEN order_count > 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 0), 2) AS val FROM filtered_cust;`;
      const avgLtvSql = `${customerCte} SELECT ROUND(COALESCE(AVG(lifetime_spend), 0), 2) AS val FROM filtered_cust;`;

      const [uniqCust, firstTimeCust, repeatCust, repeatRate, avgLtv] =
        await Promise.all([
          queryScalar(uniqCustSql),
          queryScalar(firstTimeSql),
          queryScalar(repeatCustSql),
          queryScalar(repeatRateSql),
          queryScalar(avgLtvSql)
        ]);

      const kpis: DashboardKpiItem[] = [
        {
          id: 'cust-unique',
          label: 'Unique Purchasing Customers',
          value: uniqCust,
          unit: 'number',
          subtitle: 'Permanent customer_unique_id entities',
          definition:
            'Distinct permanent customer identities (customer_unique_id) who placed orders in the selected filter scope.',
          sqlSource: uniqCustSql,
          grainNote: '1 row per customer_unique_id'
        },
        {
          id: 'cust-first-time',
          label: 'First-Time Customers (1 Order)',
          value: firstTimeCust,
          unit: 'number',
          subtitle: 'Single-purchase customer accounts',
          definition:
            'Unique customers with exactly 1 distinct order_id in the filtered dataset.',
          sqlSource: firstTimeSql,
          grainNote: 'HAVING COUNT(DISTINCT order_id) = 1'
        },
        {
          id: 'cust-repeat',
          label: 'Repeat Customers (2+ Orders)',
          value: repeatCust,
          unit: 'number',
          subtitle: 'Multi-order retained accounts',
          definition:
            'Unique customer_unique_id accounts that have completed 2 or more distinct orders.',
          sqlSource: repeatCustSql,
          grainNote: 'HAVING COUNT(DISTINCT order_id) > 1'
        },
        {
          id: 'cust-repeat-rate',
          label: 'Repeat Customer Rate',
          value: repeatRate,
          unit: 'percent',
          subtitle: 'Share of buyers with 2+ orders',
          definition:
            'Repeat customers divided by total unique purchasing customers (resolved via customer_unique_id).',
          sqlSource: repeatRateSql,
          grainNote: 'Repeat customer_unique_id / Total customer_unique_id'
        },
        {
          id: 'cust-avg-ltv',
          label: 'Mean Customer Lifetime Value',
          value: avgLtv,
          unit: 'currency',
          subtitle: 'Average cumulative spend per buyer',
          definition:
            'Mean cumulative order value per unique customer_unique_id account.',
          sqlSource: avgLtvSql,
          grainNote: 'AVG(lifetime_spend) per customer_unique_id'
        }
      ];

      const freqDistSql = `${customerCte}
SELECT
  CASE
    WHEN order_count = 1 THEN '1 Order (First-Time)'
    WHEN order_count = 2 THEN '2 Orders (Repeat)'
    ELSE '3+ Orders (Loyal VIP)'
  END AS frequency_cohort,
  COUNT(*) AS customer_count,
  ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS customer_share_pct,
  SUM(order_count) AS total_orders,
  ROUND(SUM(lifetime_spend), 2) AS cohort_revenue,
  ROUND(AVG(lifetime_spend), 2) AS avg_customer_ltv
FROM filtered_cust
GROUP BY frequency_cohort
ORDER BY frequency_cohort ASC;`;

      const rfmSql = `${customerCte},
dataset_anchor AS (
  SELECT MAX(last_order_date) AS max_ref_date FROM filtered_cust
),
rfm_scored AS (
  SELECT
    fc.customer_unique_id,
    fc.customer_state,
    fc.order_count AS frequency,
    fc.lifetime_spend AS monetary,
    COALESCE(DATE_DIFF('day', fc.last_order_date, da.max_ref_date), 0) AS recency_days,
    CASE
      WHEN fc.order_count >= 2 AND fc.lifetime_spend >= 1500 THEN '1. Champions (Repeat High-LTV)'
      WHEN fc.order_count >= 2 THEN '2. Loyal Repeat Buyers'
      WHEN COALESCE(DATE_DIFF('day', fc.last_order_date, da.max_ref_date), 0) <= 60 AND fc.lifetime_spend >= 800 THEN '3. High-Ticket Recent Buyers'
      WHEN COALESCE(DATE_DIFF('day', fc.last_order_date, da.max_ref_date), 0) <= 90 THEN '4. Promising Recent First-Timers'
      ELSE '5. At-Risk / Dormant One-Timers'
    END AS rfm_segment
  FROM filtered_cust fc
  CROSS JOIN dataset_anchor da
)
SELECT
  rfm_segment,
  COUNT(*) AS customer_count,
  ROUND(AVG(recency_days), 1) AS avg_recency_days,
  ROUND(AVG(frequency), 2) AS avg_frequency,
  ROUND(AVG(monetary), 2) AS avg_monetary_ltv,
  ROUND(SUM(monetary), 2) AS segment_revenue,
  ROUND(SUM(monetary) * 100.0 / NULLIF(SUM(SUM(monetary)) OVER (), 0), 2) AS revenue_share_pct
FROM rfm_scored
GROUP BY rfm_segment
ORDER BY rfm_segment ASC;`;

      const valueDistSql = `${customerCte}
SELECT
  CASE
    WHEN lifetime_spend < 250 THEN '1. Under $250'
    WHEN lifetime_spend < 750 THEN '2. $250 - $749'
    WHEN lifetime_spend < 1500 THEN '3. $750 - $1,499'
    WHEN lifetime_spend < 3000 THEN '4. $1,500 - $2,999'
    ELSE '5. $3,000+ (Enterprise VIP)'
  END AS value_tier,
  COUNT(*) AS customer_count,
  ROUND(SUM(lifetime_spend), 2) AS tier_revenue,
  ROUND(AVG(lifetime_spend), 2) AS mean_ltv,
  ROUND(SUM(lifetime_spend) * 100.0 / NULLIF(SUM(SUM(lifetime_spend)) OVER (), 0), 2) AS revenue_share_pct
FROM filtered_cust
GROUP BY value_tier
ORDER BY value_tier ASC;`;

      const geoDistSql = `${customerCte}
SELECT
  customer_state AS state,
  COUNT(*) AS unique_customers,
  SUM(CASE WHEN order_count = 1 THEN 1 ELSE 0 END) AS first_time_customers,
  SUM(CASE WHEN order_count > 1 THEN 1 ELSE 0 END) AS repeat_customers,
  SUM(order_count) AS total_orders,
  ROUND(SUM(lifetime_spend), 2) AS total_spend,
  ROUND(AVG(lifetime_spend), 2) AS avg_customer_ltv
FROM filtered_cust
GROUP BY customer_state
ORDER BY total_spend DESC;`;

      const [freqRows, rfmRows, valRows, geoRows] = await Promise.all([
        queryRows(freqDistSql),
        queryRows(rfmSql),
        queryRows(valueDistSql),
        queryRows(geoDistSql)
      ]);

      const sections: DashboardVisualSection[] = [
        {
          id: 'cust-rfm-segmentation',
          title: 'RFM Customer Segmentation (Recency, Frequency, Monetary)',
          subtitle: 'Behavioral segmentation of permanent customer_unique_id entities by recency days, order frequency, and monetary spend',
          chartType: 'bar',
          xKey: 'rfm_segment',
          yKey: 'segment_revenue',
          yLabel: 'Segment Revenue ($)',
          secondaryKey: 'customer_count',
          secondaryLabel: 'Unique Customers',
          yUnit: 'currency',
          secondaryUnit: 'number',
          drilldownDimension: 'rfm_segment',
          executedSql: rfmSql,
          rows: rfmRows
        },
        {
          id: 'cust-purchase-frequency',
          title: 'Customer Purchase Frequency Cohorts',
          subtitle: 'First-Time (1 Order) vs. Repeat (2 Orders) vs. Loyal VIP (3+ Orders) customer distribution',
          chartType: 'composed',
          xKey: 'frequency_cohort',
          yKey: 'customer_count',
          yLabel: 'Customer Count',
          secondaryKey: 'avg_customer_ltv',
          secondaryLabel: 'Mean LTV ($)',
          yUnit: 'number',
          secondaryUnit: 'currency',
          executedSql: freqDistSql,
          rows: freqRows
        },
        {
          id: 'cust-value-distribution',
          title: 'Customer Lifetime Value (LTV) Distribution',
          subtitle: 'Account stratification across cumulative spend brackets and revenue concentration',
          chartType: 'bar',
          xKey: 'value_tier',
          yKey: 'tier_revenue',
          yLabel: 'Tier Revenue ($)',
          secondaryKey: 'customer_count',
          secondaryLabel: 'Customers',
          yUnit: 'currency',
          secondaryUnit: 'number',
          executedSql: valueDistSql,
          rows: valRows
        },
        {
          id: 'cust-geographic-distribution',
          title: 'Geographic Customer Distribution by State',
          subtitle: 'Unique, first-time, and repeat customers alongside total lifetime spend by Brazilian state',
          chartType: 'bar',
          xKey: 'state',
          yKey: 'unique_customers',
          yLabel: 'Unique Customers',
          secondaryKey: 'total_spend',
          secondaryLabel: 'Total Spend ($)',
          yUnit: 'number',
          secondaryUnit: 'currency',
          drilldownDimension: 'state',
          executedSql: geoDistSql,
          rows: geoRows
        }
      ];

      return {
        dashboardId,
        dashboardNumber: info.number,
        title: info.title,
        description: info.description,
        isReady: true,
        dataMode: duckdbEngine.getDataMode(),
        isDemonstrationData: duckdbEngine.isDemonstrationData(),
        appliedFilters,
        filterOptions,
        kpis,
        sections
      };
    }

    // =========================================================================
    // DASHBOARD 4: PRODUCT INTELLIGENCE
    // =========================================================================
    case 'product-intelligence': {
      const skusSoldSql = `SELECT COUNT(DISTINCT foi.product_id) AS val FROM fact_order_items foi INNER JOIN fact_orders fo ON foi.order_id = fo.order_id WHERE ${itemWhere};`;
      const unitsSoldSql = `SELECT COUNT(foi.order_item_id) AS val FROM fact_order_items foi INNER JOIN fact_orders fo ON foi.order_id = fo.order_id WHERE ${itemWhere};`;
      const merchGmvSql = `SELECT ROUND(COALESCE(SUM(foi.gmv_merchandise), 0), 2) AS val FROM fact_order_items foi INNER JOIN fact_orders fo ON foi.order_id = fo.order_id WHERE ${itemWhere};`;
      const avgPriceSql = `SELECT ROUND(COALESCE(AVG(foi.gmv_merchandise), 0), 2) AS val FROM fact_order_items foi INNER JOIN fact_orders fo ON foi.order_id = fo.order_id WHERE ${itemWhere};`;
      const freightRatioSql = `SELECT ROUND(COALESCE(SUM(foi.freight_revenue) * 100.0 / NULLIF(SUM(foi.gmv_merchandise), 0), 0), 2) AS val FROM fact_order_items foi INNER JOIN fact_orders fo ON foi.order_id = fo.order_id WHERE ${itemWhere};`;

      const [skusSold, unitsSold, merchGmv, avgPrice, freightRatio] = await Promise.all([
        queryScalar(skusSoldSql),
        queryScalar(unitsSoldSql),
        queryScalar(merchGmvSql),
        queryScalar(avgPriceSql),
        queryScalar(freightRatioSql)
      ]);

      const kpis: DashboardKpiItem[] = [
        {
          id: 'prd-active-skus',
          label: 'Active SKUs Sold',
          value: skusSold,
          unit: 'number',
          subtitle: 'Distinct product_id items ordered',
          definition:
            'Count of unique catalog products with at least one line item sold in the filtered scope.',
          sqlSource: skusSoldSql,
          grainNote: 'COUNT(DISTINCT product_id)'
        },
        {
          id: 'prd-units-sold',
          label: 'Total Line Item Units Sold',
          value: unitsSold,
          unit: 'number',
          subtitle: 'Order line item volume',
          definition:
            'Total count of order_items rows matching the active filter criteria.',
          sqlSource: unitsSoldSql,
          grainNote: '1 row per (order_id, order_item_id)'
        },
        {
          id: 'prd-merch-gmv',
          label: 'Product Merchandise Revenue',
          value: merchGmv,
          unit: 'currency',
          subtitle: 'Net product selling price total',
          definition:
            'Sum of order_items.price across all filtered product line items.',
          sqlSource: merchGmvSql,
          grainNote: 'SUM(gmv_merchandise) in fact_order_items'
        },
        {
          id: 'prd-avg-price',
          label: 'Average Unit Selling Price',
          value: avgPrice,
          unit: 'currency',
          subtitle: 'Mean price per unit sold',
          definition:
            'Arithmetic mean of order_items.price across filtered line items.',
          sqlSource: avgPriceSql,
          grainNote: 'AVG(gmv_merchandise) per line item'
        },
        {
          id: 'prd-freight-ratio',
          label: 'Freight-to-Merchandise Ratio',
          value: freightRatio,
          unit: 'percent',
          subtitle: 'Shipping cost % of net item price',
          definition:
            'Total item freight_value divided by total item merchandise price (SUM(freight_revenue) / SUM(gmv_merchandise)).',
          sqlSource: freightRatioSql,
          grainNote: 'SUM(freight_revenue) / SUM(gmv_merchandise)'
        }
      ];

      const topProductsSql = `SELECT
  foi.product_id,
  foi.product_id || ' (' || foi.product_category_english || ')' AS product_label,
  foi.product_category_english AS category,
  COUNT(foi.order_item_id) AS units_sold,
  COUNT(DISTINCT foi.order_id) AS orders_count,
  ROUND(AVG(foi.gmv_merchandise), 2) AS unit_price,
  ROUND(SUM(foi.gmv_merchandise), 2) AS merchandise_revenue,
  ROUND(SUM(foi.freight_revenue), 2) AS freight_total,
  ROUND(SUM(foi.total_line_value), 2) AS total_landed_revenue
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
WHERE ${itemWhere}
GROUP BY foi.product_id, product_label, foi.product_category_english
ORDER BY merchandise_revenue DESC
LIMIT 15;`;

      const topCategoriesSql = `SELECT
  foi.product_category_english AS category,
  COUNT(DISTINCT foi.product_id) AS active_skus,
  COUNT(foi.order_item_id) AS units_sold,
  ROUND(SUM(foi.gmv_merchandise), 2) AS merchandise_revenue,
  ROUND(SUM(foi.freight_revenue), 2) AS freight_total,
  ROUND(SUM(foi.total_line_value), 2) AS total_landed_value,
  ROUND(SUM(foi.freight_revenue) * 100.0 / NULLIF(SUM(foi.gmv_merchandise), 0), 2) AS freight_to_price_pct,
  ROUND(SUM(foi.gmv_merchandise) * 100.0 / NULLIF(SUM(SUM(foi.gmv_merchandise)) OVER (), 0), 2) AS revenue_share_pct
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
WHERE ${itemWhere}
GROUP BY foi.product_category_english
ORDER BY merchandise_revenue DESC;`;

      const lowCategoriesSql = `SELECT
  foi.product_category_english AS category,
  COUNT(DISTINCT foi.product_id) AS active_skus,
  COUNT(foi.order_item_id) AS units_sold,
  ROUND(SUM(foi.gmv_merchandise), 2) AS merchandise_revenue,
  ROUND(SUM(foi.freight_revenue), 2) AS freight_total,
  ROUND(SUM(foi.freight_revenue) * 100.0 / NULLIF(SUM(foi.gmv_merchandise), 0), 2) AS freight_burden_pct
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
WHERE ${itemWhere}
GROUP BY foi.product_category_english
ORDER BY merchandise_revenue ASC, units_sold ASC
LIMIT 10;`;

      const priceDistSql = `SELECT
  CASE
    WHEN foi.gmv_merchandise < 200 THEN '1. Under $200 (Entry)'
    WHEN foi.gmv_merchandise < 600 THEN '2. $200 - $599 (Mid-Tier)'
    WHEN foi.gmv_merchandise < 1200 THEN '3. $600 - $1,199 (Core)'
    WHEN foi.gmv_merchandise < 2000 THEN '4. $1,200 - $1,999 (Premium)'
    ELSE '5. $2,000+ (Flagship Enterprise)'
  END AS price_band,
  COUNT(DISTINCT foi.product_id) AS distinct_skus,
  COUNT(foi.order_item_id) AS units_sold,
  ROUND(SUM(foi.gmv_merchandise), 2) AS band_merchandise_revenue,
  ROUND(AVG(foi.freight_revenue), 2) AS avg_unit_freight
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
WHERE ${itemWhere}
GROUP BY price_band
ORDER BY price_band ASC;`;

      const categoryTrendsSql = `SELECT
  SUBSTR(CAST(foi.purchase_date_key AS VARCHAR), 1, 7) AS order_month,
  foi.product_category_english AS category,
  COUNT(foi.order_item_id) AS units_sold,
  ROUND(SUM(foi.gmv_merchandise), 2) AS monthly_category_revenue,
  ROUND(SUM(foi.freight_revenue), 2) AS monthly_category_freight
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
WHERE ${itemWhere}
GROUP BY order_month, foi.product_category_english
ORDER BY order_month ASC, monthly_category_revenue DESC;`;

      const [topProdRows, topCatRows, lowCatRows, priceDistRows, catTrendRows] =
        await Promise.all([
          queryRows(topProductsSql),
          queryRows(topCategoriesSql),
          queryRows(lowCategoriesSql),
          queryRows(priceDistSql),
          queryRows(categoryTrendsSql)
        ]);

      const sections: DashboardVisualSection[] = [
        {
          id: 'prd-top-selling-products',
          title: 'Top-Selling Products (SKUs by Merchandise Revenue & Units)',
          subtitle: 'Highest-grossing catalog SKUs with unit velocity, selling price, and freight cost',
          chartType: 'horizontal-bar',
          xKey: 'product_label',
          yKey: 'merchandise_revenue',
          yLabel: 'Merchandise Revenue ($)',
          secondaryKey: 'units_sold',
          secondaryLabel: 'Units Sold',
          yUnit: 'currency',
          secondaryUnit: 'number',
          drilldownDimension: 'product',
          executedSql: topProductsSql,
          rows: topProdRows
        },
        {
          id: 'prd-top-categories-freight',
          title: 'Top Revenue Categories & Freight Contribution (%)',
          subtitle: 'Merchandise revenue vs. shipping freight total and freight-to-price ratio across categories',
          chartType: 'composed',
          xKey: 'category',
          yKey: 'merchandise_revenue',
          yLabel: 'Merchandise Revenue ($)',
          secondaryKey: 'freight_to_price_pct',
          secondaryLabel: 'Freight Ratio (%)',
          yUnit: 'currency',
          secondaryUnit: 'percent',
          drilldownDimension: 'category',
          executedSql: topCategoriesSql,
          rows: topCatRows
        },
        {
          id: 'prd-price-distribution',
          title: 'Product Price Distribution & Unit Velocity by Price Band',
          subtitle: 'Distribution of SKU count, units sold, and revenue across unit price tiers',
          chartType: 'bar',
          xKey: 'price_band',
          yKey: 'band_merchandise_revenue',
          yLabel: 'Band Revenue ($)',
          secondaryKey: 'units_sold',
          secondaryLabel: 'Units Sold',
          yUnit: 'currency',
          secondaryUnit: 'number',
          executedSql: priceDistSql,
          rows: priceDistRows
        },
        {
          id: 'prd-low-performing-categories',
          title: 'Low-Performing Categories & Freight Burden Audit',
          subtitle: 'Bottom-ranked categories by revenue velocity and their relative shipping cost burden',
          chartType: 'bar',
          xKey: 'category',
          yKey: 'merchandise_revenue',
          yLabel: 'Merchandise Revenue ($)',
          secondaryKey: 'freight_burden_pct',
          secondaryLabel: 'Freight Burden (%)',
          yUnit: 'currency',
          secondaryUnit: 'percent',
          drilldownDimension: 'category',
          executedSql: lowCategoriesSql,
          rows: lowCatRows
        },
        {
          id: 'prd-category-trends',
          title: 'Product Category Monthly Revenue Trends',
          subtitle: 'Chronological evolution of category-level sales and unit volume by month',
          chartType: 'table',
          xKey: 'order_month',
          yKey: 'monthly_category_revenue',
          yLabel: 'Monthly Category Revenue ($)',
          secondaryKey: 'units_sold',
          secondaryLabel: 'Units Sold',
          yUnit: 'currency',
          secondaryUnit: 'number',
          drilldownDimension: 'category',
          executedSql: categoryTrendsSql,
          rows: catTrendRows
        }
      ];

      return {
        dashboardId,
        dashboardNumber: info.number,
        title: info.title,
        description: info.description,
        isReady: true,
        dataMode: duckdbEngine.getDataMode(),
        isDemonstrationData: duckdbEngine.isDemonstrationData(),
        appliedFilters,
        filterOptions,
        kpis,
        sections
      };
    }

    // =========================================================================
    // DASHBOARD 5: DELIVERY PERFORMANCE
    // =========================================================================
    case 'delivery-performance': {
      const deliveredWhere = `${orderWhere} AND fo.order_status = 'delivered'`;

      const avgDurSql = `SELECT ROUND(COALESCE(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 0), 2) AS val FROM fact_orders fo WHERE ${deliveredWhere};`;
      const onTimePctSql = `SELECT ROUND(COALESCE(SUM(CASE WHEN fo.is_on_time = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(DISTINCT fo.order_id), 0), 0), 2) AS val FROM fact_orders fo WHERE ${deliveredWhere};`;
      const latePctSql = `SELECT ROUND(COALESCE(SUM(CASE WHEN fo.is_on_time = 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(DISTINCT fo.order_id), 0), 0), 2) AS val FROM fact_orders fo WHERE ${deliveredWhere};`;
      const slaBufferSql = `SELECT ROUND(COALESCE(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_estimated_delivery_date AS VARCHAR), 1, 10) AS DATE))), 0), 2) AS val FROM fact_orders fo WHERE ${deliveredWhere};`;
      const deliveredCntSql = `SELECT COUNT(DISTINCT fo.order_id) AS val FROM fact_orders fo WHERE ${deliveredWhere};`;

      const [avgDuration, onTimePct, latePct, slaBuffer, deliveredCnt] =
        await Promise.all([
          queryScalar(avgDurSql),
          queryScalar(onTimePctSql),
          queryScalar(latePctSql),
          queryScalar(slaBufferSql),
          queryScalar(deliveredCntSql)
        ]);

      const kpis: DashboardKpiItem[] = [
        {
          id: 'del-avg-duration',
          label: 'Average Delivery Duration',
          value: avgDuration,
          unit: 'days',
          subtitle: 'Purchase to customer delivery days',
          definition:
            'Mean calendar days elapsed between order_purchase_timestamp and order_delivered_customer_date for delivered orders.',
          sqlSource: avgDurSql,
          grainNote: "Delivered orders (order_status = 'delivered')"
        },
        {
          id: 'del-ontime-pct',
          label: 'On-Time Delivery Percentage',
          value: onTimePct,
          unit: 'percent',
          subtitle: 'Arrived on or before estimated date',
          definition:
            'Percentage of delivered orders where order_delivered_customer_date <= order_estimated_delivery_date.',
          sqlSource: onTimePctSql,
          grainNote: 'SUM(is_on_time) / COUNT(delivered orders)'
        },
        {
          id: 'del-late-pct',
          label: 'Late Delivery Percentage',
          value: latePct,
          unit: 'percent',
          subtitle: 'Exceeded estimated SLA date',
          definition:
            'Percentage of delivered orders arriving after order_estimated_delivery_date.',
          sqlSource: latePctSql,
          grainNote: '100% - On-Time Delivery %'
        },
        {
          id: 'del-sla-buffer',
          label: 'Estimated vs. Actual Buffer',
          value: slaBuffer,
          unit: 'days',
          subtitle: 'Days ahead (+) or behind (-) SLA',
          definition:
            'Average difference in days between estimated delivery date and actual delivery date (positive means early arrival).',
          sqlSource: slaBufferSql,
          grainNote: 'DATE_DIFF(delivered_date, estimated_date)'
        },
        {
          id: 'del-orders-evaluated',
          label: 'Delivered Shipments Analyzed',
          value: deliveredCnt,
          unit: 'number',
          subtitle: 'Completed customer deliveries',
          definition:
            'Count of distinct delivered orders evaluated for logistics SLA performance.',
          sqlSource: deliveredCntSql,
          grainNote: 'COUNT(DISTINCT order_id)'
        }
      ];

      const estVsActualSql = `SELECT
  SUBSTR(CAST(fo.purchase_date_key AS VARCHAR), 1, 7) AS order_month,
  COUNT(DISTINCT fo.order_id) AS delivered_orders,
  ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 2) AS avg_actual_delivery_days,
  ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_estimated_delivery_date AS VARCHAR), 1, 10) AS DATE))), 2) AS avg_estimated_sla_days,
  ROUND(SUM(CASE WHEN fo.is_on_time = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(DISTINCT fo.order_id), 0), 2) AS on_time_pct,
  ROUND(SUM(CASE WHEN fo.is_on_time = 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(DISTINCT fo.order_id), 0), 2) AS late_pct
FROM fact_orders fo
WHERE ${deliveredWhere}
GROUP BY order_month
ORDER BY order_month ASC;`;

      const stateDeliverySql = `SELECT
  fo.customer_state AS state,
  COUNT(DISTINCT fo.order_id) AS delivered_orders,
  SUM(CASE WHEN fo.is_on_time = 1 THEN 1 ELSE 0 END) AS on_time_orders,
  SUM(CASE WHEN fo.is_on_time = 0 THEN 1 ELSE 0 END) AS late_orders,
  ROUND(SUM(CASE WHEN fo.is_on_time = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(DISTINCT fo.order_id), 0), 2) AS on_time_pct,
  ROUND(SUM(CASE WHEN fo.is_on_time = 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(DISTINCT fo.order_id), 0), 2) AS late_pct,
  ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 2) AS avg_actual_days,
  ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_estimated_delivery_date AS VARCHAR), 1, 10) AS DATE))), 2) AS avg_estimated_days
FROM fact_orders fo
WHERE ${deliveredWhere}
GROUP BY fo.customer_state
ORDER BY delivered_orders DESC, state ASC;`;

      const sellerDeliverySql = `SELECT
  foi.seller_id,
  COALESCE(foi.seller_city, 'unknown') AS seller_city,
  COALESCE(foi.seller_state, 'NA') AS seller_state,
  COUNT(DISTINCT fo.order_id) AS delivered_orders,
  SUM(CASE WHEN fo.is_on_time = 1 THEN 1 ELSE 0 END) AS on_time_items,
  SUM(CASE WHEN fo.is_on_time = 0 THEN 1 ELSE 0 END) AS late_items,
  ROUND(SUM(CASE WHEN fo.is_on_time = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS on_time_pct,
  ROUND(SUM(CASE WHEN fo.is_on_time = 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2) AS late_pct,
  ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 2) AS avg_delivery_days,
  ROUND(SUM(foi.gmv_merchandise), 2) AS merchandise_revenue
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
WHERE ${itemWhere} AND fo.order_status = 'delivered'
GROUP BY foi.seller_id, foi.seller_city, foi.seller_state
ORDER BY delivered_orders DESC, merchandise_revenue DESC;`;

      const [estVsActualRows, stateDelRows, sellerDelRows] = await Promise.all([
        queryRows(estVsActualSql),
        queryRows(stateDeliverySql),
        queryRows(sellerDeliverySql)
      ]);

      const sections: DashboardVisualSection[] = [
        {
          id: 'del-estimated-vs-actual',
          title: 'Estimated SLA vs. Actual Delivery Duration by Month',
          subtitle: 'Comparison of promised SLA lead time (days) against actual carrier transit duration',
          chartType: 'composed',
          xKey: 'order_month',
          yKey: 'avg_actual_delivery_days',
          yLabel: 'Actual Delivery (Days)',
          secondaryKey: 'avg_estimated_sla_days',
          secondaryLabel: 'Estimated SLA (Days)',
          yUnit: 'days',
          secondaryUnit: 'days',
          drilldownDimension: 'month',
          executedSql: estVsActualSql,
          rows: estVsActualRows
        },
        {
          id: 'del-by-state',
          title: 'Delivery Performance & Late Shipment Rate by State',
          subtitle: 'Regional on-time SLA percentage, late percentage, and average transit days across states',
          chartType: 'composed',
          xKey: 'state',
          yKey: 'on_time_pct',
          yLabel: 'On-Time SLA (%)',
          secondaryKey: 'avg_actual_days',
          secondaryLabel: 'Avg Transit (Days)',
          yUnit: 'percent',
          secondaryUnit: 'days',
          drilldownDimension: 'state',
          executedSql: stateDeliverySql,
          rows: stateDelRows
        },
        {
          id: 'del-by-seller',
          title: 'Delivery Performance & SLA Compliance by Seller',
          subtitle: 'Merchant fulfillment lead times, on-time delivery rate, and late shipment counts',
          chartType: 'bar',
          xKey: 'seller_id',
          yKey: 'on_time_pct',
          yLabel: 'On-Time SLA (%)',
          secondaryKey: 'avg_delivery_days',
          secondaryLabel: 'Avg Delivery (Days)',
          yUnit: 'percent',
          secondaryUnit: 'days',
          drilldownDimension: 'seller',
          executedSql: sellerDeliverySql,
          rows: sellerDelRows
        }
      ];

      return {
        dashboardId,
        dashboardNumber: info.number,
        title: info.title,
        description: info.description,
        isReady: true,
        dataMode: duckdbEngine.getDataMode(),
        isDemonstrationData: duckdbEngine.isDemonstrationData(),
        appliedFilters,
        filterOptions,
        kpis,
        sections
      };
    }

    // =========================================================================
    // DASHBOARD 6: CUSTOMER SATISFACTION
    // =========================================================================
    case 'customer-satisfaction':
    default: {
      const avgScoreSql = `SELECT ROUND(COALESCE(AVG(fr.review_score), 0), 2) AS val FROM fact_reviews fr INNER JOIN fact_orders fo ON fr.order_id = fo.order_id WHERE ${orderWhere};`;
      const posShareSql = `SELECT ROUND(COALESCE(SUM(CASE WHEN fr.review_score >= 4 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 0), 2) AS val FROM fact_reviews fr INNER JOIN fact_orders fo ON fr.order_id = fo.order_id WHERE ${orderWhere};`;
      const detractorShareSql = `SELECT ROUND(COALESCE(SUM(CASE WHEN fr.review_score <= 2 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 0), 2) AS val FROM fact_reviews fr INNER JOIN fact_orders fo ON fr.order_id = fo.order_id WHERE ${orderWhere};`;
      const onTimeScoreSql = `SELECT ROUND(COALESCE(AVG(CASE WHEN fo.order_status = 'delivered' AND fo.is_on_time = 1 THEN fr.review_score END), 0), 2) AS val FROM fact_reviews fr INNER JOIN fact_orders fo ON fr.order_id = fo.order_id WHERE ${orderWhere};`;
      const lateScoreSql = `SELECT ROUND(COALESCE(AVG(CASE WHEN fo.order_status = 'delivered' AND fo.is_on_time = 0 THEN fr.review_score END), 0), 2) AS val FROM fact_reviews fr INNER JOIN fact_orders fo ON fr.order_id = fo.order_id WHERE ${orderWhere};`;

      const [avgScore, posShare, detractorShare, onTimeScore, lateScore] =
        await Promise.all([
          queryScalar(avgScoreSql),
          queryScalar(posShareSql),
          queryScalar(detractorShareSql),
          queryScalar(onTimeScoreSql),
          queryScalar(lateScoreSql)
        ]);

      const kpis: DashboardKpiItem[] = [
        {
          id: 'csat-avg-score',
          label: 'Average Review Score',
          value: avgScore,
          unit: 'score',
          subtitle: 'Scale of 1.00 to 5.00 stars',
          definition:
            'Arithmetic mean of review_score across customer reviews linked to filtered orders.',
          sqlSource: avgScoreSql,
          grainNote: 'AVG(review_score) in fact_reviews'
        },
        {
          id: 'csat-positive-share',
          label: 'Positive Promoter Share (4-5★)',
          value: posShare,
          unit: 'percent',
          subtitle: 'Reviews rated 4 or 5 stars',
          definition:
            'Percentage of customer reviews scoring 4 or 5 stars out of total submitted reviews.',
          sqlSource: posShareSql,
          grainNote: 'review_score >= 4 / COUNT(*)'
        },
        {
          id: 'csat-detractor-share',
          label: 'Critical Detractor Share (1-2★)',
          value: detractorShare,
          unit: 'percent',
          subtitle: 'Reviews rated 1 or 2 stars',
          definition:
            'Percentage of customer reviews scoring 1 or 2 stars indicating fulfillment or product friction.',
          sqlSource: detractorShareSql,
          grainNote: 'review_score <= 2 / COUNT(*)'
        },
        {
          id: 'csat-ontime-score',
          label: 'On-Time Delivery Review Score',
          value: onTimeScore,
          unit: 'score',
          subtitle: 'Mean rating when delivered <= SLA',
          definition:
            'Mean review score for delivered orders that arrived on or before the estimated delivery date.',
          sqlSource: onTimeScoreSql,
          grainNote: 'WHERE is_on_time = 1'
        },
        {
          id: 'csat-late-score',
          label: 'Delayed Delivery Review Score',
          value: lateScore,
          unit: 'score',
          subtitle: 'Mean rating when delivered > SLA',
          definition:
            'Mean review score for delivered orders that missed their estimated SLA delivery date.',
          sqlSource: lateScoreSql,
          grainNote: 'WHERE is_on_time = 0'
        }
      ];

      const reviewDistSql = `SELECT
  CAST(fr.review_score AS VARCHAR) || ' Stars' AS score_label,
  fr.review_score,
  COUNT(*) AS review_count,
  ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) AS share_pct,
  ROUND(AVG(fo.total_order_value), 2) AS avg_order_value
FROM fact_reviews fr
INNER JOIN fact_orders fo ON fr.order_id = fo.order_id
WHERE ${orderWhere}
GROUP BY fr.review_score
ORDER BY fr.review_score DESC;`;

      const deliveryVsReviewSql = `SELECT
  CASE
    WHEN fo.order_status <> 'delivered' THEN '3. In-Transit / Non-Delivered'
    WHEN fo.is_on_time = 1 THEN '1. On-Time Delivery (Arrived <= SLA)'
    ELSE '2. Late Delivery (Arrived > SLA)'
  END AS delivery_sla_status,
  COUNT(DISTINCT fo.order_id) AS orders_count,
  ROUND(AVG(fr.review_score), 2) AS avg_review_score,
  SUM(CASE WHEN fr.review_score >= 4 THEN 1 ELSE 0 END) AS positive_4_5_star_count,
  SUM(CASE WHEN fr.review_score <= 2 THEN 1 ELSE 0 END) AS detractor_1_2_star_count,
  ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 1) AS avg_transit_days
FROM fact_reviews fr
INNER JOIN fact_orders fo ON fr.order_id = fo.order_id
WHERE ${orderWhere}
GROUP BY delivery_sla_status
ORDER BY delivery_sla_status ASC;`;

      const categoryReviewSql = `WITH order_review_avg AS (
  SELECT order_id, AVG(review_score) AS order_score
  FROM reviews
  GROUP BY order_id
)
SELECT
  foi.product_category_english AS category,
  COUNT(DISTINCT foi.order_id) AS reviewed_orders,
  ROUND(AVG(ora.order_score), 2) AS avg_review_score,
  SUM(CASE WHEN ora.order_score >= 4 THEN 1 ELSE 0 END) AS positive_items,
  SUM(CASE WHEN ora.order_score <= 2 THEN 1 ELSE 0 END) AS low_rated_items,
  ROUND(SUM(foi.gmv_merchandise), 2) AS merchandise_revenue
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
INNER JOIN order_review_avg ora ON foi.order_id = ora.order_id
WHERE ${itemWhere}
GROUP BY foi.product_category_english
ORDER BY avg_review_score DESC, merchandise_revenue DESC;`;

      const statusReviewSql = `SELECT
  fo.order_status AS status,
  COUNT(fr.review_id) AS review_count,
  ROUND(AVG(fr.review_score), 2) AS avg_review_score,
  MIN(fr.review_score) AS min_score,
  MAX(fr.review_score) AS max_score,
  ROUND(SUM(fo.total_order_value), 2) AS total_order_value
FROM fact_reviews fr
INNER JOIN fact_orders fo ON fr.order_id = fo.order_id
WHERE ${orderWhere}
GROUP BY fo.order_status
ORDER BY review_count DESC;`;

      const [distRows, delivVsRevRows, catRevRows, statusRevRows] = await Promise.all([
        queryRows(reviewDistSql),
        queryRows(deliveryVsReviewSql),
        queryRows(categoryReviewSql),
        queryRows(statusReviewSql)
      ]);

      const sections: DashboardVisualSection[] = [
        {
          id: 'csat-review-distribution',
          title: 'Customer Review Score Distribution (1 to 5 Stars)',
          subtitle: 'Volume and percentage share of 1-star through 5-star ratings (Click any star rating to drill down)',
          chartType: 'bar',
          xKey: 'score_label',
          yKey: 'review_count',
          yLabel: 'Review Count',
          secondaryKey: 'share_pct',
          secondaryLabel: 'Share (%)',
          yUnit: 'number',
          secondaryUnit: 'percent',
          drilldownDimension: 'review_score',
          executedSql: reviewDistSql,
          rows: distRows
        },
        {
          id: 'csat-delivery-vs-review',
          title: 'Delivery SLA Performance vs. Customer Review Score',
          subtitle: 'Quantifies rating degradation when shipments miss their estimated SLA delivery date',
          chartType: 'composed',
          xKey: 'delivery_sla_status',
          yKey: 'avg_review_score',
          yLabel: 'Mean Review Score (★)',
          secondaryKey: 'orders_count',
          secondaryLabel: 'Orders Count',
          yUnit: 'score',
          secondaryUnit: 'number',
          executedSql: deliveryVsReviewSql,
          rows: delivVsRevRows
        },
        {
          id: 'csat-category-reviews',
          title: 'Review Scores by Product Category',
          subtitle: 'Mean customer rating, positive/low-rated counts, and revenue across translated product categories',
          chartType: 'horizontal-bar',
          xKey: 'category',
          yKey: 'avg_review_score',
          yLabel: 'Avg Review Score (★)',
          secondaryKey: 'merchandise_revenue',
          secondaryLabel: 'Revenue ($)',
          yUnit: 'score',
          secondaryUnit: 'currency',
          drilldownDimension: 'category',
          executedSql: categoryReviewSql,
          rows: catRevRows
        },
        {
          id: 'csat-status-reviews',
          title: 'Review Scores by Order Lifecycle / Delivery Status',
          subtitle: 'Customer rating breakdown across delivered, shipped, processing, and canceled order states',
          chartType: 'bar',
          xKey: 'status',
          yKey: 'avg_review_score',
          yLabel: 'Avg Review Score (★)',
          secondaryKey: 'review_count',
          secondaryLabel: 'Reviews Count',
          yUnit: 'score',
          secondaryUnit: 'number',
          drilldownDimension: 'status',
          executedSql: statusReviewSql,
          rows: statusRevRows
        }
      ];

      return {
        dashboardId,
        dashboardNumber: info.number,
        title: info.title,
        description: info.description,
        isReady: true,
        dataMode: duckdbEngine.getDataMode(),
        isDemonstrationData: duckdbEngine.isDemonstrationData(),
        appliedFilters,
        filterOptions,
        kpis,
        sections
      };
    }
  }
}

export async function executeDashboardDrilldown(
  req: DashboardDrilldownRequest
): Promise<DashboardDrilldownResult> {
  await duckdbEngine.ensureInitialized();
  const options = await getDashboardFilterOptions();
  const filters = normalizeFilterState(req.filters, options);
  const baseOrderWhere = buildOrderWhereClause(filters, 'fo');
  const val = sanitizeSqlToken(req.dimensionValue);

  let sql = '';
  let title = '';
  let subtitle = '';

  switch (req.dimensionType) {
    case 'state':
      title = `State Drill-Down: ${req.dimensionValue}`;
      subtitle = `Granular orders, customer entities, and settlement values in state ${req.dimensionValue}`;
      sql = `SELECT
  fo.order_id,
  fo.customer_unique_id,
  fo.customer_city,
  fo.customer_state,
  fo.order_status,
  SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS purchase_date,
  fo.item_count,
  fo.gmv_merchandise,
  fo.freight_revenue,
  fo.total_order_value,
  CASE WHEN fo.is_on_time = 1 THEN 'ON_TIME' ELSE 'DELAYED_OR_IN_FLIGHT' END AS sla_status
FROM fact_orders fo
WHERE ${baseOrderWhere} AND fo.customer_state = '${val}'
ORDER BY fo.total_order_value DESC;`;
      break;

    case 'category':
      title = `Category Drill-Down: ${req.dimensionValue}`;
      subtitle = `Order line items, SKUs, sellers, and pricing in category "${req.dimensionValue}"`;
      sql = `SELECT
  foi.order_id,
  foi.order_item_id,
  foi.product_id,
  foi.product_category_english,
  foi.seller_id,
  fo.customer_state,
  fo.order_status,
  foi.gmv_merchandise,
  foi.freight_revenue,
  foi.total_line_value
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
WHERE ${baseOrderWhere} AND foi.product_category_english = '${val}'
ORDER BY foi.total_line_value DESC;`;
      break;

    case 'month':
      title = `Monthly Period Drill-Down: ${req.dimensionValue}`;
      subtitle = `All orders placed during calendar month ${req.dimensionValue}`;
      sql = `SELECT
  fo.order_id,
  fo.customer_unique_id,
  fo.customer_state,
  fo.order_status,
  SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS purchase_date,
  fo.item_count,
  fo.gmv_merchandise,
  fo.freight_revenue,
  fo.total_order_value
FROM fact_orders fo
WHERE ${baseOrderWhere} AND SUBSTR(CAST(fo.purchase_date_key AS VARCHAR), 1, 7) = '${val}'
ORDER BY fo.order_purchase_timestamp ASC;`;
      break;

    case 'status':
      title = `Order Lifecycle Status Drill-Down: ${req.dimensionValue}`;
      subtitle = `Orders currently in status "${req.dimensionValue}"`;
      sql = `SELECT
  fo.order_id,
  fo.customer_unique_id,
  fo.customer_state,
  fo.order_status,
  SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS purchase_date,
  SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS delivered_date,
  fo.item_count,
  fo.total_order_value
FROM fact_orders fo
WHERE ${baseOrderWhere} AND fo.order_status = '${val}'
ORDER BY fo.total_order_value DESC;`;
      break;

    case 'seller':
      title = `Merchant Seller Drill-Down: ${req.dimensionValue}`;
      subtitle = `Fulfilled line items and order SLA statuses for seller ${req.dimensionValue}`;
      sql = `SELECT
  foi.order_id,
  foi.product_id,
  foi.product_category_english,
  fo.customer_state AS destination_state,
  fo.order_status,
  foi.gmv_merchandise,
  foi.freight_revenue,
  CASE WHEN fo.is_on_time = 1 THEN 'ON_TIME' ELSE 'DELAYED' END AS sla_status
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
WHERE ${baseOrderWhere} AND foi.seller_id = '${val}'
ORDER BY foi.gmv_merchandise DESC;`;
      break;

    case 'payment_type':
      title = `Payment Method Drill-Down: ${req.dimensionValue}`;
      subtitle = `Payment settlements and installment schedules using ${req.dimensionValue}`;
      sql = `SELECT
  fp.order_id,
  fo.customer_unique_id,
  fo.customer_state,
  fp.payment_sequential,
  fp.payment_type,
  fp.payment_installments,
  fp.payment_value,
  fo.order_status
FROM fact_payments fp
INNER JOIN fact_orders fo ON fp.order_id = fo.order_id
WHERE ${baseOrderWhere} AND fp.payment_type = '${val}'
ORDER BY fp.payment_value DESC;`;
      break;

    case 'review_score': {
      const scoreNum = parseInt(val, 10) || 5;
      title = `Customer Review Drill-Down: ${scoreNum} Stars`;
      subtitle = `Verbatim customer reviews and order delivery telemetry for ${scoreNum}-star ratings`;
      sql = `SELECT
  fr.review_id,
  fr.order_id,
  fr.review_score,
  COALESCE(fr.review_comment_title, '(No Title)') AS review_title,
  COALESCE(fr.review_comment_message, '(No Verbatim Comment)') AS review_message,
  fo.customer_state,
  fo.order_status,
  fo.total_order_value,
  CASE WHEN fo.is_on_time = 1 THEN 'ON_TIME' ELSE 'LATE_OR_IN_FLIGHT' END AS sla_status
FROM fact_reviews fr
INNER JOIN fact_orders fo ON fr.order_id = fo.order_id
WHERE ${baseOrderWhere} AND fr.review_score = ${scoreNum}
ORDER BY fo.total_order_value DESC;`;
      break;
    }

    case 'product':
      title = `Product SKU Drill-Down: ${req.dimensionValue}`;
      subtitle = `Order line items for product ${req.dimensionValue}`;
      sql = `SELECT
  foi.order_id,
  foi.product_id,
  foi.product_category_english,
  foi.seller_id,
  fo.customer_state,
  foi.gmv_merchandise,
  foi.freight_revenue,
  foi.total_line_value
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
WHERE ${baseOrderWhere} AND (foi.product_id = '${val}' OR (foi.product_id || ' (' || foi.product_category_english || ')') = '${val}')
ORDER BY foi.total_line_value DESC;`;
      break;

    case 'rfm_segment':
    default:
      title = `Customer RFM Segment Drill-Down: ${req.dimensionValue}`;
      subtitle = `Customer accounts and lifetime spend metrics in segment "${req.dimensionValue}"`;
      sql = `SELECT
  fo.customer_unique_id,
  MIN(fo.customer_state) AS state,
  COUNT(DISTINCT fo.order_id) AS total_orders,
  ROUND(SUM(fo.total_order_value), 2) AS lifetime_spend,
  ROUND(AVG(fo.total_order_value), 2) AS avg_order_value,
  MIN(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10)) AS first_order_date,
  MAX(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10)) AS last_order_date
FROM fact_orders fo
WHERE ${baseOrderWhere}
GROUP BY fo.customer_unique_id
ORDER BY lifetime_spend DESC;`;
      break;
  }

  const execRes = await duckdbEngine.executeReadOnlyQuery(sql, 250, true);
  return {
    dimensionType: req.dimensionType,
    dimensionValue: req.dimensionValue,
    title,
    subtitle,
    executedSql: execRes.sql,
    columns: execRes.columns,
    rows: execRes.rows,
    rowCount: execRes.rowCount,
    executionTimeMs: execRes.executionTimeMs
  };
}
