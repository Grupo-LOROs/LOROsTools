"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import Link from "next/link";

type JobRow = {
  id: string;
  app_key: string;
  status: string;
  progress: number;
  message: string | null;
  created_by: string;
  created_at: string;
  has_output: boolean;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<JobRow[]>("/jobs")
      .then(setJobs)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h1 style={{ fontSize: "1.4rem", marginBottom: 16 }}>Mis Jobs</h1>

      {error && <div className="error-msg">{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th>Status</th>
              <th>Creado</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.app_key.replace(/_/g, " ")}</td>
                <td>
                  <span className={`badge badge-${j.status}`}>{j.status}</span>
                  {j.progress > 0 && j.status === "running" && (
                    <span className="text-muted" style={{ marginLeft: 6 }}>{j.progress}%</span>
                  )}
                </td>
                <td className="text-muted">{timeAgo(j.created_at)}</td>
                <td style={{ textAlign: "right" }}>
                  <Link href={`/jobs/${j.id}`} className="btn btn-outline btn-sm" style={{ textDecoration: "none" }}>
                    Ver
                  </Link>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && !error && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", padding: 24 }} className="text-muted">
                  No hay jobs todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
