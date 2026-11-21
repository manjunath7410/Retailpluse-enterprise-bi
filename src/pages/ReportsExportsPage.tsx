import React, { useState } from 'react';
import { FileJson, FileSpreadsheet } from 'lucide-react';
import { usePlatform } from '../context/PlatformContext';
import { apiClient } from '../services/apiClient';
import { convertRowsToCsv } from '../utils/validators';
import { DataStateBanner } from '../components/ui/DataStateBanner';
import { ExecutiveBoardReportBuilder } from '../components/ui/ExecutiveBoardReportBuilder';

export const ReportsExportsPage: React.FC = () => {
  const { datasets, dataMode, isDemonstrationData } = usePlatform();
  const [exportingTable, setExportingTable] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleExportTable = async (tableName: string, format: 'csv' | 'json') => {
    setExportingTable(`${tableName}-${format}`);
    setStatusMessage(null);
    try {
      const res = await apiClient.executeSql({
        sql: `SELECT * FROM ${tableName} LIMIT 5000`,
        limit: 5000
      });
      const payload = res.data;
      if (!payload) return;

      let content = '';
      let mime = 'text/csv;charset=utf-8;';
      let ext = 'csv';

      if (format === 'csv') {
        content = convertRowsToCsv(payload.columns, payload.rows);
      } else {
        content = JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            tableName,
            dataMode,
            isDemonstrationData,
            rowCount: payload.rowCount,
            rows: payload.rows
          },
          null,
          2
        );
        mime = 'application/json;charset=utf-8;';
        ext = 'json';
      }

      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `retailpulse_${tableName}_${isDemonstrationData ? 'demo' : 'custom'}.${ext}`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setStatusMessage(
        `Exported ${payload.rows.length.toLocaleString()} rows from "${tableName}" as ${ext.toUpperCase()} (${
          isDemonstrationData ? 'BENCHMARK DATASET' : 'USER DATASET'
        }).`
      );
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : `Failed to export table ${tableName}.`
      );
    } finally {
      setExportingTable(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="no-print">
        <DataStateBanner />
      </div>

      {/* Flagship Executive Board Report Studio */}
      <ExecutiveBoardReportBuilder />

      {/* Raw Table CSV & JSON Extract Grid */}
      <div className="space-y-4 no-print">
        <div className="studio-card rounded-xl p-5">
          <div className="space-y-1 max-w-2xl">
            <h1 className="text-base font-bold text-[var(--rp-ink)] tracking-tight">
              Warehouse Table Extracts
            </h1>
            <p className="text-xs text-[var(--rp-ink-muted)] leading-relaxed">
              Download RFC 4180 CSV or structured JSON extracts directly from any active DuckDB analytical table (up to 5,000 rows per extract).
            </p>
          </div>

          {statusMessage && (
            <div className="mt-4 p-3 bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg text-xs text-[var(--rp-primary)] font-mono">
              {statusMessage}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {datasets.map((tbl) => (
            <div
              key={tbl.tableName}
              className="studio-card rounded-xl p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-[var(--rp-primary)]">
                    {tbl.tableName}
                  </span>
                  <span className="font-mono tabular-nums text-[var(--rp-ink-secondary)]">
                    {tbl.rowCount.toLocaleString()} rows · {tbl.sourceLabel}
                  </span>
                </div>
                <h2 className="text-sm font-semibold text-[var(--rp-ink)] mt-1">
                  {tbl.displayName}
                </h2>
                <p className="text-xs text-[var(--rp-ink-muted)] mt-1">{tbl.description}</p>
              </div>

              <div className="pt-3 border-t border-[var(--rp-border)] flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono text-[var(--rp-ink-muted)]">
                  {tbl.columns.length} columns
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={tbl.rowCount === 0 || exportingTable !== null}
                    onClick={() => void handleExportTable(tbl.tableName, 'csv')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[#1E8E3E]" />
                    <span>CSV</span>
                  </button>
                  <button
                    type="button"
                    disabled={tbl.rowCount === 0 || exportingTable !== null}
                    onClick={() => void handleExportTable(tbl.tableName, 'json')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <FileJson className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                    <span>JSON</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
