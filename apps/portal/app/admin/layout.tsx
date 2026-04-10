"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

const TABS = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/activity", label: "Actividad" },
  { href: "/admin/users", label: "Usuarios" },
  { href: "/admin/announcements", label: "Anuncios" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.push("/login");
      return;
    }
    if (!user.is_admin) {
      router.push("/apps");
    }
  }, [ready, user, router]);

  if (!ready || !user?.is_admin) {
    return <p className="text-muted" style={{ textAlign: "center", marginTop: 40 }}>Cargando...</p>;
  }

  return (
    <div className="admin-wide">
      <h1 style={{ fontSize: "1.4rem", marginBottom: 16 }}>Administración</h1>

      <nav className="admin-tabs">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`admin-tab${pathname === tab.href ? " active" : ""}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
