import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  BrainCircuit,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FlaskConical,
  Layers,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Terminal
} from 'lucide-react';
import { usePlatform } from '../../context/PlatformContext';

interface SidebarNavItem {
  id: string;
  label: string;
  route: string;
  icon: React.ComponentType<{ className?: string }>;
  iconAccent: string;
}

const SIDEBAR_GROUPS: { title: string; items: SidebarNavItem[] }[] = [
  {
    title: 'Analytics',
    items: [
      {
        id: 'dashboards',
        label: 'Dashboards',
        route: '/dashboards',
        icon: LayoutDashboard,
        iconAccent: 'text-[#1A73E8]'
      },
      {
        id: 'analytics',
        label: 'Models',
        route: '/analytics',
        icon: Layers,
        iconAccent: 'text-[#1E8E3E]'
      },
      {
        id: 'decision-lab',
        label: 'Decision Lab',
        route: '/decision-lab',
        icon: FlaskConical,
        iconAccent: 'text-[#D93025]'
      },
      {
        id: 'business-insights',
        label: 'AI Assistant',
        route: '/business-insights',
        icon: BrainCircuit,
        iconAccent: 'text-[#4F46E5]'
      },
      {
        id: 'sql-lab',
        label: 'SQL Studio',
        route: '/sql-lab',
        icon: Terminal,
        iconAccent: 'text-[#7C3AED]'
      }
    ]
  },
  {
    title: 'Platform',
    items: [
      {
        id: 'data-management',
        label: 'Datasets',
        route: '/data-management',
        icon: Database,
        iconAccent: 'text-[#007B83]'
      },
      {
        id: 'data-quality',
        label: 'Quality & Lineage',
        route: '/data-quality',
        icon: CheckCircle2,
        iconAccent: 'text-[#137333]'
      },
      {
        id: 'reports-exports',
        label: 'Reports & Exports',
        route: '/reports-exports',
        icon: FileSpreadsheet,
        iconAccent: 'text-[#E37400]'
      }
    ]
  }
];

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  mobileOpen,
  onCloseMobile,
  collapsed,
  onToggleCollapse
}) => {
  const { totalRows, dataMode, isDemonstrationData, loading } = usePlatform();

  const datasetLabel = loading
    ? 'Connecting...'
    : dataMode === 'EMPTY'
    ? 'Empty Warehouse'
    : isDemonstrationData
    ? 'Sample Olist'
    : 'Custom CSV';

  const renderNavContent = (isCompact: boolean) => (
    <div
      className={`flex flex-col h-full bg-[var(--rp-sidebar)] border-r border-[var(--rp-border)] select-none transition-[width] duration-200 ease-out ${
        isCompact ? 'w-[68px]' : 'w-[228px]'
      }`}
    >
      {/* Navigation Items */}
      <nav
        aria-label="Workspace Navigation"
        className={`flex-1 overflow-y-auto py-4 space-y-5 ${isCompact ? 'px-2' : 'px-3'}`}
      >
        {SIDEBAR_GROUPS.map((group) => (
          <div key={group.title}>
            {!isCompact ? (
              <div className="px-3 mb-1.5 text-[11px] font-semibold tracking-wide text-[var(--rp-ink-muted)]">
                {group.title}
              </div>
            ) : (
              <div className="mx-2 mb-2 border-t border-[var(--rp-border)] first:hidden" />
            )}
            <ul className="space-y-1">
              {group.items.map((item) => {
                const IconComponent = item.icon;
                return (
                  <li key={item.id}>
                    <NavLink
                      to={item.route}
                      title={item.label}
                      onClick={onCloseMobile}
                      className={({ isActive }) =>
                        `group flex items-center ${
                          isCompact ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2'
                        } rounded-full text-[13px] transition-colors whitespace-nowrap ${
                          isActive
                            ? 'bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)] font-semibold'
                            : 'text-[var(--rp-ink-secondary)] font-medium hover:bg-[var(--rp-surface-hover)] hover:text-[var(--rp-ink)]'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <IconComponent
                            className={`w-[18px] h-[18px] shrink-0 transition-transform duration-150 group-hover:scale-105 ${
                              isActive ? 'text-[var(--rp-primary-ink)]' : item.iconAccent
                            }`}
                          />
                          {!isCompact && <span className="truncate">{item.label}</span>}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Warehouse Status & Rail Collapse Footer */}
      <div className={`border-t border-[var(--rp-border)] space-y-2 ${isCompact ? 'p-2' : 'p-3'}`}>
        <Link
          to="/data-management"
          title={`${datasetLabel} — ${totalRows.toLocaleString()} rows`}
          onClick={onCloseMobile}
          className={`block rounded-xl bg-[var(--rp-surface)] hover:border-[var(--rp-primary)] border border-[var(--rp-border)] transition-colors ${
            isCompact ? 'p-2.5 flex items-center justify-center' : 'px-3.5 py-2.5'
          }`}
        >
          {isCompact ? (
            <Database
              className={`w-4 h-4 ${
                dataMode === 'EMPTY'
                  ? 'text-[#E37400]'
                  : isDemonstrationData
                  ? 'text-[var(--rp-primary)]'
                  : 'text-[#1E8E3E]'
              }`}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[var(--rp-ink)] truncate">{datasetLabel}</span>
                <span
                  className={`text-[11px] font-mono font-semibold tabular-nums shrink-0 ${
                    dataMode === 'EMPTY'
                      ? 'text-[#E37400]'
                      : isDemonstrationData
                      ? 'text-[var(--rp-primary)]'
                      : 'text-[#1E8E3E]'
                  }`}
                >
                  {totalRows.toLocaleString()}
                </span>
              </div>
              <div className="text-[11px] text-[var(--rp-ink-muted)] mt-0.5">
                DuckDB persistent tables
              </div>
            </>
          )}
        </Link>

        {/* Desktop Rail Collapse Toggle */}
        <button
          type="button"
          onClick={onToggleCollapse}
          title={isCompact ? 'Expand navigation rail ([)' : 'Collapse navigation rail ([)'}
          aria-label={isCompact ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
          className={`hidden lg:flex w-full items-center ${
            isCompact ? 'justify-center px-0 py-2' : 'justify-between px-3 py-1.5'
          } rounded-lg text-[11px] font-medium text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] hover:bg-[var(--rp-surface-hover)] transition-colors cursor-pointer`}
        >
          {isCompact ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <>
              <span className="inline-flex items-center gap-2">
                <PanelLeftClose className="w-3.5 h-3.5" />
                <span>Collapse rail</span>
              </span>
              <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--rp-surface)] border border-[var(--rp-border)]">
                [
              </kbd>
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0 no-print sticky top-14 h-[calc(100vh-3.5rem)]">
        {renderNavContent(collapsed)}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/45 backdrop-blur-[1px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 flex h-full">{renderNavContent(false)}</div>
        </div>
      )}
    </>
  );
};
