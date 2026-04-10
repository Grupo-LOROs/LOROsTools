"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type ActivityItem = {
  timestamp: string;
  event_type: string;
  username: string;
  app_key: string | null;
  detail: string | null;
};

type ActivityResponse = {
  items: ActivityItem[];
  total: number;
  limit: number;
  offset: number;
};

const EVENT_LABELS: Record<string, string> = {
  login: "Login",
  app_open: "Apertura de app",
  job_created: "Job creado",
};

const PAGE_SIZE = 50;

export default function AdminActivityPage() {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const [filterUser, setFilterUser] = useState("");
  const [filterAppKey, setFilterAppKey] = useState("");
  const [filterType, setFilterType] = useState("");

  const fetchActivity = useCallback(() => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    if (filterUser) params.set("user", filterUser);
    if (filterAppKey) params.set("app_key", filterAppKey);
    if (filterType) params.set("event_type", filterType);

    apiFetch<ActivityResponse>(`/admin/activity?${params}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [offset, filterUser, filterAppKey, filterType]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  function handleFilter() {
    setOffset(0);
    fetchActivity();
  }

  return (
    <>
      <div className="filter-bar">
        <input
          type="text"
          placeholder="Usuario"
          value={filterUser}
          onChange={(e) => setFilterUser(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "0.85rem" }}
        />
        <input
          type="text"
          placeholder="App key"
          value={filterAppKey}
          onChange={(e) => setFilterAppKey(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "0.85rem" }}
        />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">Todos los tipos</option>
          <option value="login">Login</option>
          <option value="app_open">Apertura de app</option>
          <option value="job_created">Job creado</option>
        </select>
        <button className="btn btn-outline btn-sm" onClick={handleFilter}>
          Filtrar
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {!data ? (
        <p className="text-muted">Cargando actividad...</p>
      ) : (
        <>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Usuario</th>
                  <th>App</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 20 }}>
                      Sin registros
                    </td>
                  </tr>
                ) : (
                  data.items.map((item, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                        {new Date(item.timestamp).toLocaleString("es-MX")}
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background:
                              item.event_type === "login"
                                ? "#dbeafe"
                                : item.event_type === "app_open"
                                ? "#dcfce7"
                                : "#fef3c7",
                            color:
                              item.event_type === "login"
                                ? "#1d4ed8"
                                : item.event_type === "app_open"
                                ? "#166534"
                                : "#92400e",
                            fontSize: "0.75rem",
                          }}
                        >
                          {EVENT_LABELS[item.event_type] || item.event_type}
                        </span>
                      </td>
                      <td>{item.username}</td>
                      <td>{item.app_key || "—"}</td>
                      <td className="text-muted" style={{ fontSize: "0.85rem" }}>
                        {item.detail || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              className="btn btn-outline btn-sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Anterior
            </button>
            <span className="text-muted" style={{ fontSize: "0.85rem" }}>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} de {data.total}
            </span>
            <button
              className="btn btn-outline btn-sm"
              disabled={offset + PAGE_SIZE >= data.total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Siguiente
            </button>
          </div>
        </>
      )}
    </>
  );
}
