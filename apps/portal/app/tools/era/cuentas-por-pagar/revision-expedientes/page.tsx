"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { apiUpload } from "@/lib/api";

type Summary = {
  files: number;
  ocr_pages: number;
  with_errors: number;
  with_warnings: number;
  with_sat: number;
};

type Check = {
  key: string;
  label: string;
  status: "ok" | "warning" | "error" | "info";
  message: string;
};

type QuickField = {
  key: string;
  label: string;
  value: string;
};

type ReviewPage = {
  page_number: number;
  document_type: string;
  document_label: string;
  ocr_used: boolean;
  excerpt: string;
  raw_text: string;
};

type ReviewFile = {
  id: string;
  source_file: string;
  status: "ok" | "warning" | "error";
  page_count: number;
  ocr_pages: number;
  company_alias: string | null;
  supplier_name: string | null;
  supplier_rfc: string | null;
  receiver_name: string | null;
  receiver_rfc: string | null;
  order_number: string | null;
  requisition_number: string | null;
  invoice_uuid: string | null;
  invoice_reference: string | null;
  invoice_total: number | null;
  sat_status: string | null;
  cancellation_status: string | null;
  checks: Check[];
  warnings: string[];
  quick_fields: QuickField[];
  pages: ReviewPage[];
  sections: Record<string, Record<string, unknown>>;
  raw_text: string;
};

type AnalysisResponse = {
  summary: Summary;
  files: ReviewFile[];
};

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mergeFiles(current: File[], incoming: File[]) {
  const map = new Map<string, File>();
  [...current, ...incoming].forEach((file) => map.set(fileKey(file), file));
  return Array.from(map.values());
}

function formatMoney(value: number | null) {
  if (value == null) return "Sin monto";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(value);
}

function statusLabel(status: ReviewFile["status"]) {
  if (status === "error") return "Con error";
  if (status === "warning") return "Con advertencias";
  return "Listo";
}

function checkLabel(status: Check["status"]) {
  if (status === "ok") return "OK";
  if (status === "warning") return "Revisar";
  if (status === "error") return "Error";
  return "Info";
}

function renderValue(value: unknown) {
  if (value == null || value === "") return "Sin dato";
  if (typeof value === "number") return formatMoney(value);
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Sin dato";
  return String(value);
}

function sectionRows(label: string, review: ReviewFile): Array<[string, unknown]> {
  const order = review.sections.order || {};
  const invoice = review.sections.invoice || {};
  const sat = review.sections.sat || {};
  const warehouse = review.sections.warehouse || {};
  const support = review.sections.support || {};

  if (label === "order") {
    return [
      ["Empresa reconocida", order.company_name],
      ["Proyecto", order.project_name],
      ["Pedido", order.order_number],
      ["Requisición", order.requisition_number],
      ["Fecha", order.order_date],
      ["Proveedor pedido", order.supplier_name],
      ["RFC pedido", order.supplier_rfc],
      ["Forma de pago", order.payment_hint],
      ["Subtotal", order.subtotal],
      ["IVA", order.iva],
      ["Total", order.total],
      ["Descripción", order.description],
    ];
  }

  if (label === "invoice") {
    return [
      ["Emisor", invoice.issuer_name],
      ["RFC emisor", invoice.issuer_rfc],
      ["Receptor", invoice.receiver_name],
      ["RFC receptor", invoice.receiver_rfc],
      ["UUID", invoice.uuid],
      ["Serie", invoice.series],
      ["Folio", invoice.folio],
      ["Referencia", invoice.reference],
      ["Fecha de emisión", invoice.issue_date],
      ["Fecha certificación", invoice.certification_date],
      ["Uso CFDI", invoice.use_cfdi],
      ["Forma de pago", invoice.payment_form],
      ["Método de pago", invoice.payment_method],
      ["Régimen emisor", invoice.issuer_regime],
      ["Régimen receptor", invoice.receiver_regime],
      ["Clave SAT", invoice.product_keys],
      ["Concepto", invoice.concept_summary],
      ["Subtotal", invoice.subtotal],
      ["IVA", invoice.iva],
      ["Retención ISR", invoice.retained_isr],
      ["Retención IVA", invoice.retained_iva],
      ["Total", invoice.total],
      ["Banco", invoice.bank_name],
      ["Cuenta", invoice.bank_account],
      ["CLABE", invoice.bank_clabe],
    ];
  }

  if (label === "sat") {
    return [
      ["UUID", sat.uuid],
      ["Emisor SAT", sat.issuer_name],
      ["RFC emisor SAT", sat.issuer_rfc],
      ["Receptor SAT", sat.receiver_name],
      ["RFC receptor SAT", sat.receiver_rfc],
      ["Fecha expedición", sat.issue_date],
      ["Fecha certificación", sat.certification_date],
      ["Estado CFDI", sat.status],
      ["Estatus cancelación", sat.cancellation_status],
      ["Total SAT", sat.total],
    ];
  }

  if (label === "warehouse") {
    return [
      ["Entrada", warehouse.entry_number],
      ["Pedido almacén", warehouse.order_number],
      ["Requisición almacén", warehouse.requisition_number],
      ["Factura almacén", warehouse.invoice_ref],
      ["Total almacén", warehouse.total],
      ["Descripción almacén", warehouse.description],
    ];
  }

  return [["Documentos detectados", support.detected_documents]];
}

function rowsToTsv(rows: ReviewFile[]) {
  const header = [
    "Archivo",
    "Estado",
    "Empresa",
    "Proveedor",
    "RFC proveedor",
    "Pedido",
    "Requisición",
    "UUID",
    "Serie/Folio",
    "Total",
    "Estado SAT",
  ].join("\t");

  const body = rows.map((item) =>
    [
      item.source_file,
      statusLabel(item.status),
      item.company_alias || item.receiver_name || "",
      item.supplier_name || "",
      item.supplier_rfc || "",
      item.order_number || "",
      item.requisition_number || "",
      item.invoice_uuid || "",
      item.invoice_reference || "",
      item.invoice_total == null ? "" : String(item.invoice_total),
      item.sat_status || "",
    ].join("\t")
  );

  return [header, ...body].join("\n");
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

export default function CxpExpedienteReviewPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "warning" | "error">("all");
  const [copied, setCopied] = useState<string | null>(null);

  const filteredFiles = useMemo(() => {
    const list = analysis?.files || [];
    return list.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const haystack = [
        item.source_file,
        item.company_alias,
        item.supplier_name,
        item.supplier_rfc,
        item.receiver_name,
        item.order_number,
        item.requisition_number,
        item.invoice_uuid,
        item.invoice_reference,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search.trim().toLowerCase());
    });
  }, [analysis, search, statusFilter]);

  const selectedFile = useMemo(
    () => filteredFiles.find((item) => item.id === selectedId) || filteredFiles[0] || null,
    [filteredFiles, selectedId]
  );

  async function analyze() {
    if (!files.length) {
      setError("Debes subir al menos un expediente PDF.");
      return;
    }

    setProcessing(true);
    setError(null);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const data = await apiUpload<AnalysisResponse>("/tools/cuentas-por-pagar/expedientes/analyze", formData);
      setAnalysis(data);
      setSelectedId(data.files[0]?.id || null);
    } catch (err: any) {
      setError(err?.message || "No se pudieron revisar los expedientes.");
    } finally {
      setProcessing(false);
    }
  }

  async function handleCopy(label: string, text: string) {
    await copyToClipboard(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <>
      <p className="text-muted mb-4">
        <Link href="/apps">&larr; Aplicaciones</Link>
      </p>

      <section className="card cxp-hero mb-4">
        <div className="cxp-kicker">ERA Cuentas por Pagar</div>
        <h1>Revisión de expedientes</h1>
        <p>
          Sube expedientes PDF completos para detectar pedido, factura, validación SAT y entrada de almacén, con campos
          rápidos para copiar a Neodata.
        </p>
        <div className="cxp-hero-grid">
          <div className="cxp-hero-card">
            <strong>Entrada</strong>
            <span>Expedientes PDF completos, aunque traigan páginas escaneadas.</span>
          </div>
          <div className="cxp-hero-card">
            <strong>Proceso</strong>
            <span>Clasifica documentos, extrae datos fiscales y aplica OCR cuando haga falta.</span>
          </div>
          <div className="cxp-hero-card">
            <strong>Salida</strong>
            <span>Validaciones visibles y campos listos para copiar en captura manual.</span>
          </div>
        </div>
      </section>

      {error ? <div className="error-msg">{error}</div> : null}

      <div className="card mb-4 cxp-upload">
        <div
          className={`dropzone cxp-dropzone ${dragActive ? "active" : ""}`}
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
          <div className="cxp-drop-title">Arrastra aquí los expedientes PDF</div>
          <div className="gi-helper">También puedes hacer clic para seleccionarlos. Puedes revisar varios a la vez.</div>
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
          <div className="cxp-file-chips">
            {files.map((file) => (
              <button
                key={fileKey(file)}
                type="button"
                className="cxp-file-chip"
                onClick={() => setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))}
              >
                {file.name} <span>×</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="cxp-actions">
          <button className="btn btn-primary" type="button" onClick={analyze} disabled={processing}>
            {processing ? "Revisando..." : "Revisar expedientes"}
          </button>
          <span className="text-muted">{files.length ? `${files.length} archivo(s) listo(s)` : "Sin archivos seleccionados"}</span>
          {copied ? <span className="cxp-copied">Copiado: {copied}</span> : null}
        </div>
      </div>

      {analysis ? (
        <>
          <div className="cxp-summary-grid mb-4">
            <div className="card cxp-summary-card">
              <span>Expedientes</span>
              <strong>{analysis.summary.files}</strong>
            </div>
            <div className="card cxp-summary-card">
              <span>Páginas con OCR</span>
              <strong>{analysis.summary.ocr_pages}</strong>
            </div>
            <div className="card cxp-summary-card">
              <span>Con error</span>
              <strong>{analysis.summary.with_errors}</strong>
            </div>
            <div className="card cxp-summary-card">
              <span>Con advertencias</span>
              <strong>{analysis.summary.with_warnings}</strong>
            </div>
            <div className="card cxp-summary-card">
              <span>Con SAT</span>
              <strong>{analysis.summary.with_sat}</strong>
            </div>
          </div>

          <div className="card mb-4 cxp-toolbar">
            <div className="cxp-toolbar-grid">
              <label>
                Buscar
                <input
                  type="text"
                  value={search}
                  placeholder="Proveedor, pedido, UUID, archivo..."
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                Estado
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                  <option value="all">Todos</option>
                  <option value="ok">Listo</option>
                  <option value="warning">Con advertencias</option>
                  <option value="error">Con error</option>
                </select>
              </label>
              <div className="cxp-toolbar-actions">
                <button type="button" className="btn" onClick={() => handleCopy("tabla", rowsToTsv(filteredFiles))} disabled={!filteredFiles.length}>
                  Copiar tabla
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    selectedFile &&
                    handleCopy(
                      selectedFile.source_file,
                      selectedFile.quick_fields.map((item) => `${item.label}\t${item.value}`).join("\n")
                    )
                  }
                  disabled={!selectedFile}
                >
                  Copiar campos rápidos
                </button>
              </div>
            </div>
          </div>

          <div className="cxp-layout">
            <aside className="card cxp-sidebar">
              <div className="cxp-sidebar-title">Expedientes cargados</div>
              <div className="cxp-list">
                {filteredFiles.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`cxp-list-item ${selectedFile?.id === item.id ? "active" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="cxp-list-top">
                      <strong>{item.company_alias || item.source_file}</strong>
                      <span className={`cxp-status-pill ${item.status}`}>{statusLabel(item.status)}</span>
                    </div>
                    <span>{item.supplier_name || "Proveedor pendiente"}</span>
                    <small>
                      {item.order_number ? `Pedido ${item.order_number}` : "Sin pedido"} · {formatMoney(item.invoice_total)}
                    </small>
                  </button>
                ))}
              </div>
            </aside>

            <section className="cxp-main">
              {selectedFile ? (
                <>
                  <div className="card cxp-detail-card">
                    <div className="cxp-detail-head">
                      <div>
                        <div className="cxp-kicker">Expediente</div>
                        <h2>{selectedFile.source_file}</h2>
                        <p>
                          {selectedFile.company_alias || selectedFile.receiver_name || "Empresa pendiente"} · {selectedFile.supplier_name || "Proveedor pendiente"}
                        </p>
                      </div>
                      <div className="cxp-detail-meta">
                        <span className={`cxp-status-pill ${selectedFile.status}`}>{statusLabel(selectedFile.status)}</span>
                        <span className="cxp-meta-chip">{selectedFile.page_count} página(s)</span>
                        <span className="cxp-meta-chip">{selectedFile.ocr_pages} con OCR</span>
                      </div>
                    </div>

                    <div className="cxp-quick-grid">
                      {selectedFile.quick_fields.map((field) => (
                        <button key={field.key} type="button" className="cxp-quick-card" onClick={() => handleCopy(field.label, field.value)}>
                          <span>{field.label}</span>
                          <strong>{field.value}</strong>
                        </button>
                      ))}
                    </div>

                    {selectedFile.warnings.length ? (
                      <div className="cxp-warning-list">
                        {selectedFile.warnings.map((warning) => (
                          <div key={warning} className="cxp-warning">
                            {warning}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="card cxp-detail-card">
                    <div className="cxp-panel-title">Validaciones</div>
                    <div className="cxp-check-grid">
                      {selectedFile.checks.map((check) => (
                        <div key={check.key} className={`cxp-check-card ${check.status}`}>
                          <div className="cxp-check-head">
                            <strong>{check.label}</strong>
                            <span>{checkLabel(check.status)}</span>
                          </div>
                          <p>{check.message}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="cxp-sections-grid">
                    {[
                      ["order", "Pedido"],
                      ["invoice", "Factura"],
                      ["sat", "SAT"],
                      ["warehouse", "Almacén"],
                      ["support", "Soporte"],
                    ].map(([key, title]) => (
                      <div key={key} className="card cxp-detail-card">
                        <div className="cxp-panel-title">{title}</div>
                        <div className="cxp-field-list">
                          {sectionRows(key, selectedFile).map(([label, value]) => (
                            <div key={`${key}-${String(label)}`} className="cxp-field-row">
                              <span>{label}</span>
                              <strong>{renderValue(value)}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="card cxp-detail-card">
                    <div className="cxp-panel-title">Páginas detectadas</div>
                    <div className="cxp-pages-grid">
                      {selectedFile.pages.map((page) => (
                        <div key={`${selectedFile.id}-${page.page_number}`} className="cxp-page-card">
                          <div className="cxp-page-head">
                            <strong>Página {page.page_number}</strong>
                            <span>{page.document_label}</span>
                          </div>
                          <p>{page.excerpt || "Sin texto detectado."}</p>
                          {page.ocr_used ? <small>Leída con OCR</small> : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <details className="card cxp-raw-box">
                    <summary>Ver texto extraído completo</summary>
                    <pre>{selectedFile.raw_text}</pre>
                  </details>
                </>
              ) : (
                <div className="card">
                  <p className="text-muted">No hay expedientes con los filtros actuales.</p>
                </div>
              )}
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}
