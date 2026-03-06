"use client";

import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";

export function NavBar() {
  const { user, logout, ready } = useAuth();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <nav className="navbar">
      <a href="/" className="navbar-brand">LOROs Tools</a>
      <div className="navbar-links">
        <a href="/apps">Apps</a>
        <a href="/jobs">Mis Jobs</a>
        {ready && user && <a href="/account/password">Mi Password</a>}
        {ready && user?.is_admin && <a href="/admin/users">Usuarios</a>}
        {ready && user ? (
          <>
            <span className="text-muted" style={{ fontSize: "0.85rem" }}>{user.username}</span>
            <button className="btn btn-outline btn-sm" onClick={handleLogout}>Salir</button>
          </>
        ) : (
          <a href="/login">Login</a>
        )}
      </div>
    </nav>
  );
}
