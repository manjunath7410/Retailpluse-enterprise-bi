import React from 'react';
import { Link, NavLink } from 'react-router-dom';

export const TopHeader: React.FC = () => {
  return (
    <div className="sticky top-0 z-30 shrink-0">
      <header className="h-14 flex items-center justify-between gap-8 px-5 bg-[var(--rp-header)] backdrop-blur-md border-b border-[var(--rp-border)]">
        {/* Zone 1: Single-line Brand Wordmark */}
        <Link
          to="/dashboards"
          className="inline-flex items-center gap-2.5 text-[16px] font-bold tracking-tight text-[var(--rp-ink)] whitespace-nowrap shrink-0"
        >
          <span className="w-8 h-8 rounded-xl bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] flex items-center justify-center">
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="shrink-0"
            >
              <rect x="2.5" y="13" width="3.8" height="8" rx="1.6" fill="#4285F4" />
              <rect x="7.8" y="8.5" width="3.8" height="12.5" rx="1.6" fill="#EA4335" />
              <rect x="13.1" y="10.5" width="3.8" height="10.5" rx="1.6" fill="#FBBC04" />
              <rect x="18.4" y="3.5" width="3.8" height="17.5" rx="1.6" fill="#34A853" />
            </svg>
          </span>
          <span>RetailPulse</span>
        </Link>

        {/* Zone 2: 4 concise single-line text links */}
        <nav
          aria-label="Primary Navigation"
          className="hidden md:flex items-center gap-7 text-[13px] font-medium text-[var(--rp-ink-muted)] h-full"
        >
          <NavLink
            to="/dashboards"
            className={({ isActive }) =>
              `inline-flex items-center h-full border-b-[2px] transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'border-[var(--rp-primary)] text-[var(--rp-primary)] font-semibold'
                  : 'border-transparent hover:text-[var(--rp-ink)]'
              }`
            }
          >
            Dashboards
          </NavLink>
          <NavLink
            to="/decision-lab"
            className={({ isActive }) =>
              `inline-flex items-center h-full border-b-[2px] transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'border-[var(--rp-primary)] text-[var(--rp-primary)] font-semibold'
                  : 'border-transparent hover:text-[var(--rp-ink)]'
              }`
            }
          >
            Decision Lab
          </NavLink>
          <NavLink
            to="/business-insights"
            className={({ isActive }) =>
              `inline-flex items-center h-full border-b-[2px] transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'border-[var(--rp-primary)] text-[var(--rp-primary)] font-semibold'
                  : 'border-transparent hover:text-[var(--rp-ink)]'
              }`
            }
          >
            AI Assistant
          </NavLink>
          <NavLink
            to="/sql-lab"
            className={({ isActive }) =>
              `inline-flex items-center h-full border-b-[2px] transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'border-[var(--rp-primary)] text-[var(--rp-primary)] font-semibold'
                  : 'border-transparent hover:text-[var(--rp-ink)]'
              }`
            }
          >
            SQL Studio
          </NavLink>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <Link
            to="/data-management"
            className="px-4 py-2 text-xs font-semibold text-white bg-[var(--rp-primary)] hover:bg-[var(--rp-primary-hover)] rounded-full transition-colors whitespace-nowrap shrink-0"
          >
            Upload CSV
          </Link>
        </div>
      </header>
    </div>
  );
};
