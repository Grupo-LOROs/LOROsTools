"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { apiUpload } from "@/lib/api";

type Summary = {
  statements: number;
  movements: number;
  banks: string[];
  accounts: number;
  ocr_statements: number;
};

type Movement = {
  statement_id: string;
  source_file: string;
  bank: string;
  sequence: number;
  account_number: string | null;
  account_holder: string | null;
  currency: string | null;
  movement_date: string | null;
  settlement_date: string | null;
  statement_date: string | null;
  time: string | null;
  branch: string | null;
  description: string | null;
  concept: string | null;
  long_description: string | null;
  reference: string | null;
  counterparty: string | null;
  movement_type: string | null;
  category: string | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  raw_text: string | null;
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
  movements: Movement[];
};

type AnalysisResponse = {
  summary: Summary;
  columns: string[];
  statements: Statement[];
  movements: Movement[];
};

const TSV_COLUMNS: Array<[keyof Movement | "amount_label", string]> = [
  ["bank", "Banco"],
  ["source_file", "Archivo"],
  ["account_number", "Cuenta"],
  ["account_holder", "Titular"],
  ["currency", "Divisa"],
  ["movement_date", "Fecha movimiento"],
  ["settlement_date", "Fecha liquidación"],
  ["time", "Hora"],
  ["movement_type", "Tipo"],
  ["category", "Clasificación"],
  ["description", "Descripción"],
  ["concept", "Concepto"],
  ["reference", "Referencia"],
  ["counterparty", "Contraparte"],
  ["debit", "Cargo"],
  ["credit", "Abono"],
  ["balance", "Saldo"],
];

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

function moneyCell(value: number | null) {
  return value == null ? "" : String(value);
}

function statementLabel(statement: Statement) {
  return statement.account_number || statement.contract || statement.source_file;
}

function movementBadge(item: Movement) {
  if (item.debit != null && item.debit > 0) return "Cargo";
  if (item.credit != null && item.credit > 0) return "Abono";
  return "Revisar";
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mergeFiles(current: File[], incoming: File[]) {
  const map = new Map<string, File>();
  [...current, ...incoming].forEach((file) => map.set(fileKey(file), file));
  return Array.from(map.values());
}

function rowsToTsv(rows: Movement[]) {
  const header = TSV_COLUMNS.map(([, label]) => label).join("\t");
  const body = rows.map((row) =>
    TSV_COLUMNS.map(([key]) => {
      if (key === "amount_label") return movementBadge(row);
      const value = row[key];
      if (typeof value === "number") return String(value);
      return (value || "").replace(/\t/g, " ").replace(/\n/g, " ");
    }).join("\t")
  );
  return [header, ...body].join("\n");
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

export default function TreasuryBankMovementsPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [bankFilter, setBankFilter] = useState<string>("all");
  const [copied, setCopied] = useState<string | null>(null);

  const selectedStatement = useMemo(
    () => analysis?.statements.find((item) => item.id === selectedId) || analysis?.statements[0] || null,
    [analysis, selectedId]
  );

  const filteredMovements = useMemo(() => {
    const list = analysis?.movements || [];
    return list.filter((item) => {
      if (bankFilter !== "all" && item.bank !== bankFilter) return false;
      if (!search.trim()) return true;
      const haystack = [
        item.bank,
        item.source_file,
        item.account_number,
        item.account_holder,
        item.description,
        item.concept,
        item.reference,
        item.counterparty,
        item.category,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search.trim().toLowerCase());
    });
  }, [analysis, bankFilter, search]);

  async function analyze() {
    if (!files.length) {
      setError("Debes subir al menos un PDF.");
      return;
    }

    setProcessing(true);
    setError(null);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const data = await apiUpload<AnalysisResponse>("/tools/tesoreria/bank-movements/analyze", formData);
      setAnalysis(data);
      setSelectedId(data.statements[0]?.id || null);
    } catch (err: any) {
      setError(err?.message || "No se pudo analizar la información bancaria.");
    } finally {
      setProcessing(false);
    }
  }

  async function handleCopy(label: string, text: string) {
    await copyToClipboard(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <>
      <p className="text-muted mb-4">
        <Link href="/apps">&larr; Aplicaciones</Link>
      </p>

      <section className="card treasury-hero mb-4">
        <div className="treasury-kicker">Tesorería</div>
        <h1>Captura de movimientos bancarios</h1>
        <p>
          Sube estados de cuenta PDF de distintos bancos, obtén una tabla normalizada y copia la información directo
          a Excel mientras se define el formato final.
        </p>
        <div className="treasury-hero-grid">
          <div className="treasury-hero-card">
            <strong>Entrada</strong>
            <span>PDFs de BBVA, Banregio, BanBajío, Monex y Santander.</span>
          </div>
          <div className="treasury-hero-card">
            <strong>Proceso</strong>
            <span>Lee texto nativo y usa OCR cuando el PDF viene escaneado.</span>
          </div>
          <div className="treasury-hero-card">
            <strong>Salida</strong>
            <span>Movimientos clasificados, listos para copiar y pegar.</span>
          </div>
        </div>
      </section>

      {error ? <div className="error-msg">{error}</div> : null}

      <div className="card mb-4 treasury-upload">
        <div
          className={`dropzone treasury-dropzone ${dragActive ? "active" : ""}`}
          onClick={() => inputRef.current?.click()}
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
            const dropped = Array.from(event.dataTransfer.files).filter((file) => file.name.toLowerCase().endsWith(".pdf"));
            setFiles((current) => mergeFiles(current, dropped));
          }}
        >
          <div className="treasury-drop-title">Arrastra aquí los estados de cuenta PDF</div>
          <div className="gi-helper">También puedes hacer clic para seleccionarlos. Puedes mezclar bancos.</div>
        </div>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".pdf"
          multiple
          onChange={(event) => {
            setFiles((current) => mergeFiles(current, Array.from(event.target.files || [])));
            if (inputRef.current) inputRef.current.value = "";
          }}
        />

        {files.length ? (
          <div className="treasury-file-chips">
            {files.map((file) => (
              <button
                key={fileKey(file)}
                type="button"
                className="treasury-file-chip"
                onClick={() => setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))}
              >
                {file.name} <span>×</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="treasury-actions">
          <button className="btn btn-primary" type="button" onClick={analyze} disabled={processing}>
            {processing ? "Analizando..." : "Analizar movimientos"}
          </button>
          <span className="text-muted">
            {files.length ? `${files.length} archivo(s) listo(s)` : "Sin archivos seleccionados"}
          </span>
          {copied ? <span className="treasury-copied">Copiado: {copied}</span> : null}
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
              <span>Movimientos detectados</span>
              <strong>{analysis.summary.movements}</strong>
            </div>
            <div className="card treasury-summary-card">
              <span>Cuentas detectadas</span>
              <strong>{analysis.summary.accounts}</strong>
            </div>
            <div className="card treasury-summary-card">
              <span>PDFs con OCR</span>
              <strong>{analysis.summary.ocr_statements}</strong>
            </div>
          </div>

          <div className="card mb-4 treasury-toolbar">
            <div className="treasury-toolbar-grid">
              <label>
                Buscar
                <input
                  type="text"
                  value={search}
                  placeholder="Descripción, referencia, contraparte..."
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                Banco
                <select value={bankFilter} onChange={(event) => setBankFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  {analysis.summary.banks.map((bank) => (
                    <option key={bank} value={bank}>
                      {bank}
                    </option>
                  ))}
                </select>
              </label>
              <div className="treasury-toolbar-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleCopy("tabla filtrada", rowsToTsv(filteredMovements))}
                  disabled={!filteredMovements.length}
                >
                  Copiar tabla
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => selectedStatement && handleCopy(selectedStatement.source_file, selectedStatement.raw_text)}
                  disabled={!selectedStatement}
                >
                  Copiar texto extraído
                </button>
              </div>
            </div>
          </div>

          <div className="treasury-layout">
            <aside className="card treasury-sidebar">
              <div className="treasury-sidebar-title">Estados cargados</div>
              <div className="treasury-statement-list">
                {analysis.statements.map((statement) => (
                  <button
                    key={statement.id}
                    type="button"
                    className={`treasury-statement-item ${selectedStatement?.id === statement.id ? "active" : ""}`}
                    onClick={() => setSelectedId(statement.id)}
                  >
                    <strong>{statement.bank}</strong>
                    <span>{statementLabel(statement)}</span>
                    <small>{statement.movements.length} movimiento(s)</small>
                    {statement.ocr_used ? <em>OCR</em> : null}
                  </button>
                ))}
              </div>
            </aside>

            <section className="card treasury-detail">
              {selectedStatement ? (
                <>
                  <div className="treasury-detail-head">
                    <div>
                      <div className="treasury-kicker">{selectedStatement.bank}</div>
                      <h2>{selectedStatement.source_file}</h2>
                      <p>{selectedStatement.account_holder || "Titular no detectado"}</p>
                    </div>
                    <div className="treasury-detail-actions">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => handleCopy(selectedStatement.source_file, rowsToTsv(selectedStatement.movements))}
                        disabled={!selectedStatement.movements.length}
                      >
                        Copiar esta cuenta
                      </button>
                    </div>
                  </div>

                  <div className="treasury-meta-grid">
                    <div>
                      <span>Cuenta</span>
                      <strong>{selectedStatement.account_number || "No detectada"}</strong>
                    </div>
                    <div>
                      <span>CLABE</span>
                      <strong>{selectedStatement.clabe || "No detectada"}</strong>
                    </div>
                    <div>
                      <span>Contrato</span>
                      <strong>{selectedStatement.contract || "No detectado"}</strong>
                    </div>
                    <div>
                      <span>Divisa</span>
                      <strong>{selectedStatement.currency || "No detectada"}</strong>
                    </div>
                    <div>
                      <span>Periodo</span>
                      <strong>
                        {selectedStatement.period_start || selectedStatement.period_end
                          ? `${selectedStatement.period_start || "?"} a ${selectedStatement.period_end || "?"}`
                          : selectedStatement.period_label || "No detectado"}
                      </strong>
                    </div>
                    <div>
                      <span>Saldo final</span>
                      <strong>{formatMoney(selectedStatement.closing_balance)}</strong>
                    </div>
                  </div>

                  {selectedStatement.warnings.length ? (
                    <div className="treasury-warning-list">
                      {selectedStatement.warnings.map((warning) => (
                        <div key={warning} className="treasury-warning">
                          {warning}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <details className="treasury-raw-box">
                    <summary>Ver texto extraído</summary>
                    <pre>{selectedStatement.raw_text}</pre>
                  </details>
                </>
              ) : (
                <p className="text-muted">Selecciona un estado de cuenta para ver su detalle.</p>
              )}
            </section>
          </div>

          <div className="card treasury-table-card">
            <div className="treasury-table-head">
              <div>
                <h3>Tabla lista para copiar</h3>
                <p>{filteredMovements.length} movimiento(s) con los filtros actuales.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="treasury-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Banco</th>
                    <th>Cuenta</th>
                    <th>Tipo</th>
                    <th>Clasificación</th>
                    <th>Descripción</th>
                    <th>Referencia</th>
                    <th>Contraparte</th>
                    <th>Cargo</th>
                    <th>Abono</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.map((item) => (
                    <tr key={`${item.statement_id}-${item.sequence}`}>
                      <td>{item.movement_date ? formatDate(item.movement_date) : "Sin fecha"}</td>
                      <td>{item.bank}</td>
                      <td>{item.account_number || "—"}</td>
                      <td>
                        <span className={`treasury-pill ${item.movement_type || "informativo"}`}>{movementBadge(item)}</span>
                      </td>
                      <td>{item.category || "—"}</td>
                      <td>
                        <strong>{item.description || "Sin descripción"}</strong>
                        {item.concept ? <small>{item.concept}</small> : null}
                      </td>
                      <td>{item.reference || "—"}</td>
                      <td>{item.counterparty || "—"}</td>
                      <td className="money-out">{formatMoney(item.debit)}</td>
                      <td className="money-in">{formatMoney(item.credit)}</td>
                      <td>{formatMoney(item.balance)}</td>
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
