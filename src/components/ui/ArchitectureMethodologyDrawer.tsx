import React, { useEffect, useState } from 'react';
import {
  BrainCircuit,
  Database,
  FlaskConical,
  HardDrive,
  Layers,
  ShieldCheck,
  X
} from 'lucide-react';
import { WarehousePersistenceStatus } from '../../types/analytics';
import { apiClient } from '../../services/apiClient';

interface ArchitectureMethodologyDrawerProps {
  open: boolean;
  onClose: () => void;
}

export const ArchitectureMethodologyDrawer: React.FC<ArchitectureMethodologyDrawerProps> = ({
  open,
  onClose
}) => {
  const [persistence, setPersistence] = useState<WarehousePersistenceStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    apiClient
      .getWarehousePersistence()
      .then((res) => {
        if (active && res.data) setPersistence(res.data);
      })
      .catch(() => {
        // Silent fail; drawer displays architectural specs regardless
      });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      active = false;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end no-print"
      role="dialog"
      aria-modal="true"
      aria-label="Architecture and Analytical Methodology"
    >
      <div
        className="fixed inset-0 bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-xl h-full bg-[var(--rp-surface)] border-l border-[var(--rp-border)] shadow-2xl flex flex-col overflow-hidden">
        <div className="google-spectrum-bar shrink-0" />

        <div className="px-6 py-4 border-b border-[var(--rp-border)] flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--rp-ink)]">
              Architecture &amp; Analytical Methodology
            </h2>
            <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5">
              Production engineering specs, grain contracts, statistical formulas, and AI guardrails.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close architecture drawer"
            className="p-1.5 rounded-lg text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-subtle)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-xs">
          {/* Live Warehouse Persistence Status */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--rp-primary)] flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" />
              <span>1. Persistent DuckDB Analytical Engine</span>
            </h3>
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)]">
              <div>
                <div className="text-[11px] text-[var(--rp-ink-muted)]">Storage Mode</div>
                <div className="font-mono font-semibold text-[var(--rp-ink)] mt-0.5">
                  {persistence?.storageMode === 'PERSISTENT_FILE'
                    ? 'Persistent File (.duckdb)'
                    : 'In-Memory Session'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--rp-ink-muted)]">File Path / Footprint</div>
                <div className="font-mono font-semibold text-[var(--rp-ink)] mt-0.5 truncate">
                  {persistence
                    ? `${persistence.dbFilePath}${persistence.fileSizeBytes > 0 ? ` (${(persistence.fileSizeBytes / 1024).toFixed(0)} KB)` : ''}`
                    : 'Loading...'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--rp-ink-muted)]">Active Scale</div>
                <div className="font-mono font-semibold tabular-nums text-[var(--rp-ink)] mt-0.5">
                  {persistence
                    ? `${persistence.totalOrders.toLocaleString()} orders · ${persistence.totalRows.toLocaleString()} rows`
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--rp-ink-muted)]">Durable Saved SQL</div>
                <div className="font-mono font-semibold tabular-nums text-[var(--rp-ink)] mt-0.5">
                  {persistence ? `${persistence.savedCustomQueriesCount} custom queries` : '—'}
                </div>
              </div>
            </div>
            <p className="text-[var(--rp-ink-secondary)] leading-relaxed">
              Warehouse tables, rejected-record audits, warehouse metadata (<code>_rp_warehouse_meta</code>), and analyst saved queries (<code>_rp_saved_queries</code>) persist on disk across server restarts. Default seed provides a deterministic 5,200-order, 24-month benchmark dataset with realistic Q4 seasonality, 26% repeat buyers, and 3 planted operational anomalies.
            </p>
          </section>

          {/* Medallion & Fanout Prevention */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#9334E6] flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              <span>2. Medallion Lakehouse &amp; Zero-Fanout Star Schema</span>
            </h3>
            <ul className="space-y-1.5 text-[var(--rp-ink-secondary)] leading-relaxed">
              <li>
                <strong className="text-[var(--rp-ink)]">Bronze (stg_*):</strong> Raw CSV landing tables preserve source filenames, row numbers, and ingestion batch IDs with zero silent row drops.
              </li>
              <li>
                <strong className="text-[var(--rp-ink)]">Silver (Core 9 Tables):</strong> Enforces primary keys, type coercion, ISO date parsing, and quarantines malformed rows into <code>audit_rejected_records</code>.
              </li>
              <li>
                <strong className="text-[var(--rp-ink)]">Gold (9 Star Schema Views):</strong> Pre-aggregates <code>order_items</code> (1:N) and <code>payments</code> (1:N) in isolated CTEs at <code>order_id</code> grain before joining <code>fact_orders</code>, guaranteeing zero revenue double-counting. Resolves order-scoped <code>customer_id</code> to permanent <code>customer_unique_id</code> in <code>dim_customers</code>.
              </li>
            </ul>
          </section>

          {/* Statistical Rigor */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#1E8E3E] flex items-center gap-1.5">
              <FlaskConical className="w-3.5 h-3.5" />
              <span>3. Statistical &amp; Econometric Methodology</span>
            </h3>
            <ul className="space-y-1.5 text-[var(--rp-ink-secondary)] leading-relaxed">
              <li>
                <strong className="text-[var(--rp-ink)]">Anomaly Detection:</strong> Leave-one-out Z-score (prevents extreme spikes from inflating baseline σ) paired with Tukey 1.5×IQR fences across Revenue, Late Delivery SLA %, Cancellation %, and Review Scores.
              </li>
              <li>
                <strong className="text-[var(--rp-ink)]">A/B Hypothesis Lab:</strong> Welch’s unequal-variance two-sample t-test (Welch–Satterthwaite degrees of freedom + exact regularized incomplete beta p-value) and two-proportion z-test with 95% CIs, Cohen’s d/h, achieved power, and 80%-power MDE sample-size curves.
              </li>
              <li>
                <strong className="text-[var(--rp-ink)]">Seller Shrinkage &amp; Forecasting:</strong> Empirical Bayes review adjustment <code>(v/(v+m))·R + (m/(v+m))·C</code> protects against small-sample bias; Holt-Winters / OLS forecasting evaluates MAE &amp; MAPE strictly on chronological holdouts.
              </li>
            </ul>
          </section>

          {/* Zero-Hallucination AI Guardrails */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#E37400] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>4. Zero-Hallucination Gemini BI Architecture</span>
            </h3>
            <p className="text-[var(--rp-ink-secondary)] leading-relaxed">
              The conversational BI Assistant runs strictly server-side via <code>@google/genai</code> function calling over 10 parameter-validated, read-only DuckDB analytical tools (including Anomaly Detection and A/B Hypothesis testing). Every claim is bound to inspectable SQL traces, distinguishes observational correlation from causation, and supports fast primary failover + SSE streaming resilience.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
