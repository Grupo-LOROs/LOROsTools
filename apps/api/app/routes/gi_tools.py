from __future__ import annotations

import json
import re
import shutil
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.db.models import AppDefinition, User
from app.db.session import get_db
from app.deps import ensure_app_access, require_user

try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None


router = APIRouter(prefix="/tools/gi", tags=["tools-gi"])

GI_APP_KEY = "gi_cotizador_era_gi"

_MONEY_RE = re.compile(r"([\d,]+\.\d{2})")


@dataclass
class ReceiptCFE:
    file: str
    service_number: str | None = None
    account: str | None = None
    tariff: str | None = None
    period_raw: str | None = None
    kwh_total: int | None = None
    billing_period: float | None = None
    dap: float | None = None
    total_to_pay: float | None = None
    base_amount_recommended: float | None = None
    confidence: str = "low"
    warnings: list[str] = field(default_factory=list)


@dataclass
class SystemInputs:
    reduction_pct: float = 65.0
    conservative_adj_pct: float = 10.0
    system_cost: float = 0.0
    down_payment_pct: float = 10.0
    months_installation: int = 0


@dataclass
class CreditInputs:
    annual_rate_pct: float = 18.0
    term_months: int = 60
    opening_fee_pct: float = 0.0
    vat_on_fee_pct: float = 16.0
    vat_on_interest: bool = True
    vat_interest_pct: float = 16.0


@dataclass
class QuoteResult:
    avg_cfe_amount: float
    conservative_savings: float
    financed_amount: float
    monthly_payment: float
    ica: float
    margin: float
    status: str


@dataclass
class Recommendation:
    title: str
    changes: dict[str, Any]
    status: str
    ica: float
    monthly_payment: float


def _to_float(maybe: str | None) -> float | None:
    if maybe is None:
        return None
    try:
        return float(maybe.replace(",", ""))
    except Exception:
        return None


def _to_int(maybe: str | None) -> int | None:
    if maybe is None:
        return None
    try:
        return int(maybe.replace(",", ""))
    except Exception:
        return None


def _extract_pdf_text(path: Path) -> str:
    if fitz is None:
        raise RuntimeError(
            "PyMuPDF no está instalado en la API. Agrega la dependencia `PyMuPDF` al contenedor."
        )
    doc = fitz.open(str(path))
    try:
        pages = [page.get_text("text") for page in doc]
    finally:
        doc.close()
    return "\n".join(pages).replace("\xa0", " ")


def _parse_cfe_pdf(path: Path) -> ReceiptCFE:
    text = _extract_pdf_text(path)
    receipt = ReceiptCFE(file=path.name)

    m = re.search(r"NO\.\s*DE\s*SERVICIO[:\s]+(\d+)", text, re.IGNORECASE)
    receipt.service_number = m.group(1) if m else None

    m = re.search(r"CUENTA[:\s]+([A-Z0-9]+)", text, re.IGNORECASE)
    receipt.account = m.group(1) if m else None

    m = re.search(r"TARIFA[:\s]+([A-Z0-9]+)", text, re.IGNORECASE)
    receipt.tariff = m.group(1) if m else None

    m = re.search(
        r"PERIODO\s*FACTURADO[:\s]+(\d{2}\s+[A-Z]{3}\s+\d{2}\s*-\s*\d{2}\s+[A-Z]{3}\s+\d{2})",
        text,
        re.IGNORECASE,
    )
    receipt.period_raw = m.group(1) if m else None

    m = re.search(
        r"kWh\s*base\s*[\r\n]+([\d,]+)\s*[\r\n]+kWh\s*intermedia\s*[\r\n]+([\d,]+)\s*[\r\n]+kWh\s*punta\s*[\r\n]+([\d,]+)",
        text,
        re.IGNORECASE,
    )
    if m:
        base = _to_int(m.group(1)) or 0
        inter = _to_int(m.group(2)) or 0
        punta = _to_int(m.group(3)) or 0
        receipt.kwh_total = base + inter + punta
    else:
        receipt.warnings.append("Falta desglose kWh (base/intermedia/punta)")

    m = re.search(r"Facturaci[oó]n\s+del\s+Periodo\s*[\r\n]+([\d,]+\.\d{2})", text, re.IGNORECASE)
    receipt.billing_period = _to_float(m.group(1)) if m else None
    if receipt.billing_period is None:
        receipt.warnings.append("Falta facturación del período")

    m = re.search(
        r"Derecho\s+de\s+Alumbrado\s+P[uú]blico.*?[\r\n]+([\d,]+\.\d{2})",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    receipt.dap = _to_float(m.group(1)) if m else None

    total_amt: float | None = None
    if m0 := re.search(r"Facturaci[oó]n\s+del\s+Periodo", text, re.IGNORECASE):
        window = text[m0.start() : m0.start() + 1800]
    else:
        window = text

    candidates: list[float] = []
    for mt in re.finditer(r"\bTotal\b\s*[\r\n]+([\d,]+\.\d{2})", window, re.IGNORECASE):
        value = _to_float(mt.group(1))
        if value is not None:
            candidates.append(value)
    if candidates:
        total_amt = candidates[-1]
    receipt.total_to_pay = total_amt

    if receipt.billing_period is None and receipt.total_to_pay is None:
        monies = [_to_float(m.group(1)) for m in _MONEY_RE.finditer(text)]
        monies = [v for v in monies if v is not None]
        if monies:
            receipt.total_to_pay = monies[-1]

    if receipt.billing_period is not None:
        receipt.base_amount_recommended = receipt.billing_period + (receipt.dap or 0.0)
    elif receipt.total_to_pay is not None:
        receipt.base_amount_recommended = receipt.total_to_pay

    critical_missing = 0
    if receipt.period_raw is None:
        receipt.warnings.append("Falta período facturado")
        critical_missing += 1
    if receipt.kwh_total is None:
        critical_missing += 1
    if receipt.base_amount_recommended is None:
        receipt.warnings.append("No se pudo calcular base recomendada")
        critical_missing += 1

    if critical_missing == 0:
        receipt.confidence = "high"
    elif critical_missing == 1:
        receipt.confidence = "medium"
    else:
        receipt.confidence = "low"

    return receipt


def _pmt(rate: float, nper: int, pv: float) -> float:
    if nper <= 0:
        return 0.0
    if abs(rate) < 1e-12:
        return pv / nper
    return (rate * pv) / (1 - (1 + rate) ** (-nper))


def _amortization_schedule(
    pv: float,
    annual_rate_pct: float,
    term_months: int,
    vat_on_interest: bool,
    vat_interest_pct: float,
) -> list[dict[str, float]]:
    monthly_rate = (annual_rate_pct / 100.0) / 12.0
    vat_rate = (vat_interest_pct / 100.0) if vat_on_interest else 0.0
    effective_rate = monthly_rate * (1 + vat_rate)
    payment = _pmt(effective_rate, term_months, pv)

    balance = pv
    rows: list[dict[str, float]] = []
    for month in range(1, term_months + 1):
        interest = balance * monthly_rate
        vat_interest = interest * vat_rate
        principal = payment - interest - vat_interest
        next_balance = balance - principal

        rows.append(
            {
                "month": month,
                "balance_start": round(balance, 2),
                "payment": round(payment, 2),
                "interest": round(interest, 2),
                "vat_interest": round(vat_interest, 2),
                "principal": round(principal, 2),
                "balance_end": round(next_balance, 2),
            }
        )

        balance = next_balance
        if balance < 0 and abs(balance) < 0.05:
            balance = 0.0

    return rows


def _compute_quote(avg_cfe_amount: float, system: SystemInputs, credit: CreditInputs) -> QuoteResult:
    reduction = system.reduction_pct / 100.0
    conservative_adj = system.conservative_adj_pct / 100.0

    amount_post_system = avg_cfe_amount * (1 - reduction)
    gross_savings = avg_cfe_amount - amount_post_system
    conservative_savings = gross_savings * (1 - conservative_adj)

    financed_amount = system.system_cost * (1 - system.down_payment_pct / 100.0)
    monthly_rate = (credit.annual_rate_pct / 100.0) / 12.0
    vat_rate = (credit.vat_interest_pct / 100.0) if credit.vat_on_interest else 0.0
    effective_rate = monthly_rate * (1 + vat_rate)
    monthly_payment = _pmt(effective_rate, credit.term_months, financed_amount)

    ica = (conservative_savings / monthly_payment) if monthly_payment > 0 else 0.0
    margin = conservative_savings - monthly_payment

    if ica >= 1.1:
        status = "AUTORIZABLE"
    elif ica >= 1.0:
        status = "AJUSTAR"
    else:
        status = "NO AUTORIZABLE"

    return QuoteResult(
        avg_cfe_amount=avg_cfe_amount,
        conservative_savings=conservative_savings,
        financed_amount=financed_amount,
        monthly_payment=monthly_payment,
        ica=ica,
        margin=margin,
        status=status,
    )


def _recommend_adjustments(
    avg_cfe_amount: float, system: SystemInputs, credit: CreditInputs, max_recs: int = 6
) -> list[Recommendation]:
    base_quote = _compute_quote(avg_cfe_amount, system, credit)
    recs: list[Recommendation] = []

    def add_recommendation(
        title: str,
        changes: dict[str, Any],
        system_alt: SystemInputs,
        credit_alt: CreditInputs,
    ) -> None:
        q = _compute_quote(avg_cfe_amount, system_alt, credit_alt)
        if q.ica <= base_quote.ica + 0.01 and q.status == base_quote.status:
            return
        recs.append(
            Recommendation(
                title=title,
                changes=changes,
                status=q.status,
                ica=q.ica,
                monthly_payment=q.monthly_payment,
            )
        )

    for term in [credit.term_months + d for d in (12, 24, 36) if credit.term_months + d <= 96]:
        credit_alt = CreditInputs(**{**asdict(credit), "term_months": term})
        add_recommendation(
            f"Aumentar plazo a {term} meses",
            {"credit.term_months": term},
            system,
            credit_alt,
        )

    for down_payment in [system.down_payment_pct + d for d in (5, 10, 15) if system.down_payment_pct + d <= 40]:
        system_alt = SystemInputs(**{**asdict(system), "down_payment_pct": down_payment})
        add_recommendation(
            f"Aumentar enganche a {down_payment:.0f}%",
            {"system.down_payment_pct": down_payment},
            system_alt,
            credit,
        )

    for rate in [credit.annual_rate_pct - d for d in (2, 4, 6) if credit.annual_rate_pct - d >= 8]:
        credit_alt = CreditInputs(**{**asdict(credit), "annual_rate_pct": rate})
        add_recommendation(
            f"Reducir tasa a {rate:.1f}% anual",
            {"credit.annual_rate_pct": rate},
            system,
            credit_alt,
        )

    if system.conservative_adj_pct > 5:
        for conservative_adj in [max(0.0, system.conservative_adj_pct - d) for d in (2.5, 5.0)]:
            system_alt = SystemInputs(**{**asdict(system), "conservative_adj_pct": conservative_adj})
            add_recommendation(
                f"Reducir ajuste conservador a {conservative_adj:.1f}%",
                {"system.conservative_adj_pct": conservative_adj},
                system_alt,
                credit,
            )

    order = {"AUTORIZABLE": 0, "AJUSTAR": 1, "NO AUTORIZABLE": 2}
    recs.sort(key=lambda x: (order.get(x.status, 9), -x.ica, x.monthly_payment))
    return recs[:max_recs]


def _parse_dict_json(raw: str | None, field_name: str) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} inválido: {exc}") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail=f"{field_name} debe ser un objeto JSON")
    return data


def _parse_inputs(system_json: str | None, credit_json: str | None) -> tuple[SystemInputs, CreditInputs]:
    system_payload = _parse_dict_json(system_json, "system_json")
    credit_payload = _parse_dict_json(credit_json, "credit_json")

    try:
        system = SystemInputs(**system_payload)
    except TypeError as exc:
        raise HTTPException(status_code=400, detail=f"Parámetros de sistema inválidos: {exc}") from exc

    try:
        credit = CreditInputs(**credit_payload)
    except TypeError as exc:
        raise HTTPException(status_code=400, detail=f"Parámetros de crédito inválidos: {exc}") from exc

    return system, credit


def _parse_uploaded_files(files: list[UploadFile]) -> list[ReceiptCFE]:
    if not files:
        raise HTTPException(status_code=400, detail="Debes subir al menos un PDF.")

    with tempfile.TemporaryDirectory(prefix="gi-cotizador-") as temp_dir:
        temp_root = Path(temp_dir)
        paths: list[Path] = []

        for idx, uploaded in enumerate(files):
            filename = Path(uploaded.filename or f"input_{idx}.pdf").name
            if Path(filename).suffix.lower() != ".pdf":
                raise HTTPException(
                    status_code=400,
                    detail=f"Archivo inválido ({filename}). Solo se aceptan PDFs.",
                )
            target = temp_root / f"{idx:03d}-{filename}"
            with target.open("wb") as out:
                shutil.copyfileobj(uploaded.file, out)
            paths.append(target)

        return [_parse_cfe_pdf(path) for path in paths]


def _average_cfe(receipts: list[ReceiptCFE]) -> float:
    values = [float(r.base_amount_recommended) for r in receipts if r.base_amount_recommended is not None]
    if not values:
        raise HTTPException(
            status_code=400,
            detail="No se pudo calcular el promedio CFE con los PDFs recibidos.",
        )
    return sum(values) / len(values)


@router.post("/quote")
async def compute_gi_quote(
    files: list[UploadFile] = File(...),
    system_json: str | None = Form(default=None),
    credit_json: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    app = db.get(AppDefinition, GI_APP_KEY)
    if not app or not app.enabled:
        raise HTTPException(status_code=404, detail="App GI no disponible.")

    ensure_app_access(user, GI_APP_KEY, db)

    receipts = _parse_uploaded_files(files)
    avg_cfe = _average_cfe(receipts)
    system, credit = _parse_inputs(system_json, credit_json)

    quote = _compute_quote(avg_cfe, system, credit)
    recommendations = _recommend_adjustments(avg_cfe, system, credit)
    amortization = _amortization_schedule(
        pv=quote.financed_amount,
        annual_rate_pct=credit.annual_rate_pct,
        term_months=credit.term_months,
        vat_on_interest=credit.vat_on_interest,
        vat_interest_pct=credit.vat_interest_pct,
    )

    return {
        "receipts": [asdict(r) for r in receipts],
        "quote": asdict(quote),
        "recommendations": [asdict(r) for r in recommendations],
        "amortization": amortization,
        "inputs": {
            "system": asdict(system),
            "credit": asdict(credit),
        },
    }
