/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PlatformProvider } from './context/PlatformContext';
import { ThemeProvider } from './context/ThemeContext';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { DashboardsHubPage } from './pages/DashboardsHubPage';
import { AdvancedModelsPage } from './pages/AdvancedModelsPage';
import { DataManagementPage } from './pages/DataManagementPage';
import { DataQualityPage } from './pages/DataQualityPage';
import { SqlLabPage } from './pages/SqlLabPage';
import { BusinessInsightsPage } from './pages/BusinessInsightsPage';
import { ReportsExportsPage } from './pages/ReportsExportsPage';
import { DecisionLabPage } from './pages/DecisionLabPage';

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <PlatformProvider>
            <AppShell>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboards" replace />} />

                {/* Canonical 8 Workspaces */}
                <Route path="/dashboards" element={<DashboardsHubPage />} />
                <Route path="/analytics" element={<AdvancedModelsPage />} />
                <Route path="/decision-lab" element={<DecisionLabPage />} />
                <Route path="/business-insights" element={<BusinessInsightsPage />} />
                <Route path="/sql-lab" element={<SqlLabPage />} />
                <Route path="/data-management" element={<DataManagementPage />} />
                <Route path="/data-quality" element={<DataQualityPage />} />
                <Route path="/reports-exports" element={<ReportsExportsPage />} />

                {/* Backwards-compatible deep-link redirects */}
                <Route path="/executive-overview" element={<Navigate to="/dashboards" replace />} />
                <Route
                  path="/sales-intelligence"
                  element={<Navigate to="/dashboards?view=sales-intelligence" replace />}
                />
                <Route
                  path="/customer-intelligence"
                  element={<Navigate to="/dashboards?view=customer-intelligence" replace />}
                />
                <Route
                  path="/product-intelligence"
                  element={<Navigate to="/dashboards?view=product-intelligence" replace />}
                />
                <Route
                  path="/delivery-analytics"
                  element={<Navigate to="/dashboards?view=delivery-performance" replace />}
                />
                <Route
                  path="/customer-retention"
                  element={<Navigate to="/dashboards?view=customer-satisfaction" replace />}
                />
                <Route
                  path="/seller-performance"
                  element={<Navigate to="/analytics?model=seller-performance" replace />}
                />

                <Route path="*" element={<Navigate to="/dashboards" replace />} />
              </Routes>
            </AppShell>
          </PlatformProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
