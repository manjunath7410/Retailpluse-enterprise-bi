import React, { useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileText,
  Printer,
  RefreshCw
} from 'lucide-react';
import { ExecutiveBoardReportPayload } from '../../types/analytics';
import { apiClient } from '../../services/apiClient';

function formatUsd(val: number): string {
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildStandaloneBoardHtml(
  report: ExecutiveBoardReportPayload,
  sections: {
    takeaways: boolean;
    categories: boolean;
    regionalSla: boolean;
    anomalies: boolean;
    rfm: boolean;
  }
): string {
  const kpiCards = report.headlineKpis
    .map(
      (k) => `
      <div class="kpi">
        <div class="kpi-label">${escapeHtml(k.label)}</div>
        <div class="kpi-val">${escapeHtml(k.value)}</div>
        <div class="kpi-sub">${escapeHtml(k.subtext)}</div>
      </div>`
    )
    .join('');

  const takeawaysHtml = sections.takeaways
    ? `<section><h2>Executive Takeaways</h2><ul>${report.executiveTakeaways
        .map((t) => `<li>${escapeHtml(t)}</li>`)
        .join('')}</ul></section>`
    : '';

  const categoriesHtml = sections.categories
    ? `<section><h2>Top Revenue Categories</h2><table><thead><tr><th>Category</th><th class="num">Orders</th><th class="num">Merchandise GMV</th><th class="num">Share</th><th class="num">Avg Review</th></tr></thead><tbody>${report.topCategories
        .map(
          (c) =>
            `<tr><td>${escapeHtml(c.category)}</td><td class="num">${c.orders.toLocaleString()}</td><td class="num">${formatUsd(c.revenue)}</td><td class="num">${c.sharePct.toFixed(1)}%</td><td class="num">${c.avgReview.toFixed(2)}★</td></tr>`
        )
        .join('')}</tbody></table></section>`
    : '';

  const slaHtml = sections.regionalSla
    ? `<section><h2>Regional Delivery SLA Risk (Highest Late Rates)</h2><table><thead><tr><th>State</th><th class="num">Delivered</th><th class="num">Late %</th><th class="num">Avg Days</th><th class="num">Avg Review</th></tr></thead><tbody>${report.regionalSlaLeadersAndLaggards
        .map(
          (s) =>
            `<tr><td>${escapeHtml(s.state)}</td><td class="num">${s.deliveredOrders.toLocaleString()}</td><td class="num">${s.lateRatePct.toFixed(1)}%</td><td class="num">${s.avgDeliveryDays.toFixed(1)}d</td><td class="num">${s.avgReviewScore.toFixed(2)}★</td></tr>`
        )
        .join('')}</tbody></table></section>`
    : '';

  const anomaliesHtml =
    sections.anomalies && report.activeAnomalies.length > 0
      ? `<section><h2>Flagged Statistical Anomalies (Z-Score &amp; Tukey IQR)</h2><table><thead><tr><th>Period</th><th>Domain</th><th>Metric</th><th class="num">Observed</th><th class="num">Baseline</th><th class="num">Z-Score</th></tr></thead><tbody>${report.activeAnomalies
          .map(
            (a) =>
              `<tr><td>${escapeHtml(a.period)}</td><td>${escapeHtml(a.domain)}</td><td>${escapeHtml(a.metricLabel)}</td><td class="num">${escapeHtml(a.formattedObserved)}</td><td class="num">${escapeHtml(a.formattedBaseline)}</td><td class="num">${a.zScore > 0 ? '+' : ''}${a.zScore}σ</td></tr>`
          )
          .join('')}</tbody></table></section>`
      : '';

  const rfmHtml = sections.rfm
    ? `<section><h2>Customer RFM Value Segmentation</h2><table><thead><tr><th>Segment</th><th class="num">Unique Buyers</th><th class="num">Share</th><th class="num">Total Spend</th><th class="num">Avg Spend</th></tr></thead><tbody>${report.rfmSummary
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.segment)}</td><td class="num">${r.customers.toLocaleString()}</td><td class="num">${r.sharePct.toFixed(1)}%</td><td class="num">${formatUsd(r.totalSpend)}</td><td class="num">${formatUsd(r.avgMonetary)}</td></tr>`
        )
        .join('')}</tbody></table></section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>RetailPulse Executive Board Report — ${escapeHtml(report.reportId)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f1f1f; background: #fff; max-width: 980px; margin: 0 auto; padding: 32px; line-height: 1.5; }
    .spectrum { height: 4px; background: linear-gradient(90deg, #4285F4 25%, #EA4335 25% 50%, #FBBC04 50% 75%, #34A853 75%); margin-bottom: 20px; border-radius: 2px; }
    header { border-bottom: 1px solid #dde3ea; padding-bottom: 16px; margin-bottom: 24px; }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: -0.02em; }
    .meta { font-size: 12px; color: #5f6368; font-family: ui-monospace, SFMono-Regular, monospace; }
    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0 28px; }
    .kpi { border: 1px solid #dde3ea; border-radius: 8px; padding: 14px; background: #f8fafd; }
    .kpi-label { font-size: 11px; color: #5f6368; text-transform: uppercase; letter-spacing: 0.04em; }
    .kpi-val { font-size: 20px; font-weight: 700; margin: 4px 0 2px; font-variant-numeric: tabular-nums; }
    .kpi-sub { font-size: 11px; color: #5f6368; }
    section { margin-bottom: 26px; page-break-inside: avoid; }
    h2 { font-size: 15px; border-bottom: 1px solid #dde3ea; padding-bottom: 6px; margin-bottom: 12px; color: #1a73e8; }
    ul { margin: 0; padding-left: 20px; font-size: 13px; }
    li { margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
    th { background: #f8fafd; font-weight: 600; color: #444746; }
    .num { text-align: right; font-family: ui-monospace, SFMono-Regular, monospace; font-variant-numeric: tabular-nums; }
    footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #dde3ea; font-size: 11px; color: #5f6368; }
    @media print { body { padding: 12px; } }
  </style>
</head>
<body>
  <div class="spectrum"></div>
  <header>
    <h1>RetailPulse Enterprise — Executive Board Report</h1>
    <div class="meta">Report ID: ${escapeHtml(report.reportId)} · Generated: ${escapeHtml(report.generatedAt)} · Window: ${escapeHtml(report.observationWindow.startDate)} to ${escapeHtml(report.observationWindow.endDate)} (${report.observationWindow.totalMonths} months)</div>
    <div class="meta" style="margin-top:4px;">Source: ${escapeHtml(report.dataOriginLabel)}</div>
  </header>
  <div class="kpi-grid">${kpiCards}</div>
  ${takeawaysHtml}
  ${categoriesHtml}
  ${slaHtml}
  ${anomaliesHtml}
  ${rfmHtml}
  <footer>
    <strong>Methodology &amp; Governance Disclosures:</strong>
    <ul>${report.methodologyAndDisclosures.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
  </footer>
</body>
</html>`;
}

export const ExecutiveBoardReportBuilder: React.FC = () => {
  const [report, setReport] = useState<ExecutiveBoardReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState({
    takeaways: true,
    categories: true,
    regionalSla: true,
    anomalies: true,
    rfm: true
  });

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getExecutiveBoardReport();
      if (res.data) setReport(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compile executive board report.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadHtml = () => {
    if (!report) return;
    const html = buildStandaloneBoardHtml(report, sections);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `retailpulse_board_report_${report.reportId.toLowerCase()}.html`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrintPdf = () => {
    window.print();
  };

  return (
    <div className="space-y-5">
      <div className="studio-card rounded-xl p-5 space-y-4 no-print">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h2 className="text-base font-bold text-[var(--rp-ink)] flex items-center gap-2">
              <FileText className="w-4 h-4 text-[var(--rp-primary)]" />
              <span>One-Click Executive Board Report Studio</span>
            </h2>
            <p className="text-xs text-[var(--rp-ink-muted)] leading-relaxed">
              Compiles a live, grain-verified DuckDB executive briefing combining KPIs, top categories, regional SLA risks, RFM value segments, active statistical anomalies, and governance disclosures.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleGenerate()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[var(--rp-primary)] hover:bg-[var(--rp-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{report ? 'Refresh Live Snapshot' : 'Generate Executive Report'}</span>
            </button>

            {report && (
              <>
                <button
                  type="button"
                  onClick={handleDownloadHtml}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#1E8E3E]" />
                  <span>Download HTML</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintPdf}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                  <span>Print / Save PDF</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Section Inclusion Checkboxes */}
        <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-[var(--rp-border)] text-xs text-[var(--rp-ink-secondary)]">
          <span className="font-semibold text-[var(--rp-ink-muted)]">Include Sections:</span>
          {(
            [
              ['takeaways', 'Executive Takeaways'],
              ['categories', 'Top Categories'],
              ['regionalSla', 'Regional SLA Risks'],
              ['anomalies', 'Statistical Anomalies'],
              ['rfm', 'RFM Segments']
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={sections[key]}
                onChange={(e) => setSections((p) => ({ ...p, [key]: e.target.checked }))}
                className="accent-[var(--rp-primary)]"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        {error && <div className="text-xs text-[#D93025]">{error}</div>}
      </div>

      {/* Live Printable Executive Deck Preview */}
      {report && (
        <article
          id="executive-board-report-sheet"
          className="studio-card rounded-xl p-6 md:p-8 space-y-6"
        >
          <div className="google-spectrum-bar rounded-full" />

          <header className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[var(--rp-border)]">
            <div>
              <div className="text-[11px] font-mono text-[var(--rp-primary)] uppercase">
                RetailPulse Enterprise · Executive Board Briefing
              </div>
              <h3 className="text-xl font-bold text-[var(--rp-ink)] mt-1">
                Marketplace Performance, SLA &amp; Statistical Health Review
              </h3>
              <div className="text-xs font-mono text-[var(--rp-ink-muted)] mt-1">
                {report.reportId} · Window {report.observationWindow.startDate} to{' '}
                {report.observationWindow.endDate} ({report.observationWindow.totalMonths} months)
              </div>
            </div>

            <div className="text-right text-[11px] font-mono text-[var(--rp-ink-muted)]">
              <div className="text-[var(--rp-ink)] font-semibold">
                {report.isDemonstrationData ? 'BENCHMARK DATASET' : 'PRODUCTION CSV'}
              </div>
              <div>{report.persistence.totalOrders.toLocaleString()} orders verified</div>
              <div>{new Date(report.generatedAt).toLocaleString()}</div>
            </div>
          </header>

          {/* 6 Headline KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3.5">
            {report.headlineKpis.map((k) => (
              <div
                key={k.label}
                className="p-4 rounded-xl bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)]"
              >
                <div className="text-[11px] text-[var(--rp-ink-muted)]">{k.label}</div>
                <div className="text-xl font-bold font-mono tabular-nums text-[var(--rp-ink)] mt-1">
                  {k.value}
                </div>
                <div className="text-[11px] text-[var(--rp-ink-muted)] mt-0.5">{k.subtext}</div>
              </div>
            ))}
          </div>

          {sections.takeaways && (
            <section className="space-y-2">
              <h4 className="text-sm font-bold text-[var(--rp-ink)]">Executive Takeaways</h4>
              <ul className="space-y-1.5 text-xs text-[var(--rp-ink-secondary)]">
                {report.executiveTakeaways.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 leading-relaxed">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#1E8E3E] shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sections.categories && (
              <section className="space-y-2">
                <h4 className="text-sm font-bold text-[var(--rp-ink)]">Top Revenue Categories</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--rp-border)] text-[var(--rp-ink-muted)]">
                        <th className="py-1.5 pr-2 font-semibold">Category</th>
                        <th className="py-1.5 px-2 font-semibold text-right">GMV</th>
                        <th className="py-1.5 px-2 font-semibold text-right">Share</th>
                        <th className="py-1.5 pl-2 font-semibold text-right">Rating</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--rp-border)]">
                      {report.topCategories.map((c) => (
                        <tr key={c.category}>
                          <td className="py-1.5 pr-2 text-[var(--rp-ink)]">{c.category}</td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {formatUsd(c.revenue)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums text-[var(--rp-ink-muted)]">
                            {c.sharePct.toFixed(1)}%
                          </td>
                          <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                            {c.avgReview.toFixed(2)}★
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {sections.regionalSla && (
              <section className="space-y-2">
                <h4 className="text-sm font-bold text-[var(--rp-ink)]">
                  Regional SLA Risk Watchlist
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--rp-border)] text-[var(--rp-ink-muted)]">
                        <th className="py-1.5 pr-2 font-semibold">State</th>
                        <th className="py-1.5 px-2 font-semibold text-right">Orders</th>
                        <th className="py-1.5 px-2 font-semibold text-right">Late %</th>
                        <th className="py-1.5 pl-2 font-semibold text-right">Avg Days</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--rp-border)]">
                      {report.regionalSlaLeadersAndLaggards.slice(0, 8).map((s) => (
                        <tr key={s.state}>
                          <td className="py-1.5 pr-2 font-mono font-semibold text-[var(--rp-ink)]">
                            {s.state}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                            {s.deliveredOrders.toLocaleString()}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums text-[#D93025]">
                            {s.lateRatePct.toFixed(1)}%
                          </td>
                          <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-[var(--rp-ink-muted)]">
                            {s.avgDeliveryDays.toFixed(1)}d
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>

          {sections.anomalies && report.activeAnomalies.length > 0 && (
            <section className="space-y-2">
              <h4 className="text-sm font-bold text-[var(--rp-ink)]">
                Flagged Statistical Anomalies (Z-Score &amp; Tukey IQR)
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--rp-border)] text-[var(--rp-ink-muted)]">
                      <th className="py-1.5 pr-2 font-semibold">Period</th>
                      <th className="py-1.5 px-2 font-semibold">Domain</th>
                      <th className="py-1.5 px-2 font-semibold">Metric</th>
                      <th className="py-1.5 px-2 font-semibold text-right">Observed</th>
                      <th className="py-1.5 px-2 font-semibold text-right">Baseline</th>
                      <th className="py-1.5 pl-2 font-semibold text-right">Z-Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--rp-border)]">
                    {report.activeAnomalies.map((a) => (
                      <tr key={a.id}>
                        <td className="py-1.5 pr-2 font-mono">{a.period}</td>
                        <td className="py-1.5 px-2">{a.domain}</td>
                        <td className="py-1.5 px-2 text-[var(--rp-ink-secondary)]">
                          {a.metricLabel}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono font-semibold tabular-nums">
                          {a.formattedObserved}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums text-[var(--rp-ink-muted)]">
                          {a.formattedBaseline}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono font-bold tabular-nums text-[#D93025]">
                          {a.zScore > 0 ? '+' : ''}
                          {a.zScore}σ
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {sections.rfm && report.rfmSummary.length > 0 && (
            <section className="space-y-2">
              <h4 className="text-sm font-bold text-[var(--rp-ink)]">
                Customer RFM Value Segmentation
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--rp-border)] text-[var(--rp-ink-muted)]">
                      <th className="py-1.5 pr-2 font-semibold">Segment</th>
                      <th className="py-1.5 px-2 font-semibold text-right">Unique Buyers</th>
                      <th className="py-1.5 px-2 font-semibold text-right">Share</th>
                      <th className="py-1.5 px-2 font-semibold text-right">Total Spend</th>
                      <th className="py-1.5 pl-2 font-semibold text-right">Avg Spend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--rp-border)]">
                    {report.rfmSummary.map((r) => (
                      <tr key={r.segment}>
                        <td className="py-1.5 pr-2 font-semibold text-[var(--rp-ink)]">
                          {r.segment}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {r.customers.toLocaleString()}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums text-[var(--rp-ink-muted)]">
                          {r.sharePct.toFixed(1)}%
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {formatUsd(r.totalSpend)}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono tabular-nums">
                          {formatUsd(r.avgMonetary)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <footer className="pt-4 border-t border-[var(--rp-border)] space-y-1 text-[11px] text-[var(--rp-ink-muted)]">
            <div className="font-semibold text-[var(--rp-ink-secondary)]">
              Methodology &amp; Governance Disclosures
            </div>
            {report.methodologyAndDisclosures.map((d, i) => (
              <div key={i}>• {d}</div>
            ))}
          </footer>
        </article>
      )}
    </div>
  );
};
