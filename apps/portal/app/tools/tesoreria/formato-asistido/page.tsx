"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUpload, apiUploadDownload } from "@/lib/api";

const APP_KEY = "tesoreria_automatizacion_saldos";
const ASYNC_THRESHOLD = 3;

type Summary = {
  statements: number;
  movements: number;
  banks: string[];
  accounts: number;
  ocr_statements: number;
};

type Statement = {
  id: string;
  source_file: string;
  bank: string;
  ocr_used: boolean;
  account_holder: string | null;
  account_number: string | null;
  clabe: string | null;
  contract: string | null;
  alias: string | null;
  currency: string | null;
  period_start: string | null;
  period_end: string | null;
  period_label: string | null;
  statement_date: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  total_debits: number | null;
  total_credits: number | null;
  warnings: string[];
  raw_text: string;
};

type AnalysisResponse = {
  summary: Summary;
  columns: string[];
  statements: Statement[];
  movements: Array<Record<string, unknown>>;
};

type BalanceUpdate = {
  id: string;
  row_number: number;
  bank: string | null;
  account_label: string | null;
  column_key: "pesos" | "dolares";
  current_value: number | null;
  new_value: number | null;
  statement_id: string;
  statement_label: string;
  confidence: number;
  reason: string;
  enabled: boolean;
};

type BalanceTemplateResponse = {
  filename: string;
  sheet_name: string;
  updates: BalanceUpdate[];
  unmatched_statements: string[];
};

type PreparedBalancesResponse = {
  analysis: AnalysisResponse;
  balances_template: BalanceTemplateResponse | null;
};

type JobResult = {
  id: string;
  app_key: string;
  status: string;
};

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";
  return new Date(`${value}T12:00:00`).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(value);
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function isPdfFile(file: File) {
  return file.name.toLowerCase().endsWith(".pdf");
}

function filterPdfFiles(files: File[]) {
  return files.filter(isPdfFile);
}

function mergeFiles(current: File[], incoming: File[]) {
  const map = new Map<string, File>();
  [...current, ...incoming].forEach((file) => map.set(fileKey(file), file));
  return Array.from(map.values());
}

function statementLabel(statement: Statement) {
  return statement.account_number || statement.contract || statement.source_file;
}

function balanceLabel(update: BalanceUpdate) {
  return update.column_key === "dolares" ? "Saldo B dólares" : "Saldo B pesos";
}

export default function TesoreriaFormatoAsistidoPage() {
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [balanceTemplateFile, setBalanceTemplateFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submittingJob, setSubmittingJob] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [balanceTemplate, setBalanceTemplate] = useState<BalanceTemplateResponse | null>(null);
  const [balanceUpdates, setBalanceUpdates] = useState<BalanceUpdate[]>([]);

  const [copiedRow, setCopiedRow] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabledCount = useMemo(() => balanceUpdates.filter((item) => item.enabled).length, [balanceUpdates]);
  const suggestAsync = files.length > ASYNC_THRESHOLD;

  const copyRow = useCallback((statement: Statement) => {
    const parts = [
      statement.bank,
      statement.account_number || statement.contract || "",
      statement.source_file,
      statement.period_start || statement.period_end
        ? `${statement.period_start || "?"} a ${statement.period_end || "?"}`
        : statement.period_label || statement.statement_date || "",
      statement.closing_balance != null ? statement.closing_balance.toString() : "",
    ];
    const text = parts.join("\t");
    navigator.clipboard.writeText(text).then(() => {
      setCopiedRow(statement.id);
      setToast(`Copiado: ${statement.bank} · ${statement.account_number || statement.source_file}`);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => {
        setToast(null);
        setCopiedRow(null);
      }, 1800);
    });
  }, []);

  function clearResults() {
    setAnalysis(null);
    setBalanceTemplate(null);
    setBalanceUpdates([]);
  }

  function handlePdfSelection(nextFiles: File[]) {
    clearResults();
    const accepted = filterPdfFiles(nextFiles);
    if (!accepted.length) {
      setFiles([]);
      setError("Selecciona al menos un archivo PDF válido.");
      return;
    }

    setError(nextFiles.length !== accepted.length ? "Se ignoraron archivos que no eran PDF." : null);
    setFiles((current) => mergeFiles(current, accepted));
  }

  async function analyzeStatements() {
    if (!files.length) {
      setError("Debes subir al menos un PDF.");
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const data = await apiUpload<AnalysisResponse>("/tools/tesoreria/bank-movements/analyze", formData);
      setAnalysis(data);
      setBalanceTemplate(null);
      setBalanceUpdates([]);
    } catch (err: any) {
      setError(err?.message || "No se pudo analizar la información bancaria.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function prepareBalances() {
    if (!analysis) {
      setError("Primero analiza los PDFs bancarios.");
      return;
    }
    if (!balanceTemplateFile) {
      setError("Sube el Excel de saldos diarios.");
      return;
    }

    setPreparing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("analysis_json", JSON.stringify(analysis));
      formData.append("balances_template", balanceTemplateFile);

      const data = await apiUpload<PreparedBalancesResponse>("/tools/tesoreria/bank-movements/prepare", formData);
      setAnalysis(data.analysis);
      setBalanceTemplate(data.balances_template);
      setBalanceUpdates(data.balances_template?.updates || []);
    } catch (err: any) {
      setError(err?.message || "No se pudo preparar la actualización de saldos.");
    } finally {
      setPreparing(false);
    }
  }

  async function exportBalances() {
    if (!balanceTemplateFile) {
      setError("Sube el Excel de saldos diarios.");
      return;
    }

    setExporting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("balances_template", balanceTemplateFile);
      formData.append("balance_updates_json", JSON.stringify(balanceUpdates));
      await apiUploadDownload("/tools/tesoreria/bank-movements/export", formData, "saldos_diarios_actualizados.zip");
    } catch (err: any) {
      setError(err?.message || "No se pudo generar el Excel de saldos.");
    } finally {
      setExporting(false);
    }
  }

  async function submitAsJob() {
    if (!files.length) {
      setError("Debes subir al menos un PDF.");
      return;
    }
    if (!balanceTemplateFile) {
      setError("Sube el Excel de saldos diarios antes de enviar como trabajo.");
      return;
    }

    setSubmittingJob(true);
    setError(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("inputs", f));
      fd.append("template", balanceTemplateFile);
      const job = await apiUpload<JobResult>(`/apps/${APP_KEY}/jobs`, fd);
      router.push(`/jobs/${job.id}`);
    } catch (err: any) {
      setError(err?.message || "No se pudo crear el trabajo en background.");
    } finally {
      setSubmittingJob(false);
    }
  }

  function toggleBalance(updateId: string) {
    setBalanceUpdates((current) =>
      current.map((item) => (item.id === updateId ? { ...item, enabled: !item.enabled } : item))
    );
  }

  return (
    <div className="treasury-wide">
      <p className="text-muted mb-4">
        <Link href="/apps">&larr; Aplicaciones</Link>
      </p>

      <section className="card treasury-hero mb-4">
        <div className="treasury-kicker">Tesorería</div>
        <h1>Actualización de saldos diarios</h1>
        <p>
          Esta vista es solo para saldos. Primero analiza los estados de cuenta PDF y después sube el Excel de saldos
          diarios para actualizar las columnas de pesos y dólares con el saldo final detectado por cuenta.
        </p>
        <div className="treasury-hero-grid">
          <div className="treasury-hero-card">
            <strong>Paso 1</strong>
            <span>Sube los PDFs bancarios y confirma los saldos detectados por cuenta.</span>
          </div>
          <div className="treasury-hero-card">
            <strong>Paso 2</strong>
            <span>Sube el Excel de saldos diarios para preparar la actualización sin releer los PDFs.</span>
          </div>
          <div className="treasury-hero-card">
            <strong>Salida</strong>
            <span>Excel de saldos actualizado, con opción de activar o quitar cada actualización antes de descargar.</span>
          </div>
        </div>
      </section>

      {error ? <div className="error-msg">{error}</div> : null}

      <div className="card mb-4 treasury-upload">
        <div
          className={`dropzone treasury-dropzone ${dragActive ? "active" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            handlePdfSelection(Array.from(event.dataTransfer.files));
          }}
        >
          <div className="treasury-drop-title">Arrastra aquí los estados de cuenta PDF</div>
          <div className="gi-helper">Esta app solo usará los saldos finales detectados por cuenta.</div>
        </div>

        <label className="treasury-file-field">
          <span>Seleccionar estados de cuenta PDF</span>
          <input
            type="file"
            accept=".pdf,application/pdf"
            multiple
            onChange={(event) => {
              handlePdfSelection(Array.from(event.target.files || []));
              event.currentTarget.value = "";
            }}
          />
          <small>
            {files.length
              ? `${files.length} PDF(s) cargado(s).`
              : "Elige uno o varios PDFs desde el selector normal si el arrastre no te funciona."}
          </small>
        </label>

        {files.length ? (
          <div className="treasury-file-chips">
            {files.map((file) => (
              <button
                key={fileKey(file)}
                type="button"
                className="treasury-file-chip"
                onClick={() => {
                  clearResults();
                  setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)));
                }}
              >
                {file.name} <span>×</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="treasury-actions">
          <button className="btn btn-primary" type="button" onClick={analyzeStatements} disabled={analyzing}>
            {analyzing ? "Analizando PDFs..." : "Analizar saldos"}
          </button>
          <span className="text-muted">
            {files.length ? `${files.length} PDF(s) listo(s)` : "Sin PDFs seleccionados"}
          </span>
        </div>

        {suggestAsync && balanceTemplateFile ? (
          <div className="treasury-async-hint">
            <p>
              Tienes <strong>{files.length} PDFs</strong>. Puedes procesar en background para no esperar aquí.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={submitAsJob}
              disabled={submittingJob}
            >
              {submittingJob ? "Enviando..." : "Procesar en background"}
            </button>
          </div>
        ) : null}
      </div>

      {/* Template upload for async mode: show before analysis if many PDFs */}
      {suggestAsync && !analysis ? (
        <div className="card mb-4 treasury-review-card">
          <div className="treasury-table-head">
            <div>
              <h3>Excel de saldos diarios</h3>
              <p>Sube la plantilla para poder enviar como trabajo en background, o analiza primero los PDFs para el flujo normal.</p>
            </div>
          </div>
          <div className="treasury-upload-grid">
            <label className="treasury-file-field">
              <span>Excel de saldos diarios</span>
              <input
                type="file"
                accept=".xlsx,.xlsm"
                onChange={(event) => {
                  setBalanceTemplate(null);
                  setBalanceUpdates([]);
                  const next = event.target.files?.[0] || null;
                  setBalanceTemplateFile(next);
                  event.currentTarget.value = "";
                }}
              />
              <small>
                {balanceTemplateFile
                  ? `Seleccionado: ${balanceTemplateFile.name}`
                  : "Sube el archivo que contiene los saldos por banco y cuenta."}
              </small>
            </label>
          </div>
        </div>
      ) : null}

      {analysis ? (
        <>
          <div className="card mb-4 treasury-review-card">
            <div className="treasury-table-head">
              <div>
                <h3>Preparar Excel de saldos</h3>
                <p>Con el análisis ya hecho, este paso solo arma la actualización del archivo de saldos diarios.</p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={prepareBalances}
                disabled={preparing || !balanceTemplateFile}
              >
                {preparing ? "Preparando saldos..." : "Preparar Excel de saldos"}
              </button>
            </div>

            <div className="treasury-upload-grid">
              <label className="treasury-file-field">
                <span>Excel de saldos diarios</span>
                <input
                  type="file"
                  accept=".xlsx,.xlsm"
                  onChange={(event) => {
                    setBalanceTemplate(null);
                    setBalanceUpdates([]);
                    const next = event.target.files?.[0] || null;
                    setBalanceTemplateFile(next);
                    event.currentTarget.value = "";
                  }}
                />
                <small>
                  {balanceTemplateFile
                    ? `Seleccionado: ${balanceTemplateFile.name}`
                    : "Sube el archivo que contiene los saldos por banco y cuenta."}
                </small>
              </label>
            </div>

            {preparing ? (
              <div className="treasury-progress-note">
                Empatando cuentas del Excel con los saldos finales encontrados en los PDFs analizados...
              </div>
            ) : null}
          </div>

          <div className="treasury-summary-grid mb-4">
            <div className="card treasury-summary-card">
              <span>Estados analizados</span>
              <strong>{analysis.summary.statements}</strong>
            </div>
            <div className="card treasury-summary-card">
              <span>Cuentas detectadas</span>
              <strong>{analysis.summary.accounts}</strong>
            </div>
            <div className="card treasury-summary-card">
              <span>Bancos encontrados</span>
              <strong>{analysis.summary.banks.length}</strong>
            </div>
            <div className="card treasury-summary-card">
              <span>PDFs con OCR</span>
              <strong>{analysis.summary.ocr_statements}</strong>
            </div>
          </div>

          <div className="card mb-4 treasury-review-card">
            <div className="treasury-table-head">
              <div>
                <h3>Actualizaciones propuestas</h3>
                <p>
                  {balanceTemplate ? `${enabledCount} saldo(s) activos para exportar en ${balanceTemplate.sheet_name}.` : "Sin plantilla preparada."}
                </p>
              </div>
              <button type="button" className="btn btn-primary" onClick={exportBalances} disabled={exporting || !balanceTemplate}>
                {exporting ? "Generando Excel..." : "Descargar Excel de saldos"}
              </button>
            </div>

            {balanceTemplate ? (
              <>
                <div className="treasury-prep-grid">
                  <div className="treasury-prep-card">
                    <strong>{balanceTemplate.filename}</strong>
                    <span>{enabledCount} actualización(es) quedarán aplicadas.</span>
                    {balanceTemplate.unmatched_statements.length ? (
                      <small>Sin match automático: {balanceTemplate.unmatched_statements.join(", ")}</small>
                    ) : (
                      <small>Todas las cuentas detectadas tuvieron match automático.</small>
                    )}
                  </div>
                </div>

                <div className="treasury-balance-list">
                  {balanceUpdates.map((update) => (
                    <label key={update.id} className="treasury-balance-item">
                      <input type="checkbox" checked={update.enabled} onChange={() => toggleBalance(update.id)} />
                      <div>
                        <strong>
                          {update.bank || "Banco"} · {update.account_label || "Cuenta"}
                        </strong>
                        <span>
                          {balanceLabel(update)}: {formatMoney(update.current_value)} → {formatMoney(update.new_value)}
                        </span>
                        <small>
                          {update.statement_label} · {update.reason}
                        </small>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <div className="card treasury-table-card">
            <div className="treasury-table-head">
              <div>
                <h3>Saldos detectados por estado</h3>
                <p>Vista rápida de los saldos finales encontrados en los PDFs cargados.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="treasury-table">
                <thead>
                  <tr>
                    <th>Banco</th>
                    <th>Cuenta</th>
                    <th>Archivo</th>
                    <th>Periodo</th>
                    <th>Saldo final</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.statements.map((statement) => (
                    <tr
                      key={statement.id}
                      className={`treasury-clickable${copiedRow === statement.id ? " treasury-row-copied" : ""}`}
                      title="Clic para copiar esta fila"
                      onClick={() => copyRow(statement)}
                    >
                      <td>{statement.bank}</td>
                      <td>{statementLabel(statement)}</td>
                      <td>{statement.source_file}</td>
                      <td>
                        {statement.period_start || statement.period_end
                          ? `${statement.period_start || "?"} a ${statement.period_end || "?"}`
                          : statement.period_label || formatDate(statement.statement_date)}
                      </td>
                      <td>{formatMoney(statement.closing_balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {toast ? <div className="treasury-copy-toast">{toast}</div> : null}
    </div>
  );
}
