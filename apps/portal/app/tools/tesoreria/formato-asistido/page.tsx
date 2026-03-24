"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { apiUpload, apiUploadDownload } from "@/lib/api";

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
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const templateInputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [balanceTemplateFile, setBalanceTemplateFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [balanceTemplate, setBalanceTemplate] = useState<BalanceTemplateResponse | null>(null);
  const [balanceUpdates, setBalanceUpdates] = useState<BalanceUpdate[]>([]);

  const enabledCount = useMemo(() => balanceUpdates.filter((item) => item.enabled).length, [balanceUpdates]);

  function clearResults() {
    setAnalysis(null);
    setBalanceTemplate(null);
    setBalanceUpdates([]);
  }

  async function prepareBalances() {
    if (!files.length) {
      setError("Debes subir al menos un PDF.");
      return;
    }
    if (!balanceTemplateFile) {
      setError("Sube el Excel de saldos diarios.");
      return;
    }

    setProcessing(true);
    setError(null);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("balances_template", balanceTemplateFile);

      const data = await apiUpload<PreparedBalancesResponse>("/tools/tesoreria/bank-movements/prepare", formData);
      setAnalysis(data.analysis);
      setBalanceTemplate(data.balances_template);
      setBalanceUpdates(data.balances_template?.updates || []);
    } catch (err: any) {
      setError(err?.message || "No se pudo preparar la actualización de saldos.");
    } finally {
      setProcessing(false);
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

  function toggleBalance(updateId: string) {
    setBalanceUpdates((current) =>
      current.map((item) => (item.id === updateId ? { ...item, enabled: !item.enabled } : item))
    );
  }

  return (
    <>
      <p className="text-muted mb-4">
        <Link href="/apps">&larr; Aplicaciones</Link>
      </p>

      <section className="card treasury-hero mb-4">
        <div className="treasury-kicker">Tesorería</div>
        <h1>Actualización de saldos diarios</h1>
        <p>
          Esta vista es solo para saldos. Sube los estados de cuenta PDF y el Excel de saldos diarios para actualizar
          las columnas de pesos y dólares con el saldo final detectado por cuenta.
        </p>
        <div className="treasury-hero-grid">
          <div className="treasury-hero-card">
            <strong>Entrada</strong>
            <span>PDFs bancarios y el Excel de saldos diarios que usa Tesorería.</span>
          </div>
          <div className="treasury-hero-card">
            <strong>Detección</strong>
            <span>Se empatan cuentas por banco, número y tipo para proponer el saldo correcto.</span>
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
          onClick={() => pdfInputRef.current?.click()}
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
            clearResults();
            setFiles((current) => mergeFiles(current, filterPdfFiles(Array.from(event.dataTransfer.files))));
          }}
        >
          <div className="treasury-drop-title">Arrastra aquí los estados de cuenta PDF</div>
          <div className="gi-helper">Esta app solo usará los saldos finales detectados por cuenta.</div>
        </div>

        <input
          ref={pdfInputRef}
          hidden
          type="file"
          accept=".pdf,application/pdf"
          multiple
          onChange={(event) => {
            clearResults();
            setFiles((current) => mergeFiles(current, filterPdfFiles(Array.from(event.target.files || []))));
            if (pdfInputRef.current) pdfInputRef.current.value = "";
          }}
        />

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

        <div className="treasury-template-grid">
          <button type="button" className="treasury-template-card" onClick={() => templateInputRef.current?.click()}>
            <strong>Excel de saldos diarios</strong>
            <span>{balanceTemplateFile ? balanceTemplateFile.name : "Sube el archivo que contiene los saldos por banco y cuenta."}</span>
          </button>
        </div>

        <input
          ref={templateInputRef}
          hidden
          type="file"
          accept=".xlsx,.xlsm"
          onChange={(event) => {
            clearResults();
            const next = event.target.files?.[0] || null;
            setBalanceTemplateFile(next);
            if (templateInputRef.current) templateInputRef.current.value = "";
          }}
        />

        <div className="treasury-actions">
          <button className="btn btn-primary" type="button" onClick={prepareBalances} disabled={processing}>
            {processing ? "Preparando saldos..." : "Detectar saldos"}
          </button>
          <span className="text-muted">
            {files.length ? `${files.length} PDF(s) listo(s)` : "Sin PDFs seleccionados"}
          </span>
        </div>
      </div>

      {analysis ? (
        <>
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
                    <tr key={statement.id}>
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
    </>
  );
}
