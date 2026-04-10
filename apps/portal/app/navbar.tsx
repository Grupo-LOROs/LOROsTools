"use client";

import { useAuth } from "@/lib/auth";
import Link from "next/link";
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
      <Link href="/" className="navbar-brand">LOROs Tools</Link>
      <div className="navbar-links">
        <Link href="/apps">Apps</Link>
        <Link href="/jobs">Mis trabajos</Link>
        {ready && user && <Link href="/account/password">Mi contraseña</Link>}
        {ready && user?.is_admin && <Link href="/admin">Admin</Link>}
        {ready && user ? (
          <>
            <span className="text-muted" style={{ fontSize: "0.85rem" }}>{user.username}</span>
            <button className="btn btn-outline btn-sm" onClick={handleLogout}>Salir</button>
          </>
        ) : (
          <Link href="/login">Login</Link>
        )}
      </div>
    </nav>
  );
}
