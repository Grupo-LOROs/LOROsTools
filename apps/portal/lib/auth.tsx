"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type User = { username: string; is_admin: boolean } | null;

interface AuthCtx {
  user: User;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  ready: boolean;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  token: null,
  login: async () => {},
  logout: () => {},
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

  // Restore from sessionStorage on mount
  useEffect(() => {
    const t = sessionStorage.getItem(TOKEN_KEY);
    const u = sessionStorage.getItem(USER_KEY);
    if (t && u) {
      setToken(t);
      try {
        setUser(JSON.parse(u));
      } catch {}
    }
    setReady(true);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.detail || "Login failed");

    setToken(body.token);
    setUser(body.user);
    sessionStorage.setItem(TOKEN_KEY, body.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(body.user));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    // Also clear server cookie
    fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
  }, []);

  return (
    <Ctx.Provider value={{ user, token, login, logout, ready }}>
      {children}
    </Ctx.Provider>
  );
}
