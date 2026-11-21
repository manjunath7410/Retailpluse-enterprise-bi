import React from 'react';
import { DataStateBanner } from '../components/ui/DataStateBanner';
import { BiAssistantWorkspace } from '../components/ui/BiAssistantWorkspace';

export const BusinessInsightsPage: React.FC = () => {
  return (
    <div className="space-y-5">
      <DataStateBanner />

      <div>
        <h1 className="text-2xl font-bold text-[var(--rp-ink)] tracking-tight">
          AI Business Assistant
        </h1>
        <p className="text-xs text-[var(--rp-ink-muted)] mt-0.5">
          Conversational Google Gemini analytics grounded strictly in 10 live read-only DuckDB tools.
        </p>
      </div>

      <BiAssistantWorkspace />
    </div>
  );
};
