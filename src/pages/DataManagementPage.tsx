import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  GitCompare,
  Layers,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Upload
} from 'lucide-react';
import { usePlatform } from '../context/PlatformContext';
import { OlistTableKey } from '../types/analytics';
import {
  convertRowsToCsv,
  detectOlistTableFromFileAndHeaders,
  normalizeCsvHeader,
  validateCsvFileMetadata
} from '../utils/validators';
import { DataStateBanner } from '../components/ui/DataStateBanner';

interface QueuedCsvFile {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  csvContent: string;
  detectedTable: OlistTableKey | null;
  selectedTable: OlistTableKey | '';
  detectedHeaders: string[];
  estimatedRowCount: number;
  validationError: string | null;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'WARNING' | 'FAILED';
  progressPercent: number;
  resultMessage?: string;
}

const OLIST_CANONICAL_SAMPLES: Record<OlistTableKey, string> = {
  orders: `order_id,customer_id,order_status,order_purchase_timestamp,order_approved_at,order_delivered_carrier_date,order_delivered_customer_date,order_estimated_delivery_date
e481f51cbdc54678b7cc49136f2d6af7,9ef432eb6251297304e76186b10a928d,delivered,2017-10-02 10:56:33,2017-10-02 11:07:15,2017-10-04 19:55:00,2017-10-10 21:25:13,2017-10-18 00:00:00
53cdb2fc8bc7dce0b6741e2150273451,b0830fb4747a6c6d20dea0b8c802d7ef,delivered,2018-07-24 20:41:37,2018-07-26 03:24:27,2018-07-26 14:31:00,2018-08-07 15:27:45,2018-08-13 00:00:00`,
  customers: `customer_id,customer_unique_id,customer_zip_code_prefix,customer_city,customer_state
9ef432eb6251297304e76186b10a928d,7c396fd4830fd04220f754e42b4e5bff,03149,sao paulo,SP
b0830fb4747a6c6d20dea0b8c802d7ef,af07308b275d755c9edb36a90c618231,47813,barreiras,BA`,
  order_items: `order_id,order_item_id,product_id,seller_id,shipping_limit_date,price,freight_value
e481f51cbdc54678b7cc49136f2d6af7,1,87285b34884572647811a353c7ac498a,3504c0cb71d7fa48d967e0e4c94d59d9,2017-10-06 11:07:15,29.99,8.72
53cdb2fc8bc7dce0b6741e2150273451,1,595fac2a385ac33a80bd5114aec74eb8,289cdb325fb7e7f891c38608bf9e0962,2018-07-30 03:24:27,118.70,22.76`,
  payments: `order_id,payment_sequential,payment_type,payment_installments,payment_value
e481f51cbdc54678b7cc49136f2d6af7,1,credit_card,1,18.12
e481f51cbdc54678b7cc49136f2d6af7,2,voucher,1,20.59
53cdb2fc8bc7dce0b6741e2150273451,1,boleto,1,141.46`,
  reviews: `review_id,order_id,review_score,review_comment_title,review_comment_message,review_creation_date,review_answer_timestamp
a54f0611adc9ed256b57ede6b6eb5114,e481f51cbdc54678b7cc49136f2d6af7,4,Recomendo,Não testei o produto ainda,2017-10-11 00:00:00,2017-10-12 03:43:48
8d5266042046a06655c8db133d120ba5,53cdb2fc8bc7dce0b6741e2150273451,4,Muito bom,Chegou antes do prazo,2018-08-08 00:00:00,2018-08-08 18:37:50`,
  products: `product_id,product_category_name,product_name_lenght,product_description_lenght,product_photos_qty,product_weight_g,product_length_cm,product_height_cm,product_width_cm
87285b34884572647811a353c7ac498a,utilidades_domesticas,40,268,4,500,19,8,13
595fac2a385ac33a80bd5114aec74eb8,perfumaria,29,178,1,400,19,13,19`,
  sellers: `seller_id,seller_zip_code_prefix,seller_city,seller_state
3504c0cb71d7fa48d967e0e4c94d59d9,09350,maua,SP
289cdb325fb7e7f891c38608bf9e0962,31570,belo horizonte,MG`,
  category_translations: `product_category_name,product_category_name_english
utilidades_domesticas,housewares
perfumaria,perfumery
informatica_acessorios,computers_accessories`,
  geolocation: `geolocation_zip_code_prefix,geolocation_lat,geolocation_lng,geolocation_city,geolocation_state
01001,-23.54929199999999,-46.633559478233785,sao paulo,SP
03149,-23.583182,-46.582721,sao paulo,SP`
};

const OLIST_DIRTY_SAMPLE_ORDERS = `order_id,customer_id,order_status,order_purchase_timestamp,order_approved_at,order_delivered_carrier_date,order_delivered_customer_date,order_estimated_delivery_date
e481f51cbdc54678b7cc49136f2d6af7,9ef432eb6251297304e76186b10a928d,delivered,2017-10-02 10:56:33,2017-10-02 11:07:15,2017-10-04 19:55:00,2017-10-10 21:25:13,2017-10-18 00:00:00
e481f51cbdc54678b7cc49136f2d6af7,9ef432eb6251297304e76186b10a928d,delivered,2017-10-02 10:56:33,2017-10-02 11:07:15,2017-10-04 19:55:00,2017-10-10 21:25:13,2017-10-18 00:00:00
bad_date_order_991,b0830fb4747a6c6d20dea0b8c802d7ef,shipped,2018-99-45 25:00:00,,,,2018-08-13 00:00:00
,b0830fb4747a6c6d20dea0b8c802d7ef,processing,2018-07-24 20:41:37,,,,2018-08-13 00:00:00`;

export const DataManagementPage: React.FC = () => {
  const {
    datasets,
    importHistory,
    rejectedRecords,
    relationships,
    totalRows,
    totalStagingRows,
    totalRejectedRows,
    actionLoading,
    seedDemoDataset,
    clearAllDatasets,
    uploadCsvDataset
  } = usePlatform();

  const [selectedTable, setSelectedTable] = useState<OlistTableKey>('orders');
  const [uploadMode, setUploadMode] = useState<'replace' | 'append'>('append');
  const [csvContent, setCsvContent] = useState<string>(OLIST_CANONICAL_SAMPLES.orders);
  const [queuedFiles, setQueuedFiles] = useState<QueuedCsvFile[]>([]);
  const [batchProcessing, setBatchProcessing] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [activeView, setActiveView] = useState<'upload' | 'tables' | 'audit'>('upload');
  const [uploadStatus, setUploadStatus] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const activeTableSchema = datasets.find((d) => d.tableName === selectedTable) || datasets[0];

  const handleTableSelect = (tbl: OlistTableKey) => {
    setSelectedTable(tbl);
    setUploadStatus(null);
    if (OLIST_CANONICAL_SAMPLES[tbl]) {
      setCsvContent(OLIST_CANONICAL_SAMPLES[tbl]);
    }
  };

  const inspectFileContent = (file: File, text: string): QueuedCsvFile => {
    const metaValidation = validateCsvFileMetadata(file.name, file.size);
    const cleanText = text.replace(/^\uFEFF/, '').trim();
    const firstNewline = cleanText.indexOf('\n');
    const headerLine =
      firstNewline !== -1 ? cleanText.slice(0, firstNewline).replace(/\r$/, '') : cleanText;
    const headers = headerLine
      .split(',')
      .map(normalizeCsvHeader)
      .filter((h) => h.length > 0);

    let lineCount = 0;
    for (let i = 0; i < cleanText.length; i++) {
      if (cleanText.charCodeAt(i) === 10) lineCount++;
    }

    const detected = detectOlistTableFromFileAndHeaders(file.name, headers);
    let validationError: string | null = null;
    if (!metaValidation.valid) {
      validationError = metaValidation.error || 'Invalid file metadata';
    } else if (lineCount < 1 || headers.length === 0) {
      validationError = 'CSV must contain a header row and at least 1 data row.';
    } else if (!detected) {
      validationError = 'Unrecognized Olist schema headers. Select a target table manually.';
    }

    return {
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fileName: file.name,
      fileSizeBytes: file.size,
      csvContent: text,
      detectedTable: detected,
      selectedTable: detected || '',
      detectedHeaders: headers,
      estimatedRowCount: lineCount,
      validationError,
      status: validationError && !detected ? 'QUEUED' : validationError ? 'FAILED' : 'QUEUED',
      progressPercent: 0
    };
  };

  const enqueueFiles = async (filesArray: File[]) => {
    if (filesArray.length === 0) return;
    const inspected: QueuedCsvFile[] = [];

    for (const file of filesArray) {
      if (!file.name.toLowerCase().endsWith('.csv') || file.size === 0) {
        inspected.push(inspectFileContent(file, ''));
        continue;
      }
      const text = await file.text();
      inspected.push(inspectFileContent(file, text));
    }

    setQueuedFiles((prev) => [...inspected, ...prev]);
  };

  const handleMultiFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    await enqueueFiles(Array.from(fileList));
    e.target.value = '';
  };

  const handleDropZoneDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const droppedFiles = e.dataTransfer?.files;
    if (!droppedFiles || droppedFiles.length === 0) return;
    await enqueueFiles(Array.from(droppedFiles));
  };

  const handleProcessQueue = async () => {
    if (queuedFiles.length === 0) return;
    setBatchProcessing(true);
    setUploadStatus(null);

    let totalInserted = 0;
    let totalRejected = 0;
    let filesSucceeded = 0;

    for (let idx = 0; idx < queuedFiles.length; idx++) {
      const item = queuedFiles[idx];
      if (item.status === 'COMPLETED' || !item.selectedTable) continue;

      setQueuedFiles((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, status: 'PROCESSING', progressPercent: 45 } : q
        )
      );

      try {
        const res = await uploadCsvDataset({
          tableName: item.selectedTable,
          fileName: item.fileName,
          fileSizeBytes: item.fileSizeBytes,
          csvContent: item.csvContent,
          mode: uploadMode
        });

        totalInserted += res.rowsInserted;
        totalRejected += res.rejectedRowsCount;
        filesSucceeded++;

        setQueuedFiles((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: res.rejectedRowsCount > 0 ? 'WARNING' : 'COMPLETED',
                  progressPercent: 100,
                  validationError: null,
                  resultMessage: `Staged ${res.stagingRowsRead} rows -> Cleaned ${res.rowsInserted} rows (${res.rejectedRowsCount} rejected)`
                }
              : q
          )
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Upload failed';
        setQueuedFiles((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  status: 'FAILED',
                  progressPercent: 100,
                  validationError: errMsg
                }
              : q
          )
        );
      }
    }

    setBatchProcessing(false);
    setUploadStatus({
      type: totalRejected > 0 ? 'warning' : 'success',
      message: `Processed ${filesSucceeded} file(s): inserted ${totalInserted.toLocaleString()} cleaned analytical rows and isolated ${totalRejected.toLocaleString()} rejected record(s).`
    });
  };

  const handleSubmitDirectCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadStatus(null);
    const activeMeta = datasets.find((d) => d.tableName === selectedTable);
    const defaultFileName = activeMeta?.expectedOlistFilename || `${selectedTable}.csv`;

    try {
      const res = await uploadCsvDataset({
        tableName: selectedTable,
        fileName: defaultFileName,
        fileSizeBytes: new Blob([csvContent]).size,
        csvContent,
        mode: uploadMode
      });
      setUploadStatus({
        type: res.rejectedRowsCount > 0 ? 'warning' : 'success',
        message: `[${res.batchReport.fileName}] Staged ${res.stagingRowsRead} raw rows in stg_${res.tableName} -> Inserted ${res.rowsInserted} cleaned rows into ${res.tableName} (${res.totalRowsAfter} total). Rejected records isolated: ${res.rejectedRowsCount}.`
      });
    } catch (err) {
      setUploadStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'CSV upload failed validation.'
      });
    }
  };

  const handleDownloadRejectedCsv = () => {
    if (rejectedRecords.length === 0) return;
    const cols = [
      { name: 'rejectionId' },
      { name: 'batchId' },
      { name: 'sourceFile' },
      { name: 'targetTable' },
      { name: 'rowNumber' },
      { name: 'recordKey' },
      { name: 'rejectionReason' },
      { name: 'details' },
      { name: 'rawPayload' },
      { name: 'detectedAt' }
    ];
    const csv = convertRowsToCsv(
      cols,
      rejectedRecords as unknown as Record<string, unknown>[]
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'olist_rejected_records_report.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const verifiedRelCount = relationships.filter((r) => r.status === 'VERIFIED').length;

  return (
    <div className="space-y-6">
      <DataStateBanner />

      {/* Clean Page Header & KPI Strip */}
      <div className="studio-card rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h1 className="text-xl font-bold text-slate-50 tracking-tight">
              Datasets &amp; CSV Import
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Drag and drop or browse one or multiple Olist CSV datasets with automatic column matching, staging preservation, and non-destructive validation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={actionLoading || batchProcessing}
              onClick={() => void seedDemoDataset()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#1a73e8] hover:bg-[#2b7de9] disabled:opacity-50 rounded-lg shadow-sm shadow-blue-950/40 transition-colors whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Load Sample</span>
            </button>
            <button
              type="button"
              disabled={actionLoading || batchProcessing}
              onClick={() => void clearAllDatasets()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* 4-Metric Architecture Strip */}
        <div className="pt-4 border-t border-slate-800/80 grid grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs">
          <div className="relative overflow-hidden p-3.5 bg-slate-950/65 border border-slate-800/90 rounded-lg">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#4285F4] to-[#60A5FA]" />
            <div className="text-slate-400">Staging Records</div>
            <div className="text-lg font-bold font-mono tabular-nums text-[#8ab4f8] mt-0.5">
              {totalStagingRows.toLocaleString()}
            </div>
          </div>

          <div className="relative overflow-hidden p-3.5 bg-slate-950/65 border border-slate-800/90 rounded-lg">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#34A853] to-[#34D399]" />
            <div className="text-slate-400">Cleaned Rows</div>
            <div className="text-lg font-bold font-mono tabular-nums text-emerald-400 mt-0.5">
              {totalRows.toLocaleString()}
            </div>
          </div>

          <div className="relative overflow-hidden p-3.5 bg-slate-950/65 border border-slate-800/90 rounded-lg">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#F59E0B] to-[#FBBF24]" />
            <div className="text-slate-400">Rejected Rows</div>
            <div className="text-lg font-bold font-mono tabular-nums text-amber-400 mt-0.5">
              {totalRejectedRows.toLocaleString()}
            </div>
          </div>

          <div className="relative overflow-hidden p-3.5 bg-slate-950/65 border border-slate-800/90 rounded-lg">
            <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA]" />
            <div className="text-slate-400">Verified Joins</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-100 mt-0.5">
              {verifiedRelCount} / {relationships.length}
            </div>
          </div>
        </div>

        {/* Clean Google Cloud Underline Tab Bar */}
        <div className="flex items-center gap-1 border-b border-slate-800 -mb-5 -mx-5 px-5" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'upload'}
            onClick={() => setActiveView('upload')}
            className={`px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
              activeView === 'upload'
                ? 'border-[#8ab4f8] text-[#8ab4f8]'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            Upload
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'tables'}
            onClick={() => setActiveView('tables')}
            className={`px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
              activeView === 'tables'
                ? 'border-[#8ab4f8] text-[#8ab4f8]'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            Tables ({datasets.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'audit'}
            onClick={() => setActiveView('audit')}
            className={`px-3.5 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap cursor-pointer ${
              activeView === 'audit'
                ? 'border-[#8ab4f8] text-[#8ab4f8]'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            Audit Log ({totalRejectedRows})
          </button>
        </div>
      </div>

      {/* Tab 1: Multi-File Olist CSV Upload & Direct Ingestion Workbench */}
      {activeView === 'upload' && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Interactive Drag-and-Drop Multi-File Olist CSV Uploader */}
        <div className="lg:col-span-6 studio-card rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Multi-File Olist CSV Upload Queue
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Drop or select Olist <code className="font-mono">.csv</code> files for automatic column matching, staging, and validation.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400">Max 200 MB / file</span>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isDragging) setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={(e) => void handleDropZoneDrop(e)}
            className={`relative p-6 rounded-xl border-2 border-dashed transition-all text-center space-y-3 ${
              isDragging
                ? 'border-[#4285F4] bg-[#4285F4]/10 shadow-[0_0_24px_rgba(66,133,244,0.2)]'
                : 'border-slate-700/80 bg-slate-950/60 hover:border-[#4285F4]/60'
            }`}
          >
            <div
              className={`w-11 h-11 mx-auto rounded-full flex items-center justify-center border transition-colors ${
                isDragging
                  ? 'bg-[#4285F4]/20 border-[#4285F4] text-[#8ab4f8]'
                  : 'bg-[#1a2842]/80 border-[#4285F4]/30 text-[#8ab4f8]'
              }`}
            >
              <Upload className="w-5 h-5" />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-100">
                {isDragging
                  ? 'Drop Olist CSV files to inspect & queue'
                  : 'Drag & drop Olist CSV files here'}
              </div>
              <div className="text-[11px] text-slate-400">
                Supports <span className="font-mono text-slate-300">orders</span>,{' '}
                <span className="font-mono text-slate-300">customers</span>,{' '}
                <span className="font-mono text-slate-300">order_items</span>,{' '}
                <span className="font-mono text-slate-300">payments</span>,{' '}
                <span className="font-mono text-slate-300">reviews</span>,{' '}
                <span className="font-mono text-slate-300">products</span>, and{' '}
                <span className="font-mono text-slate-300">sellers</span>
              </div>
            </div>

            <div className="pt-1">
              <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1a73e8] hover:bg-[#2b7de9] rounded-lg shadow-sm shadow-blue-950/40 cursor-pointer whitespace-nowrap transition-colors">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Browse CSV</span>
                <input
                  type="file"
                  multiple
                  accept=".csv,text/csv"
                  onChange={(e) => void handleMultiFileSelect(e)}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {queuedFiles.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Queued ({queuedFiles.length})</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setQueuedFiles([])}
                    className="text-slate-400 hover:text-slate-200 whitespace-nowrap cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={batchProcessing || actionLoading}
                    onClick={() => void handleProcessQueue()}
                    className="px-3 py-1.5 font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-md whitespace-nowrap cursor-pointer"
                  >
                    {batchProcessing ? 'Importing...' : 'Import'}
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {queuedFiles.map((qf) => (
                  <div
                    key={qf.id}
                    className="p-3 bg-slate-950 border border-slate-800 rounded-md text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-medium text-slate-100 truncate">
                        {qf.fileName}
                      </span>
                      <span className="font-mono tabular-nums text-slate-400 shrink-0">
                        {(qf.fileSizeBytes / 1024).toFixed(1)} KB · ~{qf.estimatedRowCount} rows
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span>
                        Target Table:{' '}
                        <strong className="font-mono text-sky-400">
                          {qf.selectedTable || 'UNRECOGNIZED'}
                        </strong>{' '}
                        ({qf.detectedHeaders.length} cols detected)
                      </span>
                      <span
                        className={`font-mono ${
                          qf.status === 'COMPLETED'
                            ? 'text-emerald-400'
                            : qf.status === 'WARNING'
                            ? 'text-amber-400'
                            : qf.status === 'FAILED'
                            ? 'text-red-400'
                            : 'text-sky-400'
                        }`}
                      >
                        {qf.status} ({qf.progressPercent}%)
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
                      <div
                        className={`h-full transition-opacity ${
                          qf.status === 'FAILED'
                            ? 'bg-red-500'
                            : qf.status === 'WARNING'
                            ? 'bg-amber-400'
                            : 'bg-sky-500'
                        }`}
                        style={{ width: `${Math.max(qf.progressPercent, 8)}%` }}
                      />
                    </div>

                    {qf.validationError && (
                      <div className="text-red-300 font-mono text-[11px]">{qf.validationError}</div>
                    )}
                    {qf.resultMessage && (
                      <div className="text-emerald-300 font-mono text-[11px]">
                        {qf.resultMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Direct CSV Payload Workbench */}
          <form onSubmit={(e) => void handleSubmitDirectCsv(e)} className="pt-3 border-t border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-200">
                Direct CSV Editor
              </div>
              <button
                type="button"
                title="Load a test orders payload with duplicate PK, invalid date, and missing PK"
                onClick={() => {
                  setSelectedTable('orders');
                  setCsvContent(OLIST_DIRTY_SAMPLE_ORDERS);
                  setUploadStatus(null);
                }}
                className="text-xs font-medium text-amber-400 hover:text-amber-300 whitespace-nowrap cursor-pointer"
              >
                Load Test Errors
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="target-table-select"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Target Olist Table
                </label>
                <select
                  id="target-table-select"
                  value={selectedTable}
                  onChange={(e) => handleTableSelect(e.target.value as OlistTableKey)}
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  {datasets.map((d) => (
                    <option key={d.tableName} value={d.tableName}>
                      {d.tableName} — {d.expectedOlistFilename} ({d.rowCount} rows)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="write-mode-select"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Ingestion Mode
                </label>
                <select
                  id="write-mode-select"
                  value={uploadMode}
                  onChange={(e) => setUploadMode(e.target.value as 'append' | 'replace')}
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="append">Append (preserving existing records)</option>
                  <option value="replace">Replace (clean reload of target table)</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="csv-payload-textarea"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                CSV Payload ({activeTableSchema?.expectedOlistFilename})
              </label>
              <textarea
                id="csv-payload-textarea"
                rows={5}
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                className="w-full p-3 text-xs font-mono bg-slate-950 border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-sky-500 leading-relaxed"
              />
            </div>

            {uploadStatus && (
              <div
                role="alert"
                className={`p-3 rounded-md border text-xs ${
                  uploadStatus.type === 'success'
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
                    : uploadStatus.type === 'warning'
                    ? 'bg-amber-950/40 border-amber-800/80 text-amber-200'
                    : 'bg-red-950/50 border-red-800/80 text-red-200'
                }`}
              >
                <div className="flex items-start gap-2">
                  {uploadStatus.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : uploadStatus.type === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  ) : (
                    <FileText className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <span>{uploadStatus.message}</span>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={actionLoading || batchProcessing}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#1a73e8] hover:bg-[#2b7de9] disabled:opacity-50 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{actionLoading ? 'Importing...' : 'Import CSV'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right: Active Table Schema & Grain Inspector */}
        <div className="lg:col-span-6 studio-card rounded-xl p-5 space-y-4">
          {activeTableSchema && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                    <span className="text-sky-400">{activeTableSchema.expectedOlistFilename}</span>
                    <span aria-hidden="true">·</span>
                    <span>Staging: {activeTableSchema.stagingTableName}</span>
                  </div>
                  <h2 className="text-base font-semibold text-slate-100 mt-0.5">
                    {activeTableSchema.displayName} ({activeTableSchema.tableName})
                  </h2>
                </div>
                <span className="text-xs font-mono tabular-nums text-emerald-400">
                  {activeTableSchema.rowCount.toLocaleString()} cleaned rows
                </span>
              </div>

              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-md text-xs space-y-1">
                <div>
                  <strong className="text-slate-200">Table Grain:</strong>{' '}
                  <span className="font-mono text-sky-300">
                    {activeTableSchema.grainDescription}
                  </span>
                </div>
                <div className="text-slate-400">{activeTableSchema.description}</div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 pr-3 font-semibold">Column Name</th>
                      <th className="py-2 px-3 font-semibold">DuckDB Type</th>
                      <th className="py-2 px-3 font-semibold">Constraints</th>
                      <th className="py-2 pl-3 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {activeTableSchema.columns.map((col) => (
                      <tr key={col.name} className="h-8">
                        <td className="py-1.5 pr-3 font-mono text-slate-100">{col.name}</td>
                        <td className="py-1.5 px-3 font-mono text-sky-400">{col.type}</td>
                        <td className="py-1.5 px-3 font-mono text-[11px] text-slate-400">
                          {col.isPrimaryKey ? 'PK · NOT NULL' : col.nullable ? 'NULLABLE' : 'NOT NULL'}
                          {col.foreignKeyTo ? ` · FK -> ${col.foreignKeyTo}` : ''}
                        </td>
                        <td className="py-1.5 pl-3 text-slate-400">{col.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {/* Tab 2: Full Olist Dataset Inventory Matrix & Relationship Verification */}
      {activeView === 'tables' && (
      <div className="space-y-6">
      <div className="studio-card rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Olist Dataset Inventory (Staging Layer vs. Cleaned Analytical Layer)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Click any dataset row below to inspect its column schema and quality warnings.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            8 Required Olist Files + 1 Optional Geolocation Table
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-300">
                <th className="px-4 py-3 font-semibold">Analytical Table</th>
                <th className="px-4 py-3 font-semibold">Olist Source File</th>
                <th className="px-4 py-3 font-semibold">Staging (stg_*)</th>
                <th className="px-4 py-3 font-semibold text-right">Cleaned Rows</th>
                <th className="px-4 py-3 font-semibold text-right">Rejected</th>
                <th className="px-4 py-3 font-semibold text-right">Cols</th>
                <th className="px-4 py-3 font-semibold">Imported Timestamp</th>
                <th className="px-4 py-3 font-semibold">Status & Quality Warnings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {datasets.map((tbl) => (
                <tr
                  key={tbl.tableName}
                  onClick={() => handleTableSelect(tbl.tableName)}
                  className={`cursor-pointer transition-colors ${
                    selectedTable === tbl.tableName
                      ? 'bg-sky-500/10'
                      : 'hover:bg-slate-800/40'
                  }`}
                >
                  <td className="px-4 py-3 font-mono font-semibold text-sky-300 whitespace-nowrap">
                    {tbl.tableName}
                    {tbl.isOptional && (
                      <span className="ml-1.5 text-[10px] text-slate-500 font-normal">
                        (optional)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-300 whitespace-nowrap">
                    {tbl.lastImportedFile || tbl.expectedOlistFilename}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                    {tbl.stagingTableName} ({tbl.stagingRowCount.toLocaleString()})
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-100 font-medium">
                    {tbl.rowCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-400">
                    {tbl.rejectedRowCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">
                    {tbl.columnCount}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                    {tbl.lastUpdated ? new Date(tbl.lastUpdated).toLocaleTimeString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`font-mono text-[11px] ${
                          tbl.processingStatus === 'READY'
                            ? 'text-emerald-400'
                            : tbl.processingStatus === 'READY_WITH_WARNINGS'
                            ? 'text-amber-400'
                            : 'text-slate-500'
                        }`}
                      >
                        {tbl.processingStatus}
                      </span>
                      {tbl.qualitySummary.warnings.length > 0 && (
                        <span className="text-slate-400 truncate max-w-xs">
                          · {tbl.qualitySummary.warnings[0]}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Entity Relationship & Grain Verification Matrix */}
      <div className="studio-card rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-sky-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Olist Relational Integrity & Data Grain Verification Matrix
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Live SQL verification of all 7 required Olist foreign-key joins and grain rules.
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-300">
                <th className="px-4 py-3 font-semibold">Relationship</th>
                <th className="px-4 py-3 font-semibold">Join Key</th>
                <th className="px-4 py-3 font-semibold">Data Grain Rule</th>
                <th className="px-4 py-3 font-semibold text-right">Child Rows</th>
                <th className="px-4 py-3 font-semibold text-right">Matched Parent Rows</th>
                <th className="px-4 py-3 font-semibold text-right">Match Rate</th>
                <th className="px-4 py-3 font-semibold text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {relationships.map((rel) => (
                <tr key={rel.id} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-medium text-slate-100 whitespace-nowrap">
                    {rel.relationshipName}
                  </td>
                  <td className="px-4 py-3 font-mono text-sky-300 whitespace-nowrap">
                    {rel.childTable}.{rel.joinKey} = {rel.parentTable}.{rel.joinKey}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{rel.grainNote}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                    {rel.totalChildRows.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-400">
                    {rel.matchedRows.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-200">
                    {rel.matchRatePercent === null ? '—' : `${rel.matchRatePercent.toFixed(1)}%`}
                  </td>
                  <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                    <span
                      className={
                        rel.status === 'VERIFIED'
                          ? 'text-emerald-400'
                          : rel.status === 'PARTIAL_MATCH'
                          ? 'text-amber-400'
                          : 'text-slate-500'
                      }
                    >
                      {rel.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </div>
      )}

      {/* Tab 3: Rejected-Record Audit Report & Import Batch History */}
      {activeView === 'audit' && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 studio-card rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Rejected-Record Audit Report (audit_rejected_records)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Invalid rows are never silently deleted; they are preserved in staging and logged
                  here with exact row numbers and diagnostic causes.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={rejectedRecords.length === 0}
              onClick={handleDownloadRejectedCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-md whitespace-nowrap cursor-pointer shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>

          {rejectedRecords.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              0 rejected records in <code className="font-mono">audit_rejected_records</code>. Use
              &ldquo;Load Sample with Duplicate + Invalid Date + Missing PK&rdquo; above to test the
              rejected-record isolation pipeline.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-300">
                    <th className="px-4 py-2.5 font-semibold">Row #</th>
                    <th className="px-4 py-2.5 font-semibold">Table</th>
                    <th className="px-4 py-2.5 font-semibold">Record Key</th>
                    <th className="px-4 py-2.5 font-semibold">Reason</th>
                    <th className="px-4 py-2.5 font-semibold">Diagnostic Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {rejectedRecords.map((rec) => (
                    <tr key={rec.rejectionId} className="hover:bg-slate-800/40">
                      <td className="px-4 py-2 font-mono tabular-nums text-slate-300">
                        #{rec.rowNumber}
                      </td>
                      <td className="px-4 py-2 font-mono text-sky-300">{rec.targetTable}</td>
                      <td className="px-4 py-2 font-mono text-slate-200">{rec.recordKey}</td>
                      <td className="px-4 py-2 font-mono text-amber-400 whitespace-nowrap">
                        {rec.rejectionReason}
                      </td>
                      <td className="px-4 py-2 text-slate-300">{rec.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Import Batch History & Failed Imports Log */}
        <div className="lg:col-span-5 studio-card rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                Import Batch Log ({importHistory.length})
              </h2>
            </div>
          </div>

          {importHistory.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              No custom CSV import batches executed in this session yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70 max-h-80 overflow-y-auto">
              {importHistory.map((batch) => (
                <div key={batch.batchId} className="p-4 text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-slate-100 truncate">
                      {batch.fileName}
                    </span>
                    <span
                      className={`font-mono text-[11px] ${
                        batch.status === 'COMPLETED'
                          ? 'text-emerald-400'
                          : batch.status === 'COMPLETED_WITH_WARNINGS'
                          ? 'text-amber-400'
                          : 'text-red-400'
                      }`}
                    >
                      {batch.status} ({batch.durationMs} ms)
                    </span>
                  </div>
                  <div className="font-mono tabular-nums text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                    <span>Table: {batch.targetTable}</span>
                    <span>· Staged: {batch.stagingRowsRead}</span>
                    <span>· Cleaned: {batch.cleanedRowsInserted}</span>
                    <span>· Rejected: {batch.rejectedRowsCount}</span>
                  </div>
                  <div className="font-mono tabular-nums text-[11px] text-slate-500">
                    Duplicates: {batch.duplicateCount} · Missing Values: {batch.missingValueCount} ·
                    Invalid Dates: {batch.invalidDateCount}
                  </div>
                  {batch.errorMessage && (
                    <div className="text-red-300 font-mono text-[11px]">{batch.errorMessage}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
