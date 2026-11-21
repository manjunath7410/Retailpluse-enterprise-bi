import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  CsvUploadRequest,
  CsvUploadResult,
  DashboardFilterOptions,
  DashboardFilterState,
  DataMode,
  HealthStatus,
  ImportBatchReport,
  RejectedRecordItem,
  RelationshipVerificationItem,
  TableStatus
} from '../types/analytics';
import { apiClient } from '../services/apiClient';

const DEFAULT_DASHBOARD_FILTERS: DashboardFilterState = {
  startDate: '',
  endDate: '',
  category: 'ALL',
  state: 'ALL',
  orderStatus: 'ALL'
};

export interface ToastMessage {
  id: string;
  tone: 'success' | 'info' | 'warning' | 'error';
  title: string;
  detail?: string;
}

interface PlatformContextValue {
  health: HealthStatus | null;
  datasets: TableStatus[];
  importHistory: ImportBatchReport[];
  rejectedRecords: RejectedRecordItem[];
  relationships: RelationshipVerificationItem[];
  dataMode: DataMode;
  isDemonstrationData: boolean;
  totalRows: number;
  totalStagingRows: number;
  totalRejectedRows: number;
  populatedTableCount: number;
  loading: boolean;
  actionLoading: boolean;
  error: string | null;
  toasts: ToastMessage[];
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
  dashboardFilters: DashboardFilterState;
  filterOptions: DashboardFilterOptions | null;
  updateDashboardFilters: (patch: Partial<DashboardFilterState>) => void;
  resetDashboardFilters: () => void;
  refreshPlatformState: () => Promise<void>;
  seedDemoDataset: () => Promise<void>;
  clearAllDatasets: () => Promise<void>;
  uploadCsvDataset: (payload: CsvUploadRequest) => Promise<CsvUploadResult>;
}

const PlatformContext = createContext<PlatformContextValue | undefined>(undefined);

export const PlatformProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [datasets, setDatasets] = useState<TableStatus[]>([]);
  const [importHistory, setImportHistory] = useState<ImportBatchReport[]>([]);
  const [rejectedRecords, setRejectedRecords] = useState<RejectedRecordItem[]>([]);
  const [relationships, setRelationships] = useState<RelationshipVerificationItem[]>([]);
  const [dashboardFilters, setDashboardFilters] = useState<DashboardFilterState>(
    DEFAULT_DASHBOARD_FILTERS
  );
  const [filterOptions, setFilterOptions] = useState<DashboardFilterOptions | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const updateDashboardFilters = useCallback((patch: Partial<DashboardFilterState>) => {
    setDashboardFilters((prev) => ({
      ...prev,
      ...patch
    }));
  }, []);

  const resetDashboardFilters = useCallback(() => {
    setDashboardFilters(DEFAULT_DASHBOARD_FILTERS);
    pushToast({
      tone: 'info',
      title: 'Filters cleared',
      detail: 'All dashboards are now showing the full active dataset.'
    });
  }, [pushToast]);

  const refreshPlatformState = useCallback(async () => {
    setError(null);
    try {
      const [healthRes, summaryRes, filterOptsRes] = await Promise.all([
        apiClient.getHealth(),
        apiClient.getIngestionSummary(),
        apiClient.getDashboardFilterOptions().catch(() => null)
      ]);
      if (healthRes.data) setHealth(healthRes.data);
      if (summaryRes.data) {
        setDatasets(summaryRes.data.tables);
        setImportHistory(summaryRes.data.importHistory);
        setRejectedRecords(summaryRes.data.rejectedRecords);
        setRelationships(summaryRes.data.relationships);
      }
      if (filterOptsRes?.data) {
        setFilterOptions(filterOptsRes.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach DuckDB analytical backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPlatformState();
  }, [refreshPlatformState]);

  const seedDemoDataset = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      await apiClient.seedDemoData();
      await refreshPlatformState();
      pushToast({
        tone: 'success',
        title: 'Sample dataset loaded',
        detail: 'All 9 Olist benchmark tables are ready for exploration.'
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to seed demonstration data.';
      setError(msg);
      pushToast({ tone: 'error', title: 'Could not load sample data', detail: msg });
    } finally {
      setActionLoading(false);
    }
  }, [pushToast, refreshPlatformState]);

  const clearAllDatasets = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      await apiClient.clearDatasets();
      await refreshPlatformState();
      pushToast({
        tone: 'info',
        title: 'Warehouse cleared',
        detail: 'All tables have been reset to 0 rows. Upload CSVs or load sample data anytime.'
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to clear DuckDB tables.';
      setError(msg);
      pushToast({ tone: 'error', title: 'Failed to clear warehouse', detail: msg });
    } finally {
      setActionLoading(false);
    }
  }, [pushToast, refreshPlatformState]);

  const uploadCsvDataset = useCallback(
    async (payload: CsvUploadRequest): Promise<CsvUploadResult> => {
      setActionLoading(true);
      setError(null);
      try {
        const res = await apiClient.uploadCsv(payload);
        await refreshPlatformState();
        if (!res.data) {
          throw new Error('Empty upload response from server.');
        }
        pushToast({
          tone: res.data.rejectedRowsCount > 0 ? 'warning' : 'success',
          title: `Imported ${res.data.tableName}`,
          detail: `${res.data.rowsInserted.toLocaleString()} cleaned rows loaded${
            res.data.rejectedRowsCount > 0
              ? ` · ${res.data.rejectedRowsCount} rejected isolated`
              : ''
          }.`
        });
        return res.data;
      } finally {
        setActionLoading(false);
      }
    },
    [pushToast, refreshPlatformState]
  );

  const totalRows = datasets.reduce((acc, t) => acc + t.rowCount, 0);
  const totalStagingRows = datasets.reduce((acc, t) => acc + t.stagingRowCount, 0);
  const totalRejectedRows = datasets.reduce((acc, t) => acc + t.rejectedRowCount, 0);
  const populatedTableCount = datasets.filter((t) => t.isPopulated).length;
  const dataMode: DataMode = health?.dataMode ?? (totalRows > 0 ? 'DEMONSTRATION_DATA' : 'EMPTY');
  const isDemonstrationData = dataMode === 'DEMONSTRATION_DATA';

  return (
    <PlatformContext.Provider
      value={{
        health,
        datasets,
        importHistory,
        rejectedRecords,
        relationships,
        dataMode,
        isDemonstrationData,
        totalRows,
        totalStagingRows,
        totalRejectedRows,
        populatedTableCount,
        loading,
        actionLoading,
        error,
        toasts,
        pushToast,
        dismissToast,
        dashboardFilters,
        filterOptions,
        updateDashboardFilters,
        resetDashboardFilters,
        refreshPlatformState,
        seedDemoDataset,
        clearAllDatasets,
        uploadCsvDataset
      }}
    >
      {children}
    </PlatformContext.Provider>
  );
};

export function usePlatform(): PlatformContextValue {
  const ctx = useContext(PlatformContext);
  if (!ctx) {
    throw new Error('usePlatform must be used within a PlatformProvider');
  }
  return ctx;
}

