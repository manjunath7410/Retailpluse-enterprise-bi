import React from 'react';
import { Link } from 'react-router-dom';
import { Database, RotateCcw, Upload } from 'lucide-react';
import { usePlatform } from '../../context/PlatformContext';

export const DataStateBanner: React.FC = () => {
  const {
    dataMode,
    totalRows,
    populatedTableCount,
    datasets,
    loading,
    actionLoading,
    seedDemoDataset
  } = usePlatform();

  if (loading) {
    return null;
  }

  // Only surface the banner when actionable (Empty warehouse) or confirming Custom CSV mode;
  // Standard seeded mode telemetry is already visible in the persistent Sidebar footer.
  if (dataMode === 'EMPTY' || totalRows === 0) {
    return (
      <div className="bg-[#FEF7E0] dark:bg-amber-950/35 border border-[#FDE293] dark:border-amber-800/60 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5 text-xs text-[#7A4400] dark:text-amber-100">
          <Database className="w-4 h-4 text-[#E37400] shrink-0" />
          <span>
            <strong>Warehouse is empty (0 rows).</strong> Load the sample Olist dataset or upload
            your own CSV files to populate analytics.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={actionLoading}
            onClick={() => void seedDemoDataset()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[var(--rp-primary)] hover:bg-[var(--rp-primary-hover)] disabled:opacity-50 rounded-full transition-colors whitespace-nowrap cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Load Sample</span>
          </button>
          <Link
            to="/data-management"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[var(--rp-ink)] bg-[var(--rp-surface)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] rounded-full transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload CSV</span>
          </Link>
        </div>
      </div>
    );
  }

  if (dataMode === 'CUSTOM_UPLOAD' && totalRows > 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-[var(--rp-surface)] border border-[var(--rp-border)] rounded-xl text-xs text-[var(--rp-ink-muted)]">
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-[#1E8E3E] shrink-0" />
          <span className="text-[#1E8E3E] font-semibold">Custom CSV warehouse active</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-[var(--rp-ink)] font-medium">
            {totalRows.toLocaleString()} rows
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {populatedTableCount}/{datasets.length} tables
          </span>
        </div>
        <Link
          to="/data-management"
          className="text-[var(--rp-primary)] hover:underline font-semibold whitespace-nowrap"
        >
          Manage datasets
        </Link>
      </div>
    );
  }

  return null;
};
