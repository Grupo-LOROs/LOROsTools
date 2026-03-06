"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import Link from "next/link";

type AppRow = {
  key: string;
  name: string;
  unit: string;
  enabled: boolean;
  mode: string;
  ui: { type: string | null; url: string | null };
  spec: Record<string, any>;
};

const UNIT_LABELS: Record<string, string> = {
  gi: "GI",
  era_ventas: "ERA Ventas",
  era_compras: "ERA Compras",
  era_proyectos: "ERA Proyectos",
  tesoreria: "Tesorería",
};

function resolveInteractiveHref(app: AppRow): string {
  const raw = app.ui?.url?.trim();
  if (raw) {
    return raw;
  }
  return `/apps/${app.key}/interactive`;
}

export default function AppsPage() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AppRow[]>("/apps")
      .then(setApps)
      .catch((e) => setError(e.message));
  }, []);

  // Group by unit
  const grouped = apps.reduce<Record<string, AppRow[]>>((acc, a) => {
    (acc[a.unit] ??= []).push(a);
    return acc;
  }, {});

  return (
    <>
      <div className="flex-between mb-4">
        <h1 style={{ fontSize: "1.4rem" }}>Aplicaciones</h1>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {Object.entries(grouped).map(([unit, items]) => (
        <div key={unit} className="mb-4">
          <h2 style={{ fontSize: "1rem", color: "var(--text-muted)", marginBottom: 8 }}>
            {UNIT_LABELS[unit] || unit}
          </h2>
          <div className="card" style={{ padding: 0 }}>
            <table style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col />
                <col style={{ width: 130 }} />
                <col style={{ width: 150 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>App</th>
                  <th style={{ textAlign: "center" }}>Modo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const interactiveHref = resolveInteractiveHref(a);
                  const isExternal = interactiveHref.startsWith("http://") || interactiveHref.startsWith("https://");

                  return (
                    <tr key={a.key}>
                      <td>
                        <strong>{a.name}</strong>
                        {!a.enabled && (
                          <span className="text-muted" style={{ marginLeft: 8 }}>
                            (deshabilitada)
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span className={`badge badge-${a.mode}`}>{a.mode}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {a.mode === "batch" && a.enabled ? (
                          <Link
                            href={`/apps/${a.key}/new-job`}
                            className="btn btn-primary btn-sm"
                            style={{ textDecoration: "none" }}
                          >
                            Nuevo trabajo
                          </Link>
                        ) : a.mode === "interactive" && a.enabled ? (
                          isExternal ? (
                            <a
                              href={interactiveHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-primary btn-sm"
                              style={{ textDecoration: "none" }}
                            >
                              Abrir
                            </a>
                          ) : (
                            <Link
                              href={interactiveHref}
                              className="btn btn-primary btn-sm"
                              style={{ textDecoration: "none" }}
                            >
                              Abrir
                            </Link>
                          )
                        ) : (
                          <span
                            className="badge"
                            style={{
                              background: "var(--bg-muted)",
                              color: "var(--text-muted)",
                              fontSize: "0.75rem",
                            }}
                          >
                            No disponible
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {apps.length === 0 && !error && (
        <p className="text-muted" style={{ textAlign: "center", marginTop: 40 }}>
          Cargando aplicaciones...
        </p>
      )}
    </>
  );
}
