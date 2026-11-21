import { FunctionDeclaration, Type } from '@google/genai';
import {
  ApprovedBiToolName,
  BiAssistantToolMetadata,
  BiAssistantToolTrace
} from '../../src/types/analytics';
import { duckdbEngine } from '../db/duckdbEngine';
import { computeAdvancedAnalyticsSuite } from '../db/advancedAnalyticsEngine';
import {
  computeAnomalyAlerts,
  runAbCohortHypothesisTest
} from '../db/decisionLabEngine';

export interface ApprovedToolExecutionOutput {
  trace: BiAssistantToolTrace;
  llmPayload: Record<string, unknown>;
}

export interface ToolValidationResult {
  valid: boolean;
  toolName?: ApprovedBiToolName;
  sanitizedArgs: Record<string, string | number | boolean>;
  error?: string;
}

export const APPROVED_BI_TOOLS_CATALOG: BiAssistantToolMetadata[] = [
  {
    name: 'get_highest_revenue_categories',
    displayName: 'Category Revenue & Satisfaction Ranking',
    domain: 'Sales & Product Intelligence',
    description:
      'Retrieves product categories ranked by merchandise GMV, freight revenue, unit volume, revenue share %, and mean customer review score from fact_order_items, fact_orders, and fact_reviews.',
    accessMode: 'READ_ONLY_SQL',
    parametersSummary: 'limit (1-25, default 10), sortOrder (DESC | ASC, default DESC)',
    sampleQuestion: 'What were our highest revenue categories?'
  },
  {
    name: 'get_at_risk_customers',
    displayName: 'RFM Customer Risk & Churn Segmentation',
    domain: 'Customer Intelligence & RFM',
    description:
      'Evaluates unique customers (customer_unique_id) using documented Recency, Frequency, and Monetary scoring (1-5) to identify At Risk, Cannot Lose Them, Hibernating, and healthy customer segments.',
    accessMode: 'READ_ONLY_SQL',
    parametersSummary:
      'segmentFilter (ALL | AT_RISK_FOCUS | Champions | Loyal Customers | Potential Loyalists | New Customers | At Risk | Cannot Lose Them | Hibernating), limit (1-50, default 20)',
    sampleQuestion: 'Which customers are at risk?'
  },
  {
    name: 'get_state_delivery_performance',
    displayName: 'Regional State Delivery SLA Performance',
    domain: 'Delivery & Logistics Analytics',
    description:
      'Aggregates delivered orders by customer_state to identify regions with elevated late delivery rates, prolonged transit durations, SLA delay variance, and associated mean review scores.',
    accessMode: 'READ_ONLY_SQL',
    parametersSummary:
      'sortBy (LATE_RATE_DESC | TRANSIT_DAYS_DESC | ORDER_VOLUME_DESC), limit (1-30, default 15)',
    sampleQuestion: 'Which states have poor delivery performance?'
  },
  {
    name: 'get_monthly_revenue_changes',
    displayName: 'Monthly Revenue Trajectory & MoM Variance',
    domain: 'Sales & Time-Series Intelligence',
    description:
      'Computes chronological monthly revenue, order count, average order value, month-over-month (MoM) dollar & percentage changes using SQL LAG() window functions, plus chronological train/test forecast summary.',
    accessMode: 'READ_ONLY_SQL',
    parametersSummary: 'limit (1-36, default 18)',
    sampleQuestion: 'What changed in monthly revenue?'
  },
  {
    name: 'get_low_review_associated_factors',
    displayName: 'Low Review Score Association Analysis',
    domain: 'Customer Satisfaction Econometrics',
    description:
      'Examines empirical factors associated with low review scores (delivery SLA delays with Pearson r, on-time vs. late star distributions, low-rated product categories, and seller late/review metrics) while explicitly distinguishing correlation from causation.',
    accessMode: 'READ_ONLY_SQL',
    parametersSummary: 'scoreThreshold (1-4, default 3)',
    sampleQuestion: 'What factors are associated with low reviews?'
  },
  {
    name: 'get_sellers_requiring_investigation',
    displayName: 'Sample-Adjusted Seller Risk Audit',
    domain: 'Seller Performance Governance',
    description:
      'Audits active sellers across revenue, order volume, freight burden, late delivery %, raw review score, and Empirical Bayes sample-size-adjusted score to flag sellers requiring operational investigation while avoiding unfair small-sample bias.',
    accessMode: 'READ_ONLY_SQL',
    parametersSummary: 'minOrderThreshold (1-20, default 3), limit (1-30, default 15)',
    sampleQuestion: 'Which sellers require further investigation?'
  },
  {
    name: 'get_executive_kpi_overview',
    displayName: 'Executive KPI & Dataset Inventory Summary',
    domain: 'Executive Overview',
    description:
      'Retrieves grain-safe platform KPIs (Total GMV, Freight Revenue, Total Order Value, Completed/Canceled Orders, AOV, Unique Customers, Repeat Rate, Avg Review Score, On-Time Delivery %) and DuckDB table inventory.',
    accessMode: 'READ_ONLY_SQL',
    parametersSummary: 'No required parameters',
    sampleQuestion: 'Summarize overall marketplace revenue, orders, and fulfillment health.'
  },
  {
    name: 'get_cohort_retention_summary',
    displayName: 'Monthly Customer Cohort Retention Matrix',
    domain: 'Customer Retention & Cohorts',
    description:
      'Retrieves monthly acquisition cohorts (customer_unique_id) and elapsed-month retention percentages, explicitly identifying right-censored unobserved future periods.',
    accessMode: 'READ_ONLY_SQL',
    parametersSummary: 'No required parameters',
    sampleQuestion: 'How well do monthly customer acquisition cohorts retain over time?'
  },
  {
    name: 'get_statistical_anomalies',
    displayName: 'Statistical Anomaly & Outlier Monitor',
    domain: 'Decision Lab & Anomaly Monitoring',
    description:
      'Runs leave-one-out Z-score and Tukey 1.5x IQR outlier detection across monthly revenue, late delivery SLA %, order cancellation %, review scores, and regional state SLA outliers.',
    accessMode: 'READ_ONLY_SQL',
    parametersSummary: 'domainFilter (ALL | Revenue | Logistics SLA | Cancellations | Customer Satisfaction, default ALL)',
    sampleQuestion: 'What statistical anomalies or operational spikes occurred across the last 24 months?'
  },
  {
    name: 'get_ab_cohort_comparison',
    displayName: 'A/B Cohort Statistical Hypothesis Test',
    domain: 'Experimentation & Hypothesis Lab',
    description:
      'Executes Welch two-sample t-tests or two-proportion z-tests with exact two-tailed p-values, 95% confidence intervals, Cohen d effect size, and achieved power across live DuckDB cohorts.',
    accessMode: 'READ_ONLY_SQL',
    parametersSummary:
      'presetId (on_time_vs_late | credit_card_vs_boleto | sp_vs_non_sp | installments_high_vs_single | low_freight_vs_high_freight | repeat_vs_first_time), metricKey (review_score | order_value | repeat_rate | on_time_rate)',
    sampleQuestion: 'Is the review score gap between on-time and late deliveries statistically significant?'
  }
];

export const BI_ANALYTICAL_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_highest_revenue_categories',
    description:
      'Get product categories ranked by revenue (GMV), unit volume, revenue share percentage, freight burden, and average review score from the DuckDB analytical database.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.INTEGER,
          description: 'Maximum number of categories to return (integer between 1 and 25). Defaults to 10.'
        },
        sortOrder: {
          type: Type.STRING,
          description: 'Sort direction by merchandise GMV: "DESC" for highest revenue or "ASC" for lowest revenue.'
        }
      }
    }
  },
  {
    name: 'get_at_risk_customers',
    description:
      'Get RFM customer segmentation results identifying At Risk, Cannot Lose Them, Hibernating, and other customer segments based on Recency, Frequency, and Monetary scores per customer_unique_id.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        segmentFilter: {
          type: Type.STRING,
          description:
            'Filter customers by segment: "AT_RISK_FOCUS" (returns At Risk, Cannot Lose Them, Hibernating), "ALL", or an exact segment name ("Champions", "Loyal Customers", "Potential Loyalists", "New Customers", "At Risk", "Cannot Lose Them", "Hibernating").'
        },
        limit: {
          type: Type.INTEGER,
          description: 'Maximum number of customer records to return (1 to 50). Defaults to 20.'
        }
      }
    }
  },
  {
    name: 'get_state_delivery_performance',
    description:
      'Get regional delivery SLA performance by customer state, including delivered orders, late orders, late delivery percentage, on-time percentage, average transit days, and mean review score.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        sortBy: {
          type: Type.STRING,
          description:
            'Sort metric: "LATE_RATE_DESC" (worst late delivery % first), "TRANSIT_DAYS_DESC" (longest transit duration first), or "ORDER_VOLUME_DESC".'
        },
        limit: {
          type: Type.INTEGER,
          description: 'Maximum number of states to return (1 to 30). Defaults to 15.'
        }
      }
    }
  },
  {
    name: 'get_monthly_revenue_changes',
    description:
      'Get chronological monthly revenue trends, order volumes, average order values, month-over-month (MoM) dollar and percentage deltas via SQL LAG(), and time-series forecast evaluation metrics.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.INTEGER,
          description: 'Maximum number of chronological months to return (1 to 36). Defaults to 18.'
        }
      }
    }
  },
  {
    name: 'get_low_review_associated_factors',
    description:
      'Investigate factors empirically associated with low customer review scores: delivery SLA delay correlation (Pearson r), on-time vs. late rating distributions, low-scoring product categories, and seller delivery/review metrics.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        scoreThreshold: {
          type: Type.INTEGER,
          description: 'Upper star threshold defining low reviews (integer between 1 and 4). Defaults to 3.'
        }
      }
    }
  },
  {
    name: 'get_sellers_requiring_investigation',
    description:
      'Evaluate sellers across revenue, order volume, average freight, on-time delivery %, raw review score, and Empirical Bayes sample-size-adjusted score to identify underperforming or anomalous sellers requiring investigation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        minOrderThreshold: {
          type: Type.INTEGER,
          description: 'Minimum distinct order count for official sample qualification (integer between 1 and 20). Defaults to 3.'
        },
        limit: {
          type: Type.INTEGER,
          description: 'Maximum number of sellers to return (1 to 30). Defaults to 15.'
        }
      }
    }
  },
  {
    name: 'get_executive_kpi_overview',
    description:
      'Retrieve verified platform-wide KPIs (GMV, freight revenue, total order value, completed/canceled orders, AOV, unique purchasing customers, repeat rate, average review score, on-time delivery %) and dataset table counts.'
  },
  {
    name: 'get_cohort_retention_summary',
    description:
      'Retrieve monthly customer acquisition cohort retention metrics, repeat rates, and dataset observation window right-censoring boundaries.'
  },
  {
    name: 'get_statistical_anomalies',
    description:
      'Detect statistically significant monthly anomalies (Z-score & Tukey IQR fences) in revenue, late delivery SLA rates, cancellation spikes, review score drops, and regional state outliers.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        domainFilter: {
          type: Type.STRING,
          description:
            'Optional filter: "ALL", "Revenue", "Logistics SLA", "Cancellations", or "Customer Satisfaction". Defaults to "ALL".'
        }
      }
    }
  },
  {
    name: 'get_ab_cohort_comparison',
    description:
      'Run a formal Welch t-test or two-proportion z-test comparing two live DuckDB marketplace cohorts with p-value, 95% CI, effect size, and statistical power.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        presetId: {
          type: Type.STRING,
          description:
            'Cohort comparison preset: "on_time_vs_late", "credit_card_vs_boleto", "sp_vs_non_sp", "installments_high_vs_single", "low_freight_vs_high_freight", or "repeat_vs_first_time". Defaults to "on_time_vs_late".'
        },
        metricKey: {
          type: Type.STRING,
          description:
            'Target metric: "review_score", "order_value", "repeat_rate", or "on_time_rate". Defaults to "review_score".'
        }
      }
    }
  }
];

const ALLOWED_TOOL_NAMES = new Set<ApprovedBiToolName>(
  APPROVED_BI_TOOLS_CATALOG.map((t) => t.name)
);

const ALLOWED_RFM_FILTERS = new Set([
  'ALL',
  'AT_RISK_FOCUS',
  'Champions',
  'Loyal Customers',
  'Potential Loyalists',
  'New Customers',
  'At Risk',
  'Cannot Lose Them',
  'Hibernating'
]);

const ALLOWED_STATE_SORTS = new Set([
  'LATE_RATE_DESC',
  'TRANSIT_DAYS_DESC',
  'ORDER_VOLUME_DESC'
]);

function parseBoundedInt(
  raw: unknown,
  defaultVal: number,
  minVal: number,
  maxVal: number,
  fieldName: string
): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: defaultVal };
  }
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return {
      ok: false,
      error: `Parameter "${fieldName}" must be an integer between ${minVal} and ${maxVal}.`
    };
  }
  if (num < minVal || num > maxVal) {
    return {
      ok: false,
      error: `Parameter "${fieldName}" (${num}) is out of allowed range [${minVal}, ${maxVal}].`
    };
  }
  return { ok: true, value: num };
}

export function validateToolParameters(
  rawToolName: string,
  rawArgs: Record<string, unknown> | undefined
): ToolValidationResult {
  const trimmedName = String(rawToolName || '').trim() as ApprovedBiToolName;
  if (!ALLOWED_TOOL_NAMES.has(trimmedName)) {
    return {
      valid: false,
      sanitizedArgs: {},
      error: `Tool "${rawToolName}" is not in the approved read-only analytical function registry.`
    };
  }

  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};

  switch (trimmedName) {
    case 'get_highest_revenue_categories': {
      const limitCheck = parseBoundedInt(args.limit, 10, 1, 25, 'limit');
      if (!limitCheck.ok) return { valid: false, sanitizedArgs: {}, error: limitCheck.error };
      const sortRaw = args.sortOrder ? String(args.sortOrder).toUpperCase().trim() : 'DESC';
      if (sortRaw !== 'DESC' && sortRaw !== 'ASC') {
        return {
          valid: false,
          sanitizedArgs: {},
          error: 'Parameter "sortOrder" must be "DESC" or "ASC".'
        };
      }
      return {
        valid: true,
        toolName: trimmedName,
        sanitizedArgs: { limit: limitCheck.value, sortOrder: sortRaw }
      };
    }

    case 'get_at_risk_customers': {
      const limitCheck = parseBoundedInt(args.limit, 20, 1, 50, 'limit');
      if (!limitCheck.ok) return { valid: false, sanitizedArgs: {}, error: limitCheck.error };
      const filterRaw = args.segmentFilter ? String(args.segmentFilter).trim() : 'AT_RISK_FOCUS';
      if (!ALLOWED_RFM_FILTERS.has(filterRaw)) {
        return {
          valid: false,
          sanitizedArgs: {},
          error: `Parameter "segmentFilter" ("${filterRaw}") is not an approved RFM segment filter.`
        };
      }
      return {
        valid: true,
        toolName: trimmedName,
        sanitizedArgs: { segmentFilter: filterRaw, limit: limitCheck.value }
      };
    }

    case 'get_state_delivery_performance': {
      const limitCheck = parseBoundedInt(args.limit, 15, 1, 30, 'limit');
      if (!limitCheck.ok) return { valid: false, sanitizedArgs: {}, error: limitCheck.error };
      const sortByRaw = args.sortBy ? String(args.sortBy).toUpperCase().trim() : 'LATE_RATE_DESC';
      if (!ALLOWED_STATE_SORTS.has(sortByRaw)) {
        return {
          valid: false,
          sanitizedArgs: {},
          error: `Parameter "sortBy" must be one of: ${Array.from(ALLOWED_STATE_SORTS).join(', ')}.`
        };
      }
      return {
        valid: true,
        toolName: trimmedName,
        sanitizedArgs: { sortBy: sortByRaw, limit: limitCheck.value }
      };
    }

    case 'get_monthly_revenue_changes': {
      const limitCheck = parseBoundedInt(args.limit, 18, 1, 36, 'limit');
      if (!limitCheck.ok) return { valid: false, sanitizedArgs: {}, error: limitCheck.error };
      return {
        valid: true,
        toolName: trimmedName,
        sanitizedArgs: { limit: limitCheck.value }
      };
    }

    case 'get_low_review_associated_factors': {
      const thresholdCheck = parseBoundedInt(args.scoreThreshold, 3, 1, 4, 'scoreThreshold');
      if (!thresholdCheck.ok) {
        return { valid: false, sanitizedArgs: {}, error: thresholdCheck.error };
      }
      return {
        valid: true,
        toolName: trimmedName,
        sanitizedArgs: { scoreThreshold: thresholdCheck.value }
      };
    }

    case 'get_sellers_requiring_investigation': {
      const minOrdCheck = parseBoundedInt(
        args.minOrderThreshold,
        3,
        1,
        20,
        'minOrderThreshold'
      );
      if (!minOrdCheck.ok) return { valid: false, sanitizedArgs: {}, error: minOrdCheck.error };
      const limitCheck = parseBoundedInt(args.limit, 15, 1, 30, 'limit');
      if (!limitCheck.ok) return { valid: false, sanitizedArgs: {}, error: limitCheck.error };
      return {
        valid: true,
        toolName: trimmedName,
        sanitizedArgs: {
          minOrderThreshold: minOrdCheck.value,
          limit: limitCheck.value
        }
      };
    }

    case 'get_executive_kpi_overview':
    case 'get_cohort_retention_summary':
      return {
        valid: true,
        toolName: trimmedName,
        sanitizedArgs: {}
      };

    case 'get_statistical_anomalies': {
      const allowedDomains = new Set([
        'ALL',
        'Revenue',
        'Logistics SLA',
        'Cancellations',
        'Customer Satisfaction'
      ]);
      const dom = args.domainFilter ? String(args.domainFilter).trim() : 'ALL';
      if (!allowedDomains.has(dom)) {
        return {
          valid: false,
          sanitizedArgs: {},
          error: `Parameter "domainFilter" must be one of: ${Array.from(allowedDomains).join(', ')}.`
        };
      }
      return {
        valid: true,
        toolName: trimmedName,
        sanitizedArgs: { domainFilter: dom }
      };
    }

    case 'get_ab_cohort_comparison': {
      const allowedPresets = new Set([
        'on_time_vs_late',
        'credit_card_vs_boleto',
        'sp_vs_non_sp',
        'installments_high_vs_single',
        'low_freight_vs_high_freight',
        'repeat_vs_first_time'
      ]);
      const allowedMetrics = new Set([
        'review_score',
        'order_value',
        'repeat_rate',
        'on_time_rate'
      ]);
      const presetId = args.presetId ? String(args.presetId).trim() : 'on_time_vs_late';
      const metricKey = args.metricKey ? String(args.metricKey).trim() : 'review_score';
      if (!allowedPresets.has(presetId)) {
        return {
          valid: false,
          sanitizedArgs: {},
          error: `Parameter "presetId" ("${presetId}") is not an approved cohort preset.`
        };
      }
      if (!allowedMetrics.has(metricKey)) {
        return {
          valid: false,
          sanitizedArgs: {},
          error: `Parameter "metricKey" ("${metricKey}") is not an approved test metric.`
        };
      }
      return {
        valid: true,
        toolName: trimmedName,
        sanitizedArgs: { presetId, metricKey }
      };
    }
  }
}

export async function executeApprovedBiTool(
  rawToolName: string,
  rawArgs?: Record<string, unknown>
): Promise<ApprovedToolExecutionOutput> {
  await duckdbEngine.ensureInitialized();
  const validation = validateToolParameters(rawToolName, rawArgs);
  if (!validation.valid || !validation.toolName) {
    throw new Error(validation.error || 'Tool parameter validation failed.');
  }

  const toolName = validation.toolName;
  const args = validation.sanitizedArgs;
  const meta = APPROVED_BI_TOOLS_CATALOG.find((t) => t.name === toolName)!;
  const dataOrigin = duckdbEngine.getDataMode();
  const start = performance.now();

  switch (toolName) {
    case 'get_highest_revenue_categories': {
      const limit = Number(args.limit);
      const sortDir = args.sortOrder === 'ASC' ? 'ASC' : 'DESC';
      const sql = `WITH order_review_avg AS (
  SELECT order_id, AVG(CAST(review_score AS DOUBLE)) AS order_review_score
  FROM fact_reviews
  GROUP BY order_id
),
cat_agg AS (
  SELECT
    foi.product_category_english AS category,
    COUNT(DISTINCT foi.order_id) AS distinct_orders,
    COUNT(foi.order_item_id) AS units_sold,
    ROUND(SUM(foi.gmv_merchandise), 2) AS merchandise_gmv,
    ROUND(SUM(foi.freight_revenue), 2) AS freight_revenue,
    ROUND(SUM(foi.total_line_value), 2) AS total_landed_revenue,
    ROUND(AVG(ora.order_review_score), 2) AS avg_review_score
  FROM fact_order_items foi
  INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
  LEFT JOIN order_review_avg ora ON fo.order_id = ora.order_id
  WHERE fo.order_status NOT IN ('canceled', 'unavailable')
  GROUP BY foi.product_category_english
)
SELECT
  category,
  distinct_orders,
  units_sold,
  merchandise_gmv,
  freight_revenue,
  total_landed_revenue,
  ROUND(merchandise_gmv * 100.0 / NULLIF(SUM(merchandise_gmv) OVER (), 0), 2) AS gmv_share_pct,
  avg_review_score
FROM cat_agg
ORDER BY merchandise_gmv ${sortDir}
LIMIT ${limit};`;

      const res = await duckdbEngine.executeReadOnlyQuery(sql, limit, false);
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      const topRow = res.rows[0] || null;
      const totalGmv = res.rows.reduce((s, r) => s + Number(r.merchandise_gmv || 0), 0);

      return {
        trace: {
          toolName,
          displayName: meta.displayName,
          validatedArgs: args,
          executedSql: sql,
          rowCount: res.rowCount,
          executionTimeMs: elapsed,
          dataOrigin,
          previewRows: res.rows.slice(0, 10),
          summaryMetrics: {
            categoriesReturned: res.rowCount,
            topCategory: topRow ? String(topRow.category) : 'None',
            topCategoryGmv: topRow ? Number(topRow.merchandise_gmv || 0) : 0,
            combinedMerchandiseGmv: Math.round(totalGmv * 100) / 100
          }
        },
        llmPayload: {
          tool: toolName,
          dataOrigin,
          filtersApplied: 'Excludes canceled and unavailable orders; grain-safe category aggregation',
          categoriesReturned: res.rowCount,
          rows: res.rows
        }
      };
    }

    case 'get_at_risk_customers': {
      const segmentFilter = String(args.segmentFilter);
      const limit = Number(args.limit);
      const suite = await computeAdvancedAnalyticsSuite();
      const rfm = suite.rfmSegmentation;
      const elapsed = Math.round((performance.now() - start) * 100) / 100;

      const atRiskSegments = new Set(['At Risk', 'Cannot Lose Them', 'Hibernating']);
      const matchedCustomers =
        segmentFilter === 'ALL'
          ? rfm.customerRecords
          : segmentFilter === 'AT_RISK_FOCUS'
            ? rfm.customerRecords.filter((c) => atRiskSegments.has(c.segment))
            : rfm.customerRecords.filter((c) => c.segment === segmentFilter);

      const previewRows = matchedCustomers.slice(0, limit).map((c) => ({
        customer_unique_id: c.customerUniqueId,
        location: `${c.customerCity}, ${c.customerState}`,
        recency_days: c.recencyDays,
        frequency: c.frequency,
        monetary_value: c.monetaryValue,
        rfm_code: c.rfmCode,
        segment: c.segment,
        rationale: c.segmentRationale
      }));

      return {
        trace: {
          toolName,
          displayName: meta.displayName,
          validatedArgs: args,
          executedSql: rfm.executedSql,
          rowCount: matchedCustomers.length,
          executionTimeMs: elapsed,
          dataOrigin,
          previewRows: previewRows.slice(0, 10),
          summaryMetrics: {
            anchorDate: rfm.anchorDate,
            totalUniqueCustomers: rfm.totalUniqueCustomers,
            matchedSegmentCustomers: matchedCustomers.length,
            atRiskOrHibernatingCount: rfm.customerRecords.filter((c) =>
              atRiskSegments.has(c.segment)
            ).length
          }
        },
        llmPayload: {
          tool: toolName,
          dataOrigin,
          anchorDate: rfm.anchorDate,
          totalUniqueCustomers: rfm.totalUniqueCustomers,
          scoringMethodology: rfm.scoringMethodology,
          segmentSummary: rfm.segmentSummary,
          matchedCustomers: previewRows,
          noteIfZeroAtRisk:
            matchedCustomers.length === 0
              ? 'No customers matched the strict filter; review segmentSummary and allCustomers for full RFM distribution.'
              : null,
          allCustomersOverview: rfm.customerRecords.slice(0, 15).map((c) => ({
            customer_unique_id: c.customerUniqueId,
            state: c.customerState,
            recency_days: c.recencyDays,
            frequency: c.frequency,
            monetary_value: c.monetaryValue,
            rfm_code: c.rfmCode,
            segment: c.segment
          }))
        }
      };
    }

    case 'get_state_delivery_performance': {
      const limit = Number(args.limit);
      const sortBy = String(args.sortBy);
      const orderByClause =
        sortBy === 'TRANSIT_DAYS_DESC'
          ? 'avg_delivery_days DESC, late_delivery_pct DESC'
          : sortBy === 'ORDER_VOLUME_DESC'
            ? 'delivered_orders DESC, late_delivery_pct DESC'
            : 'late_delivery_pct DESC, avg_delivery_days DESC';

      const sql = `SELECT
  fo.customer_state,
  COUNT(DISTINCT fo.order_id) AS delivered_orders,
  SUM(CASE WHEN fo.is_on_time = 1 THEN 1 ELSE 0 END) AS on_time_orders,
  SUM(CASE WHEN fo.is_on_time = 0 THEN 1 ELSE 0 END) AS late_orders,
  ROUND(AVG(CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END), 2) AS late_delivery_pct,
  ROUND(AVG(CASE WHEN fo.is_on_time = 1 THEN 100.0 ELSE 0.0 END), 2) AS on_time_delivery_pct,
  ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 2) AS avg_delivery_days,
  ROUND(AVG(DATE_DIFF('day', TRY_CAST(SUBSTR(CAST(fo.order_estimated_delivery_date AS VARCHAR), 1, 10) AS DATE), TRY_CAST(SUBSTR(CAST(fo.order_delivered_customer_date AS VARCHAR), 1, 10) AS DATE))), 2) AS avg_delay_vs_estimate_days,
  ROUND(AVG(CAST(fr.review_score AS DOUBLE)), 2) AS avg_review_score
FROM fact_orders fo
LEFT JOIN fact_reviews fr ON fo.order_id = fr.order_id
WHERE fo.order_status = 'delivered'
GROUP BY fo.customer_state
ORDER BY ${orderByClause}
LIMIT ${limit};`;

      const res = await duckdbEngine.executeReadOnlyQuery(sql, limit, false);
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      const worstState = res.rows[0] || null;

      return {
        trace: {
          toolName,
          displayName: meta.displayName,
          validatedArgs: args,
          executedSql: sql,
          rowCount: res.rowCount,
          executionTimeMs: elapsed,
          dataOrigin,
          previewRows: res.rows.slice(0, 10),
          summaryMetrics: {
            statesEvaluated: res.rowCount,
            worstLateState: worstState ? String(worstState.customer_state) : 'None',
            worstLateRatePct: worstState ? Number(worstState.late_delivery_pct || 0) : 0
          }
        },
        llmPayload: {
          tool: toolName,
          dataOrigin,
          scope: "Delivered orders only (order_status = 'delivered')",
          states: res.rows
        }
      };
    }

    case 'get_monthly_revenue_changes': {
      const limit = Number(args.limit);
      const sql = `WITH monthly_base AS (
  SELECT
    SUBSTR(CAST(fo.order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month,
    COUNT(DISTINCT fo.order_id) AS total_orders,
    COUNT(DISTINCT fo.customer_unique_id) AS unique_customers,
    ROUND(COALESCE(SUM(fo.gmv_merchandise), 0), 2) AS merchandise_gmv,
    ROUND(COALESCE(SUM(fo.freight_revenue), 0), 2) AS freight_revenue,
    ROUND(COALESCE(SUM(fo.total_order_value), 0), 2) AS total_revenue,
    ROUND(COALESCE(AVG(fo.total_order_value), 0), 2) AS avg_order_value
  FROM fact_orders fo
  WHERE fo.order_status NOT IN ('canceled', 'unavailable')
    AND fo.order_purchase_timestamp IS NOT NULL
  GROUP BY 1
)
SELECT
  order_month,
  total_orders,
  unique_customers,
  merchandise_gmv,
  freight_revenue,
  total_revenue,
  avg_order_value,
  LAG(total_revenue) OVER (ORDER BY order_month ASC) AS prev_month_revenue,
  ROUND(total_revenue - LAG(total_revenue) OVER (ORDER BY order_month ASC), 2) AS mom_revenue_delta,
  ROUND(
    CASE
      WHEN LAG(total_revenue) OVER (ORDER BY order_month ASC) > 0
      THEN ((total_revenue - LAG(total_revenue) OVER (ORDER BY order_month ASC)) / LAG(total_revenue) OVER (ORDER BY order_month ASC)) * 100.0
      ELSE NULL
    END,
    2
  ) AS mom_revenue_change_pct
FROM monthly_base
ORDER BY order_month ASC
LIMIT ${limit};`;

      const [res, suite] = await Promise.all([
        duckdbEngine.executeReadOnlyQuery(sql, limit, false),
        computeAdvancedAnalyticsSuite()
      ]);
      const elapsed = Math.round((performance.now() - start) * 100) / 100;

      const peakRow = res.rows.reduce<Record<string, string | number | boolean | null> | null>(
        (best, cur) =>
          !best || Number(cur.total_revenue || 0) > Number(best.total_revenue || 0) ? cur : best,
        null
      );
      const troughRow = res.rows.reduce<Record<string, string | number | boolean | null> | null>(
        (worst, cur) =>
          !worst || Number(cur.total_revenue || 0) < Number(worst.total_revenue || 0)
            ? cur
            : worst,
        null
      );

      return {
        trace: {
          toolName,
          displayName: meta.displayName,
          validatedArgs: args,
          executedSql: sql,
          rowCount: res.rowCount,
          executionTimeMs: elapsed,
          dataOrigin,
          previewRows: res.rows.slice(0, 12),
          summaryMetrics: {
            monthsAnalyzed: res.rowCount,
            peakMonth: peakRow ? String(peakRow.order_month) : 'N/A',
            peakRevenue: peakRow ? Number(peakRow.total_revenue || 0) : 0,
            lowestMonth: troughRow ? String(troughRow.order_month) : 'N/A',
            lowestRevenue: troughRow ? Number(troughRow.total_revenue || 0) : 0
          }
        },
        llmPayload: {
          tool: toolName,
          dataOrigin,
          monthlySeries: res.rows,
          forecastingBacktestContext: {
            trainRange: suite.salesForecasting.trainPeriodRange,
            testRange: suite.salesForecasting.testPeriodRange,
            olsSlopePerMonth: suite.salesForecasting.modelParameters.olsSlopePerMonth,
            modelMae: suite.salesForecasting.evaluationMetrics.modelMae,
            modelMapePct: suite.salesForecasting.evaluationMetrics.modelMapePct,
            baselineMae: suite.salesForecasting.evaluationMetrics.baselineMae,
            limitations: suite.salesForecasting.limitationsAndAssumptions
          }
        }
      };
    }

    case 'get_low_review_associated_factors': {
      const scoreThreshold = Number(args.scoreThreshold);
      const lowCatSql = `SELECT
  foi.product_category_english AS category,
  COUNT(DISTINCT fo.order_id) AS reviewed_orders,
  ROUND(AVG(CAST(fr.review_score AS DOUBLE)), 2) AS avg_review_score,
  SUM(CASE WHEN fr.review_score <= ${scoreThreshold} THEN 1 ELSE 0 END) AS low_review_orders,
  ROUND(AVG(CASE WHEN fr.review_score <= ${scoreThreshold} THEN 100.0 ELSE 0.0 END), 2) AS low_review_share_pct,
  ROUND(AVG(CASE WHEN fo.is_on_time = 0 THEN 100.0 ELSE 0.0 END), 2) AS late_delivery_pct
FROM fact_order_items foi
INNER JOIN fact_orders fo ON foi.order_id = fo.order_id
INNER JOIN fact_reviews fr ON fo.order_id = fr.order_id
WHERE fo.order_status NOT IN ('canceled', 'unavailable')
GROUP BY foi.product_category_english
ORDER BY avg_review_score ASC, low_review_share_pct DESC;`;

      const [suite, catRes] = await Promise.all([
        computeAdvancedAnalyticsSuite(),
        duckdbEngine.executeReadOnlyQuery(lowCatSql, 25, false)
      ]);
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      const ds = suite.deliverySatisfaction;

      return {
        trace: {
          toolName,
          displayName: meta.displayName,
          validatedArgs: args,
          executedSql: `${ds.executedSql}\n\n-- Category Low-Review Breakdown:\n${lowCatSql}`,
          rowCount: ds.performanceGroups.length + catRes.rowCount,
          executionTimeMs: elapsed,
          dataOrigin,
          previewRows: catRes.rows.slice(0, 10),
          summaryMetrics: {
            onTimeAvgReviewScore: ds.onTimeAvgReviewScore,
            lateAvgReviewScore: ds.lateAvgReviewScore,
            scoreDeltaOnTimeVsLate: ds.reviewScoreDeltaOnTimeVsLate,
            pearsonCorrelationR: ds.pearsonCorrelationDelayVsScore,
            evaluatedOrders: ds.totalEvaluatedOrders
          }
        },
        llmPayload: {
          tool: toolName,
          dataOrigin,
          scoreThresholdUsed: scoreThreshold,
          deliveryVsSatisfaction: {
            totalEvaluatedOrders: ds.totalEvaluatedOrders,
            onTimeOrderCount: ds.onTimeOrderCount,
            lateOrderCount: ds.lateOrderCount,
            onTimeAvgReviewScore: ds.onTimeAvgReviewScore,
            lateAvgReviewScore: ds.lateAvgReviewScore,
            scoreDegradationSpread: ds.reviewScoreDeltaOnTimeVsLate,
            pearsonCorrelationDelayVsScore: ds.pearsonCorrelationDelayVsScore,
            correlationStrengthLabel: ds.correlationStrengthLabel,
            performanceGroups: ds.performanceGroups,
            starDistributionComparison: ds.starDistributionComparison,
            correlationVsCausationAnalysis: ds.correlationVsCausationAnalysis
          },
          categoryLowReviewBreakdown: catRes.rows
        }
      };
    }

    case 'get_sellers_requiring_investigation': {
      const minOrderThreshold = Number(args.minOrderThreshold);
      const limit = Number(args.limit);
      const suite = await computeAdvancedAnalyticsSuite({ minSellerOrders: minOrderThreshold });
      const sp = suite.sellerPerformance;
      const elapsed = Math.round((performance.now() - start) * 100) / 100;

      // Sort by operational risk first (late orders / low on-time % / low review score) for investigation
      const sortedForInvestigation = [...sp.sellers]
        .sort((a, b) => {
          if (a.onTimeDeliveryPct !== b.onTimeDeliveryPct) {
            return a.onTimeDeliveryPct - b.onTimeDeliveryPct;
          }
          return a.bayesianAdjustedReviewScore - b.bayesianAdjustedReviewScore;
        })
        .slice(0, limit);

      const previewRows = sortedForInvestigation.map((s) => ({
        seller_id: s.sellerId,
        hub: `${s.sellerCity}, ${s.sellerState}`,
        distinct_orders: s.distinctOrders,
        seller_revenue: s.sellerRevenue,
        avg_freight: s.avgFreightPerItem,
        freight_ratio_pct: s.freightToRevenueRatioPct,
        on_time_delivery_pct: s.onTimeDeliveryPct,
        late_orders: s.lateOrderCount,
        avg_delivery_days: s.avgDeliveryDays,
        raw_review_score: s.rawAvgReviewScore,
        bayesian_score: s.bayesianAdjustedReviewScore,
        sample_status: s.sampleReliabilityStatus
      }));

      return {
        trace: {
          toolName,
          displayName: meta.displayName,
          validatedArgs: args,
          executedSql: sp.executedSql,
          rowCount: sortedForInvestigation.length,
          executionTimeMs: elapsed,
          dataOrigin,
          previewRows: previewRows.slice(0, 10),
          summaryMetrics: {
            totalActiveSellers: sp.totalActiveSellers,
            qualifiedSellersCount: sp.qualifiedSellersCount,
            smallSampleSellersCount: sp.smallSampleSellersCount,
            platformMeanScoreC: sp.platformMeanReviewScoreC,
            platformAvgOnTimePct: sp.platformAvgOnTimePct
          }
        },
        llmPayload: {
          tool: toolName,
          dataOrigin,
          minOrderThreshold: sp.minOrderThreshold,
          bayesianPriorWeightM: sp.bayesianPriorWeightM,
          platformMeanReviewScoreC: sp.platformMeanReviewScoreC,
          platformAvgOnTimePct: sp.platformAvgOnTimePct,
          smallSampleProtectionExplanation: sp.smallSampleProtectionExplanation,
          sellersSortedByRisk: sortedForInvestigation
        }
      };
    }

    case 'get_executive_kpi_overview': {
      const [kpis, statuses] = await Promise.all([
        duckdbEngine.getKpiDictionary(),
        duckdbEngine.getDatasetStatuses()
      ]);
      const elapsed = Math.round((performance.now() - start) * 100) / 100;

      const previewRows = kpis.map((k) => ({
        kpi_id: k.id,
        kpi_name: k.metricName,
        value: k.currentValue,
        unit: k.unit,
        grain_guard: k.grainAndJoinRule
      }));

      return {
        trace: {
          toolName,
          displayName: meta.displayName,
          validatedArgs: args,
          executedSql:
            '-- Executed grain-safe KPI Dictionary queries across fact_orders, fact_order_items, fact_reviews, and dim_customers\nSELECT * FROM fact_orders LIMIT 10;',
          rowCount: kpis.length,
          executionTimeMs: elapsed,
          dataOrigin,
          previewRows,
          summaryMetrics: {
            kpiCount: kpis.length,
            populatedTables: statuses.filter((s) => s.rowCount > 0).length,
            totalRows: statuses.reduce((s, t) => s + t.rowCount, 0)
          }
        },
        llmPayload: {
          tool: toolName,
          dataOrigin,
          tableInventory: statuses.map((s) => ({
            tableName: s.tableName,
            rowCount: s.rowCount,
            source: s.sourceLabel
          })),
          kpis: kpis.map((k) => ({
            id: k.id,
            name: k.metricName,
            value: k.currentValue,
            unit: k.unit,
            definition: k.businessDefinition,
            grainGuard: k.grainAndJoinRule
          }))
        }
      };
    }

    case 'get_cohort_retention_summary': {
      const suite = await computeAdvancedAnalyticsSuite();
      const ch = suite.cohortAnalysis;
      const elapsed = Math.round((performance.now() - start) * 100) / 100;

      const previewRows = ch.cohorts.map((c) => ({
        cohort_month: c.cohortMonth,
        cohort_size: c.cohortSize,
        initial_revenue: c.initialCohortRevenue,
        repeat_customers: c.cumulativeRepeatCustomers,
        repeat_rate_pct: c.cumulativeRepeatRatePct,
        max_observable_offset_months: c.maxObservableOffset
      }));

      return {
        trace: {
          toolName,
          displayName: meta.displayName,
          validatedArgs: args,
          executedSql: ch.executedSql,
          rowCount: ch.cohorts.length,
          executionTimeMs: elapsed,
          dataOrigin,
          previewRows,
          summaryMetrics: {
            totalCohorts: ch.totalCohorts,
            datasetWindow: `${ch.datasetStartMonth} to ${ch.datasetEndMonth}`,
            overallRepeatRatePct: ch.overallRepeatCustomerRatePct
          }
        },
        llmPayload: {
          tool: toolName,
          dataOrigin,
          datasetStartMonth: ch.datasetStartMonth,
          datasetEndMonth: ch.datasetEndMonth,
          overallRepeatCustomerRatePct: ch.overallRepeatCustomerRatePct,
          methodology: ch.methodology,
          observationWindowNotice: ch.observationWindowNotice,
          cohorts: ch.cohorts
        }
      };
    }

    case 'get_statistical_anomalies': {
      const domainFilter = String(args.domainFilter || 'ALL');
      const payload = await computeAnomalyAlerts();
      const elapsed = Math.round((performance.now() - start) * 100) / 100;
      const filtered =
        domainFilter === 'ALL'
          ? payload.anomalies
          : payload.anomalies.filter((a) => a.domain === domainFilter);

      const previewRows = filtered.slice(0, 10).map((a) => ({
        period: a.period,
        domain: a.domain,
        metric: a.metricLabel,
        observed: a.formattedObserved,
        baseline: a.formattedBaseline,
        z_score: a.zScore,
        severity: a.severity,
        direction: a.direction
      }));

      return {
        trace: {
          toolName,
          displayName: meta.displayName,
          validatedArgs: args,
          executedSql:
            filtered[0]?.sqlLineage ||
            'SELECT SUBSTR(CAST(order_purchase_timestamp AS VARCHAR), 1, 7) AS order_month, COUNT(*) AS orders FROM fact_orders GROUP BY 1 ORDER BY 1;',
          rowCount: filtered.length,
          executionTimeMs: elapsed,
          dataOrigin,
          previewRows,
          summaryMetrics: {
            monthsEvaluated: payload.monthsEvaluated,
            totalAnomalies: filtered.length,
            highSeverityCount: filtered.filter((a) => a.severity === 'HIGH').length,
            topZScore: filtered[0]?.zScore ?? 0
          }
        },
        llmPayload: {
          tool: toolName,
          dataOrigin,
          monthsEvaluated: payload.monthsEvaluated,
          methodology: payload.methodologyNote,
          anomalies: filtered,
          recentMonthlySeries: payload.monthlySeries.slice(-12)
        }
      };
    }

    case 'get_ab_cohort_comparison': {
      const presetId = String(args.presetId || 'on_time_vs_late') as
        | 'on_time_vs_late'
        | 'credit_card_vs_boleto'
        | 'sp_vs_non_sp'
        | 'installments_high_vs_single'
        | 'low_freight_vs_high_freight'
        | 'repeat_vs_first_time';
      const metricKey = String(args.metricKey || 'review_score') as
        | 'review_score'
        | 'order_value'
        | 'repeat_rate'
        | 'on_time_rate';
      const result = await runAbCohortHypothesisTest({ presetId, metricKey, alpha: 0.05 });
      const elapsed = Math.round((performance.now() - start) * 100) / 100;

      const previewRows = [
        {
          arm: result.control.label,
          sample_size: result.control.sampleSize,
          metric_value: result.control.value,
          std_dev: result.control.stdDev
        },
        {
          arm: result.variant.label,
          sample_size: result.variant.sampleSize,
          metric_value: result.variant.value,
          std_dev: result.variant.stdDev
        }
      ];

      return {
        trace: {
          toolName,
          displayName: meta.displayName,
          validatedArgs: args,
          executedSql: result.executedSql || '-- Custom hypothesis test',
          rowCount: 2,
          executionTimeMs: elapsed,
          dataOrigin,
          previewRows,
          summaryMetrics: {
            testMethod: result.testMethod,
            relativeLiftPct: result.relativeLiftPct,
            pValue: result.pValue,
            cohensD: result.cohensD,
            achievedPowerPct: result.achievedPowerPct,
            verdict: result.verdict
          }
        },
        llmPayload: {
          tool: toolName,
          dataOrigin,
          result
        }
      };
    }
  }
}
