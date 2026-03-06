const GI_COTIZADOR_URL = process.env.NEXT_PUBLIC_GI_COTIZADOR_URL?.trim() || "";

export default function GICotizadorWebPage() {
  return (
    <>
      <p className="text-muted mb-4">
        <a href="/apps">&larr; Apps</a>
      </p>

      <h1 style={{ fontSize: "1.35rem", marginBottom: 6 }}>GI - Cotizador ERA/GI</h1>
      <p className="text-muted mb-4">Vista web interactiva</p>

      {!GI_COTIZADOR_URL && (
        <div className="card">
          <p style={{ marginTop: 0, marginBottom: 8 }}>
            La URL del cotizador GI no esta configurada en el portal.
          </p>
          <p className="text-muted" style={{ margin: 0 }}>
            Configura <code>NEXT_PUBLIC_GI_COTIZADOR_URL</code> con la URL publica del servicio web.
          </p>
        </div>
      )}

      {GI_COTIZADOR_URL && (
        <>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <iframe
              src={GI_COTIZADOR_URL}
              title="GI Cotizador ERA/GI"
              style={{ width: "100%", height: "80vh", border: 0, display: "block" }}
            />
          </div>

          <p className="text-muted mt-4">
            Si no carga correctamente dentro del portal,{" "}
            <a href={GI_COTIZADOR_URL} target="_blank" rel="noopener noreferrer">
              abre la app en una nueva pestaña
            </a>
            .
          </p>
        </>
      )}
    </>
  );
}
