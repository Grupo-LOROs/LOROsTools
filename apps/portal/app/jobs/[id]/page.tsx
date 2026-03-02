"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, apiDownload } from "@/lib/api";

type JobDetail = {
  id: string;
  app_key: string;
  status: string;
  progress: number;
  message: string | null;
  params: Record<string, any>;
  template_path: string | null;
  output_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type JobFiles = {
  job_id: string;
  inputs: Array<{ filename: string; size_bytes: number | null; role: string }>;
  template: { filename: string; size_bytes: number | null } | null;
  outputs: Array<{ filename: string; size_bytes: number | null }>;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [job, setJob] = useState<JobDetail | null>(null);
  const [files, setFiles] = useState<JobFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Fetch job + files
  function fetchJob() {
    apiFetch<JobDetail>(`/jobs/${id}`)
      .then((j) => {
        setJob(j);
        // Stop polling when terminal
        if (j.status === "succeeded" || j.status === "failed") {
          clearInterval(pollRef.current);
        }
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    fetchJob();
    apiFetch<JobFiles>(`/jobs/${id}/files`).then(setFiles).catch(() => {});

    // Poll every 3s while running/queued
    pollRef.current = setInterval(fetchJob, 3000);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!job && !error) {
    return <p className="text-muted">Cargando...</p>;
  }

  const isTerminal = job?.status === "succeeded" || job?.status === "failed";

  return (
    <>
      <p className="text-muted mb-4">
        <a href="/jobs">&larr; Mis Jobs</a>
      </p>

      {error && <div className="error-msg">{error}</div>}

      {job && (
        <>
          <div className="flex-between mb-4">
            <h1 style={{ fontSize: "1.3rem" }}>
              {job.app_key.replace(/_/g, " ")}
            </h1>
            <span className={`badge badge-${job.status}`} style={{ fontSize: "0.85rem", padding: "4px 12px" }}>
              {job.status}
              {job.status === "running" && job.progress > 0 && ` ${job.progress}%`}
            </span>
          </div>

          {/* Progress bar for running jobs */}
          {job.status === "running" && (
            <div style={{ background: "var(--border)", borderRadius: 4, height: 6, marginBottom: 16 }}>
              <div
                style={{
                  background: "var(--primary)",
                  borderRadius: 4,
                  height: 6,
                  width: `${Math.max(job.progress, 5)}%`,
                  transition: "width 0.3s",
                }}
              />
            </div>
          )}

          {/* Info card */}
          <div className="card mb-4">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px" }}>
              <div>
                <span className="text-muted">Job ID</span>
                <div style={{ fontFamily: "monospace", fontSize: "0.85rem", wordBreak: "break-all" }}>{job.id}</div>
              </div>
              <div>
                <span className="text-muted">Creado por</span>
                <div>{job.created_by}</div>
              </div>
              <div>
                <span className="text-muted">Creado</span>
                <div>{formatDate(job.created_at)}</div>
              </div>
              <div>
                <span className="text-muted">Actualizado</span>
                <div>{formatDate(job.updated_at)}</div>
              </div>
            </div>

            {job.message && (
              <div className="mt-4">
                <span className="text-muted">Mensaje</span>
                <div style={{ marginTop: 4 }}>{job.message}</div>
              </div>
            )}
          </div>

          {/* Files */}
          {files && (
            <div className="card mb-4">
              <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>Archivos</h3>

              {files.inputs.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <span className="text-muted">Inputs ({files.inputs.length})</span>
                  <ul className="file-list">
                    {files.inputs.map((f, i) => (
                      <li key={i}>
                        {f.filename}
                        {f.size_bytes != null && (
                          <span className="text-muted">{(f.size_bytes / 1024).toFixed(0)} KB</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {files.template && (
                <div style={{ marginBottom: 12 }}>
                  <span className="text-muted">Template</span>
                  <div>{files.template.filename}</div>
                </div>
              )}
            </div>
          )}

          {/* Download */}
          {job.status === "succeeded" && job.output_path && (
            <button
              className="btn btn-primary"
              style={{ padding: "10px 32px", fontSize: "1rem" }}
              onClick={() => {
                const fname = job.output_path!.split("/").pop() || "output.xlsx";
                apiDownload(`/jobs/${job.id}/download`, fname);
              }}
            >
              Descargar resultado
            </button>
          )}

          {/* Error message */}
          {job.status === "failed" && (
            <div className="error-msg">
              El job falló. {job.message || "Revisa los logs para más detalle."}
            </div>
          )}

          {/* Polling indicator */}
          {!isTerminal && (
            <p className="text-muted mt-4" style={{ textAlign: "center" }}>
              Actualizando automáticamente cada 3 segundos...
            </p>
          )}
        </>
      )}
    </>
  );
}
