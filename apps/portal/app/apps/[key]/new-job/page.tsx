"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, apiUpload } from "@/lib/api";

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

type SpecInput = {
  type: string;
  role?: string;
  multiple?: boolean;
  optional?: boolean;
};

function toAccept(type: string | undefined): string | undefined {
  if (!type) return undefined;
  const clean = type.trim().toLowerCase();
  if (!clean || clean === "file" || clean === "data") return undefined;
  if (clean === "xlsx" || clean === "xls" || clean === "excel") return ".xlsx,.xls";
  if (clean === "xlsm") return ".xlsm";
  if (clean === "pdf") return ".pdf";
  return clean.startsWith(".") ? clean : `.${clean}`;
}

export default function NewJobPage() {
  const { key } = useParams<{ key: string }>();
  const router = useRouter();

  const [app, setApp] = useState<AppDef | null>(null);
  const [inputs, setInputs] = useState<File[]>([]);
  const [template, setTemplate] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch<AppDef>(`/apps/${key}`)
      .then(setApp)
      .catch((e) => setError(e.message));
  }, [key]);

  // Spec-based hints
  const specInputs = app?.spec?.inputs as SpecInput[] | undefined;
  const templateSpec = specInputs?.find((s) => {
    const role = (s.role || "").toLowerCase();
    return role === "plantilla" || role === "template" || role === "schema" || role === "esquema";
  });

  const needsTemplate = Boolean(templateSpec) && !templateSpec?.optional;
  const inputType = specInputs?.find((s) => !s.role)?.type || "file";
  const acceptInput = toAccept(inputType);

  const templateType = templateSpec?.type;
  const acceptTemplate = toAccept(templateType) || ".xlsx,.xls,.xlsm";
  const showTemplate = Boolean(templateSpec);

  // Drag & drop
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) setInputs((prev) => [...prev, ...files]);
  }, []);

  function removeInput(idx: number) {
    setInputs((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    setError(null);
    if (inputs.length === 0) {
      setError("Agrega al menos un archivo de entrada.");
      return;
    }
    if (needsTemplate && !template) {
      setError("Esta app requiere una plantilla (template).");
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      inputs.forEach((f) => fd.append("inputs", f));
      if (template) fd.append("template", template);

      const job = await apiUpload<JobResult>(`/apps/${key}/jobs`, fd);
      router.push(`/jobs/${job.id}`);
    } catch (err: any) {
      setError(err.message || "Error al crear el trabajo.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!app && !error) {
    return <p className="text-muted">Cargando...</p>;
  }

  return (
    <>
      <p className="text-muted mb-4">
        <a href="/apps">&larr; Apps</a>
      </p>

      <h1 style={{ fontSize: "1.3rem", marginBottom: 4 }}>{app?.name || key}</h1>
      <p className="text-muted mb-4">Nuevo trabajo &middot; modo batch</p>

      {error && <div className="error-msg">{error}</div>}

      <div className="card mb-4">
        <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>
          Archivos de entrada {inputType !== "file" && `(${acceptInput || inputType})`}
        </h3>

        <div
          className={`dropzone${dragActive ? " active" : ""}`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          Arrastra archivos aquí o haz clic para seleccionar
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptInput}
          style={{ display: "none" }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            setInputs((prev) => [...prev, ...files]);
            e.target.value = "";
          }}
        />

        {inputs.length > 0 && (
          <ul className="file-list">
            {inputs.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span>{f.name} <span className="text-muted">({(f.size / 1024).toFixed(0)} KB)</span></span>
                <button onClick={() => removeInput(i)}>Quitar</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showTemplate && (
        <div className="card mb-4">
          <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>
            Plantilla (template) {needsTemplate ? "" : "(opcional)"}
          </h3>

          {template ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>
                {template.name}{" "}
                <span className="text-muted">({(template.size / 1024).toFixed(0)} KB)</span>
              </span>
              <button className="btn btn-outline btn-sm" onClick={() => setTemplate(null)}>
                Quitar
              </button>
            </div>
          ) : (
            <>
              <button className="btn btn-outline" onClick={() => templateRef.current?.click()}>
                Seleccionar archivo
              </button>
              <input
                ref={templateRef}
                type="file"
                accept={acceptTemplate}
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setTemplate(f);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ padding: "10px 32px", fontSize: "1rem" }}
        onClick={submit}
        disabled={submitting}
      >
        {submitting ? "Enviando..." : "Crear trabajo"}
      </button>
    </>
  );
}
