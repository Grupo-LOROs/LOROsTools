"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type AppDef = {
  key: string;
  name: string;
  mode: string;
  ui: { type: string | null; url: string | null };
};

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

function normalizeInternalHref(raw: string): string {
  if (!raw.startsWith("/")) return raw;
  if (!BASE_PATH) return raw;
  if (raw === BASE_PATH) return "/";
  if (raw.startsWith(`${BASE_PATH}/`)) return raw.slice(BASE_PATH.length) || "/";
  return raw;
}

export default function InteractiveLauncherPage() {
  const { key } = useParams<{ key: string }>();
  const router = useRouter();

  const [app, setApp] = useState<AppDef | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AppDef>(`/apps/${key}`)
      .then(setApp)
      .catch((e) => setError(e.message));
  }, [key]);

  const targetUrl = useMemo(() => {
    const raw = app?.ui?.url?.trim();
    return raw ? normalizeInternalHref(raw) : null;
  }, [app]);

  useEffect(() => {
    if (!targetUrl) return;
    if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
      window.location.href = targetUrl;
      return;
    }
    router.replace(targetUrl);
  }, [router, targetUrl]);

  if (error) {
    return <div className="error-msg">{error}</div>;
  }

  if (!app) {
    return <p className="text-muted">Cargando...</p>;
  }

  if (app.mode !== "interactive") {
    return <div className="error-msg">Esta app no es interactiva.</div>;
  }

  if (!targetUrl) {
    return (
      <div className="card">
        <h1 style={{ fontSize: "1.1rem", marginBottom: 8 }}>{app.name}</h1>
        <p className="text-muted">No hay URL configurada para esta app interactiva.</p>
      </div>
    );
  }

  return <p className="text-muted">Abriendo app interactiva...</p>;
}
