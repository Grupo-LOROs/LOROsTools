"use client";

import { useMemo, useState } from "react";
import { apiUpload } from "@/lib/api";

type ReceiptRow = {
  file: string;
  period_raw: string | null;
  kwh_total: number | null;
  billing_period: number | null;
  dap: number | null;
  total_to_pay: number | null;
  confidence: "high" | "medium" | "low";
};

type QuoteResult = {
  avg_cfe_amount: number;
  conservative_savings: number;
  financed_amount: number;
  monthly_payment: number;
  ica: number;
  margin: number;
  status: "AUTORIZABLE" | "AJUSTAR" | "NO AUTORIZABLE";
};

type Recommendation = {
  title: string;
  status: string;
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

type ComputeResponse = {
  receipts: ReceiptRow[];
  quote: QuoteResult;
  recommendations: Recommendation[];
  amortization: AmortizationRow[];
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

function money(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(value);
}

function number(value: number, max = 3) {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: max }).format(value);
}

export default function GICotizadorPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComputeResponse | null>(null);

  const [system, setSystem] = useState<SystemForm>({
    reduction_pct: 65,
    conservative_adj_pct: 10,
    system_cost: 0,
    down_payment_pct: 10,
    months_installation: 0,
  });

  const [credit, setCredit] = useState<CreditForm>({
    annual_rate_pct: 18,
    term_months: 60,
    opening_fee_pct: 0,
    vat_on_fee_pct: 16,
    vat_on_interest: true,
    vat_interest_pct: 16,
  });

  const statusClass = useMemo(() => {
    if (!result) return "badge";
    if (result.quote.status === "AUTORIZABLE") return "badge badge-succeeded";
    if (result.quote.status === "AJUSTAR") return "badge badge-running";
    return "badge badge-failed";
  }, [result]);

  async function onCompute() {
    if (!files.length) {
      setError("Debes subir al menos un PDF.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      fd.append("system_json", JSON.stringify(system));
      fd.append("credit_json", JSON.stringify(credit));

      const data = await apiUpload<ComputeResponse>("/tools/gi/quote", fd);
      setResult(data);
    } catch (err: any) {
      setError(err?.message || "No se pudo procesar la cotización.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <p className="text-muted mb-4">
        <a href="/apps">&larr; Apps</a>
      </p>

      <h1 style={{ fontSize: "1.35rem", marginBottom: 6 }}>GI - Cotizador ERA/GI</h1>
      <p className="text-muted mb-4">
        Sube recibos PDF CFE y genera el análisis de crédito dentro del portal.
      </p>

      {error && <div className="error-msg">{error}</div>}

      <div className="card mb-4">
        <div className="form-group">
          <label>Recibos PDF</label>
          <input
            type="file"
            multiple
            accept=".pdf"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
          <div className="text-muted mt-2">{files.length} archivo(s) seleccionado(s)</div>
        </div>
      </div>

      <div className="card mb-4">
        <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Parámetros del sistema</h2>
        <div className="form-grid">
          <div className="form-group">
            <label>Reducción (%)</label>
            <input
              type="number"
              value={system.reduction_pct}
              onChange={(e) => setSystem({ ...system, reduction_pct: Number(e.target.value || 0) })}
            />
          </div>
          <div className="form-group">
            <label>Ajuste conservador (%)</label>
            <input
              type="number"
              value={system.conservative_adj_pct}
              onChange={(e) => setSystem({ ...system, conservative_adj_pct: Number(e.target.value || 0) })}
            />
          </div>
          <div className="form-group">
            <label>Costo del sistema ($)</label>
            <input
              type="number"
              value={system.system_cost}
              onChange={(e) => setSystem({ ...system, system_cost: Number(e.target.value || 0) })}
            />
          </div>
          <div className="form-group">
            <label>Enganche (%)</label>
            <input
              type="number"
              value={system.down_payment_pct}
              onChange={(e) => setSystem({ ...system, down_payment_pct: Number(e.target.value || 0) })}
            />
          </div>
          <div className="form-group">
            <label>Meses de instalación</label>
            <input
              type="number"
              value={system.months_installation}
              onChange={(e) => setSystem({ ...system, months_installation: Number(e.target.value || 0) })}
            />
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Parámetros del crédito</h2>
        <div className="form-grid">
          <div className="form-group">
            <label>Tasa anual (%)</label>
            <input
              type="number"
              value={credit.annual_rate_pct}
              onChange={(e) => setCredit({ ...credit, annual_rate_pct: Number(e.target.value || 0) })}
            />
          </div>
          <div className="form-group">
            <label>Plazo (meses)</label>
            <input
              type="number"
              value={credit.term_months}
              onChange={(e) => setCredit({ ...credit, term_months: Number(e.target.value || 0) })}
            />
          </div>
          <div className="form-group">
            <label>Comisión de apertura (%)</label>
            <input
              type="number"
              value={credit.opening_fee_pct}
              onChange={(e) => setCredit({ ...credit, opening_fee_pct: Number(e.target.value || 0) })}
            />
          </div>
          <div className="form-group">
            <label>IVA comisión (%)</label>
            <input
              type="number"
              value={credit.vat_on_fee_pct}
              onChange={(e) => setCredit({ ...credit, vat_on_fee_pct: Number(e.target.value || 0) })}
            />
          </div>
          <div className="form-group">
            <label>IVA intereses (%)</label>
            <input
              type="number"
              value={credit.vat_interest_pct}
              onChange={(e) => setCredit({ ...credit, vat_interest_pct: Number(e.target.value || 0) })}
            />
          </div>
        </div>

        <label className="inline-check" style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={credit.vat_on_interest}
            onChange={(e) => setCredit({ ...credit, vat_on_interest: e.target.checked })}
          />
          <span>Aplicar IVA a intereses</span>
        </label>
      </div>

      <button className="btn btn-primary mb-4" disabled={loading} onClick={onCompute}>
        {loading ? "Procesando..." : "Procesar cotización"}
      </button>

      {result && (
        <>
          <div className="card mb-4">
            <h2 style={{ fontSize: "1rem", marginBottom: 12 }}>Resultado</h2>
            <div className="mb-3">
              <span className={statusClass}>{result.quote.status}</span>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div>Promedio CFE: {money(result.quote.avg_cfe_amount)}</div>
              <div>Ahorro conservador: {money(result.quote.conservative_savings)}</div>
              <div>Monto financiado: {money(result.quote.financed_amount)}</div>
              <div>Pago mensual: {money(result.quote.monthly_payment)}</div>
              <div>ICA: {number(result.quote.ica)}</div>
              <div>Margen: {money(result.quote.margin)}</div>
            </div>
          </div>

          <div className="card mb-4" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Período</th>
                  <th>kWh total</th>
                  <th>Facturación</th>
                  <th>DAP</th>
                  <th>Total</th>
                  <th>Confianza</th>
                </tr>
              </thead>
              <tbody>
                {result.receipts.map((r) => (
                  <tr key={r.file}>
                    <td>{r.file}</td>
                    <td>{r.period_raw || "-"}</td>
                    <td>{r.kwh_total ?? "-"}</td>
                    <td>{r.billing_period != null ? money(r.billing_period) : "-"}</td>
                    <td>{r.dap != null ? money(r.dap) : "-"}</td>
                    <td>{r.total_to_pay != null ? money(r.total_to_pay) : "-"}</td>
                    <td>
                      <span className={`badge badge-${r.confidence === "high" ? "succeeded" : r.confidence === "medium" ? "running" : "failed"}`}>
                        {r.confidence}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card mb-4" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Recomendación</th>
                  <th>Estatus</th>
                  <th>ICA</th>
                  <th>Pago mensual</th>
                </tr>
              </thead>
              <tbody>
                {result.recommendations.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-muted" style={{ textAlign: "center", padding: 18 }}>
                      Sin recomendaciones adicionales.
                    </td>
                  </tr>
                )}
                {result.recommendations.map((rec) => (
                  <tr key={rec.title}>
                    <td>{rec.title}</td>
                    <td>{rec.status}</td>
                    <td>{number(rec.ica)}</td>
                    <td>{money(rec.monthly_payment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card mb-4" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Saldo inicial</th>
                  <th>Pago</th>
                  <th>Interés</th>
                  <th>IVA interés</th>
                  <th>Principal</th>
                  <th>Saldo final</th>
                </tr>
              </thead>
              <tbody>
                {result.amortization.slice(0, 24).map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{money(row.balance_start)}</td>
                    <td>{money(row.payment)}</td>
                    <td>{money(row.interest)}</td>
                    <td>{money(row.vat_interest)}</td>
                    <td>{money(row.principal)}</td>
                    <td>{money(row.balance_end)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
