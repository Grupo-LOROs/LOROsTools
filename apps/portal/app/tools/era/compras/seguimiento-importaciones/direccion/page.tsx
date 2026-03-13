"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiUpload, apiUploadDownload } from "@/lib/api";

type AttentionLevel = "ok" | "watch" | "risk";
type MilestoneStatus = "completed" | "current" | "upcoming" | "scheduled";

type BreakdownItem = {
  key?: string;
  label: string;
  count: number;
  color?: string;
};

type LocationPoint = {
  label: string;
  lat: number;
  lng: number;
};

type RouteSummary = {
  key: string;
  origin_label: string;
  destination_label: string;
  count: number;
  active: number;
  delivered: number;
  color: string;
  origin: LocationPoint;
  destination: LocationPoint;
};

type AlertItem = {
  shipment_id: string;
  level: AttentionLevel;
  title: string;
  detail: string;
};

type Milestone = {
  key: string;
  label: string;
  date: string | null;
  status: MilestoneStatus;
};

type Shipment = {
  id: string;
  order_number: string | null;
  general_po: string | null;
  invoice_number: string | null;
  supplier_display: string | null;
  supplier_name: string | null;
  container: string | null;
  visa_reference: string | null;
  terminal: string | null;
  forwarder: string | null;
  transportista: string | null;
  despacho: string | null;
  goods_summary: string | null;
  pedimento: string | null;
  iva: string | null;
  warehouse: string | null;
  container_status: string | null;
  provider_payment_due: string | null;
  provider_payment_status: string | null;
  forwarder_payment_due: string | null;
  forwarder_payment_status: string | null;
  etd: string | null;
  eta: string | null;
  storage_deadline: string | null;
  pedimento_charge_date: string | null;
  dispatch_date: string | null;
  warehouse_request_date: string | null;
  delay_reference: string | null;
  origin_port: string | null;
  destination_port: string | null;
  incoterm: string | null;
  total_usd: number | null;
  source_updated_at: string | null;
  stage_key: string;
  stage_label: string;
  stage_color: string;
  progress_pct: number;
  attention_level: AttentionLevel;
  attention_reason: string | null;
  next_event_label: string | null;
  next_event_date: string | null;
  days_to_eta: number | null;
  milestones: Milestone[];
};

type AnalysisResponse = {
  generated_at: string;
  data_source: {
    label: string;
    updated_at: string | null;
    used_history: boolean;
  };
  overview: {
    shipments: number;
    delivered: number;
    active: number;
    with_route_data: number;
    pending_provider_payment: number;
    pending_forwarder_payment: number;
    upcoming_arrivals: number;
    at_risk: number;
    total_usd: number | null;
    total_usd_count: number;
    coverage_pct: number;
  };
  stage_breakdown: BreakdownItem[];
  supplier_breakdown: BreakdownItem[];
  terminal_breakdown: BreakdownItem[];
  routes: RouteSummary[];
  alerts: AlertItem[];
  shipments: Shipment[];
};

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";
  return new Date(`${value}T12:00:00`).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value: number | null) {
  if (value == null) return "Sin monto";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "USD" }).format(value);
}

function shipmentTitle(shipment: Shipment) {
  return shipment.order_number || shipment.general_po || shipment.invoice_number || shipment.container || shipment.id;
}

function shipmentSubtitle(shipment: Shipment) {
  return shipment.supplier_display || shipment.supplier_name || "Proveedor sin identificar";
}

function attentionLabel(level: AttentionLevel) {
  if (level === "risk") return "Riesgo";
  if (level === "watch") return "Atención";
  return "En curso";
}

function pointToMap(point: LocationPoint, width: number, height: number) {
  return {
    x: ((point.lng + 180) / 360) * width,
    y: height - ((point.lat + 90) / 180) * height,
  };
}

function buildFormData(trackingFile: File | null, useLatestTemplate: boolean, useHistory: boolean) {
  const formData = new FormData();
  if (trackingFile) {
    formData.append("tracking_file", trackingFile);
  }
  formData.append("use_latest_template", String(useLatestTemplate));
  formData.append("use_importaciones_history", String(useHistory));
  return formData;
}

function RouteMap({ routes }: { routes: RouteSummary[] }) {
  const width = 920;
  const height = 280;
  if (!routes.length) {
    return <div className="dir-empty">No hay puertos identificables para dibujar el mapa en esta corrida.</div>;
  }

  return (
    <div className="dir-map-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="dir-map-svg" aria-label="Mapa de rutas">
        <rect x="0" y="0" width={width} height={height} rx="26" className="dir-map-bg" />
        {Array.from({ length: 4 }).map((_, index) => (
          <line key={`h-${index}`} x1="0" y1={((index + 1) * height) / 5} x2={width} y2={((index + 1) * height) / 5} className="dir-map-grid" />
        ))}
        {Array.from({ length: 5 }).map((_, index) => (
          <line key={`v-${index}`} x1={((index + 1) * width) / 6} y1="0" x2={((index + 1) * width) / 6} y2={height} className="dir-map-grid" />
        ))}
        {routes.slice(0, 8).map((route) => {
          const start = pointToMap(route.origin, width, height);
          const end = pointToMap(route.destination, width, height);
          const mx = (start.x + end.x) / 2;
          const my = Math.max(32, Math.min(height - 26, (start.y + end.y) / 2 + 40));
          return (
            <g key={route.key}>
              <path d={`M ${start.x} ${start.y} C ${mx} ${my}, ${mx} ${my}, ${end.x} ${end.y}`} stroke={route.color} strokeWidth={Math.min(5, Math.max(2, route.count))} fill="none" strokeLinecap="round" />
              <circle cx={start.x} cy={start.y} r="4" className="dir-map-dot" />
              <circle cx={end.x} cy={end.y} r="4" className="dir-map-dot" />
              <text x={start.x + 8} y={start.y - 8} className="dir-map-label">{route.origin.label}</text>
              <text x={end.x + 8} y={end.y + 16} className="dir-map-label">{route.destination.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="dir-route-chips">
        {routes.slice(0, 6).map((route) => (
          <div key={route.key} className="dir-route-chip">
            <span>{route.origin_label}</span>
            <strong>{route.count}</strong>
            <span>{route.destination_label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MilestonesStrip({ milestones, color }: { milestones: Milestone[]; color: string }) {
  return (
    <div className="dir-milestones">
      {milestones.map((milestone) => (
        <div key={milestone.key} className={`dir-mile dir-mile-${milestone.status}`}>
          <span className="dir-mile-dot" style={{ ["--mile-color" as string]: color }} />
          <strong>{milestone.label}</strong>
          <small>{formatDate(milestone.date)}</small>
        </div>
      ))}
    </div>
  );
}

export default function SeguimientoImportacionesDireccionPage() {
  const autoLoadRef = useRef(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [trackingFile, setTrackingFile] = useState<File | null>(null);
  const [useLatestTemplate, setUseLatestTemplate] = useState(true);
  const [useHistory, setUseHistory] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");

  async function runAnalysis(nextFile = trackingFile, nextUseLatest = useLatestTemplate, nextUseHistory = useHistory) {
    if (!nextFile && !nextUseLatest) {
      setError("Sube el Excel de seguimiento o activa el uso del último archivo generado.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await apiUpload<AnalysisResponse>(
        "/tools/compras/importaciones-tracking/executive/analyze",
        buildFormData(nextFile, nextUseLatest, nextUseHistory)
      );
      setAnalysis(data);
      setStageFilter("all");
    } catch (err: any) {
      setError(err?.message || "No se pudo generar la vista ejecutiva.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (autoLoadRef.current) return;
    autoLoadRef.current = true;
    void runAnalysis(null, true, true);
  }, []);

  const filteredShipments = useMemo(() => {
    if (!analysis) return [];
    if (stageFilter === "all") return analysis.shipments;
    return analysis.shipments.filter((item) => item.stage_key === stageFilter);
  }, [analysis, stageFilter]);

  async function exportPdf() {
    if (!analysis) return;
    setExporting(true);
    setError(null);
    try {
      await apiUploadDownload(
        "/tools/compras/importaciones-tracking/executive/export-pdf",
        buildFormData(trackingFile, useLatestTemplate, useHistory),
        "seguimiento-importaciones-direccion.pdf"
      );
    } catch (err: any) {
      setError(err?.message || "No se pudo exportar el PDF.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <p className="text-muted mb-4">
        <Link href="/apps">&larr; Aplicaciones</Link>
      </p>

      <div className="dir-breakout">
        <div className="dir-shell">
          <div className="dir-view-switch mb-4">
            <Link href="/tools/era/compras/seguimiento-importaciones" className="btn btn-outline">Vista operativa</Link>
            <span className="btn btn-primary">Vista dirección</span>
          </div>

          <section className="card dir-hero">
            <div>
              <div className="dir-kicker">ERA Compras · Dirección</div>
              <h1>Seguimiento ejecutivo de importaciones</h1>
              <p>
                Tablero en una sola pantalla para dirección: estado por embarque, focos de riesgo, pagos, rutas y
                exportación a PDF con presentación ejecutiva.
              </p>
            </div>
            <div className="dir-hero-actions">
              <button className="btn btn-outline" type="button" disabled={loading} onClick={() => void runAnalysis()}>
                {loading ? "Actualizando..." : "Actualizar tablero"}
              </button>
              <button className="btn btn-primary" type="button" disabled={!analysis || exporting} onClick={() => void exportPdf()}>
                {exporting ? "Preparando PDF..." : "Exportar a PDF"}
              </button>
            </div>
          </section>

          {error ? <div className="error-msg">{error}</div> : null}

          <section className="card dir-controls mb-4">
            <div className="dir-control-block">
              <span className="dir-control-label">Fuente del tablero</span>
              <strong>{analysis?.data_source.label || "Último Excel generado por Importaciones"}</strong>
              <small>{analysis?.data_source.updated_at ? `Actualizado el ${new Date(analysis.data_source.updated_at).toLocaleString("es-MX")}` : "Puedes sustituirlo con otro Excel si necesitas una foto distinta."}</small>
            </div>
            <div className="dir-control-block">
              <button className="btn btn-outline" type="button" onClick={() => fileRef.current?.click()}>
                {trackingFile ? "Cambiar Excel" : "Subir Excel manual"}
              </button>
              <input
                ref={fileRef}
                hidden
                type="file"
                accept=".xlsx,.xlsm"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setTrackingFile(file);
                  setUseLatestTemplate(file ? false : useLatestTemplate);
                  event.target.value = "";
                }}
              />
              {trackingFile ? <small>{trackingFile.name}</small> : <small>Sin archivo manual cargado.</small>}
            </div>
            <label className="inline-check">
              <input type="checkbox" checked={useLatestTemplate} onChange={(event) => {
                const checked = event.target.checked;
                setUseLatestTemplate(checked);
                if (checked) setTrackingFile(null);
              }} />
              <span>Usar el último Excel generado por Importaciones</span>
            </label>
            <label className="inline-check">
              <input type="checkbox" checked={useHistory} onChange={(event) => setUseHistory(event.target.checked)} />
              <span>Enriquecer rutas y puertos con el historial disponible</span>
            </label>
          </section>

          {analysis ? (
            <>
              <section className="dir-stats-grid mb-4">
                <div className="card dir-stat"><span>Embarques</span><strong>{analysis.overview.shipments}</strong></div>
                <div className="card dir-stat"><span>Entregados</span><strong>{analysis.overview.delivered}</strong></div>
                <div className="card dir-stat"><span>Riesgo</span><strong>{analysis.overview.at_risk}</strong></div>
                <div className="card dir-stat"><span>Arribos 14 días</span><strong>{analysis.overview.upcoming_arrivals}</strong></div>
                <div className="card dir-stat"><span>Rutas visibles</span><strong>{analysis.overview.with_route_data}</strong></div>
                <div className="card dir-stat"><span>USD identificados</span><strong>{formatMoney(analysis.overview.total_usd)}</strong></div>
              </section>

              <section className="dir-main-grid mb-4">
                <div className="card dir-map-card">
                  <div className="dir-card-head"><h2>Mapa ejecutivo</h2><span>{analysis.overview.coverage_pct}% de cobertura visual</span></div>
                  <RouteMap routes={analysis.routes} />
                </div>
                <div className="dir-side-stack">
                  <div className="card dir-side-card">
                    <div className="dir-card-head"><h2>Alertas</h2><span>{analysis.alerts.length} visibles</span></div>
                    <div className="dir-alert-list">
                      {analysis.alerts.length ? analysis.alerts.map((alert) => (
                        <div key={`${alert.shipment_id}-${alert.title}`} className={`dir-alert dir-alert-${alert.level}`}>
                          <strong>{alert.title}</strong>
                          <span>{alert.detail}</span>
                        </div>
                      )) : <div className="dir-empty">Sin alertas prioritarias en esta corrida.</div>}
                    </div>
                  </div>
                  <div className="card dir-side-card">
                    <div className="dir-card-head"><h2>Lectura rápida</h2><span>Concentrado</span></div>
                    <div className="dir-breakdown-grid">
                      <div><span>Pago proveedor pendiente</span><strong>{analysis.overview.pending_provider_payment}</strong></div>
                      <div><span>Pago forwarder pendiente</span><strong>{analysis.overview.pending_forwarder_payment}</strong></div>
                      <div><span>Fuente</span><strong>{analysis.data_source.used_history ? "Excel + historial" : "Solo Excel"}</strong></div>
                      <div><span>Embarques activos</span><strong>{analysis.overview.active}</strong></div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="dir-filters mb-4">
                <button type="button" className={`dir-filter-chip ${stageFilter === "all" ? "active" : ""}`} onClick={() => setStageFilter("all")}>Todos ({analysis.shipments.length})</button>
                {analysis.stage_breakdown.map((item) => (
                  <button key={item.key} type="button" className={`dir-filter-chip ${stageFilter === item.key ? "active" : ""}`} style={{ ["--chip-color" as string]: item.color || "#cbd5e1" }} onClick={() => setStageFilter(item.key || "all")}>
                    {item.label} ({item.count})
                  </button>
                ))}
              </section>

              <section className="dir-meta-grid mb-4">
                <div className="card dir-meta-card">
                  <div className="dir-card-head"><h2>Proveedores</h2><span>Top visibles</span></div>
                  <div className="dir-list">{analysis.supplier_breakdown.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.count}</strong></div>)}</div>
                </div>
                <div className="card dir-meta-card">
                  <div className="dir-card-head"><h2>Terminales</h2><span>Participación</span></div>
                  <div className="dir-list">{analysis.terminal_breakdown.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.count}</strong></div>)}</div>
                </div>
              </section>

              <section className="dir-cards-grid">
                {filteredShipments.map((shipment) => (
                  <article key={shipment.id} className="card dir-shipment-card">
                    <div className="dir-card-head">
                      <div>
                        <h2>{shipmentTitle(shipment)}</h2>
                        <p>{shipmentSubtitle(shipment)}</p>
                      </div>
                      <span className={`dir-stage-badge dir-stage-${shipment.attention_level}`} style={{ ["--stage-color" as string]: shipment.stage_color }}>
                        {shipment.stage_label}
                      </span>
                    </div>
                    <div className="dir-progress">
                      <div className="dir-progress-bar"><div className="dir-progress-fill" style={{ width: `${shipment.progress_pct}%`, background: shipment.stage_color }} /></div>
                      <span>{shipment.progress_pct}% del recorrido operativo</span>
                    </div>
                    <MilestonesStrip milestones={shipment.milestones} color={shipment.stage_color} />
                    <div className="dir-info-grid">
                      <div><span>Contenedor</span><strong>{shipment.container || "Sin dato"}</strong></div>
                      <div><span>Terminal</span><strong>{shipment.terminal || "Sin dato"}</strong></div>
                      <div><span>ETA</span><strong>{formatDate(shipment.eta)}</strong></div>
                      <div><span>Siguiente</span><strong>{shipment.next_event_label ? `${shipment.next_event_label} · ${formatDate(shipment.next_event_date)}` : "Sin siguiente evento"}</strong></div>
                      <div><span>Estatus contenedor</span><strong>{shipment.container_status || "Sin estatus"}</strong></div>
                      <div><span>Riesgo</span><strong>{shipment.attention_reason || attentionLabel(shipment.attention_level)}</strong></div>
                    </div>
                    <div className="dir-pill-row">
                      <span className="dir-pill">{shipment.origin_port || "Origen sin puerto"}</span>
                      <span className="dir-pill">{shipment.destination_port || "Destino sin puerto"}</span>
                      <span className="dir-pill">{shipment.incoterm || "Incoterm pendiente"}</span>
                    </div>
                    <div className="dir-footer-grid">
                      <div><span>Pago proveedor</span><strong>{shipment.provider_payment_status || "Sin estatus"}</strong><small>{formatDate(shipment.provider_payment_due)}</small></div>
                      <div><span>Pago forwarder</span><strong>{shipment.forwarder_payment_status || "Sin estatus"}</strong><small>{formatDate(shipment.forwarder_payment_due)}</small></div>
                      <div><span>Mercancía</span><strong>{shipment.goods_summary || "Sin descripción"}</strong><small>{formatMoney(shipment.total_usd)}</small></div>
                    </div>
                  </article>
                ))}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
