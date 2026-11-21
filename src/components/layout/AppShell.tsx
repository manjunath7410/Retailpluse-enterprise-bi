import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
  Layers,
  Menu,
  Search,
  X
} from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopHeader } from './TopHeader';
import { MODULE_REGISTRY } from '../../config/modules';
import { CommandPalette } from '../ui/CommandPalette';
import { ArchitectureMethodologyDrawer } from '../ui/ArchitectureMethodologyDrawer';
import { usePlatform } from '../../context/PlatformContext';
import { THEME_LIST, useTheme } from '../../context/ThemeContext';

const RAIL_STORAGE_KEY = 'retailpulse-sidebar-collapsed';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [archDrawerOpen, setArchDrawerOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(RAIL_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const themeMenuRef = useRef<HTMLDivElement>(null);
  const { themeId, themeConfig, setThemeId } = useTheme();
  const location = useLocation();
  const { toasts, dismissToast } = usePlatform();

  const ROUTE_BREADCRUMBS: Record<string, { section: string; title: string }> = {
    '/dashboards': { section: 'Analytics', title: 'BI Dashboards' },
    '/analytics': { section: 'Analytics', title: 'Statistical Models' },
    '/decision-lab': { section: 'Analytics', title: 'Decision Intelligence Lab' },
    '/business-insights': { section: 'Analytics', title: 'AI Business Assistant' },
    '/sql-lab': { section: 'Analytics', title: 'SQL Studio' },
    '/data-management': { section: 'Platform', title: 'Datasets & Ingestion' },
    '/data-quality': { section: 'Platform', title: 'Quality & Lineage' },
    '/reports-exports': { section: 'Platform', title: 'Reports & Exports' }
  };

  const matchedCrumb =
    ROUTE_BREADCRUMBS[location.pathname] ||
    (() => {
      const m = MODULE_REGISTRY.find((mod) => location.pathname.startsWith(mod.route));
      return m ? { section: m.category, title: m.title } : { section: 'Analytics', title: 'BI Dashboards' };
    })();

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RAIL_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  // Global keyboard shortcuts: Cmd/Ctrl+K (Command Palette), [ (Toggle Sidebar Rail)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (
        e.key === '[' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        toggleSidebarCollapse();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Close Theme Popover on outside click or Escape
  useEffect(() => {
    if (!themeMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setThemeMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [themeMenuOpen]);

  return (
    <div className="min-h-screen flex flex-col studio-canvas text-[var(--rp-ink)]">
      <div className="no-print">
        <TopHeader />
      </div>

      <div className="flex-1 flex min-h-0">
        <Sidebar
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapse}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Compact Google Material 3 Contextual Utility Bar */}
          <div className="no-print relative z-30 h-12 px-6 bg-[var(--rp-surface)]/85 backdrop-blur-sm border-b border-[var(--rp-border)] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                aria-label="Open navigation menu"
                onClick={() => setMobileOpen(true)}
                className="lg:hidden p-1.5 text-[var(--rp-ink-secondary)] hover:text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-lg cursor-pointer"
              >
                <Menu className="w-4 h-4" />
              </button>
              <nav
                aria-label="Breadcrumb"
                className="flex items-center gap-2 text-xs text-[var(--rp-ink-muted)] truncate"
              >
                <span>{matchedCrumb.section}</span>
                <span aria-hidden="true">/</span>
                <span className="font-semibold text-[var(--rp-ink)] truncate">
                  {matchedCrumb.title}
                </span>
              </nav>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Compact Command Search Bar */}
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="inline-flex items-center justify-between gap-4 px-3.5 py-1.5 min-w-[165px] sm:min-w-[220px] text-xs text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span className="inline-flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                  <span>Search...</span>
                </span>
                <kbd className="font-mono text-[10px] text-[var(--rp-ink-muted)] bg-[var(--rp-surface)] border border-[var(--rp-border)] rounded px-1.5 py-0.5">
                  ⌘K
                </kbd>
              </button>

              {/* Discreet Architecture & Methodology Drawer Trigger */}
              <button
                type="button"
                onClick={() => setArchDrawerOpen(true)}
                title="View DuckDB Persistence, Star-Schema Architecture & Statistical Methodology"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--rp-ink-secondary)] hover:text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5 text-[var(--rp-primary)]" />
                <span className="hidden md:inline">Architecture</span>
              </button>

              {/* Compact Material 3 Palette Popover */}
              <div ref={themeMenuRef} className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={themeMenuOpen}
                  aria-label="Switch color palette"
                  onClick={() => setThemeMenuOpen((prev) => !prev)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium text-[var(--rp-ink-secondary)] hover:text-[var(--rp-ink)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span className="inline-flex items-center -space-x-1" aria-hidden="true">
                    <span
                      className="w-2.5 h-2.5 rounded-full ring-1 ring-[var(--rp-surface)]"
                      style={{ backgroundColor: themeConfig.swatches[0] }}
                    />
                    <span
                      className="w-2.5 h-2.5 rounded-full ring-1 ring-[var(--rp-surface)]"
                      style={{ backgroundColor: themeConfig.swatches[3] }}
                    />
                  </span>
                  <span className="hidden sm:inline">{themeConfig.shortLabel}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--rp-ink-muted)]" />
                </button>

                {themeMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Color palette themes"
                    className="absolute right-0 mt-2 w-60 p-1.5 rounded-2xl bg-[var(--rp-surface)] border border-[var(--rp-border)] shadow-xl z-50 space-y-0.5"
                  >
                    <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[var(--rp-ink-muted)]">
                      Workspace Palette
                    </div>
                    {THEME_LIST.map((t) => {
                      const active = themeId === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          onClick={() => {
                            setThemeId(t.id);
                            setThemeMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                            active
                              ? 'bg-[var(--rp-primary-soft)] text-[var(--rp-primary-ink)]'
                              : 'text-[var(--rp-ink-secondary)] hover:bg-[var(--rp-surface-subtle)] hover:text-[var(--rp-ink)]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="inline-flex items-center -space-x-1 shrink-0" aria-hidden="true">
                              {t.swatches.slice(0, 3).map((hex, i) => (
                                <span
                                  key={i}
                                  className="w-2.5 h-2.5 rounded-full ring-1 ring-[var(--rp-surface)]"
                                  style={{ backgroundColor: hex }}
                                />
                              ))}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold truncate">{t.label}</div>
                              <div className="text-[11px] opacity-75 truncate">{t.shortLabel} theme</div>
                            </div>
                          </div>
                          {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <main className="flex-1 px-6 py-5 max-w-[1440px] w-full mx-auto">
            {children}
          </main>
        </div>
      </div>

      {/* Global Quick Jump Command Palette */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* Discreet Architecture & Analytical Methodology Drawer */}
      <ArchitectureMethodologyDrawer
        open={archDrawerOpen}
        onClose={() => setArchDrawerOpen(false)}
      />

      {/* Accessible Global Toast Notifications */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="pointer-events-auto p-3.5 rounded-xl bg-[var(--rp-surface)] border border-[var(--rp-border)] shadow-xl flex items-start justify-between gap-3 text-xs text-[var(--rp-ink)]"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                {toast.tone === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-[#1E8E3E] shrink-0 mt-0.5" />
                ) : toast.tone === 'error' || toast.tone === 'warning' ? (
                  <AlertCircle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      toast.tone === 'error' ? 'text-[#D93025]' : 'text-[#E37400]'
                    }`}
                  />
                ) : (
                  <Info className="w-4 h-4 text-[var(--rp-primary)] shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5 min-w-0">
                  <div className="font-semibold text-[var(--rp-ink)]">{toast.title}</div>
                  {toast.detail && (
                    <div className="text-[var(--rp-ink-muted)] leading-snug">{toast.detail}</div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
                className="text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)] cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
