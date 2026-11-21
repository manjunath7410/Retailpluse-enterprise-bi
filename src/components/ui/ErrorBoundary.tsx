import React from 'react';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected rendering error occurred.'
    };
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--rp-canvas)] text-[var(--rp-ink)] flex items-center justify-center p-6">
          <div className="max-w-lg w-full studio-card rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#FCE8E6] dark:bg-red-950/60 border border-[#EA4335]/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-[#D93025]" />
              </div>
              <div className="space-y-1">
                <h1 className="font-display text-base font-semibold text-[var(--rp-ink)]">
                  Something went wrong in this workspace
                </h1>
                <p className="text-xs text-[var(--rp-ink-muted)] leading-relaxed">
                  RetailPulse encountered an unexpected interface error. Your DuckDB analytical data
                  on the server remains safe.
                </p>
              </div>
            </div>

            <div className="p-3 bg-[var(--rp-surface-subtle)] border border-[var(--rp-border)] rounded-xl text-xs font-mono text-[#D93025] dark:text-red-300 break-words">
              {this.state.errorMessage}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[var(--rp-primary)] hover:bg-[var(--rp-primary-hover)] rounded-lg transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry View
              </button>
              <a
                href="/dashboards"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[var(--rp-ink-secondary)] bg-[var(--rp-surface-subtle)] hover:bg-[var(--rp-surface-hover)] border border-[var(--rp-border)] rounded-lg transition-colors"
              >
                <Home className="w-3.5 h-3.5" />
                Return to Dashboards
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
