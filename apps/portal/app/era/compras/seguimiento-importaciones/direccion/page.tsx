"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiUpload, apiUploadDownload } from "@/lib/api";

type AttentionLevel = "ok" | "watch" | "risk";
type MilestoneStatus = "completed" | "current" | "upcoming" | "scheduled";
type PeriodScope = "year" | "month" | "week" | "rolling30" | "all";

type BreakdownItem = {
  key?: string;
  label: string;
  count: number;
  color?: string;
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
  reference_date: string | null;
  reference_label: string | null;
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
    pending_provider_payment: number;
    pending_forwarder_payment: number;
    upcoming_arrivals: number;
    at_risk: number;
    with_eta: number;
    with_dispatch: number;
    with_reference_date: number;
    total_usd: number | null;
    total_usd_count: number;
  };
  stage_breakdown: BreakdownItem[];
  supplier_breakdown: BreakdownItem[];
  terminal_breakdown: BreakdownItem[];
  movement_summary: Array<{ key: string; label: string; count: number }>;
  shipments: Shipment[];
};

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

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

function toDate(value: string | null) {
  if (!value) return null;
  const resolved = new Date(`${value}T12:00:00`);
  return Number.isNaN(resolved.getTime()) ? null : resolved;
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

function isoWeekInfo(value: Date) {
  const date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

function startOfIsoWeek(year: number, week: number) {
  const january4 = new Date(Date.UTC(year, 0, 4));
  const day = january4.getUTCDay() || 7;
  const monday = new Date(january4);
  monday.setUTCDate(january4.getUTCDate() - day + 1 + (week - 1) * 7);
  return monday;
}

function periodBounds(scope: PeriodScope, year: number | null, month: number | null, week: number | null) {
  const today = new Date();
  if (scope === "all") return { start: null as Date | null, end: null as Date | null };
  if (scope === "rolling30") {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 30);
    return { start, end };
  }
  if (scope === "year" && year) return { start: new Date(year, 0, 1), end: new Date(year, 11, 31) };
  if (scope === "month" && year && month) return { start: new Date(year, month - 1, 1), end: new Date(year, month, 0) };
  if (scope === "week" && year && week) {
    const start = startOfIsoWeek(year, week);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return {
      start: new Date(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
      end: new Date(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
    };
  }
  return { start: null, end: null };
}

function periodLabel(scope: PeriodScope, year: number | null, month: number | null, week: number | null) {
  if (scope === "rolling30") return "Próximos 30 días";
  if (scope === "year" && year) return `Año ${year}`;
  if (scope === "month" && year && month) return `${MONTHS[month - 1]} ${year}`;
  if (scope === "week" && year && week) {
    const { start, end } = periodBounds(scope, year, month, week);
    return `Semana ${week} · ${formatDate(start ? start.toISOString().slice(0, 10) : null)} al ${formatDate(end ? end.toISOString().slice(0, 10) : null)}`;
  }
  return "Todo el histórico";
}

function filterByPeriod(shipments: Shipment[], scope: PeriodScope, year: number | null, month: number | null, week: number | null) {
  const { start, end } = periodBounds(scope, year, month, week);
  if (!start || !end) return shipments;
  return shipments.filter((shipment) => {
    const referenceDate = toDate(shipment.reference_date);
    return !!referenceDate && referenceDate >= start && referenceDate <= end;
  });
}

function topBreakdown(shipments: Shipment[], getLabel: (shipment: Shipment) => string, limit: number) {
  const counts = new Map<string, number>();
  shipments.forEach((shipment) => {
    const label = getLabel(shipment);
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function stageBreakdown(shipments: Shipment[], base: BreakdownItem[]) {
  const counts = new Map<string, number>();
  shipments.forEach((shipment) => counts.set(shipment.stage_key, (counts.get(shipment.stage_key) || 0) + 1));
  return base.map((stage) => ({ ...stage, count: counts.get(stage.key || "") || 0 }));
}

function filteredOverview(shipments: Shipment[]) {
  const totalUsdValues = shipments.filter((shipment) => shipment.total_usd != null).map((shipment) => shipment.total_usd as number);
  return {
    shipments: shipments.length,
    delivered: shipments.filter((shipment) => shipment.stage_key === "delivered").length,
    active: shipments.filter((shipment) => shipment.stage_key !== "delivered").length,
    at_risk: shipments.filter((shipment) => shipment.attention_level === "risk").length,
    pending_provider_payment: shipments.filter((shipment) => (shipment.provider_payment_status || "").toLowerCase().includes("pendiente")).length,
    pending_forwarder_payment: shipments.filter((shipment) => (shipment.forwarder_payment_status || "").toLowerCase().includes("pendiente")).length,
    upcoming_arrivals: shipments.filter((shipment) => typeof shipment.days_to_eta === "number" && shipment.days_to_eta >= 0 && shipment.days_to_eta <= 14).length,
    with_eta: shipments.filter((shipment) => !!shipment.eta).length,
    with_dispatch: shipments.filter((shipment) => !!shipment.dispatch_date).length,
    total_usd: totalUsdValues.length ? totalUsdValues.reduce((sum, value) => sum + value, 0) : null,
  };
}

function movementSummary(shipments: Shipment[], scope: PeriodScope, year: number | null, month: number | null, week: number | null) {
  const { start, end } = periodBounds(scope, year, month, week);
  const within = (value: string | null) => {
    if (!start || !end) return !!value;
    const resolved = toDate(value);
    return !!resolved && resolved >= start && resolved <= end;
  };
  return [
    { key: "etd", label: "Salidas (ETD)", count: shipments.filter((shipment) => within(shipment.etd)).length },
    { key: "eta", label: "Arribos (ETA)", count: shipments.filter((shipment) => within(shipment.eta)).length },
    { key: "dispatch", label: "Despachos", count: shipments.filter((shipment) => within(shipment.dispatch_date)).length },
    { key: "delivered", label: "Entregas", count: shipments.filter((shipment) => within(shipment.warehouse_request_date)).length },
  ];
}

function buildFormData(
  trackingFile: File | null,
  useLatestTemplate: boolean,
  useHistory: boolean,
  scope: PeriodScope,
  year: number | null,
  month: number | null,
  week: number | null
) {
  const formData = new FormData();
  if (trackingFile) formData.append("tracking_file", trackingFile);
  formData.append("use_latest_template", String(useLatestTemplate));
  formData.append("use_importaciones_history", String(useHistory));
  formData.append("period_scope", scope);
  if (year) formData.append("period_year", String(year));
  if (month) formData.append("period_month", String(month));
  if (week) formData.append("period_week", String(week));
  return formData;
}

function StageTrackerOverview({ items, total }: { items: BreakdownItem[]; total: number }) {
  return (
    <div className="dir-stage-flow">
      {items.map((item, index) => (
        <div key={item.key || item.label} className={`dir-stage-node ${item.count ? "active" : ""}`} style={{ ["--stage-color" as string]: item.color || "#94a3b8" }}>
          {index < items.length - 1 ? <span className="dir-stage-link" /> : null}
          <div className="dir-stage-marker"><span>{item.count}</span></div>
          <strong>{item.label}</strong>
          <small>{total ? `${Math.round((item.count / total) * 100)}% del período` : "Sin registros"}</small>
        </div>
      ))}
    </div>
  );
}

function PackageTracker({ milestones, color }: { milestones: Milestone[]; color: string }) {
  return (
    <div className="dir-package-track">
      {milestones.map((milestone, index) => (
        <div key={milestone.key} className={`dir-package-stop dir-package-${milestone.status}`} style={{ ["--mile-color" as string]: color }}>
          {index < milestones.length - 1 ? <span className="dir-package-link" /> : null}
          <span className="dir-package-dot" />
          <strong>{milestone.label}</strong>
          <small>{formatDate(milestone.date)}</small>
        </div>
      ))}
    </div>
  );
}

export default function SeguimientoImportacionesDireccionPage() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const autoLoadRef = useRef(false);

  const [trackingFile, setTrackingFile] = useState<File | null>(null);
  const [useLatestTemplate, setUseLatestTemplate] = useState(true);
  const [useHistory, setUseHistory] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [periodScope, setPeriodScope] = useState<PeriodScope>("year");
  const [periodYear, setPeriodYear] = useState<number | null>(new Date().getFullYear());
  const [periodMonth, setPeriodMonth] = useState<number | null>(new Date().getMonth() + 1);
  const [periodWeek, setPeriodWeek] = useState<number | null>(isoWeekInfo(new Date()).week);

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
        buildFormData(nextFile, nextUseLatest, nextUseHistory, "all", null, null, null)
      );
      setAnalysis(data);
      setStageFilter("all");

      const dated = data.shipments
        .map((item) => toDate(item.reference_date))
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime());
      const anchor = dated[0] || new Date();
      const weekInfo = isoWeekInfo(anchor);
      setPeriodScope("year");
      setPeriodYear(anchor.getFullYear());
      setPeriodMonth(anchor.getMonth() + 1);
      setPeriodWeek(weekInfo.week);
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

  const availableYears = useMemo(() => {
    if (!analysis) return [];
    const years = new Set<number>();
    analysis.shipments.forEach((item) => {
      const resolved = toDate(item.reference_date);
      if (resolved) years.add(resolved.getFullYear());
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [analysis]);

  const periodShipments = useMemo(() => {
    if (!analysis) return [];
    return filterByPeriod(analysis.shipments, periodScope, periodYear, periodMonth, periodWeek);
  }, [analysis, periodScope, periodYear, periodMonth, periodWeek]);

  const stageItems = useMemo(() => analysis ? stageBreakdown(periodShipments, analysis.stage_breakdown) : [], [analysis, periodShipments]);
  const stageScopedShipments = useMemo(() => {
    if (stageFilter === "all") return periodShipments;
    return periodShipments.filter((item) => item.stage_key === stageFilter);
  }, [periodShipments, stageFilter]);
  const overview = useMemo(() => filteredOverview(periodShipments), [periodShipments]);
  const suppliers = useMemo(() => topBreakdown(periodShipments, (item) => item.supplier_display || item.supplier_name || "Sin proveedor", 6), [periodShipments]);
  const terminals = useMemo(() => topBreakdown(periodShipments, (item) => item.terminal || "Sin terminal", 4), [periodShipments]);
  const alerts = useMemo(() => periodShipments.filter((item) => item.attention_level !== "ok" && item.attention_reason).slice(0, 8), [periodShipments]);
  const movements = useMemo(() => analysis ? movementSummary(analysis.shipments, periodScope, periodYear, periodMonth, periodWeek) : [], [analysis, periodScope, periodYear, periodMonth, periodWeek]);
  const currentPeriodLabel = useMemo(() => periodLabel(periodScope, periodYear, periodMonth, periodWeek), [periodScope, periodYear, periodMonth, periodWeek]);

  function applyPreset(scope: PeriodScope) {
    const anchor = new Date();
    const weekInfo = isoWeekInfo(anchor);
    setPeriodScope(scope);
    if (scope === "year") {
      setPeriodYear(anchor.getFullYear());
    } else if (scope === "month") {
      setPeriodYear(anchor.getFullYear());
      setPeriodMonth(anchor.getMonth() + 1);
    } else if (scope === "week") {
      setPeriodYear(weekInfo.year);
      setPeriodWeek(weekInfo.week);
    }
  }

  async function exportPdf() {
    if (!analysis) return;
    setExporting(true);
    setError(null);
    try {
      await apiUploadDownload(
        "/tools/compras/importaciones-tracking/executive/export-pdf",
        buildFormData(trackingFile, useLatestTemplate, useHistory, periodScope, periodYear, periodMonth, periodWeek),
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
                Tablero premium para dirección con lectura por etapa, filtros de período y exportación ejecutiva para
                reportes semanales, mensuales o anuales.
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
              <small>
                {analysis?.data_source.updated_at
                  ? `Actualizado el ${new Date(analysis.data_source.updated_at).toLocaleString("es-MX")}`
                  : "Puedes sustituirlo con otro Excel si necesitas una foto distinta."}
              </small>
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
                  if (file) setUseLatestTemplate(false);
                  event.target.value = "";
                }}
              />
              <small>{trackingFile ? trackingFile.name : "Sin archivo manual cargado."}</small>
            </div>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={useLatestTemplate}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setUseLatestTemplate(checked);
                  if (checked) setTrackingFile(null);
                }}
              />
              <span>Usar el último Excel generado por Importaciones</span>
            </label>
            <label className="inline-check">
              <input type="checkbox" checked={useHistory} onChange={(event) => setUseHistory(event.target.checked)} />
              <span>Enriquecer datos con el historial disponible</span>
            </label>
          </section>

          {analysis ? (
            <>
              <section className="card dir-period-card mb-4">
                <div className="dir-card-head">
                  <div>
                    <h2>Período del reporte</h2>
                    <p>{currentPeriodLabel}</p>
                  </div>
                  <span>{periodShipments.length} embarques visibles</span>
                </div>

                <div className="dir-period-presets">
                  <button type="button" className={`dir-filter-chip ${periodScope === "year" ? "active" : ""}`} onClick={() => applyPreset("year")}>Año actual</button>
                  <button type="button" className={`dir-filter-chip ${periodScope === "month" ? "active" : ""}`} onClick={() => applyPreset("month")}>Mes actual</button>
                  <button type="button" className={`dir-filter-chip ${periodScope === "week" ? "active" : ""}`} onClick={() => applyPreset("week")}>Semana actual</button>
                  <button type="button" className={`dir-filter-chip ${periodScope === "rolling30" ? "active" : ""}`} onClick={() => setPeriodScope("rolling30")}>Próximos 30 días</button>
                  <button type="button" className={`dir-filter-chip ${periodScope === "all" ? "active" : ""}`} onClick={() => setPeriodScope("all")}>Todo histórico</button>
                </div>

                <div className="dir-period-grid">
                  <label className="form-group">
                    <span className="dir-control-label">Tipo</span>
                    <select value={periodScope} onChange={(event) => setPeriodScope(event.target.value as PeriodScope)}>
                      <option value="year">Año</option>
                      <option value="month">Mes</option>
                      <option value="week">Semana</option>
                      <option value="rolling30">Próximos 30 días</option>
                      <option value="all">Todo histórico</option>
                    </select>
                  </label>

                  {(periodScope === "year" || periodScope === "month" || periodScope === "week") ? (
                    <label className="form-group">
                      <span className="dir-control-label">Año</span>
                      <select value={periodYear || ""} onChange={(event) => setPeriodYear(Number(event.target.value))}>
                        {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
                      </select>
                    </label>
                  ) : null}

                  {periodScope === "month" ? (
                    <label className="form-group">
                      <span className="dir-control-label">Mes</span>
                      <select value={periodMonth || ""} onChange={(event) => setPeriodMonth(Number(event.target.value))}>
                        {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
                      </select>
                    </label>
                  ) : null}

                  {periodScope === "week" ? (
                    <label className="form-group">
                      <span className="dir-control-label">Semana ISO</span>
                      <select value={periodWeek || ""} onChange={(event) => setPeriodWeek(Number(event.target.value))}>
                        {Array.from({ length: 53 }).map((_, index) => <option key={index + 1} value={index + 1}>Semana {index + 1}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
              </section>

              <section className="dir-stats-grid mb-4">
                <div className="card dir-stat"><span>Embarques</span><strong>{overview.shipments}</strong></div>
                <div className="card dir-stat"><span>Entregados</span><strong>{overview.delivered}</strong></div>
                <div className="card dir-stat"><span>Riesgo</span><strong>{overview.at_risk}</strong></div>
                <div className="card dir-stat"><span>Arribos 14 días</span><strong>{overview.upcoming_arrivals}</strong></div>
                <div className="card dir-stat"><span>Con ETA</span><strong>{overview.with_eta}</strong></div>
                <div className="card dir-stat"><span>USD identificados</span><strong>{formatMoney(overview.total_usd)}</strong></div>
              </section>

              <section className="dir-main-grid mb-4">
                <div className="card dir-stage-card">
                  <div className="dir-card-head">
                    <div>
                      <h2>Estado actual por etapa</h2>
                      <p>Lectura tipo tracker para dirección sobre el período seleccionado.</p>
                    </div>
                    <span>{currentPeriodLabel}</span>
                  </div>
                  <StageTrackerOverview items={stageItems} total={Math.max(periodShipments.length, 1)} />
                </div>

                <div className="dir-side-stack">
                  <div className="card dir-side-card">
                    <div className="dir-card-head">
                      <h2>Movimientos del período</h2>
                      <span>Resumen</span>
                    </div>
                    <div className="dir-movement-grid">
                      {movements.map((item) => (
                        <div key={item.key}>
                          <span>{item.label}</span>
                          <strong>{item.count}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card dir-side-card">
                    <div className="dir-card-head">
                      <h2>Alertas</h2>
                      <span>{alerts.length} visibles</span>
                    </div>
                    <div className="dir-alert-list">
                      {alerts.length ? alerts.map((alert) => (
                        <div key={`${alert.id}-${alert.attention_reason}`} className={`dir-alert dir-alert-${alert.attention_level}`}>
                          <strong>{alert.attention_reason}</strong>
                          <span>{shipmentTitle(alert)} · {shipmentSubtitle(alert)}</span>
                        </div>
                      )) : <div className="dir-empty">Sin alertas prioritarias en este período.</div>}
                    </div>
                  </div>
                </div>
              </section>

              <section className="dir-filters mb-4">
                <button type="button" className={`dir-filter-chip ${stageFilter === "all" ? "active" : ""}`} onClick={() => setStageFilter("all")}>
                  Todos ({periodShipments.length})
                </button>
                {stageItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`dir-filter-chip ${stageFilter === item.key ? "active" : ""}`}
                    style={{ ["--chip-color" as string]: item.color || "#cbd5e1" }}
                    onClick={() => setStageFilter(item.key || "all")}
                  >
                    {item.label} ({item.count})
                  </button>
                ))}
              </section>

              <section className="dir-meta-grid mb-4">
                <div className="card dir-meta-card">
                  <div className="dir-card-head">
                    <h2>Proveedores</h2>
                    <span>Top del período</span>
                  </div>
                  <div className="dir-list">
                    {suppliers.map((item) => (
                      <div key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.count}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card dir-meta-card">
                  <div className="dir-card-head">
                    <h2>Terminales</h2>
                    <span>Participación</span>
                  </div>
                  <div className="dir-list">
                    {terminals.map((item) => (
                      <div key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.count}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {stageScopedShipments.length ? (
                <section className="dir-cards-grid">
                  {stageScopedShipments.map((shipment) => (
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
                        <div className="dir-progress-bar">
                          <div className="dir-progress-fill" style={{ width: `${shipment.progress_pct}%`, background: shipment.stage_color }} />
                        </div>
                        <span>{shipment.progress_pct}% del recorrido operativo</span>
                      </div>

                      <PackageTracker milestones={shipment.milestones} color={shipment.stage_color} />

                      <div className="dir-info-grid">
                        <div><span>Referencia del período</span><strong>{shipment.reference_label ? `${shipment.reference_label} · ${formatDate(shipment.reference_date)}` : "Sin referencia"}</strong></div>
                        <div><span>Contenedor</span><strong>{shipment.container || "Sin dato"}</strong></div>
                        <div><span>Terminal</span><strong>{shipment.terminal || "Sin dato"}</strong></div>
                        <div><span>ETA</span><strong>{formatDate(shipment.eta)}</strong></div>
                        <div><span>Siguiente</span><strong>{shipment.next_event_label ? `${shipment.next_event_label} · ${formatDate(shipment.next_event_date)}` : "Sin siguiente evento"}</strong></div>
                        <div><span>Alerta</span><strong>{shipment.attention_reason || attentionLabel(shipment.attention_level)}</strong></div>
                      </div>

                      <div className="dir-pill-row">
                        <span className="dir-pill">{shipment.origin_port || "Origen pendiente"}</span>
                        <span className="dir-pill">{shipment.destination_port || "Destino pendiente"}</span>
                        <span className="dir-pill">{shipment.incoterm || "Incoterm pendiente"}</span>
                      </div>

                      <div className="dir-footer-grid">
                        <div>
                          <span>Pago proveedor</span>
                          <strong>{shipment.provider_payment_status || "Sin estatus"}</strong>
                          <small>{formatDate(shipment.provider_payment_due)}</small>
                        </div>
                        <div>
                          <span>Pago forwarder</span>
                          <strong>{shipment.forwarder_payment_status || "Sin estatus"}</strong>
                          <small>{formatDate(shipment.forwarder_payment_due)}</small>
                        </div>
                        <div>
                          <span>Mercancía</span>
                          <strong>{shipment.goods_summary || "Sin descripción"}</strong>
                          <small>{formatMoney(shipment.total_usd)}</small>
                        </div>
                      </div>
                    </article>
                  ))}
                </section>
              ) : (
                <div className="card dir-empty">No hay embarques en el período y etapa seleccionados.</div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
