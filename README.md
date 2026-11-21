# RetailPulse Enterprise — E-Commerce BI, OLAP Warehousing & Decision Intelligence Platform

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white)
![DuckDB](https://img.shields.io/badge/DuckDB-Persistent_OLAP-FFF000?style=flat-square&logo=duckdb&logoColor=black)
![Express](https://img.shields.io/badge/Node.js-Express_API-339933?style=flat-square&logo=node.js&logoColor=white)
![Tests](https://img.shields.io/badge/Automated_Tests-34%2F34_Passing-137333?style=flat-square)
![Gemini](https://img.shields.io/badge/AI_Agent-Grounded_Tool_Calling-4285F4?style=flat-square&logo=google&logoColor=white)

> **RetailPulse Enterprise** is a production-grade, full-stack **Business Intelligence (BI)**, **OLAP Data Warehousing**, **Statistical Experimentation**, and **Grounded AI Analytics** platform built on a persistent **DuckDB** columnar engine, **Node.js / Express + TypeScript**, **React 19 + Recharts**, and **Gemini function calling**.

Unlike static dashboard demos backed by mock JSON arrays, **every KPI, chart, anomaly alert, root-cause attribution, A/B hypothesis test, and AI answer in RetailPulse is computed live via auditable SQL against a 9-table Star Schema warehouse** (seeded with a 5,300-order, 24-month, 27,687-row benchmark dataset and supporting drag-and-drop ingestion of real Kaggle Olist CSVs).

---

## 60-Second Recruiter Tour

If you have 60 seconds to evaluate this repository live:

1. **Explore Live BI Dashboards (`/dashboards`)** — Switch across **6 live workspaces** (`Executive`, `Sales`, `Customers`, `Products`, `Delivery`, `Satisfaction`). Click the `i` icon on any KPI to inspect its **grain rule + reproducible DuckDB SQL**, click any chart slice to trigger a **live granular drill-down**, or apply cross-dashboard filters (`State: SP`, `Category`, `Date`) with 1-click active filter chips.
2. **Run Automated Root-Cause Attribution & Monte Carlo Risk Simulation (`/decision-lab`)** — Inspect statistically detected **Z-score & Tukey IQR anomalies**, click **`Auto-Investigate`** to decompose variance across **Product Category, Brazilian State, Payment Method, and Seller** in `< 300 ms`, run the **5,000-Trial Monte Carlo What-If Simulator (P10 / P50 / P90 confidence bands)**, and test the **Welch’s t-test A/B Hypothesis Lab**.
3. **Inspect Econometric Models (`/analytics`)** — Review **RFM Customer Segmentation**, **Right-Censored Cohort Retention**, **Empirical Bayes Seller Ranking**, **Delivery-Delay Correlation**, and **Chronological Train/Test Demand Forecasting**.
4. **Query & Profile DuckDB Directly (`/sql-lab`)** — Run any of the **36 curated analytical SQL queries** (CTEs, window functions, cohort SQL), click **`Explain Plan`** to inspect live **DuckDB `EXPLAIN ANALYZE` operator CPU flame-bars & tuning hints**, execute **5 independent-calculation acceptance benchmarks**, or test the read-only SQL security guard by trying `DROP TABLE orders;`.
5. **Audit Data Lineage & Quality (`/data-quality`)** — Explore the interactive **Visual Data Lineage DAG** (`Staging → Core → Star Schema → Governed KPIs`), inject synthetic data-quality faults, and run **1-click SQL remediation**.
6. **Ask the Grounded AI Assistant (`/business-insights`)** — Ask natural-language business questions; watch live server-sent reasoning traces execute **10 approved read-only DuckDB tools** with zero hallucinated numbers.
7. **Export an Executive Board Pack (`/reports-exports`)** — Generate a publication-ready Executive Board Report with 1-click HTML or print-to-PDF export.
8. **Press `⌘K` / `Ctrl+K` or `[`** — Deep-link anywhere via the keyboard command palette or collapse the Material 3 navigation rail.

---

## System Architecture

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                     React 19 + TypeScript + Tailwind v4 UI                   │
│   Collapsible Material 3 Rail ([) · 4 Google Palettes · ⌘K Deep-Link Jump   │
│   6 BI Dashboards · Decision Lab · 6 Models · SQL Studio · Visual Lineage    │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ REST JSON & Server-Sent Events (/api/*)
┌──────────────────────────────────────▼───────────────────────────────────────┐
│                      Node.js + Express + TypeScript API                      │
│  ┌──────────────────────┐  ┌─────────────────────────┐  ┌─────────────────┐ │
│  │ Read-Only SQL Guard  │  │ Decision Lab & Models   │  │ Gemini BI Agent │ │
│  │ & CSV ETL Validator  │  │ Z/IQR · Root-Cause RCA  │  │ 10 Approved     │ │
│  │ (Zero DDL/DML/Inj.)  │  │ Welch t-test · What-If  │  │ Read-Only Tools │ │
│  └──────────┬───────────┘  └────────────┬────────────┘  └────────┬────────┘ │
└─────────────┼───────────────────────────┼────────────────────────┼──────────┘
              └───────────────────────────┼────────────────────────┘
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│            Persistent File-Backed DuckDB Warehouse (data/*.duckdb)           │
│  Layer 1: Raw Staging (stg_*) + Quarantine Audit (audit_rejected_records)    │
│  Layer 2: 9 Cleaned Relational Tables (Olist E-Commerce Schema)              │
│  Layer 3: 9 Star-Schema Analytical Views (fact_* & dim_*) + 10 Governed KPIs │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Engineering & Grain-Safety Design

E-commerce datasets like Olist contain a classic analytics trap: **join fan-out revenue inflation**. A single `order_id` can link to *M* rows in `order_items` and *P* rows in `order_payments`. A naive `JOIN` multiplies revenue by *M × P*.

**How RetailPulse guarantees metric integrity structurally:**

| Engineering Problem | Production Solution Implemented in DuckDB |
| :--- | :--- |
| **Multi-Item × Multi-Payment Fan-Out** | `fact_orders` and `vw_order_grain_summary` pre-aggregate item totals and payment settlements independently at the `order_id` grain before joining. Verified by unit & integration tests (`2 items × 2 payments = exact settled value`). |
| **Transient vs. Permanent Customer Keys** | In Olist, `customer_id` is regenerated per order. All repeat-rate, RFM, and cohort models strictly aggregate on `customer_unique_id` (verified by the live **Customer Identity Audit**). |
| **Right-Censored Retention Bias** | Monthly cohort matrices explicitly track observation boundaries and mark future offsets as unobserved instead of falsely reporting `0%` retention. |
| **Small-Sample Seller Ranking Noise** | Seller quality leaderboards apply **Empirical Bayes shrinkage** (`(n·r̄ + m·μ) / (n + m)`) to prevent `n = 1` five-star sellers from outranking high-volume reliable merchants. |
| **Dirty CSV Onboarding** | Raw uploads land in `stg_*` tables first; schema validation quarantines duplicate PKs, missing foreign keys, and malformed dates into `audit_rejected_records` without crashing the warehouse. |
| **Read-Only SQL & AI Security** | Multi-layer AST/regex validation blocks stacked queries, DDL, DML, `COPY`, `ATTACH`, and SQL injection across both SQL Studio and all 10 Gemini BI Assistant tools. |
| **High-Scale Traffic & Large Datasets** | Dedicated 4-connection DuckDB read pool, out-of-core memory/disk spilling (`memory_limit` + `temp_directory`), single-flight epoch-versioned LRU cache, exclusive write mutex with 1,000-row transactional chunked CSV ingestion, SQL `LIMIT` pushdown + `15s` query timeout interrupts, tiered token-bucket rate limiters, concurrency bulkheads, route-scoped upload limits, and native `gzip` JSON compression. |

### Star Schema Views (`server/db/analyticalModels.ts`)

| Layer | Views / Tables | Grain / Purpose |
| :--- | :--- | :--- |
| **Fact Views** | `fact_orders`, `fact_order_items`, `fact_payments`, `fact_reviews` | Order-grain GMV/SLA (`1 row / order_id`), line-item pricing/freight, payment installments, and customer review scores. |
| **Dimension Views** | `dim_customers`, `dim_products`, `dim_sellers`, `dim_date`, `dim_geography` | Deduplicated permanent customer entities, English-translated product categories, seller geography, calendar hierarchy, and ZIP/state lookup. |
| **Governance & Audit** | `vw_order_grain_summary`, `audit_rejected_records`, `sql_custom_queries`, `sql_execution_history` | Fan-out verification, ETL quarantine log, durable saved queries, and full SQL audit trail. |

---

## Statistical & Automation Methodology

1. **Leave-One-Out Z-Score + Tukey IQR Anomaly Engine**: Computes leave-one-out mean and standard deviation per period (so an extreme seasonal spike cannot inflate its own denominator and mask itself) alongside Tukey `1.5×IQR` fences across monthly revenue, late-delivery rate, cancellation rate, review score, and regional state SLA distributions.
2. **Automated Anomaly-to-Root-Cause Attribution (`POST /api/analytics/anomalies/investigate`)**: Executes parallel DuckDB variance queries slicing any anomalous period against its leave-one-out baseline across **Product Category**, **Brazilian State**, **Payment Method**, and **Seller**, outputting each segment's absolute delta (`Δ`), volume-weighted variance contribution share (`%`), **Top-3 Concentration (`%`)**, executive synthesis, and auditable SQL.
3. **Frequentist A/B Hypothesis Testing (`POST /api/analytics/ab-test`)**: Implements exact two-tailed Student’s *t* *p*-values via regularized incomplete beta continued fractions (**Welch’s unequal-variance t-test**), **Two-Proportion Z-test**, Cohen’s *d* / *h* effect sizes, 95% confidence intervals, achieved power, and an 80%-power MDE sample-size curve.
4. **Probabilistic Monte Carlo What-If Simulator (`POST /api/analytics/simulate`)**: Anchors operational levers (SLA late-delivery reduction, freight optimization, repeat-rate lift, cancellation recovery) to live DuckDB baselines and executes a **deterministic 5,000-trial Box-Muller Gaussian Monte Carlo simulation** outputting P10 / P50 / P90 annual GMV lift bands, exceedance probabilities (`P(Lift > $0 / $50K / $100K)`), and a 20-bin density histogram.
5. **Native DuckDB `EXPLAIN ANALYZE` Query Plan Profiler (`POST /api/sql/explain`)**: Executes `EXPLAIN (ANALYZE, FORMAT JSON)` on validated read-only SQL, parsing the physical operator tree (`SEQ_SCAN`, `HASH_JOIN`, `HASH_GROUP_BY`, `PROJECTION`, `TOP_N`) into per-operator ms timings, CPU share flame-bars, scan cardinalities, hotspot bottlenecks, and automated SQL optimization hints.

---

## Complete REST API Reference (32 Endpoints)

| Domain | Endpoints |
| :--- | :--- |
| **Health & Warehouse** | `GET /api/health` · `GET /api/warehouse/persistence` |
| **Datasets & CSV ETL** | `GET /api/datasets` · `GET /api/datasets/ingestion-summary` · `POST /api/datasets/upload-csv` · `POST /api/datasets/seed-demo` · `POST /api/datasets/clear` |
| **BI Dashboards** | `GET /api/dashboards/filter-options` · `GET /api/dashboards/:dashboardId` · `POST /api/dashboards/drilldown` · `GET /api/modules/:moduleId/preview` |
| **Decision Lab & Automation** | `GET /api/analytics/anomalies` · `POST /api/analytics/anomalies/investigate` · `GET /api/analytics/simulate/baseline` · `POST /api/analytics/simulate` · `POST /api/analytics/ab-test` |
| **Statistical Models** | `GET /api/analytics/advanced` |
| **SQL Studio & Query Profiler** | `POST /api/sql/execute` · `POST /api/sql/explain` · `GET /api/sql/workspace` · `POST /api/sql/saved` · `DELETE /api/sql/saved/:id` · `GET /api/sql/verify-benchmarks` |
| **Governance, Quality & Lineage** | `GET /api/models` · `GET /api/kpis/dictionary` · `GET /api/quality` · `GET /api/quality/dashboard` · `POST /api/quality/remediate` · `POST /api/quality/inject-anomalies` · `GET /api/governance/lineage` |
| **AI Assistant & Board Reports** | `GET /api/assistant/tools` · `POST /api/assistant/ask` · `POST /api/assistant/ask-stream` (SSE) · `POST /api/assistant/tools/preview` · `GET /api/reports/executive` |

---

## Repository Structure

```text
├── server.ts                         # Express + Vite unified full-stack entry point (port 3000)
├── server/
│   ├── db/
│   │   ├── duckdbEngine.ts           # Persistent DuckDB engine, CSV ETL, quarantine, SQL guard
│   │   ├── seedDemoData.ts           # Deterministic 5,300-order, 24-month benchmark generator
│   │   ├── analyticalModels.ts       # 9 Star-Schema views + 10 governed KPI definitions
│   │   ├── biDashboardEngine.ts      # 6 BI Dashboards + synchronized filters + live drill-downs
│   │   ├── advancedAnalyticsEngine.ts# RFM, Cohorts, Bayesian Sellers, Opportunities, Forecasting
│   │   ├── decisionLabEngine.ts      # Anomaly Z/IQR, Root-Cause RCA, What-If, Welch A/B, Lineage, Report
│   │   └── duckdbEngine.test.ts      # 22 end-to-end DuckDB, high-scale stress, Monte Carlo, Explain Plan & durability tests
│   ├── routes/api.ts                 # 32 REST + SSE endpoints with single-flight caching, rate limits & bulkheads
│   └── services/
│       ├── resilienceLayer.ts        # Single-flight LRU cache, token-bucket rate limiters, bulkheads, native gzip
│       ├── biAnalyticalTools.ts      # 10 approved, parameter-validated read-only DuckDB AI tools
│       ├── biAssistantService.ts     # Grounded Gemini orchestration + empty-warehouse guard
│       └── geminiService.ts          # Server-side @google/genai client wrapper
├── src/
│   ├── components/
│   │   ├── layout/                   # TopHeader, collapsible Sidebar rail, AppShell + Theme Popover
│   │   └── ui/                       # BiDashboardWorkspace, CommandPalette, ArchitectureDrawer, ErrorBoundary
│   ├── config/                       # 36 curated SQL queries (sqlCatalog.ts), module registry, themes
│   ├── context/                      # PlatformContext (global filters/warehouse), ThemeContext
│   ├── pages/                        # DashboardsHub, AdvancedAnalytics, DecisionLab, BusinessInsights, SqlLab, DataManagement, DataQuality, ReportsExports
│   ├── services/apiClient.ts         # Typed REST & SSE streaming client
│   ├── types/analytics.ts            # Shared strict TypeScript contracts (frontend + backend)
│   └── utils/
│       ├── validators.ts             # Read-only SQL parser, CSV schema detector, date/metric formatters
│       └── validators.test.ts        # 12 frontend/shared unit tests
└── data/                             # Persistent DuckDB warehouse file (created automatically at runtime)
```

---

## Automated Test Suite (`34 / 34 Passing`)

Running `npm test` executes both shared validator unit tests and full DuckDB backend integration tests:

- **12 Unit & Validation Tests** (`src/utils/validators.test.ts`): UTF-8 BOM stripping, Olist CSV auto-detection across all 9 schemas, strict date validation, read-only SQL allow/block rules, CSV escaping, and metric formatting.
- **22 Full-Stack OLAP, Concurrency Stress & Statistical Integration Tests** (`server/db/duckdbEngine.test.ts`):
  - Persistent `.duckdb` file durability across close & reopen (orders + custom saved SQL queries)
  - **50-way concurrent OLAP & BI dashboard burst** verifying multi-connection DuckDB read pool parallelism
  - **25-way thundering-herd single-flight LRU cache coalescing**, instant epoch invalidation, and concurrency bulkhead load shedding
  - **10,000-row chunked transactional CSV ingestion** running simultaneously with a 500-row upload serialized cleanly via the write mutex
  - 8-table CSV ingestion, rejected-row quarantine (`DUPLICATE_PRIMARY_KEY`, `INVALID_DATE_FORMAT`, `MISSING_REQUIRED_KEY`), and 7/7 foreign-key verification
  - Exact multi-item × multi-payment **grain-safety verification** (no fan-out revenue double-counting)
  - All 9 Star-Schema views, 10 KPI Dictionary scalar SQL checks, and `customer_unique_id` identity audit
  - Data quality fault injection + automated SQL remediation returning to `100%`
  - Execution of all **36 curated SQL queries** + **5 independent-calculation parity benchmarks** + **DuckDB `EXPLAIN (ANALYZE, FORMAT JSON)` physical query plan profiler**
  - All **6 BI Dashboards**, dynamic cross-filtering, and granular drill-downs
  - All **6 Econometric & Forecasting models** (including right-censoring and Bayesian shrinkage)
  - All **10 Gemini BI Tools**, SQL-injection parameter rejection, and empty-warehouse anti-hallucination guard
  - **Welch’s t-test**, **Two-Proportion Z-test**, **Leave-One-Out Z/IQR Anomaly Detection**, **Automated Root-Cause Attribution**, **5,000-Trial Monte Carlo What-If Simulator**, **Visual Lineage DAG**, and **Executive Board Report**

---

## Local Setup & Commands

### Prerequisites
- **Node.js 20+**
- *(Optional)* `GEMINI_API_KEY` in `.env` (see `.env.example`) for the live **AI Business Assistant**. All DuckDB dashboards, SQL Studio, Decision Lab, Automated Root-Cause Attribution, Statistical Models, Lineage DAG, and Board Reports run **100% locally with zero external API keys**.

### Quickstart

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd retailpulse-enterprise

# 2. Install dependencies
npm install

# 3. (Optional) Configure Gemini API key for AI Assistant
cp .env.example .env

# 4. Launch full-stack dev server (Express API + Vite SPA on http://localhost:3000)
npm run dev

# 5. Run all 34 frontend + DuckDB backend automated tests
npm test

# 6. Type-check and compile production bundle
npm run lint
npm run build
```

---

## Tech Stack

- **OLAP Storage & Query Engine**: DuckDB (`@duckdb/node-api`, columnar vectorized execution, `EXPLAIN ANALYZE` plan profiling, file-backed `.duckdb` persistence)
- **Backend**: Node.js, Express 4, TypeScript, `csv-parse`, `@google/genai`
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Recharts, Lucide Icons, React Router v7
- **Testing & Quality**: Node native `node:test` + `tsx --test`, strict TypeScript (`tsc --noEmit`)

---

## Resume Bullet Points (Ready to Copy)

- **Architected RetailPulse Enterprise**, a full-stack e-commerce BI & decision analytics platform built with **persistent DuckDB**, **TypeScript/Express**, and **React 19**, modeling a 9-table Star Schema (`fact_orders` at `order_id` grain) that eliminates multi-item/multi-payment join fan-out inflation.
- **Engineered an Automated Anomaly-to-Root-Cause Attribution Engine** combining leave-one-out Z-score / Tukey `1.5×IQR` detection with parallel multi-dimensional DuckDB variance decomposition (Category, State, Payment Method, Seller) to quantify exact driver contribution shares in `< 300 ms`.
- **Built a Probabilistic Decision Lab & Query Plan Profiler** implementing a **5,000-trial Box-Muller Monte Carlo What-If Simulator** (P10/P50/P90 risk distributions), Welch’s unequal-variance *t*-test, 80%-power MDE curves, and a **BigQuery-style DuckDB `EXPLAIN ANALYZE` physical operator profiler** with CPU flame-bars and automated tuning hints.
- **Engineered High-Scale Concurrency & Large-Dataset Resilience** with a 4-connection DuckDB read pool, out-of-core disk spilling, single-flight epoch-versioned LRU caching, chunked transactional CSV ingestion serialized via write mutex, tiered token-bucket rate limiting, concurrency bulkheads, and **34 automated tests** verifying concurrent load bursts, SQL safety, independent calculation parity, and persistent warehouse durability.
