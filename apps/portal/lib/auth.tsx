"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiUrl } from "./api";

type User = { username: string; is_admin: boolean; app_permissions?: string[] } | null;

interface AuthCtx {
  user: User;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  ready: boolean;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  token: null,
  login: async () => {},
  logout: () => {},
  changePassword: async () => {},
  refreshUser: async () => {},
  ready: false,
});

export function useAuth() {
  return useContext(Ctx);
}

const TOKEN_KEY = "loros_token";
const USER_KEY = "loros_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User>(null);
  const [ready, setReady] = useState(false);

  const persistAuth = useCallback((nextToken: string | null, nextUser: User) => {
    setToken(nextToken);
    setUser(nextUser);

    if (nextToken) {
      sessionStorage.setItem(TOKEN_KEY, nextToken);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }

    if (nextUser) {
      sessionStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    } else {
      sessionStorage.removeItem(USER_KEY);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const authToken = sessionStorage.getItem(TOKEN_KEY);
    const headers: Record<string, string> = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const res = await fetch(apiUrl("/auth/me"), {
      method: "GET",
      headers,
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error("La sesión expiró");
    }

    const body = await res.json();
    const existingToken = sessionStorage.getItem(TOKEN_KEY);
    persistAuth(existingToken, {
      username: body.username,
      is_admin: body.is_admin,
      app_permissions: body.app_permissions || [],
    });
  }, [persistAuth]);

  useEffect(() => {
    const t = sessionStorage.getItem(TOKEN_KEY);
    const u = sessionStorage.getItem(USER_KEY);
    if (t && u) {
      setToken(t);
      try {
        setUser(JSON.parse(u));
      } catch {
        persistAuth(null, null);
      }
    }

    refreshUser().catch(() => {
    }).finally(() => setReady(true));
  }, [persistAuth, refreshUser]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(apiUrl("/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.detail || "No se pudo iniciar sesión");

    persistAuth(body.token, {
      username: body.user.username,
      is_admin: body.user.is_admin,
      app_permissions: body.user.app_permissions || [],
    });

    await refreshUser().catch(() => {});
  }, [persistAuth, refreshUser]);

  const logout = useCallback(() => {
    persistAuth(null, null);
    fetch(apiUrl("/auth/logout"), { method: "POST", credentials: "include" }).catch(() => {});
  }, [persistAuth]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const authToken = sessionStorage.getItem(TOKEN_KEY);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const res = await fetch(apiUrl("/auth/change-password"), {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.detail || "No se pudo cambiar la contraseña");
    }
  }, []);

  return (
    <Ctx.Provider value={{ user, token, login, logout, changePassword, refreshUser, ready }}>
      {children}
    </Ctx.Provider>
  );
}
