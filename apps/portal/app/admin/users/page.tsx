"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type UserRow = {
  username: string;
  is_admin: boolean;
  app_keys: string[];
  created_at: string;
};

type AppRow = {
  key: string;
  name: string;
  unit: string;
  mode: string;
  enabled: boolean;
};

type DraftState = {
  is_admin: boolean;
  app_keys: string[];
  new_password: string;
};

function byLabel(a: AppRow, b: AppRow) {
  return `${a.unit}-${a.name}`.localeCompare(`${b.unit}-${b.name}`);
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { user, ready } = useAuth();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [newAppKeys, setNewAppKeys] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  const sortedApps = useMemo(() => [...apps].sort(byLabel), [apps]);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.push("/login");
      return;
    }
    if (!user.is_admin) {
      router.push("/apps");
      return;
    }
    refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user, router]);

  async function refreshData() {
    setLoading(true);
    setError(null);
    try {
      const [u, a] = await Promise.all([apiFetch<UserRow[]>("/users"), apiFetch<AppRow[]>("/users/apps")]);
      setUsers(u);
      setApps(a);

      const nextDrafts: Record<string, DraftState> = {};
      u.forEach((item) => {
        nextDrafts[item.username] = {
          is_admin: item.is_admin,
          app_keys: [...(item.app_keys || [])],
          new_password: "",
        };
      });
      setDrafts(nextDrafts);
    } catch (err: any) {
      setError(err?.message || "No se pudo cargar la administración de usuarios.");
    } finally {
      setLoading(false);
    }
  }

  function patchDraft(username: string, patch: Partial<DraftState>) {
    setDrafts((prev) => ({
      ...prev,
      [username]: {
        ...prev[username],
        ...patch,
      },
    }));
  }

  function toggleAppKey(current: string[], key: string) {
    if (current.includes(key)) return current.filter((k) => k !== key);
    return [...current, key];
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    setCreating(true);
    try {
      await apiFetch("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          is_admin: newIsAdmin,
          app_keys: newIsAdmin ? [] : newAppKeys,
        }),
      });

      setNewUsername("");
      setNewPassword("");
      setNewIsAdmin(false);
      setNewAppKeys([]);
      setNotice("Usuario creado correctamente.");
      await refreshData();
    } catch (err: any) {
      setError(err?.message || "No se pudo crear el usuario.");
    } finally {
      setCreating(false);
    }
  }

  async function savePermissions(username: string) {
    const draft = drafts[username];
    if (!draft) return;

    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/users/${username}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_admin: draft.is_admin,
          app_keys: draft.is_admin ? [] : draft.app_keys,
        }),
      });
      setNotice(`Permisos actualizados para ${username}.`);
      await refreshData();
    } catch (err: any) {
      setError(err?.message || "No se pudieron guardar los permisos.");
    }
  }

  async function resetPassword(username: string) {
    const draft = drafts[username];
    if (!draft || !draft.new_password) {
      setError("Captura una nueva contraseña para el reseteo.");
      return;
    }

    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/users/${username}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: draft.new_password }),
      });
      patchDraft(username, { new_password: "" });
      setNotice(`Contraseña reiniciada para ${username}.`);
    } catch (err: any) {
      setError(err?.message || "No se pudo reiniciar la contraseña.");
    }
  }

  async function deleteUser(username: string) {
    if (!confirm(`¿Eliminar usuario ${username}? Esta acción no se puede deshacer.`)) {
      return;
    }

    setError(null);
    setNotice(null);
    setDeletingUser(username);
    try {
      await apiFetch(`/users/${username}`, { method: "DELETE" });
      setNotice(`Usuario ${username} eliminado.`);
      await refreshData();
    } catch (err: any) {
      setError(err?.message || "No se pudo eliminar el usuario.");
    } finally {
      setDeletingUser(null);
    }
  }

  return (
    <>
      <h1 style={{ fontSize: "1.3rem", marginBottom: 12 }}>Administración de usuarios</h1>
      <p className="text-muted mb-4">Crea usuarios y asigna permisos por aplicación.</p>

      {error && <div className="error-msg">{error}</div>}
      {notice && <div className="success-msg">{notice}</div>}

      <div className="card mb-4">
        <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Nuevo usuario</h2>

        <form onSubmit={createUser}>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="newUsername">Usuario</label>
              <input
                id="newUsername"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
                minLength={3}
              />
            </div>

            <div className="form-group">
              <label htmlFor="newPassword">Contraseña inicial</label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
          </div>

          <label className="inline-check" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />
            <span>Es administrador</span>
          </label>

          {!newIsAdmin && (
            <div className="permission-list mb-4">
              {sortedApps.map((a) => (
                <label className="inline-check" key={`new-${a.key}`}>
                  <input
                    type="checkbox"
                    checked={newAppKeys.includes(a.key)}
                    onChange={() => setNewAppKeys((prev) => toggleAppKey(prev, a.key))}
                  />
                  <span>{a.unit} - {a.name}</span>
                </label>
              ))}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={creating}>
            {creating ? "Creando..." : "Crear usuario"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Usuarios existentes</h2>

        {loading ? (
          <p className="text-muted">Cargando...</p>
        ) : (
          <div className="stack-lg">
            {users.map((u) => {
              const d = drafts[u.username] || {
                is_admin: u.is_admin,
                app_keys: u.app_keys,
                new_password: "",
              };

              return (
                <div className="card card-soft" key={u.username}>
                  <div className="flex-between mb-4">
                    <div>
                      <strong>{u.username}</strong>
                      <div className="text-muted">Creado: {new Date(u.created_at).toLocaleString("es-MX")}</div>
                    </div>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={d.is_admin}
                        onChange={(e) => patchDraft(u.username, { is_admin: e.target.checked })}
                      />
                      <span>Administrador</span>
                    </label>
                  </div>

                  {!d.is_admin && (
                    <div className="permission-list mb-4">
                      {sortedApps.map((a) => (
                        <label className="inline-check" key={`${u.username}-${a.key}`}>
                          <input
                            type="checkbox"
                            checked={d.app_keys.includes(a.key)}
                            onChange={() =>
                              patchDraft(u.username, { app_keys: toggleAppKey(d.app_keys, a.key) })
                            }
                          />
                          <span>{a.unit} - {a.name}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="form-grid mb-4">
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label htmlFor={`reset-${u.username}`}>Reiniciar contraseña</label>
                      <input
                        id={`reset-${u.username}`}
                        type="password"
                        minLength={8}
                        placeholder="Nueva contraseña"
                        value={d.new_password}
                        onChange={(e) => patchDraft(u.username, { new_password: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="button-row">
                    <button className="btn btn-outline" onClick={() => resetPassword(u.username)}>
                      Reiniciar contraseña
                    </button>
                    <button className="btn btn-primary" onClick={() => savePermissions(u.username)}>
                      Guardar permisos
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => deleteUser(u.username)}
                      disabled={deletingUser === u.username || user?.username === u.username}
                      title={user?.username === u.username ? "No puedes borrar tu propio usuario." : undefined}
                    >
                      {deletingUser === u.username ? "Eliminando..." : "Eliminar usuario"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
