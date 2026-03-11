"use client";

import Link from "next/link";

export default function TesoreriaFormatoAsistidoPage() {
  return (
    <>
      <p className="text-muted mb-4">
        <Link href="/apps">&larr; Aplicaciones</Link>
      </p>

      <section className="card treasury-hero">
        <div className="treasury-kicker">Tesorería</div>
        <h1>Formato asistido</h1>
        <p>
          Esta herramienta quedará para la segunda etapa. Primero cerraremos la captura y clasificación de movimientos
          bancarios; después se agregan las reglas por fila y el llenado en tiempo real.
        </p>
      </section>
    </>
  );
}
