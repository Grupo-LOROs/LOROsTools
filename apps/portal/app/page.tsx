"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/apps");
  }, [router]);

  return (
    <div style={{ textAlign: "center", padding: "80px 0" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>LOROs Tools</h1>
      <p className="text-muted">Redirigiendo...</p>
    </div>
  );
}
