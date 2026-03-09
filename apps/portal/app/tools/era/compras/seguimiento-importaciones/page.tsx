"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { apiUpload } from "@/lib/api";

type MilestoneStatus = "completed" | "current" | "upcoming" | "scheduled";

type TrackingMilestone = {
  key: string;
  label: string;
  date: string | null;
  status: MilestoneStatus;
};

type Shipment = {
  id: string;
  source: string;
  order_number: string | null;
  general_po: string | null;
  invoice_number: string | null;
  supplier_display: string | null;
  supplier_name: string | null;
  container: string | null;
  origin_port: string | null;
  destination_port: string | null;
  terminal: string | null;
  incoterm: string | null;
  total_usd: number | null;
  order_date: string | null;
  start_production: string | null;
  end_production: string | null;
  inspection_day: string | null;
  etd: string | null;
  eta: string | null;
  port_arrival: string | null;
  customs_release: string | null;
  warehouse_arrival: string | null;
  current_stage: string | null;
  status: string | null;
  comments: string | null;
  progress_pct: number;
  stage_label: string;
  milestones: TrackingMilestone[];
};

type AnalysisResponse = {
  summary: {
    shipments: number;
    with_operations: number;
    arrived_port: number;
    customs_released: number;
    warehouse_arrived: number;
    unmatched_operations: number;
  };
  shipments: Shipment[];
};

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mergeFiles(current: File[], incoming: File[]) {
  const map = new Map<string, File>();
  [...current, ...incoming].forEach((file) => map.set(fileKey(file), file));
  return Array.from(map.values());
}

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";
  return new Date(`${value}T12:00:00`).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoneyUsd(value: number | null) {
  if (value == null) return "Sin total";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "USD" }).format(value);
}

function shipmentTitle(shipment: Shipment) {
  return shipment.order_number || shipment.general_po || shipment.invoice_number || shipment.id;
}

function shipmentSubtitle(shipment: Shipment) {
  return shipment.supplier_display || shipment.supplier_name || "Proveedor pendiente";
}

function milestoneClass(status: MilestoneStatus) {
  if (status === "completed") return "trk-step done";
  if (status === "current") return "trk-step current";
  return "trk-step";
}

export default function ComprasTrackingPage() {
  const pdfRef = useRef<HTMLInputElement | null>(null);
  const operationsRef = useRef<HTMLInputElement | null>(null);

  const [orderPdfs, setOrderPdfs] = useState<File[]>([]);
  const [operationsFile, setOperationsFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedShipment = useMemo(
    () => analysis?.shipments.find((item) => item.id === selectedId) || analysis?.shipments[0] || null,
    [analysis, selectedId]
  );

  async function analyze() {
    if (!orderPdfs.length) {
      setError("Debes subir al menos un PDF de orden de compra.");
      return;
    }

    setProcessing(true);
    setError(null);
    try {
      const formData = new FormData();
      orderPdfs.forEach((file) => formData.append("order_pdfs", file));
      if (operationsFile) {
        formData.append("operations_file", operationsFile);
      }
      const data = await apiUpload<AnalysisResponse>("/tools/compras/importaciones-tracking/analyze", formData);
      setAnalysis(data);
      setSelectedId(data.shipments[0]?.id || null);
    } catch (err: any) {
      setError(err?.message || "No se pudo analizar el seguimiento.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <>
      <p className="text-muted mb-4">
        <Link href="/apps">&larr; Aplicaciones</Link>
      </p>

      <section className="card trk-hero mb-4">
        <div className="trk-kicker">ERA Compras</div>
        <h1>Seguimiento de importaciones</h1>
        <p>
          Cruza las órdenes de compra en PDF con el archivo operativo real para ver cada embarque como si fuera un
          tracking de paquetería.
        </p>
        <div className="trk-hero-grid">
          <div className="trk-hero-card">
            <strong>Entradas base</strong>
            <span>PDFs de órdenes de compra</span>
          </div>
          <div className="trk-hero-card">
            <strong>Actualización real</strong>
            <span>Excel o CSV operativo de Compras</span>
          </div>
          <div className="trk-hero-card">
            <strong>Salida</strong>
            <span>Timeline, progreso y fechas clave por embarque</span>
          </div>
        </div>
      </section>

      {error ? <div className="error-msg">{error}</div> : null}

      <div className="card mb-4 trk-upload">
        <div>
          <div
            className={`dropzone trk-dropzone ${dragActive ? "active" : ""}`}
            onClick={() => pdfRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              const dropped = Array.from(event.dataTransfer.files).filter((file) => file.name.toLowerCase().endsWith(".pdf"));
              setOrderPdfs((current) => mergeFiles(current, dropped));
            }}
          >
            <div className="trk-drop-title">Arrastra aquí las órdenes de compra PDF</div>
            <div className="gi-helper">También puedes hacer clic para seleccionarlas.</div>
          </div>
          <input
            ref={pdfRef}
            hidden
            type="file"
            accept=".pdf"
            multiple
            onChange={(event) => {
              setOrderPdfs((current) => mergeFiles(current, Array.from(event.target.files || [])));
              if (pdfRef.current) pdfRef.current.value = "";
            }}
          />
          {orderPdfs.length ? (
            <div className="trk-file-chips">
              {orderPdfs.map((file) => (
                <button
                  key={fileKey(file)}
                  type="button"
                  className="trk-file-chip"
                  onClick={() => setOrderPdfs((current) => current.filter((item) => fileKey(item) !== fileKey(file)))}
                >
                  {file.name} <span>×</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="stack-lg">
          <div>
            <div className="trk-panel-title">Archivo operativo</div>
            <div className="gi-helper">Opcional por ahora. Acepta `xlsx`, `xlsm` o `csv`.</div>
          </div>

          {operationsFile ? (
            <div className="trk-ops-file">
              <div>
                <strong>{operationsFile.name}</strong>
                <div className="text-muted">Se usará para actualizar hitos y estatus reales.</div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setOperationsFile(null)}>
                Quitar
              </button>
            </div>
          ) : (
            <>
              <button className="btn btn-outline" onClick={() => operationsRef.current?.click()}>
                Seleccionar archivo operativo
              </button>
              <input
                ref={operationsRef}
                hidden
                type="file"
                accept=".xlsx,.xlsm,.csv"
                onChange={(event) => {
                  setOperationsFile(event.target.files?.[0] || null);
                  if (operationsRef.current) operationsRef.current.value = "";
                }}
              />
            </>
          )}

          <div className="trk-mini-grid">
            <div className="trk-mini-card">
              <span className="trk-mini-label">OC cargadas</span>
              <strong>{orderPdfs.length}</strong>
            </div>
            <div className="trk-mini-card">
              <span className="trk-mini-label">Operativo</span>
              <strong>{operationsFile ? "Sí" : "No"}</strong>
            </div>
          </div>

          <button className="btn btn-primary" type="button" disabled={processing || !orderPdfs.length} onClick={analyze}>
            {processing ? "Analizando..." : "Generar seguimiento"}
          </button>
        </div>
      </div>

      {analysis ? (
        <>
          <div className="trk-summary mb-4">
            <div className="card trk-stat-card">
              <span className="trk-mini-label">Embarques</span>
              <strong>{analysis.summary.shipments}</strong>
            </div>
            <div className="card trk-stat-card">
              <span className="trk-mini-label">Con operativo</span>
              <strong>{analysis.summary.with_operations}</strong>
            </div>
            <div className="card trk-stat-card">
              <span className="trk-mini-label">Arribo a puerto</span>
              <strong>{analysis.summary.arrived_port}</strong>
            </div>
            <div className="card trk-stat-card">
              <span className="trk-mini-label">Liberados</span>
              <strong>{analysis.summary.customs_released}</strong>
            </div>
            <div className="card trk-stat-card">
              <span className="trk-mini-label">En almacén</span>
              <strong>{analysis.summary.warehouse_arrived}</strong>
            </div>
          </div>

          <div className="trk-layout">
            <aside className="trk-sidebar">
              <div className="card">
                <div className="trk-panel-title mb-4">Embarques detectados</div>
                <div className="trk-list">
                  {analysis.shipments.map((shipment) => (
                    <button
                      key={shipment.id}
                      type="button"
                      className={`trk-list-item ${selectedShipment?.id === shipment.id ? "active" : ""}`}
                      onClick={() => setSelectedId(shipment.id)}
                    >
                      <div className="trk-list-top">
                        <strong>{shipmentTitle(shipment)}</strong>
                        <span className="badge badge-running">{shipment.progress_pct}%</span>
                      </div>
                      <div className="trk-list-sub">{shipmentSubtitle(shipment)}</div>
                      <div className="trk-list-meta">
                        <span>{shipment.stage_label}</span>
                        <span>{shipment.eta ? `ETA ${formatDate(shipment.eta)}` : "Sin ETA"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            <section className="stack-lg">
              {selectedShipment ? (
                <>
                  <div className="card">
                    <div className="flex-between" style={{ gap: 16, flexWrap: "wrap" }}>
                      <div>
                        <div className="trk-panel-title">{shipmentTitle(selectedShipment)}</div>
                        <div className="trk-subtitle">{shipmentSubtitle(selectedShipment)}</div>
                      </div>
                      <span className="badge badge-succeeded">{selectedShipment.stage_label}</span>
                    </div>

                    <div className="trk-progress-wrap">
                      <div className="trk-progress-bar">
                        <div className="trk-progress-fill" style={{ width: `${selectedShipment.progress_pct}%` }} />
                      </div>
                      <span>{selectedShipment.progress_pct}% del recorrido operativo</span>
                    </div>

                    <div className="trk-facts">
                      <div className="trk-fact">
                        <span className="trk-mini-label">General PO</span>
                        <strong>{selectedShipment.general_po || "Sin dato"}</strong>
                      </div>
                      <div className="trk-fact">
                        <span className="trk-mini-label">Contenedor</span>
                        <strong>{selectedShipment.container || "Pendiente"}</strong>
                      </div>
                      <div className="trk-fact">
                        <span className="trk-mini-label">Incoterm</span>
                        <strong>{selectedShipment.incoterm || "Sin dato"}</strong>
                      </div>
                      <div className="trk-fact">
                        <span className="trk-mini-label">Total</span>
                        <strong>{formatMoneyUsd(selectedShipment.total_usd)}</strong>
                      </div>
                      <div className="trk-fact">
                        <span className="trk-mini-label">Origen</span>
                        <strong>{selectedShipment.origin_port || "Sin dato"}</strong>
                      </div>
                      <div className="trk-fact">
                        <span className="trk-mini-label">Destino</span>
                        <strong>{selectedShipment.destination_port || "Sin dato"}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <div className="trk-panel-title mb-4">Timeline del embarque</div>
                    <div className="trk-timeline">
                      {selectedShipment.milestones.map((milestone) => (
                        <div key={milestone.key} className={milestoneClass(milestone.status)}>
                          <div className="trk-step-dot" />
                          <div className="trk-step-body">
                            <div className="trk-step-head">
                              <strong>{milestone.label}</strong>
                              <span>{formatDate(milestone.date)}</span>
                            </div>
                            <div className="trk-step-status">
                              {milestone.status === "completed" && "Completado"}
                              {milestone.status === "current" && "Etapa actual"}
                              {milestone.status === "upcoming" && "Pendiente"}
                              {milestone.status === "scheduled" && "Programado"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card">
                    <div className="trk-panel-title mb-4">Lectura operativa</div>
                    <div className="trk-readout">
                      <div className="trk-readout-item">
                        <span className="trk-mini-label">ETD</span>
                        <strong>{formatDate(selectedShipment.etd)}</strong>
                      </div>
                      <div className="trk-readout-item">
                        <span className="trk-mini-label">ETA</span>
                        <strong>{formatDate(selectedShipment.eta)}</strong>
                      </div>
                      <div className="trk-readout-item">
                        <span className="trk-mini-label">Arribo real</span>
                        <strong>{formatDate(selectedShipment.port_arrival)}</strong>
                      </div>
                      <div className="trk-readout-item">
                        <span className="trk-mini-label">Despacho</span>
                        <strong>{formatDate(selectedShipment.customs_release)}</strong>
                      </div>
                      <div className="trk-readout-item">
                        <span className="trk-mini-label">Almacén</span>
                        <strong>{formatDate(selectedShipment.warehouse_arrival)}</strong>
                      </div>
                      <div className="trk-readout-item">
                        <span className="trk-mini-label">Terminal</span>
                        <strong>{selectedShipment.terminal || "Sin dato"}</strong>
                      </div>
                    </div>
                    {selectedShipment.comments ? (
                      <div className="trk-notes">
                        <span className="trk-mini-label">Comentarios</span>
                        <p>{selectedShipment.comments}</p>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}
