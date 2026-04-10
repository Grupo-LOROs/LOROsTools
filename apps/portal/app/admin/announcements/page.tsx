"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type AnnouncementRow = {
  id: number;
  slug: string;
  title: string;
  body: string;
  level: string;
  app_keys: string[];
  active: boolean;
  expired: boolean;
  expires_at: string | null;
  created_at: string;
};

export default function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AnnouncementRow[]>("/admin/announcements")
      .then(setAnnouncements)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-msg">{error}</div>;

  return (
    <>
      <p className="text-muted mb-4">
        Los anuncios se gestionan desde el archivo de configuración del servidor (seed).
        Aquí puedes ver el estado actual de todos los anuncios.
      </p>

      {announcements.length === 0 ? (
        <p className="text-muted">Sin anuncios configurados.</p>
      ) : (
        <div className="stack-lg">
          {announcements.map((a) => (
            <div
              key={a.id}
              className={`announcement announcement-${a.level}`}
              style={{ opacity: !a.active || a.expired ? 0.5 : 1 }}
            >
              <div className="announcement-title">
                {a.title}
                <span className={`announcement-badge announcement-badge-${a.level}`}>
                  {a.level}
                </span>
                {!a.active && (
                  <span className="badge" style={{ background: "var(--bg-muted)", color: "var(--text-muted)", fontSize: "0.7rem" }}>
                    Inactivo
                  </span>
                )}
                {a.expired && (
                  <span className="badge" style={{ background: "#fecaca", color: "#991b1b", fontSize: "0.7rem" }}>
                    Expirado
                  </span>
                )}
              </div>
              <div className="announcement-body">{a.body}</div>
              <div style={{ marginTop: 8, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                <strong>Slug:</strong> {a.slug}
                {" · "}
                <strong>Apps:</strong> {a.app_keys.length === 0 ? "Global" : a.app_keys.join(", ")}
                {a.expires_at && (
                  <>
                    {" · "}
                    <strong>Expira:</strong> {new Date(a.expires_at).toLocaleString("es-MX")}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
