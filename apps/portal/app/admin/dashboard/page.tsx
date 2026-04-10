"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Stats = {
  total_jobs: number;
  jobs_by_status: Record<string, number>;
  success_rate: number;
  jobs_7d: number;
  jobs_30d: number;
  logins_7d: number;
  logins_30d: number;
  app_opens_7d: number;
  app_opens_30d: number;
  active_users_7d: number;
  active_users_30d: number;
  total_users: number;
  top_users_jobs: { username: string; count: number }[];
  top_apps_jobs: { app_key: string; count: number }[];
  top_apps_opens: { app_key: string; count: number }[];
};

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Stats>("/admin/stats")
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-msg">{error}</div>;
  if (!stats) return <p className="text-muted">Cargando estadísticas...</p>;

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.total_jobs}</div>
          <div className="stat-label">Jobs totales</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.success_rate}%</div>
          <div className="stat-label">Tasa de éxito</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.jobs_by_status.running || 0}</div>
          <div className="stat-label">Jobs activos</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.total_users}</div>
          <div className="stat-label">Usuarios totales</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.active_users_7d}</div>
          <div className="stat-label">Usuarios activos (7d)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.active_users_30d}</div>
          <div className="stat-label">Usuarios activos (30d)</div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <div className="stat-card">
          <div className="stat-value">{stats.logins_7d}</div>
          <div className="stat-label">Logins (7d)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.logins_30d}</div>
          <div className="stat-label">Logins (30d)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.app_opens_7d}</div>
          <div className="stat-label">Apps abiertas (7d)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.app_opens_30d}</div>
          <div className="stat-label">Apps abiertas (30d)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.jobs_7d}</div>
          <div className="stat-label">Jobs (7d)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.jobs_30d}</div>
          <div className="stat-label">Jobs (30d)</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>Top usuarios por jobs</h3>
          {stats.top_users_jobs.length === 0 ? (
            <p className="text-muted">Sin datos</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th style={{ textAlign: "right" }}>Jobs</th>
                </tr>
              </thead>
              <tbody>
                {stats.top_users_jobs.map((u) => (
                  <tr key={u.username}>
                    <td>{u.username}</td>
                    <td style={{ textAlign: "right" }}>{u.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>Top apps por jobs</h3>
          {stats.top_apps_jobs.length === 0 ? (
            <p className="text-muted">Sin datos</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>App</th>
                  <th style={{ textAlign: "right" }}>Jobs</th>
                </tr>
              </thead>
              <tbody>
                {stats.top_apps_jobs.map((a) => (
                  <tr key={a.app_key}>
                    <td>{a.app_key}</td>
                    <td style={{ textAlign: "right" }}>{a.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>Top apps por aperturas</h3>
          {stats.top_apps_opens.length === 0 ? (
            <p className="text-muted">Sin datos</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>App</th>
                  <th style={{ textAlign: "right" }}>Aperturas</th>
                </tr>
              </thead>
              <tbody>
                {stats.top_apps_opens.map((a) => (
                  <tr key={a.app_key}>
                    <td>{a.app_key}</td>
                    <td style={{ textAlign: "right" }}>{a.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
