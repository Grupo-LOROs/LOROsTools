"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { apiUpload } from "@/lib/api";

type Confidence = "high" | "medium" | "low";
type QuoteStatus = "AUTORIZABLE" | "AJUSTAR" | "NO AUTORIZABLE";

type ReceiptRow = {
  file: string;
  period_raw: string | null;
  kwh_total: number | null;
  billing_period: number | null;
  dap: number | null;
  total_to_pay: number | null;
  base_amount_recommended: number | null;
  confidence: Confidence;
  warnings: string[];
};

type SystemForm = {
  reduction_pct: number;
  conservative_adj_pct: number;
  system_cost: number;
  down_payment_pct: number;
  months_installation: number;
};

type CreditForm = {
  annual_rate_pct: number;
  term_months: number;
  opening_fee_pct: number;
  vat_on_fee_pct: number;
  vat_on_interest: boolean;
  vat_interest_pct: number;
};

type QuoteResult = {
  avg_cfe_amount: number;
  conservative_savings: number;
  financed_amount: number;
  monthly_payment: number;
  ica: number;
  margin: number;
  status: QuoteStatus;
};

type Recommendation = {
  title: string;
  changes: Record<string, number>;
  status: QuoteStatus;
  ica: number;
  monthly_payment: number;
};

type AmortizationRow = {
  month: number;
  balance_start: number;
  payment: number;
  interest: number;
  vat_interest: number;
  principal: number;
  balance_end: number;
};

type ComputeResponse = { receipts: ReceiptRow[] };

const DEFAULT_SYSTEM: SystemForm = {
  reduction_pct: 65,
  conservative_adj_pct: 10,
  system_cost: 0,
  down_payment_pct: 10,
  months_installation: 0,
};

const DEFAULT_CREDIT: CreditForm = {
  annual_rate_pct: 18,
  term_months: 60,
  opening_fee_pct: 0,
  vat_on_fee_pct: 16,
  vat_on_interest: true,
  vat_interest_pct: 16,
};

function money(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(value);
}

function num(value: number, digits = 2) {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: digits }).format(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toNumber(raw: string, min: number, max: number) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : min;
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mergeFiles(current: File[], incoming: File[]) {
  const map = new Map<string, File>();
  [...current, ...incoming].forEach((file) => map.set(fileKey(file), file));
  return Array.from(map.values());
}

function avgCfe(receipts: ReceiptRow[]) {
  const values = receipts.map((item) => item.base_amount_recommended).filter((item): item is number => item != null);
  return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0;
}

function pmt(rate: number, periods: number, pv: number) {
  if (periods <= 0) return 0;
  if (Math.abs(rate) < 1e-12) return pv / periods;
  return (rate * pv) / (1 - (1 + rate) ** -periods);
}

function computeQuote(avg: number, system: SystemForm, credit: CreditForm): QuoteResult {
  const reduction = system.reduction_pct / 100;
  const conservativeAdj = system.conservative_adj_pct / 100;
  const conservativeSavings = avg * reduction * (1 - conservativeAdj);
  const financedAmount = system.system_cost * (1 - system.down_payment_pct / 100);
  const monthlyRate = (credit.annual_rate_pct / 100) / 12;
  const vatRate = credit.vat_on_interest ? credit.vat_interest_pct / 100 : 0;
  const payment = pmt(monthlyRate * (1 + vatRate), credit.term_months, financedAmount);
  const ica = payment > 0 ? conservativeSavings / payment : 0;
  const margin = conservativeSavings - payment;
  const status: QuoteStatus = ica >= 1.1 ? "AUTORIZABLE" : ica >= 1 ? "AJUSTAR" : "NO AUTORIZABLE";
  return { avg_cfe_amount: avg, conservative_savings: conservativeSavings, financed_amount: financedAmount, monthly_payment: payment, ica, margin, status };
}

function amortization(financedAmount: number, credit: CreditForm) {
  const monthlyRate = (credit.annual_rate_pct / 100) / 12;
  const vatRate = credit.vat_on_interest ? credit.vat_interest_pct / 100 : 0;
  const payment = pmt(monthlyRate * (1 + vatRate), credit.term_months, financedAmount);
  const rows: AmortizationRow[] = [];
  let balance = financedAmount;
  for (let month = 1; month <= credit.term_months; month += 1) {
    const interest = balance * monthlyRate;
    const vatInterest = interest * vatRate;
    const principal = payment - interest - vatInterest;
    let nextBalance = balance - principal;
    rows.push({
      month,
      balance_start: Number(balance.toFixed(2)),
      payment: Number(payment.toFixed(2)),
      interest: Number(interest.toFixed(2)),
      vat_interest: Number(vatInterest.toFixed(2)),
      principal: Number(principal.toFixed(2)),
      balance_end: Number(nextBalance.toFixed(2)),
    });
    if (nextBalance < 0 && Math.abs(nextBalance) < 0.05) nextBalance = 0;
    balance = nextBalance;
  }
  return rows;
}

function recommendations(avg: number, system: SystemForm, credit: CreditForm) {
  const base = computeQuote(avg, system, credit);
  const items: Recommendation[] = [];
  const add = (title: string, changes: Record<string, number>, nextSystem: SystemForm, nextCredit: CreditForm) => {
    const quote = computeQuote(avg, nextSystem, nextCredit);
    if (quote.ica <= base.ica + 0.01 && quote.status === base.status) return;
    items.push({ title, changes, status: quote.status, ica: quote.ica, monthly_payment: quote.monthly_payment });
  };
  [12, 24, 36].map((delta) => credit.term_months + delta).filter((term) => term <= 96).forEach((term) => add(`Aumentar plazo a ${term} meses`, { "credit.term_months": term }, system, { ...credit, term_months: term }));
  [5, 10, 15].map((delta) => system.down_payment_pct + delta).filter((pct) => pct <= 40).forEach((pct) => add(`Aumentar enganche a ${num(pct, 0)}%`, { "system.down_payment_pct": pct }, { ...system, down_payment_pct: pct }, credit));
  [2, 4, 6].map((delta) => credit.annual_rate_pct - delta).filter((rate) => rate >= 8).forEach((rate) => add(`Reducir tasa a ${num(rate, 1)}% anual`, { "credit.annual_rate_pct": rate }, system, { ...credit, annual_rate_pct: rate }));
  if (system.conservative_adj_pct > 5) {
    [2.5, 5].map((delta) => Math.max(0, system.conservative_adj_pct - delta)).forEach((pct) => add(`Reducir ajuste conservador a ${num(pct, 1)}%`, { "system.conservative_adj_pct": pct }, { ...system, conservative_adj_pct: pct }, credit));
  }
  const order: Record<QuoteStatus, number> = { AUTORIZABLE: 0, AJUSTAR: 1, "NO AUTORIZABLE": 2 };
  return items.sort((left, right) => order[left.status] - order[right.status] || right.ica - left.ica || left.monthly_payment - right.monthly_payment).slice(0, 6);
}

function badgeClass(status: QuoteStatus | Confidence) {
  if (status === "AUTORIZABLE" || status === "high") return "badge badge-succeeded";
  if (status === "AJUSTAR" || status === "medium") return "badge badge-running";
  return "badge badge-failed";
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  hint,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="gi-field">
      <div className="gi-field-head">
        <label>{label}</label>
        <strong>{display}</strong>
      </div>
      <div className="gi-helper">{hint}</div>
      <div className="gi-field-grid">
        <input className="gi-range" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(toNumber(event.target.value, min, max))} />
        <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(toNumber(event.target.value, min, max))} />
      </div>
    </div>
  );
}

export default function GICotizadorPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [processedAt, setProcessedAt] = useState<string | null>(null);
  const [system, setSystem] = useState(DEFAULT_SYSTEM);
  const [credit, setCredit] = useState(DEFAULT_CREDIT);

  const average = avgCfe(receipts);
  const quote = receipts.length ? computeQuote(average, system, credit) : null;
  const recs = quote ? recommendations(average, system, credit) : [];
  const schedule = quote ? amortization(quote.financed_amount, credit) : [];
  const high = receipts.filter((item) => item.confidence === "high").length;
  const medium = receipts.filter((item) => item.confidence === "medium").length;
  const low = receipts.filter((item) => item.confidence === "low").length;
  const warnings = receipts.reduce((sum, item) => sum + item.warnings.length, 0);
  const avgKwh = receipts.length ? receipts.reduce((sum, item) => sum + (item.kwh_total || 0), 0) / receipts.length : 0;
  const meterMax = 1.4;

  function resetAnalysis(nextFiles: File[]) {
    setFiles(nextFiles);
    setReceipts([]);
    setProcessedAt(null);
    setError(null);
  }

  async function processReceipts() {
    if (!files.length) return setError("Debes subir al menos un PDF.");
    setProcessing(true);
    setError(null);
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("system_json", JSON.stringify(system));
      formData.append("credit_json", JSON.stringify(credit));
      const data = await apiUpload<ComputeResponse>("/tools/gi/quote", formData);
      setReceipts(data.receipts);
      setProcessedAt(new Date().toISOString());
    } catch (err: any) {
      setError(err?.message || "No se pudieron procesar los recibos.");
    } finally {
      setProcessing(false);
    }
  }

  function applyRecommendation(rec: Recommendation) {
    Object.entries(rec.changes).forEach(([key, value]) => {
      if (key === "system.down_payment_pct") setSystem((current) => ({ ...current, down_payment_pct: value }));
      if (key === "system.conservative_adj_pct") setSystem((current) => ({ ...current, conservative_adj_pct: value }));
      if (key === "credit.term_months") setCredit((current) => ({ ...current, term_months: value }));
      if (key === "credit.annual_rate_pct") setCredit((current) => ({ ...current, annual_rate_pct: value }));
    });
  }

  return (
    <>
      <p className="text-muted mb-4"><Link href="/apps">&larr; Apps</Link></p>
      <div className="card gi-hero mb-4">
        <div className="gi-kicker">Vista nativa dentro del portal</div>
        <h1>GI - Cotizador ERA/GI</h1>
        <p>Procesa los recibos una sola vez y despuÃ©s ajusta la cotizaciÃ³n en tiempo real.</p>
        <div className="gi-steps"><span>1. Carga PDFs</span><span>2. Procesa recibos</span><span>3. Ajusta escenario</span></div>
      </div>
      {error ? <div className="error-msg">{error}</div> : null}
      <div className="card gi-upload mb-4">
        <div>
          <div
            className={`dropzone gi-dropzone ${dragActive ? "active" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              resetAnalysis(mergeFiles(files, Array.from(event.dataTransfer.files).filter((file) => file.name.toLowerCase().endsWith(".pdf"))));
            }}
          >
            <div className="gi-drop-title">Arrastra aquÃ­ los PDFs o haz clic para seleccionarlos</div>
            <div className="gi-helper">DespuÃ©s de procesarlos, el escenario queda en vivo.</div>
            <input
              ref={inputRef}
              hidden
              type="file"
              multiple
              accept=".pdf"
              onChange={(event) => {
                resetAnalysis(mergeFiles(files, Array.from(event.target.files || [])));
                if (inputRef.current) inputRef.current.value = "";
              }}
            />
          </div>
          {files.length ? <div className="gi-files">{files.map((file) => <button key={fileKey(file)} type="button" className="gi-file" onClick={() => resetAnalysis(files.filter((item) => fileKey(item) !== fileKey(file)))}>{file.name} <span>Ã—</span></button>)}</div> : null}
        </div>
        <div className="stack-lg">
          <div className="gi-panel-title">Procesamiento</div>
          <div className="gi-status-strip"><div><div className="gi-mini-label">Seleccionados</div><div className="gi-mini-value">{files.length}</div></div><div><div className="gi-mini-label">Procesados</div><div className="gi-mini-value">{receipts.length}</div></div><div><div className="gi-mini-label">Ãšltimo procesamiento</div><div className="gi-mini-value">{processedAt ? new Date(processedAt).toLocaleTimeString("es-MX") : "Pendiente"}</div></div></div>
          <button className="btn btn-primary" type="button" disabled={processing || !files.length} onClick={processReceipts}>{processing ? "Leyendo PDFs..." : receipts.length ? "Reprocesar recibos" : "Procesar recibos"}</button>
          <div className="gi-helper">{receipts.length ? "Los recibos ya quedaron listos. Ajusta cualquier control y el resultado cambia al instante." : "Primero procesa los PDFs para habilitar la simulaciÃ³n con datos reales."}</div>
        </div>
      </div>
      <div className="gi-layout">
        <div className="gi-sidebar">
          <div className="card">
            <div className="gi-panel-title">Escenario en vivo</div>
            <div className="gi-helper mb-4">Estos controles sÃ­ modifican el resultado actual.</div>
            <SliderField label="Costo del sistema" value={system.system_cost} min={0} max={10000000} step={1000} hint="Base del monto a financiar." display={money(system.system_cost)} onChange={(value) => setSystem((current) => ({ ...current, system_cost: value }))} />
            <SliderField label="Enganche" value={system.down_payment_pct} min={0} max={40} step={0.5} hint="Reduce el monto financiado." display={`${num(system.down_payment_pct, 1)}%`} onChange={(value) => setSystem((current) => ({ ...current, down_payment_pct: value }))} />
            <SliderField label="ReducciÃ³n" value={system.reduction_pct} min={0} max={100} step={0.5} hint="Ahorro estimado sobre el recibo." display={`${num(system.reduction_pct, 1)}%`} onChange={(value) => setSystem((current) => ({ ...current, reduction_pct: value }))} />
            <SliderField label="Ajuste conservador" value={system.conservative_adj_pct} min={0} max={30} step={0.5} hint="Descuenta una parte del ahorro." display={`${num(system.conservative_adj_pct, 1)}%`} onChange={(value) => setSystem((current) => ({ ...current, conservative_adj_pct: value }))} />
            <SliderField label="Tasa anual" value={credit.annual_rate_pct} min={0} max={40} step={0.25} hint="Impacta el pago mensual." display={`${num(credit.annual_rate_pct, 2)}%`} onChange={(value) => setCredit((current) => ({ ...current, annual_rate_pct: value }))} />
            <SliderField label="Plazo" value={credit.term_months} min={12} max={96} step={1} hint="Mayor plazo suele bajar el pago." display={`${num(credit.term_months, 0)} meses`} onChange={(value) => setCredit((current) => ({ ...current, term_months: value }))} />
            <SliderField label="IVA intereses" value={credit.vat_interest_pct} min={0} max={20} step={0.5} hint="Se usa si estÃ¡ activa la casilla inferior." display={`${num(credit.vat_interest_pct, 1)}%`} onChange={(value) => setCredit((current) => ({ ...current, vat_interest_pct: value }))} />
            <label className="inline-check" style={{ marginTop: 8 }}><input type="checkbox" checked={credit.vat_on_interest} onChange={(event) => setCredit((current) => ({ ...current, vat_on_interest: event.target.checked }))} /><span>Aplicar IVA a intereses</span></label>
          </div>
          <div className="card">
            <div className="gi-panel-title">Datos complementarios</div>
            <div className="gi-helper mb-4">Se conservan para captura, pero no mueven el cÃ¡lculo principal actual.</div>
            <div className="form-group"><label>Meses de instalaciÃ³n</label><input type="number" min={0} max={24} step={1} value={system.months_installation} onChange={(event) => setSystem((current) => ({ ...current, months_installation: toNumber(event.target.value, 0, 24) }))} /></div>
            <div className="form-group"><label>ComisiÃ³n de apertura (%)</label><input type="number" min={0} max={20} step={0.25} value={credit.opening_fee_pct} onChange={(event) => setCredit((current) => ({ ...current, opening_fee_pct: toNumber(event.target.value, 0, 20) }))} /></div>
            <div className="form-group" style={{ marginBottom: 0 }}><label>IVA comisiÃ³n (%)</label><input type="number" min={0} max={20} step={0.25} value={credit.vat_on_fee_pct} onChange={(event) => setCredit((current) => ({ ...current, vat_on_fee_pct: toNumber(event.target.value, 0, 20) }))} /></div>
          </div>
        </div>
        <div className="stack-lg">
          {!quote ? <div className="card"><div className="gi-panel-title">Resultado</div><p className="text-muted">Carga los PDFs y presiona <strong>Procesar recibos</strong> para habilitar la cotizaciÃ³n en vivo.</p></div> : <>
            <div className="card">
              <div className="flex-between" style={{ gap: 16, flexWrap: "wrap" }}><div><div className="gi-panel-title" style={{ marginBottom: 6 }}>Resultado de la cotizaciÃ³n</div><div className="gi-helper">Basado en {receipts.length} recibo(s) procesado(s).</div></div><span className={badgeClass(quote.status)}>{quote.status}</span></div>
              <div className="gi-kpis"><div className="gi-kpi"><div className="gi-kpi-label">Pago mensual</div><div className="gi-kpi-value">{money(quote.monthly_payment)}</div></div><div className="gi-kpi"><div className="gi-kpi-label">ICA</div><div className="gi-kpi-value">{num(quote.ica, 3)}</div></div><div className="gi-kpi"><div className="gi-kpi-label">Ahorro conservador</div><div className="gi-kpi-value">{money(quote.conservative_savings)}</div></div><div className="gi-kpi"><div className="gi-kpi-label">Margen</div><div className="gi-kpi-value">{money(quote.margin)}</div></div><div className="gi-kpi"><div className="gi-kpi-label">Promedio CFE</div><div className="gi-kpi-value">{money(quote.avg_cfe_amount)}</div></div><div className="gi-kpi"><div className="gi-kpi-label">Monto financiado</div><div className="gi-kpi-value">{money(quote.financed_amount)}</div></div></div>
              <div className="gi-meter-head"><strong>SemÃ¡foro ICA</strong><span className="gi-helper">Ajustar: 1.00 | Autorizable: 1.10</span></div>
              <div className="gi-meter"><div className="gi-meter-fill" style={{ width: `${Math.min((quote.ica / meterMax) * 100, 100)}%` }} /><span className="gi-meter-mark" style={{ left: `${(1 / meterMax) * 100}%` }} /><span className="gi-meter-mark" style={{ left: `${(1.1 / meterMax) * 100}%` }} /></div>
            </div>
            <div className="card">
              <div className="gi-panel-title">Lectura de recibos</div>
              <div className="gi-summary"><div className="gi-mini-stat"><div className="gi-mini-label">Confianza alta</div><div className="gi-mini-value">{high}</div></div><div className="gi-mini-stat"><div className="gi-mini-label">Confianza media</div><div className="gi-mini-value">{medium}</div></div><div className="gi-mini-stat"><div className="gi-mini-label">Confianza baja</div><div className="gi-mini-value">{low}</div></div><div className="gi-mini-stat"><div className="gi-mini-label">Alertas</div><div className="gi-mini-value">{warnings}</div></div><div className="gi-mini-stat"><div className="gi-mini-label">Promedio kWh</div><div className="gi-mini-value">{num(avgKwh, 0)}</div></div><div className="gi-mini-stat"><div className="gi-mini-label">Base promedio</div><div className="gi-mini-value">{money(average)}</div></div></div>
            </div>
            <div className="card">
              <div className="gi-panel-title">Recomendaciones</div>
              <div className="gi-helper mb-4">Haz clic para aplicar una recomendaciÃ³n al escenario actual.</div>
              {recs.length ? <div className="gi-recs">{recs.map((rec) => <button key={`${rec.title}-${rec.ica}`} type="button" className="gi-rec" onClick={() => applyRecommendation(rec)}><div className="flex-between" style={{ gap: 12, alignItems: "flex-start" }}><strong>{rec.title}</strong><span className={badgeClass(rec.status)}>{rec.status}</span></div><div className="gi-rec-meta"><span>ICA {num(rec.ica, 3)}</span><span>Pago {money(rec.monthly_payment)}</span></div></button>)}</div> : <div className="text-muted">No hay ajustes simples que mejoren el escenario actual.</div>}
            </div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="gi-table-head"><div><div className="gi-panel-title" style={{ marginBottom: 6 }}>Recibos procesados</div><div className="gi-helper">Datos extraÃ­dos y alertas detectadas por PDF.</div></div></div>
              <div className="gi-table-wrap"><table><thead><tr><th>Archivo</th><th>PerÃ­odo</th><th>kWh total</th><th>Base recomendada</th><th>FacturaciÃ³n</th><th>DAP</th><th>Total</th><th>Confianza</th><th>Alertas</th></tr></thead><tbody>{receipts.map((receipt) => <tr key={receipt.file}><td>{receipt.file}</td><td>{receipt.period_raw || "-"}</td><td>{receipt.kwh_total != null ? num(receipt.kwh_total, 0) : "-"}</td><td>{receipt.base_amount_recommended != null ? money(receipt.base_amount_recommended) : "-"}</td><td>{receipt.billing_period != null ? money(receipt.billing_period) : "-"}</td><td>{receipt.dap != null ? money(receipt.dap) : "-"}</td><td>{receipt.total_to_pay != null ? money(receipt.total_to_pay) : "-"}</td><td><span className={badgeClass(receipt.confidence)}>{receipt.confidence === "high" ? "Alta" : receipt.confidence === "medium" ? "Media" : "Baja"}</span></td><td>{receipt.warnings.length ? receipt.warnings.join("; ") : "Sin alertas"}</td></tr>)}</tbody></table></div>
            </div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="gi-table-head"><div><div className="gi-panel-title" style={{ marginBottom: 6 }}>AmortizaciÃ³n</div><div className="gi-helper">Primeros 24 meses del escenario actual.</div></div></div>
              <div className="gi-table-wrap"><table><thead><tr><th>Mes</th><th>Saldo inicial</th><th>Pago</th><th>InterÃ©s</th><th>IVA interÃ©s</th><th>Principal</th><th>Saldo final</th></tr></thead><tbody>{schedule.slice(0, 24).map((row) => <tr key={row.month}><td>{row.month}</td><td>{money(row.balance_start)}</td><td>{money(row.payment)}</td><td>{money(row.interest)}</td><td>{money(row.vat_interest)}</td><td>{money(row.principal)}</td><td>{money(row.balance_end)}</td></tr>)}</tbody></table></div>
            </div>
          </>}
        </div>
      </div>
    </>
  );
}


