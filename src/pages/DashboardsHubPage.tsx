import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BarChart3,
  HeartHandshake,
  LayoutDashboard,
  Package,
  Truck,
  Users
} from 'lucide-react';
import { AnomalyDetectionPayload, BiDashboardId } from '../types/analytics';
import { usePlatform } from '../context/PlatformContext';
import { apiClient } from '../services/apiClient';
import { BiDashboardWorkspace } from '../components/ui/BiDashboardWorkspace';

interface DashboardTabSpec {
  id: BiDashboardId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const DASHBOARD_TABS: DashboardTabSpec[] = [
  { id: 'executive-overview', label: 'Executive', icon: LayoutDashboard },
  { id: 'sales-intelligence', label: 'Sales', icon: BarChart3 },
  { id: 'customer-intelligence', label: 'Customers', icon: Users },
  { id: 'product-intelligence', label: 'Products', icon: Package },
  { id: 'delivery-performance', label: 'Delivery', icon: Truck },
  { id: 'customer-satisfaction', label: 'Satisfaction', icon: HeartHandshake }
];

const VALID_DASHBOARD_IDS = new Set<string>(DASHBOARD_TABS.map((t) => t.id));

interface DashboardsHubPageProps {
  defaultDashboard?: BiDashboardId;
}

export const DashboardsHubPage: React.FC<DashboardsHubPageProps> = ({
  defaultDashboard = 'executive-overview'
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { totalRows, dataMode } = usePlatform();
  const [anomalySummary, setAnomalySummary] = useState<AnomalyDetectionPayload | null>(null);

  const queryView = searchParams.get('view');
  const activeDashboard: BiDashboardId =
    queryView && VALID_DASHBOARD_IDS.has(queryView)
      ? (queryView as BiDashboardId)
      : defaultDashboard;

  useEffect(() => {
    if (activeDashboard !== 'executive-overview') return;
    let active = true;
    apiClient
      .getStatisticalAnomalies()
      .then((res) => {
        if (active && res.data) setAnomalySummary(res.data);
      })
      .catch(() => {
        // Non-blocking executive signal
      });
    return () => {
      active = false;
    };
  }, [activeDashboard, totalRows, dataMode]);

  const handleSelectDashboard = (id: BiDashboardId) => {
    setSearchParams(id === 'executive-overview' ? {} : { view: id });
  };

  const topAlert = anomalySummary?.anomalies[0] || null;

  const headerTabs = (
    <div
      role="tablist"
      aria-label="BI Dashboards"
      className="flex items-center gap-1 overflow-x-auto -mb-px"
    >
      {DASHBOARD_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeDashboard === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => handleSelectDashboard(tab.id)}
            className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
              isActive
                ? 'text-[var(--rp-primary)] font-semibold'
                : 'text-[var(--rp-ink-muted)] hover:text-[var(--rp-ink)]'
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span>{tab.label}</span>
            {isActive && (
              <span
                className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full bg-[var(--rp-primary)]"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );

  const anomalyBanner =
    activeDashboard === 'executive-overview' &&
    anomalySummary &&
    anomalySummary.totalAnomalies > 0 &&
    topAlert ? (
      <div className="studio-card rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[#FCE8E6] dark:bg-red-950/60 border border-[#EA4335]/30 flex items-center justify-center shrink-0">
            <Activity className="w-3.5 h-3.5 text-[#D93025]" />
          </div>
          <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="font-semibold text-[var(--rp-ink)]">
              {anomalySummary.totalAnomalies} Statistical Anomalies
            </span>
            <span className="text-[var(--rp-ink-muted)]" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-[#D93025] dark:text-red-400 font-medium">
              {topAlert.period}: {topAlert.metricLabel} {topAlert.formattedObserved} (
              {topAlert.zScore > 0 ? '+' : ''}
              {topAlert.zScore}σ)
            </span>
          </div>
        </div>

        <Link
          to="/decision-lab?tab=anomalies"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-[var(--rp-primary-ink)] bg-[var(--rp-primary-soft)] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
        >
          <span>Inspect in Decision Lab</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    ) : null;

  return (
    <BiDashboardWorkspace
      dashboardId={activeDashboard}
      showDataStateBanner={true}
      headerTabs={headerTabs}
      topBanner={anomalyBanner}
    />
  );
};
