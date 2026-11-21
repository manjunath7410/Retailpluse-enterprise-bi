import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FlaskConical,
  Layers,
  LayoutDashboard,
  RotateCcw,
  Search,
  Terminal,
  X
} from 'lucide-react';
import { CURATED_SQL_LIBRARY } from '../../config/sqlCatalog';
import { usePlatform } from '../../context/PlatformContext';

interface CommandItem {
  id: string;
  group: 'Workspaces' | 'Quick Actions' | 'Saved SQL Queries';
  title: string;
  subtitle: string;
  keywords: string;
  icon: 'workspace' | 'models' | 'lab' | 'ai' | 'sql' | 'data' | 'quality' | 'reports' | 'action';
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const { seedDemoDataset, resetDashboardFilters } = usePlatform();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const workspaceItems: CommandItem[] = [
      {
        id: 'ws-dash-exec',
        group: 'Workspaces',
        title: 'Executive Overview Dashboard',
        subtitle: 'BI Dashboards',
        keywords: 'overview executive kpi gmv orders revenue dashboard',
        icon: 'workspace',
        onSelect: () => {
          navigate('/dashboards');
          onClose();
        }
      },
      {
        id: 'ws-dash-sales',
        group: 'Workspaces',
        title: 'Sales Intelligence Dashboard',
        subtitle: 'BI Dashboards',
        keywords: 'sales revenue category state payments installments',
        icon: 'workspace',
        onSelect: () => {
          navigate('/dashboards?view=sales-intelligence');
          onClose();
        }
      },
      {
        id: 'ws-dash-customers',
        group: 'Workspaces',
        title: 'Customer Intelligence Dashboard',
        subtitle: 'BI Dashboards',
        keywords: 'customers repeat buyers ltv retention geography',
        icon: 'workspace',
        onSelect: () => {
          navigate('/dashboards?view=customer-intelligence');
          onClose();
        }
      },
      {
        id: 'ws-dash-products',
        group: 'Workspaces',
        title: 'Product Intelligence Dashboard',
        subtitle: 'BI Dashboards',
        keywords: 'products sku category freight catalog pricing',
        icon: 'workspace',
        onSelect: () => {
          navigate('/dashboards?view=product-intelligence');
          onClose();
        }
      },
      {
        id: 'ws-dash-delivery',
        group: 'Workspaces',
        title: 'Delivery Performance Dashboard',
        subtitle: 'BI Dashboards',
        keywords: 'delivery sla logistics shipping late on-time freight',
        icon: 'workspace',
        onSelect: () => {
          navigate('/dashboards?view=delivery-performance');
          onClose();
        }
      },
      {
        id: 'ws-dash-satisfaction',
        group: 'Workspaces',
        title: 'Customer Satisfaction Dashboard',
        subtitle: 'BI Dashboards',
        keywords: 'satisfaction reviews nps rating stars delay correlation',
        icon: 'workspace',
        onSelect: () => {
          navigate('/dashboards?view=customer-satisfaction');
          onClose();
        }
      },
      {
        id: 'ws-model-rfm',
        group: 'Workspaces',
        title: 'RFM Customer Segmentation Model',
        subtitle: 'Statistical Models',
        keywords: 'rfm recency frequency monetary champions at risk segments',
        icon: 'models',
        onSelect: () => {
          navigate('/analytics?model=rfm-segmentation');
          onClose();
        }
      },
      {
        id: 'ws-model-cohort',
        group: 'Workspaces',
        title: 'Cohort Retention Matrix',
        subtitle: 'Statistical Models',
        keywords: 'cohort retention monthly heatmap churn repeat',
        icon: 'models',
        onSelect: () => {
          navigate('/analytics?model=cohort-retention');
          onClose();
        }
      },
      {
        id: 'ws-model-sellers',
        group: 'Workspaces',
        title: 'Seller Performance & Bayesian Ranking',
        subtitle: 'Statistical Models',
        keywords: 'seller ranking bayesian empirical bayes merchant sla',
        icon: 'models',
        onSelect: () => {
          navigate('/analytics?model=seller-performance');
          onClose();
        }
      },
      {
        id: 'ws-model-forecast',
        group: 'Workspaces',
        title: 'Demand Forecasting & Trend Decomposition',
        subtitle: 'Statistical Models',
        keywords: 'forecast holt winters seasonality trend projection',
        icon: 'models',
        onSelect: () => {
          navigate('/analytics?model=demand-forecasting');
          onClose();
        }
      },
      {
        id: 'ws-lab-anomalies',
        group: 'Workspaces',
        title: 'Statistical Anomaly Detection (Z-Score & IQR)',
        subtitle: 'Decision Lab',
        keywords: 'decision lab anomaly alerts z-score iqr spikes outliers',
        icon: 'lab',
        onSelect: () => {
          navigate('/decision-lab?tab=anomalies');
          onClose();
        }
      },
      {
        id: 'ws-lab-whatif',
        group: 'Workspaces',
        title: 'Executive What-If Impact Simulator',
        subtitle: 'Decision Lab',
        keywords: 'what-if simulator elasticity sla revenue profit margin',
        icon: 'lab',
        onSelect: () => {
          navigate('/decision-lab?tab=what-if');
          onClose();
        }
      },
      {
        id: 'ws-lab-ab',
        group: 'Workspaces',
        title: 'A/B Hypothesis & Experiment Lab',
        subtitle: 'Decision Lab',
        keywords: 'ab test experiment welch t-test p-value confidence interval',
        icon: 'lab',
        onSelect: () => {
          navigate('/decision-lab?tab=ab-test');
          onClose();
        }
      },
      {
        id: 'ws-ai',
        group: 'Workspaces',
        title: 'AI Business Assistant',
        subtitle: 'Analytics',
        keywords: 'gemini ai assistant chat ask question natural language insights',
        icon: 'ai',
        onSelect: () => {
          navigate('/business-insights');
          onClose();
        }
      },
      {
        id: 'ws-sql',
        group: 'Workspaces',
        title: 'SQL Studio',
        subtitle: 'Analytics',
        keywords: 'sql lab duckdb query editor cte window functions',
        icon: 'sql',
        onSelect: () => {
          navigate('/sql-lab');
          onClose();
        }
      },
      {
        id: 'ws-datasets',
        group: 'Workspaces',
        title: 'Datasets & CSV Upload',
        subtitle: 'Platform',
        keywords: 'data management upload import csv tables staging olist',
        icon: 'data',
        onSelect: () => {
          navigate('/data-management');
          onClose();
        }
      },
      {
        id: 'ws-quality',
        group: 'Workspaces',
        title: 'Quality & Visual Data Lineage DAG',
        subtitle: 'Platform',
        keywords: 'data quality lineage dag star schema kpi dictionary governance',
        icon: 'quality',
        onSelect: () => {
          navigate('/data-quality');
          onClose();
        }
      },
      {
        id: 'ws-reports',
        group: 'Workspaces',
        title: 'Executive Board Reports & Exports',
        subtitle: 'Platform',
        keywords: 'executive board report pdf html csv json export',
        icon: 'reports',
        onSelect: () => {
          navigate('/reports-exports');
          onClose();
        }
      }
    ];

    const quickActions: CommandItem[] = [
      {
        id: 'act-reload-demo',
        group: 'Quick Actions',
        title: 'Reload 5,300-Order Benchmark Dataset',
        subtitle: 'Reset DuckDB warehouse to clean 24-month benchmark tables',
        keywords: 'demo sample seed reload reset data',
        icon: 'action',
        onSelect: () => {
          void seedDemoDataset();
          onClose();
        }
      },
      {
        id: 'act-reset-filters',
        group: 'Quick Actions',
        title: 'Reset All Dashboard Filters',
        subtitle: 'Clear active date, state, category, and status filters',
        keywords: 'clear reset filters cross dashboard',
        icon: 'action',
        onSelect: () => {
          resetDashboardFilters();
          onClose();
        }
      }
    ];

    const sqlItems: CommandItem[] = CURATED_SQL_LIBRARY.slice(0, 12).map((q) => ({
      id: `sql-${q.id}`,
      group: 'Saved SQL Queries',
      title: `${q.code}: ${q.title}`,
      subtitle: q.category,
      keywords: `${q.code} ${q.title} ${q.category} ${q.businessQuestion}`,
      icon: 'sql',
      onSelect: () => {
        navigate(`/sql-lab?query=${encodeURIComponent(q.code)}`);
        onClose();
      }
    }));

    return [...workspaceItems, ...quickActions, ...sqlItems];
  }, [navigate, onClose, resetDashboardFilters, seedDemoDataset]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 14);
    return items
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.keywords.toLowerCase().includes(q)
      )
      .slice(0, 14);
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) =>
          filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0
        );
      } else if (e.key === 'Enter' && filtered[activeIndex]) {
        e.preventDefault();
        filtered[activeIndex].onSelect();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, filtered, activeIndex, onClose]);

  if (!open) return null;

  const renderIcon = (type: CommandItem['icon']) => {
    switch (type) {
      case 'ai':
        return <BrainCircuit className="w-4 h-4 text-[#4285F4] shrink-0" />;
      case 'models':
        return <Layers className="w-4 h-4 text-[#34A853] shrink-0" />;
      case 'lab':
        return <FlaskConical className="w-4 h-4 text-[#EA4335] shrink-0" />;
      case 'sql':
        return <Terminal className="w-4 h-4 text-[#7C3AED] shrink-0" />;
      case 'data':
        return <Database className="w-4 h-4 text-[#007B83] shrink-0" />;
      case 'quality':
        return <CheckCircle2 className="w-4 h-4 text-[#1E8E3E] shrink-0" />;
      case 'reports':
        return <FileSpreadsheet className="w-4 h-4 text-[#1A73E8] shrink-0" />;
      case 'action':
        return <RotateCcw className="w-4 h-4 text-[#E37400] shrink-0" />;
      default:
        return <LayoutDashboard className="w-4 h-4 text-[#4285F4] shrink-0" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-xs flex items-start justify-center pt-[12vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Quick navigation command palette"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[var(--rp-surface)] border border-[var(--rp-border)] rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--rp-border)]">
          <Search className="w-4 h-4 text-[var(--rp-primary)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a workspace, SQL query, or action..."
            className="flex-1 bg-transparent text-sm text-[var(--rp-ink)] placeholder:text-[var(--rp-ink-muted)] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="p-1.5 text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-subtle)] rounded-full cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--rp-ink-muted)]">
              No matching workspaces or actions found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={item.onSelect}
                  className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)]'
                      : 'text-[var(--rp-ink-secondary)] hover:bg-[var(--rp-surface-subtle)]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {renderIcon(item.icon)}
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--rp-ink)] truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-[var(--rp-ink-muted)] truncate">
                        {item.group} · {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--rp-ink-muted)] shrink-0" />
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2.5 bg-[var(--rp-surface-subtle)] border-t border-[var(--rp-border)] flex items-center justify-between text-[11px] text-[var(--rp-ink-muted)]">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
            <span>Esc Close</span>
          </div>
          <span className="font-mono">RetailPulse Quick Jump</span>
        </div>
      </div>
    </div>
  );
};
