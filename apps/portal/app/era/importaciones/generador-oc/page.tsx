"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, apiUpload } from "@/lib/api";

const APP_KEY = "era_importaciones_generador_oc";

type AppDef = {
  key: string;
  name: string;
  unit: string;
  mode: string;
  spec: Record<string, any>;
};

type JobResult = {
  id: string;
  app_key: string;
  status: string;
};

type ImportParams = {
  provider_alias: string;
  referencia_visa: string;
  terminal: string;
  forwarder: string;
  transportista: string;
  despacho: string;
};

const DEFAULT_PARAMS: ImportParams = {
  provider_alias: "",
  referencia_visa: "",
  terminal: "",
  forwarder: "",
  transportista: "",
  despacho: "",
};

const TERMINAL_OPTIONS = [
  { value: "", label: "Detectar desde el PDF" },
  { value: "APM", label: "APM" },
  { value: "MANZANILLO", label: "Manzanillo" },
];

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mergeFiles(current: File[], incoming: File[]) {
  const map = new Map<string, File>();
  [...current, ...incoming].forEach((file) => map.set(fileKey(file), file));
  return Array.from(map.values());
}

function isPdf(file: File) {
  return file.name.toLowerCase().endsWith(".pdf");
}

function isExcel(file: File) {
  return /\.(xlsx|xls|xlsm)$/i.test(file.name);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function EraImportacionesGeneradorPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const templateRef = useRef<HTMLInputElement | null>(null);

  const [app, setApp] = useState<AppDef | null>(null);
  const [pdfs, setPdfs] = useState<File[]>([]);
  const [template, setTemplate] = useState<File | null>(null);
  const [params, setParams] = useState<ImportParams>(DEFAULT_PARAMS);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AppDef>(`/apps/${APP_KEY}`)
      .then(setApp)
      .catch((err) => setError(err.message));
  }, []);

  const cleanedParams = useMemo(() => {
    return Object.fromEntries(
      Object.entries(params)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => value.length > 0)
    );
  }, [params]);

  const notes = app?.spec?.notes as Record<string, string> | undefined;
  const outputPdfCount = pdfs.length;
  const overrideCount = Object.keys(cleanedParams).length;

  const handleDrag = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(event.type === "dragenter" || event.type === "dragover");
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);

    const dropped = Array.from(event.dataTransfer.files);
    const validPdfs = dropped.filter(isPdf);
    if (!validPdfs.length) {
      setError("Solo se permiten archivos PDF en esta sección.");
      return;
    }

    if (validPdfs.length !== dropped.length) {
      setError("Se omitieron archivos que no son PDF.");
    } else {
      setError(null);
    }

    setPdfs((current) => mergeFiles(current, validPdfs));
  }, []);

  function updateParam(field: keyof ImportParams, value: string) {
    setParams((current) => ({ ...current, [field]: value }));
  }

  function removePdf(index: number) {
    setPdfs((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function submitJob() {
    setError(null);

    if (!pdfs.length) {
      setError("Debes subir al menos un PDF del proveedor.");
      return;
    }

    if (!template) {
      setError("Debes seleccionar la plantilla de programación de entregas.");
      return;
    }

    if (pdfs.some((file) => !isPdf(file))) {
      setError("Todos los archivos de entrada deben ser PDF.");
      return;
    }

    if (!isExcel(template)) {
      setError("La plantilla debe ser un archivo Excel válido.");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      pdfs.forEach((file) => formData.append("inputs", file));
      formData.append("template", template);
      if (Object.keys(cleanedParams).length > 0) {
        formData.append("params_json", JSON.stringify(cleanedParams));
      }

      const job = await apiUpload<JobResult>(`/apps/${APP_KEY}/jobs`, formData);
      router.push(`/jobs/${job.id}`);
    } catch (err: any) {
      setError(err.message || "No se pudo crear el trabajo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <p className="text-muted mb-4">
        <Link href="/apps">&larr; Aplicaciones</Link>
      </p>

      <section className="card imp-hero mb-4">
        <p className="imp-kicker">ERA Importaciones</p>
        <div className="imp-hero-grid">
          <div>
            <h1>{app?.name || "Cartas complementarias desde órdenes de compra"}</h1>
            <p className="imp-hero-copy">
              Sube una o varias órdenes de compra en PDF, actualiza la programación de entregas
              y genera una carta complementaria PDF por cada documento procesado.
            </p>
          </div>
          <div className="imp-steps">
            <div className="imp-step">
              <strong>1. Carga</strong>
              <span>Órdenes de compra en PDF</span>
            </div>
            <div className="imp-step">
              <strong>2. Completa</strong>
              <span>Solo los datos que no vengan en el documento</span>
            </div>
            <div className="imp-step">
              <strong>3. Genera</strong>
              <span>Excel actualizado + carta complementaria en PDF</span>
            </div>
          </div>
        </div>
      </section>

      {error && <div className="error-msg">{error}</div>}

      <div className="imp-layout">
        <aside className="imp-sidebar">
          <div className="card card-soft">
            <div className="flex-between mb-4">
              <div>
                <h2 className="imp-panel-title">Documentos del proveedor</h2>
                <p className="text-muted">Puedes subir varias órdenes de compra PDF en el mismo trabajo.</p>
              </div>
              <span className="badge badge-batch">{pdfs.length} PDF</span>
            </div>

            <div
              className={`dropzone imp-dropzone${dragActive ? " active" : ""}`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
            >
              <div>
                <div className="imp-drop-title">Arrastra tus PDFs aquí</div>
                <p className="text-muted">
                  También puedes hacer clic para seleccionar las órdenes de compra.
                </p>
              </div>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              multiple
              style={{ display: "none" }}
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                const validPdfs = files.filter(isPdf);
                if (validPdfs.length !== files.length) {
                  setError("Se ignoraron archivos que no son PDF.");
                } else {
                  setError(null);
                }
                setPdfs((current) => mergeFiles(current, validPdfs));
                event.target.value = "";
              }}
            />

            {pdfs.length > 0 && (
              <ul className="file-list">
                {pdfs.map((file, index) => (
                  <li key={fileKey(file)}>
                    <span>
                      {file.name} <span className="text-muted">({formatSize(file.size)})</span>
                    </span>
                    <button onClick={() => removePdf(index)}>Quitar</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card card-soft">
            <div className="flex-between mb-4">
              <div>
                <h2 className="imp-panel-title">Plantilla</h2>
                <p className="text-muted">
                  {notes?.template || "Sube el archivo de programación de entregas en Excel."}
                </p>
              </div>
              <span className="badge badge-interactive">Excel</span>
            </div>

            {template ? (
              <div className="imp-template">
                <div>
                  <strong>{template.name}</strong>
                  <p className="text-muted">{formatSize(template.size)}</p>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => setTemplate(null)}>
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <button className="btn btn-outline" onClick={() => templateRef.current?.click()}>
                  Seleccionar Excel
                </button>
                <input
                  ref={templateRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsm"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const nextTemplate = event.target.files?.[0] || null;
                    if (nextTemplate && !isExcel(nextTemplate)) {
                      setError("La plantilla debe ser un archivo Excel válido.");
                      event.target.value = "";
                      return;
                    }
                    setError(null);
                    setTemplate(nextTemplate);
                    event.target.value = "";
                  }}
                />
              </>
            )}

            <div className="imp-summary mt-4">
              <div className="imp-mini-stat">
                <span className="imp-mini-label">Entradas</span>
                <div className="imp-mini-value">{pdfs.length || 0}</div>
              </div>
              <div className="imp-mini-stat">
                <span className="imp-mini-label">PDFs de salida</span>
                <div className="imp-mini-value">{outputPdfCount}</div>
              </div>
              <div className="imp-mini-stat">
                <span className="imp-mini-label">Campos manuales</span>
                <div className="imp-mini-value">{overrideCount}</div>
              </div>
            </div>

            <p className="imp-note mt-4">
              {notes?.behavior ||
                "La herramienta actualiza la hoja de programación y genera una orden de compra PDF por documento."}
            </p>
          </div>
        </aside>

        <section className="stack-lg">
          <div className="card">
            <div className="flex-between mb-4">
              <div>
                <h2 className="imp-panel-title">Datos operativos opcionales</h2>
                <p className="text-muted">
                  Si dejas estos campos vacíos, el sistema intentará detectarlos desde el PDF.
                </p>
              </div>
              <span className="badge badge-running">Opcional</span>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label>Nombre del proveedor o vendedor</label>
                <input
                  value={params.provider_alias}
                  onChange={(event) => updateParam("provider_alias", event.target.value)}
                  placeholder="Ej. PHILLIP"
                />
              </div>
              <div className="form-group">
                <label>Referencia VISA</label>
                <input
                  value={params.referencia_visa}
                  onChange={(event) => updateParam("referencia_visa", event.target.value)}
                  placeholder="Si aplica para la fila del Excel"
                />
              </div>
              <div className="form-group">
                <label>Terminal</label>
                <select
                  value={params.terminal}
                  onChange={(event) => updateParam("terminal", event.target.value)}
                >
                  {TERMINAL_OPTIONS.map((option) => (
                    <option key={option.value || "auto"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Forwarder</label>
                <input
                  value={params.forwarder}
                  onChange={(event) => updateParam("forwarder", event.target.value)}
                  placeholder="Naviera o agente logístico"
                />
              </div>
              <div className="form-group">
                <label>Transportista</label>
                <input
                  value={params.transportista}
                  onChange={(event) => updateParam("transportista", event.target.value)}
                  placeholder="Si debe registrarse en la plantilla"
                />
              </div>
              <div className="form-group">
                <label>Despacho</label>
                <input
                  value={params.despacho}
                  onChange={(event) => updateParam("despacho", event.target.value)}
                  placeholder="Ej. ALMACÉN"
                />
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="imp-panel-title mb-4">Resumen del trabajo</h2>
            <div className="imp-checklist">
              <div className="imp-check">
                <strong>Entrada</strong>
                <span>{pdfs.length ? `${pdfs.length} PDF cargado(s)` : "Aún no hay PDFs cargados"}</span>
              </div>
              <div className="imp-check">
                <strong>Plantilla</strong>
                <span>{template ? template.name : "Falta seleccionar el Excel base"}</span>
              </div>
              <div className="imp-check">
                <strong>Salida esperada</strong>
                <span>
                  1 Excel actualizado y {outputPdfCount || 0} carta(s) complementaria(s) en PDF
                </span>
              </div>
              <div className="imp-check">
                <strong>Parámetros manuales</strong>
                <span>
                  {overrideCount
                    ? `${overrideCount} campo(s) se enviarán como prioridad sobre el PDF`
                    : "Todo se tomará del documento cuando sea posible"}
                </span>
              </div>
            </div>
          </div>

          <div className="button-row">
            <button className="btn btn-primary" onClick={submitJob} disabled={submitting}>
              {submitting ? "Creando trabajo..." : "Crear trabajo"}
            </button>
            <button
              className="btn btn-outline"
              onClick={() => {
                setPdfs([]);
                setTemplate(null);
                setParams(DEFAULT_PARAMS);
                setError(null);
              }}
              disabled={submitting}
            >
              Limpiar formulario
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
