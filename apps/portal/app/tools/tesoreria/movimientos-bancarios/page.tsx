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

type DraftValues = {
  movement_type: string | null;
  date: string | null;
  company: string | null;
  payee: string | null;
  group: string | null;
  business_unit: string | null;
  project: string | null;
  reconciliation: string | null;
  specific_concept: string | null;
  detailed_concept: string | null;
  deposits: number | null;
  withdrawals: number | null;
  breakdown: number | null;
  observations: string | null;
};

type DraftMovementPreview = {
  sequence: number;
  bank: string;
  account_number: string | null;
  movement_date: string | null;
  description: string | null;
  concept: string | null;
  reference: string | null;
  counterparty: string | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
};

type MovementDraft = {
  draft_id: string;
  statement_id: string;
  statement_label: string;
  sheet_name: string | null;
  sheet_options: string[];
  suggestion_source: string;
  suggestion_score: number;
  matched_history_label: string | null;
  missing_fields: string[];
  needs_review: boolean;
  movement: DraftMovementPreview;
  values: DraftValues;
};

type SheetProfile = {
  name: string;
  bank_hint: string | null;
  sheet_kind: string;
  field_options: Record<string, string[]>;
  defaults: Partial<Record<keyof DraftValues, string | null>>;
};

type MovementTemplateResponse = {
  filename: string;
  sheets: SheetProfile[];
  drafts: MovementDraft[];
  review_count: number;
  skipped_duplicates: number;
  unmatched_statements: string[];
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

type PreparedResponse = {
  analysis: AnalysisResponse;
  movement_template: MovementTemplateResponse | null;
  balances_template: BalanceTemplateResponse | null;
};

type EditableFieldKey =
  | "movement_type"
  | "company"
  | "payee"
  | "group"
  | "business_unit"
  | "project"
  | "reconciliation"
  | "specific_concept"
  | "detailed_concept"
  | "observations";

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

const MOVEMENT_TYPE_OPTIONS = ["TRANSFERENCIA", "INVERSIÓN", "DEPÓSITO", "CHEQUE", "CARGO", "ABONO"];

const REVIEW_FIELDS: Array<{ key: EditableFieldKey; label: string; kind: "input" | "textarea" | "select" }> = [
  { key: "movement_type", label: "Tipo de movimiento", kind: "select" },
  { key: "company", label: "Empresa", kind: "input" },
  { key: "payee", label: "A nombre de", kind: "input" },
  { key: "group", label: "Grupo", kind: "input" },
  { key: "business_unit", label: "Unidad de negocio", kind: "input" },
  { key: "project", label: "Obra", kind: "input" },
  { key: "reconciliation", label: "Conciliación", kind: "input" },
  { key: "specific_concept", label: "Concepto específico", kind: "input" },
  { key: "detailed_concept", label: "Concepto detallado", kind: "textarea" },
  { key: "observations", label: "Observaciones", kind: "textarea" },
];

const FIELD_LABELS: Record<string, string> = {
  sheet_name: "Hoja destino",
  movement_type: "Tipo de movimiento",
  company: "Empresa",
  payee: "A nombre de",
  group: "Grupo",
  business_unit: "Unidad de negocio",
  project: "Obra",
  reconciliation: "Conciliación",
  specific_concept: "Concepto específico",
  detailed_concept: "Concepto detallado",
  observations: "Observaciones",
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

function normalizeText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function recomputeDraftStatus(draft: MovementDraft, sheet?: SheetProfile | null): MovementDraft {
  const missing = new Set<string>();
  if (!draft.sheet_name) {
    missing.add("sheet_name");
  }

  const requiredFields: Array<EditableFieldKey> = ["movement_type", "company", "payee", "reconciliation", "detailed_concept"];
  if (sheet) {
    (["group", "business_unit", "project"] as EditableFieldKey[]).forEach((field) => {
      const options = sheet.field_options[field] || [];
      if (options.length || normalizeText(draft.values[field])) {
        requiredFields.push(field);
      }
    });
  }

  requiredFields.forEach((field) => {
    if (!normalizeText(draft.values[field])) {
      missing.add(field);
    }
  });

  return {
    ...draft,
    missing_fields: Array.from(missing),
    needs_review: missing.size > 0 || draft.suggestion_source !== "historial",
  };
}

function draftAmount(draft: MovementDraft) {
  if (draft.movement.credit != null) return draft.movement.credit;
  if (draft.movement.debit != null) return -draft.movement.debit;
  return 0;
}

function balanceLabel(update: BalanceUpdate) {
  return update.column_key === "dolares" ? "Saldo B dólares" : "Saldo B pesos";
}

export default function TreasuryBankMovementsPage() {
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const movementTemplateRef = useRef<HTMLInputElement | null>(null);
  const balanceTemplateRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [movementsTemplate, setMovementsTemplate] = useState<File | null>(null);
  const [balancesTemplate, setBalancesTemplate] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [movementTemplate, setMovementTemplate] = useState<MovementTemplateResponse | null>(null);
  const [balanceTemplate, setBalanceTemplate] = useState<BalanceTemplateResponse | null>(null);
  const [drafts, setDrafts] = useState<MovementDraft[]>([]);
  const [balanceUpdates, setBalanceUpdates] = useState<BalanceUpdate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [bankFilter, setBankFilter] = useState<string>("all");
  const [copied, setCopied] = useState<string | null>(null);
  const [reviewOnly, setReviewOnly] = useState(true);

  const sheetLookup = useMemo(
    () => new Map((movementTemplate?.sheets || []).map((sheet) => [sheet.name, sheet])),
    [movementTemplate]
  );

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

  const visibleDrafts = useMemo(
    () => (reviewOnly ? drafts.filter((item) => item.needs_review) : drafts),
    [drafts, reviewOnly]
  );

  const reviewCount = useMemo(() => drafts.filter((item) => item.needs_review).length, [drafts]);
  const enabledBalanceCount = useMemo(() => balanceUpdates.filter((item) => item.enabled).length, [balanceUpdates]);

  function resetPreparedData() {
    setAnalysis(null);
    setMovementTemplate(null);
    setBalanceTemplate(null);
    setDrafts([]);
    setBalanceUpdates([]);
    setSelectedId(null);
  }

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
      if (movementsTemplate) formData.append("movements_template", movementsTemplate);
      if (balancesTemplate) formData.append("balances_template", balancesTemplate);

      const data = await apiUpload<PreparedResponse>("/tools/tesoreria/bank-movements/prepare", formData);
      const responseSheetLookup = new Map((data.movement_template?.sheets || []).map((sheet) => [sheet.name, sheet] as const));
      setAnalysis(data.analysis);
      setSelectedId(data.analysis.statements[0]?.id || null);
      setMovementTemplate(data.movement_template);
      setBalanceTemplate(data.balances_template);
      setDrafts(
        (data.movement_template?.drafts || []).map((draft) =>
          recomputeDraftStatus(draft, draft.sheet_name ? responseSheetLookup.get(draft.sheet_name) || null : null)
        )
      );
      setBalanceUpdates(data.balances_template?.updates || []);
    } catch (err: any) {
      setError(err?.message || "No se pudo analizar la información bancaria.");
    } finally {
      setProcessing(false);
    }
  }

  async function exportTemplates() {
    if (!movementsTemplate && !balancesTemplate) {
      setError("Sube al menos uno de los Excel para generar la salida.");
      return;
    }

    setExporting(true);
    setError(null);
    try {
      const formData = new FormData();
      if (movementsTemplate) formData.append("movements_template", movementsTemplate);
      if (balancesTemplate) formData.append("balances_template", balancesTemplate);
      formData.append("drafts_json", JSON.stringify(drafts));
      formData.append("balance_updates_json", JSON.stringify(balanceUpdates));
      await apiUploadDownload("/tools/tesoreria/bank-movements/export", formData, "tesoreria_actualizada.zip");
    } catch (err: any) {
      setError(err?.message || "No se pudo generar el ZIP con los Excel actualizados.");
    } finally {
      setExporting(false);
    }
  }

  async function handleCopy(label: string, text: string) {
    await copyToClipboard(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  function updateDraft(
    draftId: string,
    updater: (draft: MovementDraft, sheet: SheetProfile | null) => MovementDraft
  ) {
    setDrafts((current) =>
      current.map((item) => {
        if (item.draft_id !== draftId) return item;
        const currentSheet = item.sheet_name ? sheetLookup.get(item.sheet_name) || null : null;
        const nextDraft = updater(item, currentSheet);
        const nextSheetName = nextDraft.sheet_name;
        const sheet = nextSheetName ? sheetLookup.get(nextSheetName) || null : null;
        return recomputeDraftStatus(nextDraft, sheet);
      })
    );
  }

  function handleDraftFieldChange(draftId: string, field: EditableFieldKey, value: string) {
    updateDraft(draftId, (draft) => ({
      ...draft,
      values: {
        ...draft.values,
        [field]: value || null,
      },
    }));
  }

  function handleDraftSheetChange(draftId: string, sheetName: string) {
    const sheet = sheetName ? sheetLookup.get(sheetName) || null : null;
    updateDraft(draftId, (draft) => ({
      ...draft,
      sheet_name: sheetName || null,
      values: {
        ...draft.values,
        movement_type: draft.values.movement_type || sheet?.defaults.movement_type || draft.values.movement_type,
        company: draft.values.company || sheet?.defaults.company || draft.values.company,
      },
    }));
  }

  function handleBalanceToggle(updateId: string) {
    setBalanceUpdates((current) =>
      current.map((item) => (item.id === updateId ? { ...item, enabled: !item.enabled } : item))
    );
  }

  function fieldOptions(draft: MovementDraft, field: EditableFieldKey) {
    const sheet = draft.sheet_name ? sheetLookup.get(draft.sheet_name) : undefined;
    const options = sheet?.field_options[field] || [];
    if (field === "movement_type") {
      return Array.from(new Set([...MOVEMENT_TYPE_OPTIONS, ...options]));
    }
    return options;
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
          Sube los estados de cuenta PDF y, si ya los tienes, también el Excel de movimientos y el Excel de saldos.
          La herramienta prepara ambos archivos y deja una revisión rápida para completar lo que no salga del banco.
        </p>
        <div className="treasury-hero-grid">
          <div className="treasury-hero-card">
            <strong>Entrada</strong>
            <span>PDFs bancarios y hasta dos Excel operativos: movimientos y saldos.</span>
          </div>
          <div className="treasury-hero-card">
            <strong>Proceso</strong>
            <span>Lee PDFs nativos u OCR, detecta cuentas y propone hoja, saldos y clasificación.</span>
          </div>
          <div className="treasury-hero-card">
            <strong>Salida</strong>
            <span>ZIP con los Excel actualizados y una revisión rápida para pendientes.</span>
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
            const dropped = Array.from(event.dataTransfer.files).filter((file) => file.name.toLowerCase().endsWith(".pdf"));
            resetPreparedData();
            setFiles((current) => mergeFiles(current, dropped));
          }}
        >
          <div className="treasury-drop-title">Arrastra aquí los estados de cuenta PDF</div>
          <div className="gi-helper">También puedes hacer clic para seleccionarlos. Puedes mezclar bancos.</div>
        </div>

        <input
          ref={pdfInputRef}
          hidden
          type="file"
          accept=".pdf"
          multiple
          onChange={(event) => {
            resetPreparedData();
            setFiles((current) => mergeFiles(current, Array.from(event.target.files || [])));
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
                  resetPreparedData();
                  setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)));
                }}
              >
                {file.name} <span>×</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="treasury-template-grid">
          <button type="button" className="treasury-template-card" onClick={() => movementTemplateRef.current?.click()}>
            <strong>Excel de movimientos</strong>
            <span>{movementsTemplate ? movementsTemplate.name : "Sube el consecutivo bancario que se llena con los movimientos."}</span>
          </button>
          <button type="button" className="treasury-template-card" onClick={() => balanceTemplateRef.current?.click()}>
            <strong>Excel de saldos diarios</strong>
            <span>{balancesTemplate ? balancesTemplate.name : "Sube el consolidado diario para actualizar saldos por cuenta."}</span>
          </button>
        </div>

        <input
          ref={movementTemplateRef}
          hidden
          type="file"
          accept=".xlsx,.xlsm"
          onChange={(event) => {
            resetPreparedData();
            const next = event.target.files?.[0] || null;
            setMovementsTemplate(next);
            if (movementTemplateRef.current) movementTemplateRef.current.value = "";
          }}
        />

        <input
          ref={balanceTemplateRef}
          hidden
          type="file"
          accept=".xlsx,.xlsm"
          onChange={(event) => {
            resetPreparedData();
            const next = event.target.files?.[0] || null;
            setBalancesTemplate(next);
            if (balanceTemplateRef.current) balanceTemplateRef.current.value = "";
          }}
        />

        {(movementsTemplate || balancesTemplate) && (
          <div className="treasury-file-chips">
            {movementsTemplate ? (
              <button
                type="button"
                className="treasury-file-chip"
                onClick={() => {
                  resetPreparedData();
                  setMovementsTemplate(null);
                }}
              >
                {movementsTemplate.name} <span>×</span>
              </button>
            ) : null}
            {balancesTemplate ? (
              <button
                type="button"
                className="treasury-file-chip"
                onClick={() => {
                  resetPreparedData();
                  setBalancesTemplate(null);
                }}
              >
                {balancesTemplate.name} <span>×</span>
              </button>
            ) : null}
          </div>
        )}

        <div className="treasury-actions">
          <button className="btn btn-primary" type="button" onClick={analyze} disabled={processing}>
            {processing ? "Preparando..." : "Preparar revisión"}
          </button>
          <span className="text-muted">
            {files.length ? `${files.length} PDF(s) listo(s)` : "Sin PDFs seleccionados"}
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

          {(movementTemplate || balanceTemplate) && (
            <div className="card mb-4 treasury-review-card">
              <div className="treasury-table-head">
                <div>
                  <h3>Preparación de Excel</h3>
                  <p>
                    {movementTemplate ? `${drafts.length} movimiento(s) nuevo(s)` : "Sin Excel de movimientos"} y{" "}
                    {balanceTemplate ? `${enabledBalanceCount} saldo(s) listo(s) para actualizar` : "sin Excel de saldos"}.
                  </p>
                </div>
                <div className="treasury-toolbar-actions">
                  {movementTemplate ? (
                    <label className="treasury-review-toggle">
                      <input type="checkbox" checked={reviewOnly} onChange={(event) => setReviewOnly(event.target.checked)} />
                      Mostrar solo pendientes
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={exportTemplates}
                    disabled={exporting || (!movementsTemplate && !balancesTemplate)}
                  >
                    {exporting ? "Generando ZIP..." : "Descargar Excel actualizados"}
                  </button>
                </div>
              </div>

              <div className="treasury-prep-grid">
                {movementTemplate ? (
                  <div className="treasury-prep-card">
                    <strong>{movementTemplate.filename}</strong>
                    <span>
                      {reviewCount} pendiente(s) de revisión. {movementTemplate.skipped_duplicates} movimiento(s) ya
                      estaban en el archivo.
                    </span>
                    {movementTemplate.unmatched_statements.length ? (
                      <small>
                        Sin hoja segura: {movementTemplate.unmatched_statements.join(", ")}
                      </small>
                    ) : null}
                  </div>
                ) : null}

                {balanceTemplate ? (
                  <div className="treasury-prep-card">
                    <strong>{balanceTemplate.filename}</strong>
                    <span>{enabledBalanceCount} saldo(s) se actualizarán en {balanceTemplate.sheet_name}.</span>
                    {balanceTemplate.unmatched_statements.length ? (
                      <small>
                        Sin match automático: {balanceTemplate.unmatched_statements.join(", ")}
                      </small>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {movementTemplate ? (
                <div className="treasury-draft-list">
                  {visibleDrafts.map((draft) => {
                    const sheet = draft.sheet_name ? sheetLookup.get(draft.sheet_name) || null : null;
                    return (
                      <article key={draft.draft_id} className={`treasury-draft-card ${draft.needs_review ? "pending" : "ready"}`}>
                        <div className="treasury-draft-head">
                          <div>
                            <strong>{draft.statement_label}</strong>
                            <span>
                              {formatDate(draft.movement.movement_date)} · {formatMoney(Math.abs(draftAmount(draft)))}
                            </span>
                          </div>
                          <div className={`treasury-status ${draft.needs_review ? "pending" : "ready"}`}>
                            {draft.needs_review ? "Revisar" : "Listo"}
                          </div>
                        </div>

                        <div className="treasury-draft-summary">
                          <p>{draft.movement.description || "Sin descripción"}</p>
                          {draft.movement.counterparty ? <small>Contraparte: {draft.movement.counterparty}</small> : null}
                          {draft.matched_history_label ? <small>Sugerencia histórica: {draft.matched_history_label}</small> : null}
                          {draft.missing_fields.length ? (
                            <div className="treasury-chip-row">
                              {draft.missing_fields.map((field) => (
                                <span key={field} className="treasury-inline-pill">
                                  Falta: {FIELD_LABELS[field] || field}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="treasury-draft-grid">
                          <label className="treasury-field">
                            <span>Hoja destino</span>
                            <select value={draft.sheet_name || ""} onChange={(event) => handleDraftSheetChange(draft.draft_id, event.target.value)}>
                              <option value="">Seleccionar hoja</option>
                              {draft.sheet_options.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>

                          {REVIEW_FIELDS.map((field) => {
                            const options = fieldOptions(draft, field.key).slice(0, 6);
                            const datalistId = `${draft.draft_id}-${field.key}`;
                            return (
                              <label key={field.key} className={`treasury-field ${field.kind === "textarea" ? "wide" : ""}`}>
                                <span>{field.label}</span>
                                {field.kind === "textarea" ? (
                                  <textarea
                                    rows={3}
                                    value={draft.values[field.key] || ""}
                                    onChange={(event) => handleDraftFieldChange(draft.draft_id, field.key, event.target.value)}
                                  />
                                ) : field.kind === "select" ? (
                                  <select
                                    value={draft.values[field.key] || ""}
                                    onChange={(event) => handleDraftFieldChange(draft.draft_id, field.key, event.target.value)}
                                  >
                                    <option value="">Seleccionar</option>
                                    {fieldOptions(draft, field.key).map((option) => (
                                      <option key={option} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <>
                                    <input
                                      type="text"
                                      list={datalistId}
                                      value={draft.values[field.key] || ""}
                                      onChange={(event) => handleDraftFieldChange(draft.draft_id, field.key, event.target.value)}
                                    />
                                    <datalist id={datalistId}>
                                      {fieldOptions(draft, field.key).map((option) => (
                                        <option key={option} value={option} />
                                      ))}
                                    </datalist>
                                  </>
                                )}

                                {options.length ? (
                                  <div className="treasury-chip-row">
                                    {options.map((option) => (
                                      <button
                                        key={option}
                                        type="button"
                                        className="treasury-chip-btn"
                                        onClick={() => handleDraftFieldChange(draft.draft_id, field.key, option)}
                                      >
                                        {option}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </label>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}

              {balanceTemplate ? (
                <div className="treasury-balance-list">
                  {balanceUpdates.map((update) => (
                    <label key={update.id} className="treasury-balance-item">
                      <input type="checkbox" checked={update.enabled} onChange={() => handleBalanceToggle(update.id)} />
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
              ) : null}
            </div>
          )}

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
