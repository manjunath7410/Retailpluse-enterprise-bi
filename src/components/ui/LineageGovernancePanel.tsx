import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Database,
  GitBranch,
  HardDrive,
  Layers,
  RefreshCw,
  ShieldCheck,
  TrendingUp
} from 'lucide-react';
import { LineageGovernancePayload, LineageNode } from '../../types/analytics';
import { apiClient } from '../../services/apiClient';
import { usePlatform } from '../../context/PlatformContext';

const LAYER_CONFIG: {
  key: LineageNode['layer'];
  title: string;
  subtitle: string;
  accent: string;
}[] = [
  {
    key: 'staging',
    title: '1. Raw Staging (Bronze)',
    subtitle: 'Append-only CSV landing tables',
    accent: '#E37400'
  },
  {
    key: 'core_table',
    title: '2. Core Tables (Silver)',
    subtitle: 'Validated keys, types & dates',
    accent: '#1A73E8'
  },
  {
    key: 'semantic_view',
    title: '3. Star Schema (Gold)',
    subtitle: 'Pre-aggregated fanout-safe views',
    accent: '#9334E6'
  },
  {
    key: 'kpi_metric',
    title: '4. Certified KPIs',
    subtitle: 'Governed executive definitions',
    accent: '#1E8E3E'
  }
];

export const LineageGovernancePanel: React.FC = () => {
  const { totalRows, dataMode } = usePlatform();
  const [payload, setPayload] = useState<LineageGovernancePayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('view:fact_orders');

  const loadLineage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getLineageGovernance();
      if (res.data) {
        setPayload(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load visual lineage graph.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLineage();
  }, [loadLineage, totalRows, dataMode]);

  // Compute full transitive upstream and downstream lineage sets for selected node
  const lineageHighlight = useMemo(() => {
    const upstream = new Set<string>();
    const downstream = new Set<string>();
    if (!payload || !selectedNodeId) return { upstream, downstream };

    const walkUpstream = (id: string) => {
      for (const e of payload.edges) {
        if (e.target === id && !upstream.has(e.source)) {
          upstream.add(e.source);
          walkUpstream(e.source);
        }
      }
    };

    const walkDownstream = (id: string) => {
      for (const e of payload.edges) {
        if (e.source === id && !downstream.has(e.target)) {
          downstream.add(e.target);
          walkDownstream(e.target);
        }
      }
    };

    walkUpstream(selectedNodeId);
    walkDownstream(selectedNodeId);
    return { upstream, downstream };
  }, [payload, selectedNodeId]);

  const selectedNode = useMemo(
    () => payload?.nodes.find((n) => n.id === selectedNodeId) || null,
    [payload, selectedNodeId]
  );

  const directEdges = useMemo(() => {
    if (!payload || !selectedNodeId) return { incoming: [], outgoing: [] };
    return {
      incoming: payload.edges.filter((e) => e.target === selectedNodeId),
      outgoing: payload.edges.filter((e) => e.source === selectedNodeId)
    };
  }, [payload, selectedNodeId]);

  if (loading && !payload) {
    return (
      <div className="studio-card rounded-xl p-8 text-center text-xs text-[var(--rp-ink-muted)]">
        Tracing live DuckDB staging, star-schema views, and certified KPI lineage...
      </div>
    );
  }

  if (error) {
    return (
      <div className="studio-card rounded-xl p-5 text-xs text-[#D93025] border-[#D93025]/40">
        {error}
      </div>
    );
  }

  if (!payload) return null;

  return (
    <div className="space-y-5">
      {/* Governance Assertion Bar + Persistence Telemetry */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {payload.governanceChecks.map((chk) => (
          <div key={chk.id} className="studio-card rounded-xl p-4 space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-[var(--rp-ink)] truncate">{chk.title}</span>
              <span
                className={`font-mono font-bold shrink-0 ${
                  chk.status === 'PASS' ? 'text-[#1E8E3E]' : 'text-[#E37400]'
                }`}
              >
                {chk.status}
              </span>
            </div>
            <p className="text-[11px] text-[var(--rp-ink-muted)] leading-relaxed">{chk.detail}</p>
          </div>
        ))}
      </div>

      {/* Interactive 4-Layer Medallion & Semantic DAG */}
      <div className="studio-card rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--rp-ink)] flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-[var(--rp-primary)]" />
              <span>Interactive End-to-End Data Lineage &amp; Metric Governance DAG</span>
            </h2>
            <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5">
              Click any node to trace upstream raw sources and downstream certified KPIs with live DuckDB row counts.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[var(--rp-ink-muted)]">
            <span className="font-mono">
              <strong className="text-[var(--rp-primary)]">Blue</strong> = Selected ·{' '}
              <strong className="text-[#E37400]">Amber</strong> = Upstream ·{' '}
              <strong className="text-[#1E8E3E]">Green</strong> = Downstream
            </span>
            <button
              type="button"
              onClick={() => void loadLineage()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] text-[var(--rp-ink-secondary)] hover:text-[var(--rp-ink)] cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {LAYER_CONFIG.map((layer) => {
            const layerNodes = payload.nodes.filter((n) => n.layer === layer.key);
            return (
              <div
                key={layer.key}
                className="rounded-xl bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] p-3 space-y-2"
              >
                <div className="pb-2 border-b border-[var(--rp-border)]">
                  <div className="text-xs font-bold text-[var(--rp-ink)]">{layer.title}</div>
                  <div className="text-[11px] text-[var(--rp-ink-muted)]">{layer.subtitle}</div>
                </div>

                <div className="space-y-1.5">
                  {layerNodes.map((node) => {
                    const isSelected = node.id === selectedNodeId;
                    const isUpstream = lineageHighlight.upstream.has(node.id);
                    const isDownstream = lineageHighlight.downstream.has(node.id);
                    const isRelated = isSelected || isUpstream || isDownstream;

                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => setSelectedNodeId(node.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[var(--rp-primary-soft)] border-[var(--rp-primary)] text-[var(--rp-primary-ink)] shadow-2xs'
                            : isUpstream
                              ? 'bg-[var(--rp-surface)] border-[#E37400] text-[var(--rp-ink)]'
                              : isDownstream
                                ? 'bg-[var(--rp-surface)] border-[#1E8E3E] text-[var(--rp-ink)]'
                                : 'bg-[var(--rp-surface)] border-[var(--rp-border)] text-[var(--rp-ink-secondary)] opacity-60 hover:opacity-100'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono font-semibold truncate">{node.label}</span>
                          {node.rowCount !== null && (
                            <span className="font-mono text-[11px] tabular-nums shrink-0 opacity-85">
                              {node.rowCount.toLocaleString()}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5 text-[10px] opacity-80">
                          <span className="truncate">{node.owner}</span>
                          {isRelated && !isSelected && (
                            <span className="font-mono font-semibold shrink-0">
                              {isUpstream ? 'UPSTREAM' : 'DOWNSTREAM'}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Node Inspector */}
      {selectedNode && (
        <div className="studio-card rounded-xl p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-mono text-[var(--rp-primary)] uppercase">
                  {selectedNode.layer.replace('_', ' ')} · {selectedNode.owner}
                </div>
                <h3 className="text-base font-bold font-mono text-[var(--rp-ink)] mt-0.5">
                  {selectedNode.label}
                </h3>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-[#1E8E3E]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{selectedNode.status}</span>
              </span>
            </div>

            <p className="text-xs text-[var(--rp-ink-secondary)] leading-relaxed">
              {selectedNode.description}
            </p>

            <div className="pt-2 border-t border-[var(--rp-border)] space-y-1.5 text-xs">
              <div>
                <span className="text-[var(--rp-ink-muted)]">Grain Contract: </span>
                <span className="font-semibold text-[var(--rp-ink)]">{selectedNode.grain}</span>
              </div>
              <div>
                <span className="text-[var(--rp-ink-muted)]">Fanout Protection: </span>
                <span className="font-mono font-semibold text-[#1E8E3E]">
                  {selectedNode.fanoutSafe ? 'VERIFIED ZERO-FANOUT' : 'CHECK REQUIRED'}
                </span>
              </div>
              {selectedNode.rowCount !== null && (
                <div>
                  <span className="text-[var(--rp-ink-muted)]">Live DuckDB Row Count: </span>
                  <span className="font-mono font-semibold tabular-nums text-[var(--rp-ink)]">
                    {selectedNode.rowCount.toLocaleString()} rows
                  </span>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-[var(--rp-border)] grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <div className="font-semibold text-[var(--rp-ink-muted)] mb-1">
                  Upstream Inputs ({directEdges.incoming.length})
                </div>
                {directEdges.incoming.length === 0 ? (
                  <div className="text-[var(--rp-ink-muted)]">Source entry point</div>
                ) : (
                  <ul className="space-y-1 font-mono text-[var(--rp-ink-secondary)]">
                    {directEdges.incoming.map((e) => (
                      <li key={`${e.source}-${e.target}`}>
                        ← {e.source.split(':')[1]} ({e.cardinality})
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <div className="font-semibold text-[var(--rp-ink-muted)] mb-1">
                  Downstream Consumers ({directEdges.outgoing.length})
                </div>
                {directEdges.outgoing.length === 0 ? (
                  <div className="text-[var(--rp-ink-muted)]">Executive KPI leaf</div>
                ) : (
                  <ul className="space-y-1 font-mono text-[var(--rp-ink-secondary)]">
                    {directEdges.outgoing.map((e) => (
                      <li key={`${e.source}-${e.target}`}>
                        → {e.target.split(':')[1]} ({e.cardinality})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-2">
            <div className="text-xs font-semibold text-[var(--rp-ink-secondary)]">
              Governed DuckDB SQL Definition
            </div>
            <pre className="code-surface rounded-xl p-4 text-[11px] font-mono overflow-x-auto max-h-72 leading-relaxed">
              {selectedNode.sqlDefinition}
            </pre>
          </div>
        </div>
      )}

      {/* Persistent Storage Summary Strip */}
      <div className="studio-card rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <HardDrive className="w-4 h-4 text-[var(--rp-primary)]" />
          <span className="font-semibold text-[var(--rp-ink)]">DuckDB Persistence Engine</span>
          <span className="text-[var(--rp-ink-muted)]">·</span>
          <span className="font-mono text-[var(--rp-ink-secondary)]">
            {payload.persistence.storageMode === 'PERSISTENT_FILE'
              ? payload.persistence.dbFilePath
              : ':memory:'}
          </span>
        </div>
        <div className="font-mono tabular-nums text-[var(--rp-ink-muted)]">
          {payload.persistence.totalOrders.toLocaleString()} orders ·{' '}
          {payload.persistence.totalRows.toLocaleString()} total rows ·{' '}
          {payload.persistence.fileSizeBytes > 0
            ? `${(payload.persistence.fileSizeBytes / 1024).toFixed(1)} KB on disk`
            : 'In-memory session'}
        </div>
      </div>
    </div>
  );
};
