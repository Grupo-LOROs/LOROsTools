"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiDownload, apiFetch } from "@/lib/api";

type Vendor = {
  id: number;
  name: string;
};

type Product = {
  sku: string;
  description: string;
  unit: string;
  category: string | null;
  supplier: string;
  price_list_id: number;
  has_container_offer: boolean;
};

type Tier = {
  min_qty: number;
  label: string;
  unit_price: number;
};

type ProductDetail = Product & {
  tiers: Tier[];
  container_qty: number | null;
  container_price: number | null;
  container_notes: string | null;
};

type QuoteLine = {
  sku: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  price_rule: string;
};

type QuoteResponse = {
  quote_id: string;
  folio: string;
  date: string;
  city: string;
  vendor_name: string | null;
  customer_name: string | null;
  lines: QuoteLine[];
  totals: {
    subtotal: number;
    iva: number;
    total: number;
  };
  download_xlsx_url: string;
  download_pdf_url: string;
};

type LineItem = {
  sku: string;
  detail: ProductDetail;
  quantity: number;
  mode: "MAYOREO" | "CONTENEDOR_POR_CONTENEDOR";
};

function money(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(value);
}

function num(value: number, digits = 2) {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: digits }).format(value);
}

function chooseTier(tiers: Tier[], qty: number) {
  const sorted = [...tiers].sort((left, right) => left.min_qty - right.min_qty);
  const eligible = sorted.filter((item) => item.min_qty <= qty);
  return eligible.length ? eligible[eligible.length - 1] : sorted[0] || null;
}

function previewLine(item: LineItem) {
  if (item.mode === "MAYOREO") {
    const tier = chooseTier(item.detail.tiers || [], item.quantity);
    if (!tier) return null;
    const lineTotal = tier.unit_price * item.quantity;
    return {
      unit: item.detail.unit,
      unitPrice: tier.unit_price,
      lineTotal,
      rule: `Tier ${tier.label} (min ${tier.min_qty})`,
      extra: null as string | null,
    };
  }

  const containerPrice = item.detail.container_price || 0;
  const unitsPerContainer = item.detail.container_qty || 0;
  return {
    unit: "CONT",
    unitPrice: containerPrice,
    lineTotal: containerPrice * item.quantity,
    rule: "Precio por contenedor",
    extra: unitsPerContainer ? `${item.quantity * unitsPerContainer} pzas informativas` : null,
  };
}

function badgeMode(product: Product) {
  return product.has_container_offer ? "Contenedor" : "Mayoreo";
}

export default function CatalogQuotePage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingSku, setLoadingSku] = useState<string | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [serie, setSerie] = useState("A");
  const [city, setCity] = useState("Morelia");
  const [vendorName, setVendorName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [ivaMode, setIvaMode] = useState<"included" | "excluded">("included");
  const [ivaRate, setIvaRate] = useState(0.16);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);

  useEffect(() => {
    apiFetch<Vendor[]>("/tools/era/ventas/catalog-quote/vendors")
      .then((data) => {
        setVendors(data);
        const savedVendor = typeof window !== "undefined" ? window.localStorage.getItem("catalog_quote_vendor") : null;
        if (savedVendor) setVendorName(savedVendor);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const data = await apiFetch<Product[]>(`/tools/era/ventas/catalog-quote/products?q=${encodeURIComponent(search)}`);
        setResults(data);
      } catch (err: any) {
        setError(err.message || "No se pudo buscar en el catálogo.");
      } finally {
        setLoadingSearch(false);
      }
    }, 220);

    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("catalog_quote_vendor", vendorName || "");
    }
  }, [vendorName]);

  useEffect(() => {
    setQuote(null);
  }, [city, customerName, items, ivaMode, ivaRate, serie, vendorName]);

  const previews = useMemo(() => items.map((item) => ({ sku: item.sku, preview: previewLine(item) })), [items]);
  const estimatedSubtotal = previews.reduce((sum, item) => sum + (item.preview?.lineTotal || 0), 0);
  const estimatedBase = ivaMode === "included" ? estimatedSubtotal / (1 + ivaRate) : estimatedSubtotal;
  const estimatedIva = ivaMode === "included" ? estimatedSubtotal - estimatedBase : estimatedSubtotal * ivaRate;
  const estimatedTotal = ivaMode === "included" ? estimatedSubtotal : estimatedSubtotal + estimatedIva;

  async function addProduct(sku: string) {
    setLoadingSku(sku);
    setError(null);
    try {
      const detail = await apiFetch<ProductDetail>(`/tools/era/ventas/catalog-quote/products/${encodeURIComponent(sku)}`);
      setItems((current) => {
        const existing = current.find((item) => item.sku === detail.sku);
        if (existing) {
          return current.map((item) => item.sku === detail.sku ? { ...item, quantity: item.quantity + 1 } : item);
        }
        return [
          {
            sku: detail.sku,
            detail,
            quantity: 1,
            mode: detail.has_container_offer ? "CONTENEDOR_POR_CONTENEDOR" : "MAYOREO",
          },
          ...current,
        ];
      });
    } catch (err: any) {
      setError(err.message || "No se pudo agregar el producto.");
    } finally {
      setLoadingSku(null);
    }
  }

  function updateQty(sku: string, raw: string) {
    const qty = Math.max(1, Number(raw) || 1);
    setItems((current) => current.map((item) => item.sku === sku ? { ...item, quantity: qty } : item));
  }

  function removeItem(sku: string) {
    setItems((current) => current.filter((item) => item.sku !== sku));
  }

  async function generateQuote() {
    if (!items.length) {
      setError("Agrega al menos una partida.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const data = await apiFetch<QuoteResponse>("/tools/era/ventas/catalog-quote/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serie,
          city,
          vendor_name: vendorName || null,
          customer_name: customerName || null,
          iva_mode: ivaMode,
          iva_rate: ivaRate,
          items: items.map((item) => ({
            sku: item.sku,
            quantity: item.quantity,
            mode: item.mode,
          })),
        }),
      });
      setQuote(data);
    } catch (err: any) {
      setError(err.message || "No se pudo generar la cotización.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <p className="text-muted mb-4">
        <Link href="/apps">&larr; Aplicaciones</Link>
      </p>

      <section className="card cat-hero mb-4">
        <div className="cat-kicker">ERA Ventas</div>
        <h1>Cotizador de catálogo</h1>
        <p>
          Busca productos, arma la cotización por mayoreo o contenedor y genera la salida final en Excel y PDF sin salir del portal.
        </p>
        <div className="cat-hero-grid">
          <div className="cat-hero-card">
            <strong>Búsqueda rápida</strong>
            <span>SKU, descripción, proveedor y modo de venta.</span>
          </div>
          <div className="cat-hero-card">
            <strong>Preview vivo</strong>
            <span>Partidas y totales estimados antes de generar.</span>
          </div>
          <div className="cat-hero-card">
            <strong>Salida lista</strong>
            <span>Descarga inmediata en Excel y PDF.</span>
          </div>
        </div>
      </section>

      {error ? <div className="error-msg">{error}</div> : null}

      <div className="cat-layout">
        <aside className="cat-sidebar">
          <div className="card">
            <div className="cat-panel-title">Datos de la cotización</div>
            <div className="form-grid mt-4">
              <div className="form-group">
                <label>Serie</label>
                <input value={serie} maxLength={4} onChange={(event) => setSerie(event.target.value.toUpperCase())} />
              </div>
              <div className="form-group">
                <label>Ciudad</label>
                <input value={city} onChange={(event) => setCity(event.target.value)} />
              </div>
              <div className="form-group">
                <label>Vendedor</label>
                <select value={vendorName} onChange={(event) => setVendorName(event.target.value)}>
                  <option value="">Sin seleccionar</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.name}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Cliente</label>
                <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nombre del cliente" />
              </div>
              <div className="form-group">
                <label>Modo IVA</label>
                <select value={ivaMode} onChange={(event) => setIvaMode(event.target.value as "included" | "excluded")}>
                  <option value="included">Incluido en precios</option>
                  <option value="excluded">Agregar IVA</option>
                </select>
              </div>
              <div className="form-group">
                <label>Tasa IVA</label>
                <input type="number" min={0} max={1} step={0.01} value={ivaRate} onChange={(event) => setIvaRate(Number(event.target.value) || 0)} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="cat-panel-title">Totales estimados</div>
            <div className="cat-estimate-grid mt-4">
              <div className="cat-estimate">
                <span className="cat-mini-label">Partidas</span>
                <strong>{items.length}</strong>
              </div>
              <div className="cat-estimate">
                <span className="cat-mini-label">Subtotal</span>
                <strong>{money(estimatedBase)}</strong>
              </div>
              <div className="cat-estimate">
                <span className="cat-mini-label">IVA</span>
                <strong>{money(estimatedIva)}</strong>
              </div>
              <div className="cat-estimate">
                <span className="cat-mini-label">Total</span>
                <strong>{money(estimatedTotal)}</strong>
              </div>
            </div>
            <div className="gi-helper mt-4">
              Este preview usa la regla vigente del catálogo. La salida final mantiene el mismo criterio.
            </div>
            <button className="btn btn-primary mt-4" type="button" disabled={submitting || !items.length} onClick={generateQuote}>
              {submitting ? "Generando..." : "Generar cotización"}
            </button>
          </div>
        </aside>

        <section className="stack-lg">
          <div className="card">
            <div className="flex-between" style={{ gap: 16, flexWrap: "wrap" }}>
              <div>
                <div className="cat-panel-title">Catálogo</div>
                <div className="gi-helper">Busca por SKU o descripción y agrega productos a la cotización.</div>
              </div>
              <span className="badge badge-interactive">{loadingSearch ? "Buscando" : `${results.length} resultados`}</span>
            </div>
            <div className="form-group mt-4" style={{ marginBottom: 0 }}>
              <label>Búsqueda</label>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ej. GR-10-100 o calentador solar" />
            </div>
            <div className="cat-search-results">
              {results.map((product) => (
                <div key={`${product.price_list_id}-${product.sku}`} className="cat-product">
                  <div className="cat-product-top">
                    <div>
                      <strong>{product.sku}</strong>
                      <div className="cat-product-sub">{product.description}</div>
                    </div>
                    <button className="btn btn-outline btn-sm" type="button" disabled={loadingSku === product.sku} onClick={() => addProduct(product.sku)}>
                      {loadingSku === product.sku ? "Agregando..." : "Agregar"}
                    </button>
                  </div>
                  <div className="cat-product-meta">
                    <span className="badge badge-batch">{product.supplier}</span>
                    <span className="badge badge-interactive">{badgeMode(product)}</span>
                    <span className="text-muted">{product.category || "Sin categoría"}</span>
                  </div>
                </div>
              ))}
              {!results.length && !loadingSearch ? <div className="text-muted">Sin resultados por ahora.</div> : null}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="cat-table-head">
              <div>
                <div className="cat-panel-title">Partidas</div>
                <div className="gi-helper">El modo se toma del catálogo: mayoreo o contenedor.</div>
              </div>
            </div>
            <div className="cat-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th>Modo</th>
                    <th>Cantidad</th>
                    <th>Preview</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const preview = previewLine(item);
                    return (
                      <tr key={item.sku}>
                        <td>{item.sku}</td>
                        <td>
                          <strong>{item.detail.description}</strong>
                          <div className="cat-row-meta">{item.detail.supplier}</div>
                        </td>
                        <td>
                          <span className="badge badge-interactive">{item.mode === "MAYOREO" ? "Mayoreo" : "Contenedor"}</span>
                        </td>
                        <td>
                          <input className="cat-qty" type="number" min={1} value={item.quantity} onChange={(event) => updateQty(item.sku, event.target.value)} />
                        </td>
                        <td>
                          {preview ? (
                            <div className="cat-preview">
                              <strong>{money(preview.unitPrice)}</strong>
                              <span>{preview.rule}</span>
                              <span>{money(preview.lineTotal)} total</span>
                              {preview.extra ? <span>{preview.extra}</span> : null}
                            </div>
                          ) : (
                            <span className="text-muted">Sin preview</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn btn-danger btn-sm" type="button" onClick={() => removeItem(item.sku)}>
                            Quitar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!items.length ? (
                    <tr>
                      <td colSpan={6} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                        Agrega productos desde la búsqueda para empezar.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {quote ? (
            <div className="card">
              <div className="flex-between" style={{ gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div className="cat-panel-title">Cotización generada</div>
                  <div className="gi-helper">
                    Folio {quote.folio} · {new Date(`${quote.date}T12:00:00`).toLocaleDateString("es-MX")}
                  </div>
                </div>
                <div className="button-row">
                  <button className="btn btn-outline" type="button" onClick={() => apiDownload(quote.download_pdf_url, `${quote.folio}.pdf`)}>
                    Descargar PDF
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => apiDownload(quote.download_xlsx_url, `${quote.folio}.xlsx`)}>
                    Descargar Excel
                  </button>
                </div>
              </div>

              <div className="cat-result-grid mt-4">
                <div className="cat-estimate">
                  <span className="cat-mini-label">Subtotal</span>
                  <strong>{money(quote.totals.subtotal)}</strong>
                </div>
                <div className="cat-estimate">
                  <span className="cat-mini-label">IVA</span>
                  <strong>{money(quote.totals.iva)}</strong>
                </div>
                <div className="cat-estimate">
                  <span className="cat-mini-label">Total</span>
                  <strong>{money(quote.totals.total)}</strong>
                </div>
              </div>

              <div className="cat-result-lines mt-4">
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Unidad</th>
                      <th>Cantidad</th>
                      <th>P.U.</th>
                      <th>Importe</th>
                      <th>Regla</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.lines.map((line) => (
                      <tr key={`${quote.quote_id}-${line.sku}-${line.quantity}`}>
                        <td>{line.sku}</td>
                        <td>{line.unit}</td>
                        <td>{line.quantity}</td>
                        <td>{money(line.unit_price)}</td>
                        <td>{money(line.line_total)}</td>
                        <td>{line.price_rule}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
