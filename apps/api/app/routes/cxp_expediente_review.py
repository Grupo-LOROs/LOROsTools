from __future__ import annotations

import re
import tempfile
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.db.models import AppDefinition, User
from app.db.session import get_db
from app.deps import ensure_app_access, require_user

try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None


router = APIRouter(prefix="/tools/cuentas-por-pagar/expedientes", tags=["tools-cxp-expedientes"])

APP_KEY = "cuentas_por_pagar_revision_expedientes"
UUID_RX = re.compile(r"[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}", re.IGNORECASE)
RFC_RX = re.compile(r"\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b", re.IGNORECASE)

DOCUMENT_LABELS = {
    "purchase_order": "Pedido / orden de compra",
    "invoice": "Factura / CFDI",
    "sat_verification": "Validación SAT",
    "warehouse_entry": "Entrada de almacén",
    "support": "Soporte / materialidad",
    "other": "Otro",
}

KNOWN_COMPANIES = (
    {
        "alias": "DEESA",
        "rfc": "DDE110316K28",
        "names": (
            "DESARROLLADORA DE ENTORNOS ECOLOGICOS",
            "DESARROLLADORA DE ENTORNOS ECOLÓGICOS",
        ),
        "keywords": ("DEESA", "DESA"),
    },
    {
        "alias": "CEMICH",
        "rfc": "CEM180706Q96",
        "names": (
            "CARRETERAS Y EDIFICACIONES DE MICHOACAN",
            "CARRETERAS Y EDIFICACIONES DE MICHOACÁN",
        ),
        "keywords": ("CEMICH",),
    },
    {
        "alias": "LOROS",
        "rfc": None,
        "names": (
            "CONSTRUCCIONES LOROS SA DE CV",
            "CONSTRUCCIONES LOROS S.A. DE C.V.",
            "CORPORATIVO GRUPO LOROS",
            "GRUPO LOROS",
        ),
        "keywords": ("LOROS", "GRUPO LOROS"),
    },
)

SERVICE_KEYWORDS = (
    "HONORARIOS",
    "SERVICIO",
    "SERVICIOS",
    "CONSULTORIA",
    "CONSULTORÍA",
    "CAPACITACION",
    "CAPACITACIÓN",
    "SUBCONTRATO",
    "CÁLCULO",
    "CALCULO",
    "JURIDICO",
    "JURÍDICO",
)


@dataclass
class ReviewPage:
    page_number: int
    document_type: str
    document_label: str
    ocr_used: bool
    excerpt: str
    raw_text: str


@dataclass
class ReviewCheck:
    key: str
    label: str
    status: str
    message: str


@dataclass
class QuickField:
    key: str
    label: str
    value: str


@dataclass
class ExpedienteReview:
    id: str
    source_file: str
    status: str
    page_count: int
    ocr_pages: int
    company_alias: str | None
    supplier_name: str | None
    supplier_rfc: str | None
    receiver_name: str | None
    receiver_rfc: str | None
    order_number: str | None
    requisition_number: str | None
    invoice_uuid: str | None
    invoice_reference: str | None
    invoice_total: float | None
    sat_status: str | None
    cancellation_status: str | None
    checks: list[ReviewCheck] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    quick_fields: list[QuickField] = field(default_factory=list)
    pages: list[ReviewPage] = field(default_factory=list)
    sections: dict[str, dict[str, Any]] = field(default_factory=dict)
    raw_text: str = ""


def _normalize(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", ascii_only).strip().upper()


def _normalize_spaces(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(str(value).replace("\xa0", " ").split()).strip()
    return cleaned or None


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", _normalize(value).lower()).strip("-")
    return slug or "expediente"


def _parse_money(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return round(float(value.replace("$", "").replace(",", "").replace(" ", "")), 2)
    except Exception:
        return None


def _format_money(value: float | None) -> str:
    if value is None:
        return ""
    return f"${value:,.2f}"


def _extract_uuid(text: str) -> str | None:
    compact = re.sub(r"\s+", "", (text or "").upper())
    match = UUID_RX.search(compact)
    if not match:
        return None
    return match.group(0)


def _search_group(text: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if not match:
            continue
        for group in match.groups():
            cleaned = _normalize_spaces(group)
            if cleaned:
                return cleaned
    return None


def _search_money(text: str, patterns: list[str]) -> float | None:
    value = _search_group(text, patterns)
    return _parse_money(value)


def _last5(value: str | None, fallback: str = "") -> str:
    if not value:
        return fallback
    compact = re.sub(r"[^A-Z0-9]", "", value.upper())
    if not compact:
        return fallback
    return compact[-5:].rjust(5, "0")


def _excerpt(value: str, limit: int = 240) -> str:
    compact = " ".join((value or "").split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit].rstrip()}..."


def _unique_compact(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in values:
        cleaned = _normalize_spaces(item)
        if not cleaned:
            continue
        marker = cleaned.upper()
        if marker in seen:
            continue
        seen.add(marker)
        result.append(cleaned)
    return result


def _company_from_values(*values: str | None) -> tuple[str | None, str | None]:
    haystack = " ".join(value for value in values if value)
    normalized = _normalize(haystack)
    for company in KNOWN_COMPANIES:
        if company["rfc"] and company["rfc"] in normalized:
            return company["alias"], company["names"][0]
        if any(_normalize(name) in normalized for name in company["names"]):
            return company["alias"], company["names"][0]
        if any(_normalize(keyword) in normalized for keyword in company["keywords"]):
            return company["alias"], company["names"][0]
    return None, None


def _same_party(name_a: str | None, rfc_a: str | None, name_b: str | None, rfc_b: str | None) -> bool | None:
    if rfc_a and rfc_b:
        return _normalize(rfc_a) == _normalize(rfc_b)
    if name_a and name_b:
        left = _normalize(name_a)
        right = _normalize(name_b)
        if not left or not right:
            return None
        return left == right or left in right or right in left
    return None


def _classify_page(text: str) -> str:
    normalized = _normalize(text)
    if not normalized:
        return "other"
    if "VERIFICACION DE COMPROBANTES FISCALES DIGITALES POR INTERNET" in normalized or (
        "ESTADO CFDI" in normalized and "ESTATUS DE CANCELACION" in normalized
    ):
        return "sat_verification"
    if "NOTA DE ENTRADA DE ALMACEN" in normalized or (
        "NEODATA ERP" in normalized and "ALMACEN" in normalized
    ):
        return "warehouse_entry"
    if "PEDIDO / ORDEN DE COMPRA" in normalized or (
        "ORDEN DE COMPRA" in normalized and "AUTORIZADA" in normalized
    ) or (
        "AUTORIZADA" in normalized and "PEDIDO:" in normalized and "REQUISICION:" in normalized
    ):
        return "purchase_order"
    if any(
        marker in normalized
        for marker in (
            "FOLIO FISCAL",
            "COMPROBANTE FISCAL DIGITAL",
            "NOMBRE EMISOR",
            "RFC RECEPTOR",
            "USO CFDI",
            "METODO DE PAGO",
            "VERSION 4.0 ANEXO 20",
            "ESTE DOCUMENTO ES UNA REPRESENTACION IMPRESA DE UN CFDI",
        )
    ):
        return "invoice"
    if any(
        marker in normalized
        for marker in ("NOTA DE ENTREGA", "PAGARE", "ESQUEMA DE FIRMAS", "RECIBI MATERIAL", "MATERIALIDAD")
    ):
        return "support"
    return "other"


def _extract_page_text(page) -> tuple[str, bool]:
    plain_text = page.get_text("text").replace("\xa0", " ")
    compact_plain = re.sub(r"\s+", "", plain_text)
    if len(compact_plain) >= 120:
        return plain_text, False

    try:
        textpage = page.get_textpage_ocr(language="spa+eng", dpi=300, full=True)
        ocr_text = page.get_text("text", textpage=textpage).replace("\xa0", " ")
        if len(re.sub(r"\s+", "", ocr_text)) > len(compact_plain):
            return ocr_text, True
    except Exception:
        pass
    return plain_text, False


def _extract_pages(path: Path) -> list[ReviewPage]:
    if fitz is None:
        raise RuntimeError("PyMuPDF no está disponible en la API.")

    document = fitz.open(str(path))
    pages: list[ReviewPage] = []
    try:
        for index, page in enumerate(document, 1):
            text, ocr_used = _extract_page_text(page)
            document_type = _classify_page(text)
            pages.append(
                ReviewPage(
                    page_number=index,
                    document_type=document_type,
                    document_label=DOCUMENT_LABELS.get(document_type, "Otro"),
                    ocr_used=ocr_used,
                    excerpt=_excerpt(text),
                    raw_text=text,
                )
            )
    finally:
        document.close()
    return pages


def _join_pages(pages: list[ReviewPage], document_type: str) -> str:
    return "\n\n".join(page.raw_text for page in pages if page.document_type == document_type)


def _extract_order_snapshot(text: str) -> dict[str, Any]:
    order_number = _search_group(
        text,
        [
            r"Pedido:\s*(\d+)",
            r"Lugar de entrega:\s*(\d+)\s+\d{1,2}-[A-Za-z]{3}\.-\d{4}\s+\d+\s+Proveedor:",
        ],
    )
    requisition_number = _search_group(
        text,
        [
            r"Requisici[oó]n:\s*(\d+)",
            r"Lugar de entrega:\s*\d+\s+\d{1,2}-[A-Za-z]{3}\.-\d{4}\s+(\d+)\s+Proveedor:",
        ],
    )
    order_date = _search_group(
        text,
        [
            r"Fecha:\s*([0-9]{1,2}-[A-Za-z]{3}\.-[0-9]{4})",
            r"Lugar de entrega:\s*\d+\s+([0-9]{1,2}-[A-Za-z]{3}\.-[0-9]{4})\s+\d+\s+Proveedor:",
        ],
    )
    project_name = _search_group(text, [r"Datos bancarios\s+(.+?)\s+Proyecto:"])
    supplier_rfc = _search_group(text, [rf"Proveedor:\s*[A-Z0-9-]+\s+({RFC_RX.pattern})"])
    supplier_name = _search_group(
        text,
        [
            rf"Proveedor:\s*[A-Z0-9-]+\s+{RFC_RX.pattern}\s+(.+?)\s+(?:Tel[eé]fono:|Correo electr[oó]nico:|RFC:)",
        ],
    )
    total = _search_money(text, [r"\bTOTAL:\s*\$?\s*([0-9,]+\.\d{2})"])
    subtotal = _search_money(text, [r"SUBTOTAL:\s*\$?\s*([0-9,]+\.\d{2})"])
    iva = _search_money(text, [r"I\.V\.A:\s*(?:\d+(?:\.\d+)?\s*%)?\s*\$?\s*([0-9,]+\.\d{2})"])
    description = _search_group(
        text,
        [
            r"OBSERVACIONES:\s*(.+?)\s+SUBTOTAL:",
            r"TRANSFERENCIA\s+[A-ZÁÉÍÓÚÑ]+\s+(.+?)\s+SUBTOTAL",
        ],
    )
    payment_hint = _search_group(text, [r"\b(TRANSFERENCIA|CHEQUE|EFECTIVO|TARJETA)\b"])

    return {
        "order_number": order_number,
        "requisition_number": requisition_number,
        "order_date": order_date,
        "project_name": project_name,
        "supplier_name": supplier_name,
        "supplier_rfc": supplier_rfc,
        "payment_hint": payment_hint,
        "subtotal": subtotal,
        "iva": iva,
        "total": total,
        "description": description,
    }


def _extract_invoice_reference(text: str) -> tuple[str | None, str | None, str | None]:
    compact = " ".join(text.split())
    head = compact[:1200]
    patterns = (
        re.compile(r"FACTURA\s+FOLIO:\s*([A-Z]{1,8})\s+(\d{1,10})", re.IGNORECASE),
        re.compile(r"Folio(?! fiscal)\s+([A-Z]{1,8})\s*[-:]\s*(\d{1,10})", re.IGNORECASE),
        re.compile(r"FOLIO(?! FISCAL)\s+([A-Z]{1,8})\s*[‐-]\s*(\d{1,10})", re.IGNORECASE),
    )
    for pattern in patterns:
        match = pattern.search(head)
        if not match:
            continue
        series = _normalize_spaces(match.group(1))
        folio = _normalize_spaces(match.group(2))
        return series, folio, _normalize_spaces(f"{series}-{folio}")

    folio_only = _search_group(
        head,
        [
            r"\bNo\.?\s*(\d{1,10})\b",
            r"\bRECIBO\s+.*?\bNo\.?\s*(\d{1,10})\b",
        ],
    )
    if folio_only:
        return None, folio_only, folio_only
    return None, None, None


def _extract_sat_snapshot(text: str) -> dict[str, Any]:
    compact = " ".join(text.split())
    issuer_rfc = None
    issuer_name = None
    receiver_rfc = None
    receiver_name = None

    party_match = re.search(
        rf"RFC del emisor .*? RFC del receptor .*? receptor\s+({RFC_RX.pattern})\s+(.+?)\s+({RFC_RX.pattern})\s+(.+?)\s+Folio fiscal",
        compact,
        re.IGNORECASE,
    )
    if party_match:
        issuer_rfc = _normalize_spaces(party_match.group(1))
        issuer_name = _normalize_spaces(party_match.group(2))
        receiver_rfc = _normalize_spaces(party_match.group(3))
        receiver_name = _normalize_spaces(party_match.group(4))

    uuid = _extract_uuid(compact)
    dates = re.findall(r"20\d{2}-\d{2}-\s*\d{2}T\d{2}:\d{2}:\d{2}", compact)
    dates = [item.replace(" ", "") for item in dates]

    status = _search_group(
        compact,
        [r"Estado CFDI\s+([A-Za-zÁÉÍÓÚáéíóú ]+?)(?:\s+Estatus de cancelaci[oó]n|\s+https?://|$)"],
    )
    cancellation = _search_group(
        compact,
        [r"Estatus de cancelaci[oó]n\s+(.+?)(?:\s+https?://|$)"],
    )
    total = _search_money(compact, [r"Total del CFDI\s+\$?\s*([0-9,]+\.\d{2})"])

    inline_match = re.search(
        r"Total del CFDI(?:\s+Efecto del comprobante\s+Estado CFDI\s+Estatus de cancelaci[oó]n)?\s+\$?\s*([0-9,]+\.\d{2})\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(.+?)(?:\s+\d{1,2}/\d{1,2}/\d{2,4}|https?://|$)",
        compact,
        re.IGNORECASE,
    )

    if inline_match:
        total = total or _parse_money(inline_match.group(1))
        status = status or _normalize_spaces(inline_match.group(3))
        if not cancellation or cancellation.startswith("$"):
            cancellation = _normalize_spaces(inline_match.group(4))

    if not status:
        inline_match = re.search(
            r"Total del CFDI\s+\$?\s*[0-9,]+\.\d{2}\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(.+?)(?:\s+https?://|$)",
            compact,
            re.IGNORECASE,
        )
        if inline_match:
            status = _normalize_spaces(inline_match.group(1))
            if not cancellation:
                cancellation = _normalize_spaces(inline_match.group(2))

    return {
        "uuid": uuid,
        "issuer_rfc": issuer_rfc,
        "issuer_name": issuer_name,
        "receiver_rfc": receiver_rfc,
        "receiver_name": receiver_name,
        "issue_date": dates[0] if len(dates) >= 1 else None,
        "certification_date": dates[1] if len(dates) >= 2 else None,
        "status": status,
        "cancellation_status": cancellation,
        "total": total,
    }


def _extract_invoice_snapshot(text: str, sat_snapshot: dict[str, Any]) -> dict[str, Any]:
    compact = " ".join(text.split())
    series, folio, reference = _extract_invoice_reference(compact)

    issuer_name = _search_group(
        compact,
        [
            r"Nombre emisor:\s*(.+?)\s+RFC receptor:",
            rf"^\s*(.+?)\s+RFC:\s*({RFC_RX.pattern})",
            r"^\s*(.+?)\s+RECIBO",
        ],
    )
    issuer_rfc = _search_group(
        compact,
        [
            r"RFC emisor:\s*([A-Z0-9&Ñ]{12,13})",
            r"RFC:\s*([A-Z0-9&Ñ]{12,13})",
            r"R\.F\.C[,.]?\s*([A-Z0-9&Ñ]{12,13})",
        ],
    )
    receiver_name = _search_group(
        compact,
        [
            r"Nombre receptor:\s*(.+?)\s+C[oó]digo postal del receptor:",
            r"Datos del cliente Cliente:\s*(.+?)\s+R\.F\.C\.:",
            r"Datos Fiscales del Receptor:\s*Nombre:\s*(.+?)\s+Forma pago:",
        ],
    )
    receiver_rfc = _search_group(
        compact,
        [
            r"RFC receptor:\s*([A-Z0-9&Ñ]{12,13})",
            r"Datos Fiscales del Receptor:.*?R\.F\.C\.\s*([A-Z0-9&Ñ]{12,13})",
            r"R\.F\.C\.\s*([A-Z0-9&Ñ]{12,13})\s+Uso CFDI",
        ],
    )
    subtotal = _search_money(
        compact,
        [
            r"\bSubtotal[: ]+\$?\s*([0-9,]+\.\d{2})",
            r"\bSubtotal\s+\$?\s*([0-9,]+\.\d{2})",
        ],
    )
    total = _search_money(
        compact,
        [
            r"\bTOTAL[: ]+\$?\s*([0-9,]+\.\d{2})",
            r"\bTotal\s+\$?\s*([0-9,]+\.\d{2})",
        ],
    )
    iva = _search_money(
        compact,
        [
            r"Impuestos trasladados IVA(?:\s*\d+(?:\.\d+)?%)?\s*\$?\s*([0-9,]+\.\d{2})",
            r"Traslado I\.V\.A\.(?: Tasa [0-9.]+)?[: ]+\$?\s*([0-9,]+\.\d{2})",
            r"I\.V\.A\.:\s*\$?\s*([0-9,]+\.\d{2})",
        ],
    )
    retained_isr = _search_money(
        compact,
        [
            r"Impuestos retenidos ISR\s*\$?\s*([0-9,]+\.\d{2})",
            r"Retenci[oó]n I\.S\.R\.:\s*-?\$?\s*([0-9,]+\.\d{2})",
            r"Ret ISR:.*?Importe:\s*\$?\s*([0-9,]+\.\d{2})",
        ],
    )
    retained_iva = _search_money(
        compact,
        [
            r"Retenci[oó]n I\.V\.A\.:\s*-?\$?\s*([0-9,]+\.\d{2})",
            r"Ret IVA:.*?Importe:\s*\$?\s*([0-9,]+\.\d{2})",
        ],
    )
    use_cfdi = _search_group(
        compact,
        [r"Uso CFDI:\s*(.+?)(?:\s+No\. de serie|\s+Moneda:|\s+Forma de pago:|\s+M[ée]todo de pago:|$)"],
    )
    payment_form = _search_group(
        compact,
        [r"Forma de pago[: ]+(.+?)(?:\s+M[ée]todo de pago|\s+F A C T U R A|\s+Folio|\s+Moneda:|$)"],
    )
    payment_method = _search_group(
        compact,
        [r"M[ée]todo de pago[: ]+(.+?)(?:\s+Folio|\s+Subtotal|\s+Sello digital|$)"],
    )
    issuer_regime = _search_group(
        compact,
        [r"R[ée]gimen fiscal:\s*(.+?)(?:\s+Exportaci[oó]n|\s+Forma de pago:|\s+Uso CFDI:|$)"],
    )
    receiver_regime = _search_group(
        compact,
        [r"R[ée]gimen fiscal receptor:\s*(.+?)(?:\s+Uso CFDI:|\s+No\. de serie|$)"],
    )
    issue_date = _search_group(
        compact,
        [
            r"C[oó]digo postal, fecha y hora de emisi[oó]n:\s*\d+\s+([0-9:-]{19})",
            r"Fecha de Elaboraci[oó]n:\s*([0-9/]{8,10}\s+[0-9:]{4,8}(?:a\.?\s*m\.?|p\.?\s*m\.?)?)",
            r"Fecha\s+([0-9/]{8,10}\s+[0-9:]{4,8})\s+Moneda:",
        ],
    )
    concept_summary = _search_group(
        compact,
        [
            r"Descripci[oó]n:\s*(.+?)(?:\s+Objeto impuesto|\s+Impuesto traslado|\s+Moneda:|\s+Forma de pago:|$)",
            r"Unidad de servicio\s+(.+?)\s+[0-9]{1,3}(?:,[0-9]{3})*\.\d{2}",
            r"PIEZA SAT:\s*\d{8}\s*-\s*[A-Za-zÁÉÍÓÚáéíóúñÑ ]+\s+(.+?)\s+[0-9]+\.\d{2}",
        ],
    )
    product_keys = _unique_compact(
        re.findall(
            r"(?:SAT:\s*|Clave (?:Servicio/Producto|del producto y/o servicio)\s*)(\d{8})",
            compact,
            re.IGNORECASE,
        )
    )
    bank_name = _search_group(
        compact,
        [
            r"Banco:\s*(.+?)\s+Cuenta:",
            r"Realice su pago en:\s*(.+?)\s+Cantidad con Letra:",
        ],
    )
    bank_account = _search_group(compact, [r"Cuenta:\s*([0-9]{6,20})"])
    bank_clabe = _search_group(
        compact,
        [
            r"Clabe:\s*([0-9]{18})",
            r"CLABE:\s*([0-9]{18})",
        ],
    )

    return {
        "uuid": sat_snapshot.get("uuid") or _extract_uuid(compact),
        "series": series,
        "folio": folio,
        "reference": reference,
        "issuer_name": sat_snapshot.get("issuer_name") or issuer_name,
        "issuer_rfc": sat_snapshot.get("issuer_rfc") or issuer_rfc,
        "receiver_name": sat_snapshot.get("receiver_name") or receiver_name,
        "receiver_rfc": sat_snapshot.get("receiver_rfc") or receiver_rfc,
        "issue_date": sat_snapshot.get("issue_date") or issue_date,
        "certification_date": sat_snapshot.get("certification_date"),
        "subtotal": subtotal,
        "iva": iva,
        "retained_isr": retained_isr,
        "retained_iva": retained_iva,
        "total": total or sat_snapshot.get("total"),
        "use_cfdi": use_cfdi,
        "payment_form": payment_form,
        "payment_method": payment_method,
        "issuer_regime": issuer_regime,
        "receiver_regime": receiver_regime,
        "concept_summary": concept_summary,
        "product_keys": product_keys,
        "bank_name": bank_name,
        "bank_account": bank_account,
        "bank_clabe": bank_clabe,
    }


def _extract_warehouse_snapshot(text: str) -> dict[str, Any]:
    compact = " ".join(text.split())
    entry_number = _search_group(compact, [r"\bNEA\s+(\d+)\b", r"Folio:\s*(\d+)"])
    order_number = _search_group(compact, [r"N[úu]mero de pedido:\s*(\d+)"])
    requisition_number = _search_group(compact, [r"Requisici[oó]n:\s*(\d+)"])
    invoice_ref = _search_group(compact, [r"Factura:\s*([A-Z0-9-]+)"])
    total = _search_money(compact, [r"Total\s+\$?\s*([0-9,]+\.\d{2})", r"Importe\s+\$?\s*([0-9,]+\.\d{2})"])
    description = _search_group(
        compact,
        [r"Observaciones:\s*(.+?)\s+Tipo de documento:", r"Tipo de documento:\s*[A-Z]+\s+(.+?)\s+COMPRAS ALMACEN"],
    )

    return {
        "entry_number": entry_number,
        "order_number": order_number,
        "requisition_number": requisition_number,
        "invoice_ref": invoice_ref,
        "total": total,
        "description": description,
    }


def _extract_support_snapshot(text: str) -> dict[str, Any]:
    normalized = _normalize(text)
    detected = []
    for marker, label in (
        ("NOTA DE ENTREGA", "Nota de entrega"),
        ("PAGARE", "Pagaré"),
        ("ESQUEMA DE FIRMAS", "Esquema de firmas"),
        ("RECIBI MATERIAL", "Materialidad"),
    ):
        if marker in normalized:
            detected.append(label)
    return {
        "detected_documents": detected,
    }


def _is_service_like(order_snapshot: dict[str, Any], invoice_snapshot: dict[str, Any]) -> bool:
    texts = " ".join(
        filter(
            None,
            [
                order_snapshot.get("description"),
                order_snapshot.get("project_name"),
                invoice_snapshot.get("concept_summary"),
                " ".join(invoice_snapshot.get("product_keys") or []),
            ],
        )
    )
    normalized = _normalize(texts)
    if any(keyword in normalized for keyword in SERVICE_KEYWORDS):
        return True
    return any(str(code).startswith(("80", "81")) for code in (invoice_snapshot.get("product_keys") or []))


def _build_checks(
    pages: list[ReviewPage],
    order_snapshot: dict[str, Any],
    invoice_snapshot: dict[str, Any],
    sat_snapshot: dict[str, Any],
    warehouse_snapshot: dict[str, Any],
    company_alias: str | None,
) -> list[ReviewCheck]:
    checks: list[ReviewCheck] = []
    has_order = any(page.document_type == "purchase_order" for page in pages)
    has_invoice = any(page.document_type == "invoice" for page in pages)
    has_sat = any(page.document_type == "sat_verification" for page in pages)
    has_warehouse = any(page.document_type == "warehouse_entry" for page in pages)
    has_support = any(page.document_type == "support" for page in pages)

    missing = []
    if not has_order:
        missing.append("pedido")
    if not has_invoice:
        missing.append("factura")
    if not has_sat:
        missing.append("validación SAT")
    checks.append(
        ReviewCheck(
            key="required_documents",
            label="Documentos requeridos",
            status="error" if missing else "ok",
            message="Faltan: " + ", ".join(missing) if missing else "Se detectaron pedido, factura y validación SAT.",
        )
    )

    supplier_match = _same_party(
        order_snapshot.get("supplier_name"),
        order_snapshot.get("supplier_rfc"),
        invoice_snapshot.get("issuer_name"),
        invoice_snapshot.get("issuer_rfc"),
    )
    if supplier_match is False:
        supplier_status = "error"
        supplier_message = "El proveedor del pedido no coincide con el emisor detectado en factura/SAT."
    elif supplier_match is True:
        supplier_status = "ok"
        supplier_message = "Proveedor consistente entre pedido y factura."
    else:
        supplier_status = "warning"
        supplier_message = "No hubo datos suficientes para validar por completo el proveedor."
    checks.append(
        ReviewCheck(
            key="supplier_match",
            label="Proveedor",
            status=supplier_status,
            message=supplier_message,
        )
    )

    receiver_match = _same_party(
        invoice_snapshot.get("receiver_name"),
        invoice_snapshot.get("receiver_rfc"),
        sat_snapshot.get("receiver_name"),
        sat_snapshot.get("receiver_rfc"),
    )
    if receiver_match is False:
        receiver_status = "error"
        receiver_message = "El receptor de la factura no coincide con la validación SAT."
    elif receiver_match is True:
        receiver_status = "ok"
        receiver_message = "Receptor consistente entre factura y SAT."
    elif invoice_snapshot.get("receiver_name") or sat_snapshot.get("receiver_name"):
        receiver_status = "warning"
        receiver_message = "Se detectó el receptor, pero no fue posible validar todos los datos."
    else:
        receiver_status = "warning"
        receiver_message = "No se detectó claramente el receptor."
    checks.append(
        ReviewCheck(
            key="receiver_match",
            label="Empresa receptora",
            status=receiver_status if company_alias or receiver_status == "error" else "warning",
            message=receiver_message if company_alias else f"{receiver_message} No se reconoció alias interno automáticamente.",
        )
    )

    totals = [
        item
        for item in [
            ("pedido", order_snapshot.get("total")),
            ("factura", invoice_snapshot.get("total")),
            ("SAT", sat_snapshot.get("total")),
            ("almacén", warehouse_snapshot.get("total")),
        ]
        if item[1] is not None
    ]
    if len(totals) >= 2:
        values = [value for _, value in totals]
        total_status = "ok" if max(values) - min(values) <= 1 else "error"
        total_message = "Montos consistentes entre documentos." if total_status == "ok" else "Hay diferencia en los montos detectados."
    else:
        total_status = "warning"
        total_message = "No hubo suficientes montos para comparar."
    checks.append(
        ReviewCheck(
            key="amounts_match",
            label="Montos",
            status=total_status,
            message=total_message,
        )
    )

    if has_sat:
        sat_state = _normalize(sat_snapshot.get("status"))
        cancel_state = _normalize(sat_snapshot.get("cancellation_status"))
        if sat_state and "VIGENTE" not in sat_state:
            sat_status = "error"
            sat_message = f"Estado CFDI detectado: {sat_snapshot.get('status')}."
        elif cancel_state and "CANCELADO" in cancel_state:
            sat_status = "error"
            sat_message = f"Estatus de cancelación detectado: {sat_snapshot.get('cancellation_status')}."
        elif sat_snapshot.get("status"):
            sat_status = "ok"
            sat_message = f"CFDI {sat_snapshot.get('status')}."
        else:
            sat_status = "warning"
            sat_message = "Se detectó la página SAT, pero no se pudo leer el estatus completo."
    else:
        sat_status = "error"
        sat_message = "No se detectó la validación SAT."
    checks.append(
        ReviewCheck(
            key="sat_status",
            label="Estado SAT",
            status=sat_status,
            message=sat_message,
        )
    )

    if has_warehouse:
        same_order = _same_party(
            order_snapshot.get("order_number"),
            None,
            warehouse_snapshot.get("order_number"),
            None,
        )
        same_requisition = _same_party(
            order_snapshot.get("requisition_number"),
            None,
            warehouse_snapshot.get("requisition_number"),
            None,
        )
        if same_order is False or same_requisition is False:
            warehouse_status = "error"
            warehouse_message = "La entrada de almacén no coincide con pedido/requisición."
        else:
            warehouse_status = "ok"
            warehouse_message = "La entrada de almacén coincide con el pedido detectado."
    else:
        warehouse_status = "info" if _is_service_like(order_snapshot, invoice_snapshot) else "warning"
        warehouse_message = (
            "No se detectó entrada de almacén y parece un servicio/honorario."
            if warehouse_status == "info"
            else "No se detectó entrada de almacén."
        )
    checks.append(
        ReviewCheck(
            key="warehouse_match",
            label="Entrada de almacén",
            status=warehouse_status,
            message=warehouse_message,
        )
    )

    if has_support:
        support_status = "ok"
        support_message = "Se detectó al menos un documento adicional de soporte o materialidad."
    else:
        support_status = "warning"
        support_message = "No se detectó materialidad/soporte adicional de forma clara."
    checks.append(
        ReviewCheck(
            key="support_detected",
            label="Soporte adicional",
            status=support_status,
            message=support_message,
        )
    )

    ocr_pages = len([page for page in pages if page.ocr_used])
    checks.append(
        ReviewCheck(
            key="ocr_usage",
            label="Lectura OCR",
            status="info" if ocr_pages else "ok",
            message=(
                f"Se usó OCR en {ocr_pages} página(s); conviene revisar visualmente los campos críticos."
                if ocr_pages
                else "Todas las páginas principales tenían texto legible."
            ),
        )
    )

    return checks


def _overall_status(checks: list[ReviewCheck]) -> str:
    if any(item.status == "error" for item in checks):
        return "error"
    if any(item.status == "warning" for item in checks):
        return "warning"
    return "ok"


def _warnings_from_pages(pages: list[ReviewPage]) -> list[str]:
    warnings: list[str] = []
    ocr_pages = [page.page_number for page in pages if page.ocr_used]
    if ocr_pages:
        warnings.append(f"OCR aplicado en páginas: {', '.join(str(item) for item in ocr_pages)}.")
    other_pages = [page.page_number for page in pages if page.document_type == "other" and page.excerpt]
    if other_pages:
        warnings.append(f"Hay páginas sin clasificar claramente: {', '.join(str(item) for item in other_pages)}.")
    return warnings


def _quick_fields(
    company_alias: str | None,
    invoice_snapshot: dict[str, Any],
    order_snapshot: dict[str, Any],
    supplier_name: str | None,
    supplier_rfc: str | None,
) -> list[QuickField]:
    reference = invoice_snapshot.get("reference") or invoice_snapshot.get("folio")
    fields = [
        QuickField("company_alias", "Empresa", company_alias or invoice_snapshot.get("receiver_name") or ""),
        QuickField("supplier_name", "Proveedor", supplier_name or ""),
        QuickField("supplier_rfc", "RFC proveedor", supplier_rfc or ""),
        QuickField("order_number", "Pedido", order_snapshot.get("order_number") or ""),
        QuickField("requisition_number", "Requisición", order_snapshot.get("requisition_number") or ""),
        QuickField("invoice_uuid", "UUID", invoice_snapshot.get("uuid") or ""),
        QuickField("invoice_uuid_last5", "UUID últimos 5", _last5(invoice_snapshot.get("uuid"), "00000")),
        QuickField("invoice_reference", "Serie / folio", reference or ""),
        QuickField("invoice_reference_last5", "Serie / folio últimos 5", _last5(reference, "00000")),
        QuickField("invoice_total", "Total", _format_money(invoice_snapshot.get("total"))),
    ]
    return [item for item in fields if item.value]


def _analyze_pdf(path: Path) -> ExpedienteReview:
    pages = _extract_pages(path)
    purchase_text = _join_pages(pages, "purchase_order")
    invoice_text = _join_pages(pages, "invoice")
    sat_text = _join_pages(pages, "sat_verification")
    warehouse_text = _join_pages(pages, "warehouse_entry")
    support_text = _join_pages(pages, "support")
    full_text = "\n\n".join(page.raw_text for page in pages)

    sat_snapshot = _extract_sat_snapshot(sat_text)
    order_snapshot = _extract_order_snapshot(purchase_text)
    invoice_snapshot = _extract_invoice_snapshot(invoice_text, sat_snapshot)
    warehouse_snapshot = _extract_warehouse_snapshot(warehouse_text)
    support_snapshot = _extract_support_snapshot(support_text)

    supplier_name = invoice_snapshot.get("issuer_name") or order_snapshot.get("supplier_name")
    supplier_rfc = invoice_snapshot.get("issuer_rfc") or order_snapshot.get("supplier_rfc")
    receiver_name = invoice_snapshot.get("receiver_name")
    receiver_rfc = invoice_snapshot.get("receiver_rfc")
    company_alias, company_name = _company_from_values(receiver_name, receiver_rfc, purchase_text)

    checks = _build_checks(
        pages=pages,
        order_snapshot=order_snapshot,
        invoice_snapshot=invoice_snapshot,
        sat_snapshot=sat_snapshot,
        warehouse_snapshot=warehouse_snapshot,
        company_alias=company_alias,
    )

    warnings = _warnings_from_pages(pages)
    review = ExpedienteReview(
        id=_slugify(path.stem),
        source_file=path.name,
        status=_overall_status(checks),
        page_count=len(pages),
        ocr_pages=len([page for page in pages if page.ocr_used]),
        company_alias=company_alias,
        supplier_name=supplier_name,
        supplier_rfc=supplier_rfc,
        receiver_name=receiver_name,
        receiver_rfc=receiver_rfc,
        order_number=order_snapshot.get("order_number"),
        requisition_number=order_snapshot.get("requisition_number"),
        invoice_uuid=invoice_snapshot.get("uuid"),
        invoice_reference=invoice_snapshot.get("reference") or invoice_snapshot.get("folio"),
        invoice_total=invoice_snapshot.get("total"),
        sat_status=sat_snapshot.get("status"),
        cancellation_status=sat_snapshot.get("cancellation_status"),
        checks=checks,
        warnings=warnings,
        quick_fields=_quick_fields(company_alias, invoice_snapshot, order_snapshot, supplier_name, supplier_rfc),
        pages=pages,
        sections={
            "order": {
                **order_snapshot,
                "company_name": company_name,
            },
            "invoice": invoice_snapshot,
            "sat": sat_snapshot,
            "warehouse": warehouse_snapshot,
            "support": support_snapshot,
        },
        raw_text=full_text,
    )
    return review


@router.post("/analyze")
async def analyze_cxp_expedientes(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    app = db.get(AppDefinition, APP_KEY)
    if not app or not app.enabled:
        raise HTTPException(status_code=404, detail="La herramienta de revisión de expedientes no está disponible.")

    ensure_app_access(user, APP_KEY, db)

    valid_files = [item for item in files if item.filename]
    if not valid_files:
        raise HTTPException(status_code=400, detail="Debes subir al menos un PDF.")

    for item in valid_files:
        if Path(item.filename or "").suffix.lower() != ".pdf":
            raise HTTPException(status_code=400, detail=f"Solo se permiten archivos PDF. Recibí: {item.filename}")

    reviews: list[ExpedienteReview] = []
    with tempfile.TemporaryDirectory(prefix="cxp-expedientes-") as temp_dir:
        root = Path(temp_dir)
        for index, upload in enumerate(valid_files):
            safe_name = re.sub(r"[^A-Za-z0-9._ -]+", "_", Path(upload.filename or f"file_{index}.pdf").name)
            target = root / f"{index:02d}-{safe_name}"
            target.write_bytes(await upload.read())
            reviews.append(_analyze_pdf(target))

    reviews.sort(key=lambda item: (item.status != "error", item.status != "warning", item.source_file.lower()))

    return {
        "summary": {
            "files": len(reviews),
            "ocr_pages": sum(item.ocr_pages for item in reviews),
            "with_errors": sum(1 for item in reviews if item.status == "error"),
            "with_warnings": sum(1 for item in reviews if item.status == "warning"),
            "with_sat": sum(1 for item in reviews if item.sat_status),
        },
        "files": [asdict(item) for item in reviews],
    }
