import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from 'lucide-react';
import { convertRowsToCsv } from '../../utils/validators';

interface DataTableProps {
  title: string;
  subtitle?: string;
  columns: { name: string; type?: string }[];
  rows: Record<string, string | number | boolean | null>[];
  isDemonstrationData?: boolean;
  loading?: boolean;
  emptyMessage?: string;
  exportFilename?: string;
}

export const DataTable: React.FC<DataTableProps> = ({
  title,
  subtitle,
  columns,
  rows,
  isDemonstrationData = false,
  loading = false,
  emptyMessage = 'No records returned from DuckDB query.',
  exportFilename = 'retailpulse_query_export.csv'
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleToggleSort = (colName: string) => {
    if (sortCol === colName) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortCol(colName);
      setSortDir('desc');
    }
  };

  const filteredAndSortedRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const filtered = q
      ? rows.filter((row) =>
          Object.values(row).some((v) => v !== null && String(v).toLowerCase().includes(q))
        )
      : rows;

    if (!sortCol) return filtered;

    return [...filtered].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, searchTerm, sortCol, sortDir]);

  const handleDownloadCsv = () => {
    if (!columns.length || !filteredAndSortedRows.length) return;
    const csvString = convertRowsToCsv(columns, filteredAndSortedRows);
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', exportFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const isNumericType = (type?: string, sampleVal?: unknown) => {
    if (typeof sampleVal === 'number') return true;
    if (!type) return false;
    const upper = type.toUpperCase();
    return (
      upper.includes('INT') ||
      upper.includes('DOUBLE') ||
      upper.includes('DECIMAL') ||
      upper.includes('FLOAT') ||
      upper.includes('NUMERIC')
    );
  };

  const numericMaxByCol = useMemo(() => {
    const maxMap: Record<string, number> = {};
    for (const col of columns) {
      let maxVal = 0;
      for (const row of filteredAndSortedRows) {
        const v = row[col.name];
        if (typeof v === 'number' && Number.isFinite(v) && v > maxVal) {
          maxVal = v;
        }
      }
      if (maxVal > 0) maxMap[col.name] = maxVal;
    }
    return maxMap;
  }, [columns, filteredAndSortedRows]);

  const primaryBarColumn = useMemo(() => {
    const preferred = columns.find((c) => {
      const n = c.name.toLowerCase();
      return (
        numericMaxByCol[c.name] !== undefined &&
        (n.includes('revenue') ||
          n.includes('gmv') ||
          n.includes('value') ||
          n.includes('total') ||
          n.includes('orders') ||
          n.includes('count') ||
          n.includes('spend'))
      );
    });
    return preferred?.name || null;
  }, [columns, numericMaxByCol]);

  const getStatusTone = (val: unknown): string | null => {
    if (typeof val !== 'string') return null;
    const lower = val.toLowerCase().trim();
    if (lower === 'delivered' || lower === 'passed' || lower === 'verified' || lower === 'resolved') {
      return 'text-[#137333] dark:text-[#81C995] font-semibold';
    }
    if (lower === 'shipped' || lower === 'invoiced' || lower === 'approved') {
      return 'text-[#1A73E8] dark:text-[#8AB4F8] font-semibold';
    }
    if (lower === 'processing' || lower === 'created' || lower === 'warning' || lower === 'medium') {
      return 'text-[#B06000] dark:text-[#FDD663] font-semibold';
    }
    if (lower === 'canceled' || lower === 'unavailable' || lower === 'failed' || lower === 'high' || lower === 'critical') {
      return 'text-[#C5221F] dark:text-[#F28B82] font-semibold';
    }
    return null;
  };

  return (
    <div className="studio-card rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--rp-border)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--rp-ink)]">{title}</h3>
            <span aria-hidden="true" className="text-[var(--rp-ink-muted)]">·</span>
            <span className="text-xs font-mono tabular-nums text-[var(--rp-ink-muted)]">
              {filteredAndSortedRows.length.toLocaleString()} {filteredAndSortedRows.length === 1 ? 'row' : 'rows'}
            </span>
            {isDemonstrationData && rows.length > 0 && (
              <>
                <span aria-hidden="true" className="text-[var(--rp-ink-muted)]">·</span>
                <span className="text-xs font-mono text-[#B06000] dark:text-[#FDD663]">Sample</span>
              </>
            )}
          </div>
          {subtitle && <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--rp-ink-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              aria-label={`Filter ${title}`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter rows..."
              className="pl-8 pr-3 py-1.5 text-xs bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-full text-[var(--rp-ink)] placeholder:text-[var(--rp-ink-muted)] focus:outline-none focus:border-[var(--rp-primary)] w-44 sm:w-56 transition-colors"
            />
          </div>

          <button
            type="button"
            disabled={filteredAndSortedRows.length === 0}
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] disabled:opacity-40 rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-6 space-y-2.5">
          {[1, 2, 3, 4].map((idx) => (
            <div key={idx} className="h-9 bg-[var(--rp-surface-subtle)] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filteredAndSortedRows.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-[var(--rp-ink-muted)]">{emptyMessage}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--rp-border)] bg-[var(--rp-surface-subtle)]">
                {columns.map((col) => {
                  const numeric = isNumericType(col.type, filteredAndSortedRows[0]?.[col.name]);
                  const isSorted = sortCol === col.name;
                  return (
                    <th
                      key={col.name}
                      className={`px-4 py-2.5 text-xs font-semibold text-[var(--rp-ink-secondary)] whitespace-nowrap ${
                        numeric ? 'text-right' : 'text-left'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleSort(col.name)}
                        className={`inline-flex items-center gap-1.5 hover:text-[var(--rp-primary)] transition-colors cursor-pointer ${
                          numeric ? 'flex-row-reverse' : ''
                        }`}
                      >
                        <span>{col.name}</span>
                        {isSorted ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="w-3 h-3 text-[var(--rp-primary)] shrink-0" />
                          ) : (
                            <ArrowDown className="w-3 h-3 text-[var(--rp-primary)] shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-40 shrink-0" />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--rp-border)] text-xs">
              {filteredAndSortedRows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="hover:bg-[var(--rp-surface-subtle)] transition-colors h-10"
                >
                  {columns.map((col) => {
                    const val = row[col.name];
                    const numeric = isNumericType(col.type, val);
                    const statusTone = getStatusTone(val);
                    const showDataBar =
                      col.name === primaryBarColumn &&
                      typeof val === 'number' &&
                      numericMaxByCol[col.name] > 0;
                    const barPct = showDataBar
                      ? Math.max(4, Math.min(100, (val / numericMaxByCol[col.name]) * 100))
                      : 0;

                    return (
                      <td
                        key={col.name}
                        className={`px-4 py-2 whitespace-nowrap ${
                          numeric
                            ? 'text-right font-mono tabular-nums text-[var(--rp-ink)] font-medium'
                            : 'text-left text-[var(--rp-ink-secondary)]'
                        }`}
                      >
                        {val === null || val === undefined ? (
                          <span className="text-[var(--rp-ink-muted)] font-mono">NULL</span>
                        ) : showDataBar ? (
                          <div className="inline-flex items-center justify-end gap-2.5 min-w-[118px]">
                            <div className="w-16 h-1.5 rounded-full bg-[var(--rp-surface-hover)] overflow-hidden shrink-0">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${barPct}%`,
                                  backgroundColor: 'var(--rp-primary)'
                                }}
                              />
                            </div>
                            <span>{val.toLocaleString()}</span>
                          </div>
                        ) : statusTone ? (
                          <span className={statusTone}>{String(val)}</span>
                        ) : (
                          String(val)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
