"""
Treasury PDF Parser
───────────────────
Extracts bank statements and movements from PDF files for
BBVA, Banregio, BanBajío, Monex and Santander.

This module is framework-agnostic: no FastAPI dependency.
Both the API routes and the worker import from here.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None


# ── Constants ─────────────────────────────────────────────

DATE_SLASH_RX = re.compile(r"^\d{2}/\d{2}/\d{4}$")
DATE_MON_RX = re.compile(r"^\d{2}-[A-Za-z]{3}-\d{4}$")
SANTANDER_ACCOUNT_RX = re.compile(r"^\d{11}$")
SANTANDER_DATE_PART_RX = re.compile(r"^\d{5}$")
TIME_RX = re.compile(r"^\d{2}:\d{2}$")
BRANCH_RX = re.compile(r"^\d{3,4}$")
MONEY_ONLY_RX = re.compile(r"^-?\$?[0-9OIl]{1,3}(?:,[0-9OIl]{3})*(?:\.[0-9OIl]{2})$")
BAJIO_ROW_RX = re.compile(r"^\d+$")

MONEX_SKIP_LINES = {
    "Descripcion",
    "Descripción",
    "Fecha",
    "oper.",
    "liq.",
    "Emisora",
    "Serie",
    "Instrument",
    "o",
    "Referenc",
    "ia",
    "Titulos",
    "Contrato",
    "Cantidad",
    "Plaz",
    "Tasa",
    "rend",
    "Prima",
    "unitaria",
    "Precio",
    "strike",
    "Importe",
    "Movimientos",
    "Sistema Corporativo Monex",
}

SPANISH_MONTHS = {
    "ENE": 1, "FEB": 2, "MAR": 3, "ABR": 4, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AGO": 8, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DIC": 12, "DEC": 12,
}

SPANISH_MONTH_NAMES = {
    "ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4, "MAYO": 5, "JUNIO": 6,
    "JULIO": 7, "AGOSTO": 8, "SEPTIEMBRE": 9, "OCTUBRE": 10, "NOVIEMBRE": 11, "DICIEMBRE": 12,
}

TREASURY_STOPWORDS = {
    "de", "del", "la", "las", "los", "por", "para", "con", "una", "uno", "que",
    "spei", "pago", "banco", "transferencia", "transferencias", "deposito",
    "depositos", "abono", "cargo", "com", "ref",
}

CATEGORY_TO_RECONCILIATION = {
    "iva_comision": "COMISIONES BANCARIAS",
    "comision": "COMISIONES BANCARIAS",
    "intereses_credito": "INTERESES",
    "intereses": "INTERESES",
    "nomina": "NÓMINA",
    "cheque": "CHEQUE",
    "divisas": "DIVISAS",
    "transferencia_entrada": "TRASPASO",
    "transferencia_salida": "TRASPASO",
    "deposito": "DEPÓSITO",
    "prestamo_credito": "PRÉSTAMO",
}


# ── Dataclasses ───────────────────────────────────────────

@dataclass
class TreasuryMovement:
    statement_id: str
    source_file: str
    bank: str
    sequence: int
    account_number: str | None = None
    account_holder: str | None = None
    currency: str | None = None
    movement_date: str | None = None
    settlement_date: str | None = None
    statement_date: str | None = None
    time: str | None = None
    branch: str | None = None
    description: str | None = None
    concept: str | None = None
    long_description: str | None = None
    reference: str | None = None
    counterparty: str | None = None
    movement_type: str | None = None
    category: str | None = None
    debit: float | None = None
    credit: float | None = None
    balance: float | None = None
    raw_text: str | None = None


@dataclass
class TreasuryStatement:
    id: str
    source_file: str
    bank: str
    ocr_used: bool
    account_holder: str | None = None
    account_number: str | None = None
    clabe: str | None = None
    contract: str | None = None
    alias: str | None = None
    currency: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    period_label: str | None = None
    statement_date: str | None = None
    opening_balance: float | None = None
    closing_balance: float | None = None
    total_debits: float | None = None
    total_credits: float | None = None
    warnings: list[str] = field(default_factory=list)
    raw_text: str = ""
    movements: list[TreasuryMovement] = field(default_factory=list)


# ── Text helpers ──────────────────────────────────────────

def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_only).strip("-").lower()
    return slug or "statement"


def _normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = value.encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"\s+", " ", value.strip().lower())
    return value


def _normalize_spaces(value: str | None) -> str | None:
    if value is None:
        return None
    return " ".join(value.replace("\xa0", " ").split()).strip() or None


def _clean_money_token(value: str) -> str:
    value = value.strip().replace("$", "").replace(" ", "")
    return value.translate(str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1"}))


def _parse_money(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(_clean_money_token(value).replace(",", ""))
    except Exception:
        return None


def _parse_date(value: str | None) -> str | None:
    raw = _normalize_spaces(value)
    if not raw:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    mon_match = re.match(r"^(?P<day>\d{2})-(?P<mon>[A-Za-z]{3})-(?P<year>\d{4})$", raw)
    if mon_match:
        parts = mon_match.groupdict()
        month = SPANISH_MONTHS.get(parts["mon"].upper())
        if month:
            return datetime(int(parts["year"]), month, int(parts["day"])).date().isoformat()
    return None


def _parse_short_date(value: str | None, year: int | None = None) -> str | None:
    """Parse short dates like 'DD/Mon' (02/Oct) or 'DD MMM' (1 MAR) using year context."""
    if not value:
        return None
    raw = _normalize_spaces(value)
    if not raw:
        return None
    # DD/Mon format (e.g. "02/Oct", "31/Mar")
    m = re.match(r"^(\d{1,2})/([A-Za-z]{3})$", raw)
    if m:
        day, mon = int(m.group(1)), SPANISH_MONTHS.get(m.group(2).upper())
        if mon and year:
            return datetime(year, mon, day).date().isoformat()
    # DD MMM format (e.g. "1 MAR", "31 MAR")
    m = re.match(r"^(\d{1,2})\s+([A-Za-z]{3,})$", raw)
    if m:
        day = int(m.group(1))
        mon_text = m.group(2).upper()[:3]
        mon = SPANISH_MONTHS.get(mon_text)
        if mon and year:
            return datetime(year, mon, day).date().isoformat()
    return None


def _parse_natural_period(text: str) -> tuple[str | None, str | None]:
    """Parse period like 'Del 1 Octubre 2024 al 31 octubre 2024' or 'del DD al DD de MES YYYY'."""
    # "Del D MONTH YYYY al D MONTH YYYY"
    m = re.search(
        r"(?:del|periodo[:\s]*)\s*(\d{1,2})\s+(?:de\s+)?(\w+)\s+(?:de\s+)?(\d{4})\s+al\s+(\d{1,2})\s+(?:de\s+)?(\w+)\s+(?:de\s+)?(\d{4})",
        text, re.IGNORECASE,
    )
    if m:
        d1, m1, y1, d2, m2, y2 = m.groups()
        mon1 = SPANISH_MONTH_NAMES.get(m1.upper()) or SPANISH_MONTHS.get(m1.upper()[:3])
        mon2 = SPANISH_MONTH_NAMES.get(m2.upper()) or SPANISH_MONTHS.get(m2.upper()[:3])
        if mon1 and mon2:
            start = datetime(int(y1), mon1, int(d1)).date().isoformat()
            end = datetime(int(y2), mon2, int(d2)).date().isoformat()
            return start, end
    # "del DD al DD de MES YYYY"
    m = re.search(
        r"del\s+(\d{1,2})\s+al\s+(\d{1,2})\s+de\s+(\w+)\s+(?:de\s+)?(\d{4})",
        text, re.IGNORECASE,
    )
    if m:
        d1, d2, month_name, year = m.groups()
        mon = SPANISH_MONTH_NAMES.get(month_name.upper()) or SPANISH_MONTHS.get(month_name.upper()[:3])
        if mon:
            start = datetime(int(year), mon, int(d1)).date().isoformat()
            end = datetime(int(year), mon, int(d2)).date().isoformat()
            return start, end
    return None, None


def _parse_santander_date(part_a: str, part_b: str) -> str | None:
    digits = re.sub(r"\D", "", f"{part_a}{part_b}")
    if len(digits) != 8:
        return None
    return _parse_date(f"{digits[:2]}/{digits[2:4]}/{digits[4:]}")


def _find_label_value(lines: list[str], labels: tuple[str, ...], lookahead: int = 2) -> str | None:
    normalized_labels = tuple(_normalize(label) for label in labels)
    for idx, line in enumerate(lines):
        current = _normalize(line)
        # Also match lines with extra spaces before the colon (e.g. "Clabe  : 123")
        current_collapsed = re.sub(r"\s*:\s*", ":", current, count=1)
        for label in normalized_labels:
            if current_collapsed.startswith(f"{label}:"):
                # Extract value after the colon from the original line
                colon_pos = line.find(":")
                value = _normalize_spaces(line[colon_pos + 1 :]) if colon_pos >= 0 else None
                if value:
                    return value
                # Value is on the next line(s) — lookahead
                for probe in lines[idx + 1 : idx + 1 + lookahead]:
                    value = _normalize_spaces(probe)
                    if value:
                        return value
            if current == label and idx + 1 < len(lines):
                for probe in lines[idx + 1 : idx + 1 + lookahead]:
                    value = _normalize_spaces(probe)
                    if value:
                        return value
    return None


def _split_trailing_money(line: str) -> tuple[str, list[str]]:
    parts = line.split()
    tail: list[str] = []
    while parts and MONEY_ONLY_RX.match(parts[-1]):
        tail.insert(0, parts.pop())
        if len(tail) == 2:
            break
    return " ".join(parts).strip(), tail


def _extract_reference(text: str | None) -> str | None:
    raw = _normalize_spaces(text)
    if not raw:
        return None
    for pattern in (
        r"(CH-\d+)",
        r"(REF[A-Z0-9_/-]+)",
        r"(CRE_[A-Z0-9_]+)",
        r"(BB\d{10,})",
        r"(\b\d{8,18}\b)",
    ):
        match = re.search(pattern, raw, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def _extract_counterparty(text: str | None) -> str | None:
    raw = _normalize_spaces(text)
    if not raw:
        return None
    patterns = (
        r"(?:ordenante|nombre del ordenante|emisor)\s*:\s*(.+?)(?:\s+\|\s+| cuenta | rfc | clave | referencia[: ]| fecha[: ]| hora[: ]|$)",
        r"(?:beneficiario|nombre beneficiario|nombre receptor)\s*:\s*(.+?)(?:\s+\|\s+| cuenta | rfc | clave | referencia[: ]| fecha[: ]| hora[: ]|$)",
        r"(?:ordenante)\s*:\s*(.+?)(?:\s+cuenta|\s+rfc|\s+hora[: ]|\s+referencia[: ]|$)",
    )
    for pattern in patterns:
        match = re.search(pattern, raw, re.IGNORECASE)
        if match:
            value = _normalize_spaces(match.group(1))
            if value:
                value = re.split(r"\b(?:Cuenta|RFC|Clave|Referencia|Fecha|Hora)\b\s*:?", value, maxsplit=1, flags=re.IGNORECASE)[0].strip()
            if value:
                return value
    return None


def _movement_type(debit: float | None, credit: float | None) -> str:
    if debit and debit > 0:
        return "cargo"
    if credit and credit > 0:
        return "abono"
    return "informativo"


def _movement_category(description: str | None, concept: str | None, debit: float | None, credit: float | None) -> str:
    haystack = _normalize(" ".join(part for part in [description or "", concept or ""] if part))
    haystack = haystack.replace("i v a", "iva")

    if "iva" in haystack and "comision" in haystack:
        return "iva_comision"
    if "comision" in haystack or "membresia" in haystack or "administracion paquete" in haystack:
        return "comision"
    if "interes" in haystack and "credito" in haystack:
        return "intereses_credito"
    if "interes" in haystack:
        return "intereses"
    if "nomina" in haystack:
        return "nomina"
    if "cheque" in haystack:
        return "cheque"
    if "divisa" in haystack or "compra de divisas" in haystack:
        return "divisas"
    if "spei recibido" in haystack or "abono transferencia spei" in haystack:
        return "transferencia_entrada"
    if "spei enviado" in haystack or "spid" in haystack or ("transferencia" in haystack and debit):
        return "transferencia_salida"
    if "deposito" in haystack or "deposito de tercero" in haystack:
        return "deposito"
    if "prestamo" in haystack or "credito" in haystack:
        return "prestamo_credito"
    return _movement_type(debit, credit)


def _make_movement(
    statement: TreasuryStatement,
    sequence: int,
    *,
    currency: str | None = None,
    movement_date: str | None = None,
    settlement_date: str | None = None,
    time: str | None = None,
    branch: str | None = None,
    description: str | None = None,
    concept: str | None = None,
    long_description: str | None = None,
    reference: str | None = None,
    counterparty: str | None = None,
    debit: float | None = None,
    credit: float | None = None,
    balance: float | None = None,
    raw_text: str | None = None,
) -> TreasuryMovement:
    description = _normalize_spaces(description)
    concept = _normalize_spaces(concept)
    long_description = _normalize_spaces(long_description)
    raw_text = _normalize_spaces(raw_text)
    reference = _normalize_spaces(reference) or _extract_reference(" ".join(part for part in [description or "", concept or "", long_description or ""] if part))
    counterparty = _normalize_spaces(counterparty) or _extract_counterparty(" ".join(part for part in [description or "", concept or "", long_description or ""] if part))
    movement_type_val = _movement_type(debit, credit)
    category = _movement_category(description, concept or long_description, debit, credit)

    return TreasuryMovement(
        statement_id=statement.id,
        source_file=statement.source_file,
        bank=statement.bank,
        sequence=sequence,
        account_number=statement.account_number,
        account_holder=statement.account_holder,
        currency=currency or statement.currency,
        movement_date=movement_date,
        settlement_date=settlement_date,
        statement_date=statement.statement_date,
        time=time,
        branch=branch,
        description=description,
        concept=concept,
        long_description=long_description,
        reference=reference,
        counterparty=counterparty,
        movement_type=movement_type_val,
        category=category,
        debit=debit,
        credit=credit,
        balance=balance,
        raw_text=raw_text,
    )


# ── PDF text extraction ──────────────────────────────────

def _extract_pdf_text(path: Path) -> tuple[str, bool]:
    if fitz is None:
        raise RuntimeError("PyMuPDF no esta disponible.")

    document = fitz.open(str(path))
    used_ocr = False
    page_texts: list[str] = []
    try:
        for page in document:
            plain_text = page.get_text("text").replace("\xa0", " ")
            compact_plain = re.sub(r"\s+", "", plain_text)
            final_text = plain_text

            if len(compact_plain) < 120:
                try:
                    textpage = page.get_textpage_ocr(language="spa+eng", dpi=300, full=True)
                    ocr_text = page.get_text("text", textpage=textpage).replace("\xa0", " ")
                    if len(re.sub(r"\s+", "", ocr_text)) > len(compact_plain):
                        final_text = ocr_text
                        used_ocr = True
                except Exception:
                    pass

            page_texts.append(final_text)
    finally:
        document.close()

    return "\n".join(page_texts), used_ocr


# ── Bank detection ────────────────────────────────────────

def _detect_bank(text: str) -> str:
    normalized = _normalize(text[:3000])
    # BBVA - check for Net Cash or general BBVA markers
    if "bbva net cash" in normalized or "bbva bancomer" in normalized or normalized.startswith("bbva "):
        return "BBVA"
    if "bbva" in normalized and ("cuenta" in normalized or "movimientos" in normalized):
        return "BBVA"
    # Banregio
    if "banregio" in normalized or "estado de cuenta unico" in normalized:
        return "Banregio"
    # BanBajio
    if "banbajio" in normalized or "cuenta conecta banbajio" in normalized or "banco del bajio" in normalized or "banco bajio" in normalized:
        return "BanBajio"
    # Monex - check both old and new formats
    if "corporativo monex" in normalized:
        return "Monex"
    if "monex" in normalized and ("contrato:" in normalized or "cta. clabe:" in normalized):
        return "Monex"
    if "estado de cuenta" in normalized and "monex" in normalized:
        return "Monex"
    # Santander
    if "santander" in normalized or "contrato cmc" in normalized:
        return "Santander"
    return "Desconocido"


# ── Shared line helpers ───────────────────────────────────

def _clean_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line and line.strip()]


def _find_first_prefixed(lines: list[str], prefixes: tuple[str, ...]) -> str | None:
    for line in lines:
        for prefix in prefixes:
            if line.startswith(prefix):
                return _normalize_spaces(line.split(":", 1)[1])
    return None


# ── Individual bank parsers ───────────────────────────────

def _parse_bbva(text: str, source_file: str, ocr_used: bool) -> TreasuryStatement:
    lines = _clean_lines(text)
    statement = TreasuryStatement(
        id=_slugify(Path(source_file).stem),
        source_file=source_file,
        bank="BBVA",
        ocr_used=ocr_used,
        account_holder=_find_label_value(lines, ("Nombre del Cliente",)),
        contract=_find_label_value(lines, ("No. Contrato",)),
        account_number=_find_label_value(lines, ("Cuenta",)),
        alias=_find_label_value(lines, ("Alias",)),
        currency=_find_label_value(lines, ("Divisa",)),
        statement_date=_parse_date(_find_label_value(lines, ("Fecha Consulta",))),
        period_label=_find_label_value(lines, ("Periodo de Consulta",)),
        raw_text=text,
    )
    # CLABE extraction (BBVA CLABEs start with 012)
    if not statement.clabe:
        statement.clabe = _find_label_value(lines, ("Cuenta CLABE", "CLABE"))
    if not statement.clabe:
        clabe_match = re.search(r"\b(012\d{15})\b", text)
        if clabe_match:
            statement.clabe = clabe_match.group(1)

    if ocr_used:
        statement.warnings.append("Se uso OCR para leer este estado de cuenta.")

    start_idx = next((idx for idx, line in enumerate(lines) if _normalize(line) == "detalle de movimientos"), 0)
    body = lines[start_idx + 1 :]
    sequence = 1
    idx = 0
    while idx < len(body):
        line = body[idx]
        match = re.match(r"^(?P<date>\d{2}/\d{2}/\d{4})(?:\s+(?P<rest>.*))?$", line)
        if not match:
            idx += 1
            continue

        movement_date = _parse_date(match.group("date"))
        idx += 1
        desc_lines: list[str] = [match.group("rest").strip()] if match.group("rest") else []
        money_tokens: list[str] = []

        while idx < len(body):
            probe = body[idx]
            if re.match(r"^\d{2}/\d{2}/\d{4}\b", probe) or probe.startswith("Movimientos del dia:") or probe.startswith("Movimientos del día:") or probe.startswith("Fin dia") or probe.startswith("Fin día"):
                break
            if probe in {"Fecha", "Concepto/ Referencia", "Cargo", "Abono", "Saldo"}:
                idx += 1
                continue

            if MONEY_ONLY_RX.match(probe):
                money_tokens.append(probe)
            else:
                cleaned, trailing = _split_trailing_money(probe)
                if cleaned:
                    desc_lines.append(cleaned)
                money_tokens.extend(trailing)
            idx += 1

        if not money_tokens and not desc_lines:
            continue

        values = money_tokens[-2:] if len(money_tokens) >= 2 else money_tokens
        amount = _parse_money(values[0]) if values else None
        balance = _parse_money(values[1]) if len(values) > 1 else None
        debit = abs(amount) if amount is not None and amount < 0 else None
        credit = amount if amount is not None and amount > 0 else None
        description = _normalize_spaces(" ".join(desc_lines))
        if not description:
            continue

        statement.movements.append(
            _make_movement(
                statement,
                sequence,
                movement_date=movement_date,
                description=description,
                debit=debit,
                credit=credit,
                balance=balance,
                raw_text=" | ".join(desc_lines + money_tokens),
            )
        )
        sequence += 1

    credits = [item.credit for item in statement.movements if item.credit]
    debits = [item.debit for item in statement.movements if item.debit]
    if credits:
        statement.total_credits = round(sum(credits), 2)
    if debits:
        statement.total_debits = round(sum(debits), 2)
    if statement.movements:
        statement.closing_balance = statement.movements[-1].balance

    # Derive opening_balance from first movement
    if statement.movements and statement.opening_balance is None:
        first = statement.movements[0]
        if first.balance is not None:
            amount = (first.credit or 0) - (first.debit or 0)
            statement.opening_balance = round(first.balance - amount, 2)

    if statement.opening_balance is None:
        saldo_ini = _find_label_value(lines, ("Saldo Inicial", "Saldo Anterior"))
        if saldo_ini:
            statement.opening_balance = _parse_money(saldo_ini)
    if statement.closing_balance is None:
        saldo_fin = _find_label_value(lines, ("Saldo Final",))
        if saldo_fin:
            statement.closing_balance = _parse_money(saldo_fin)

    # Derive period from movement dates when period_label is not a date range
    if statement.movements and not statement.period_start:
        dates = sorted(d for m in statement.movements if (d := m.movement_date))
        if dates:
            statement.period_start = dates[0]
            statement.period_end = dates[-1]

    # OCR: contract number may appear fragmented far from "No. Contrato" label
    if not statement.contract:
        contract_match = re.search(r"(?:No\.?\s*Contrato|Contrato)\s*[:\s]*(\d{5,})", text, re.IGNORECASE)
        if contract_match:
            statement.contract = contract_match.group(1)

    # OCR: account holder may appear fragmented after header
    if not statement.account_holder:
        holder_match = re.search(
            r"((?:CONSTRUCCIONES|LORENTO|INMOBILIARIA|GRUPO)[A-Z\s]+(?:SA\s+DE\s+CV|S\.?A\.?\s+DE\s+C\.?V\.?))",
            text, re.IGNORECASE,
        )
        if holder_match:
            statement.account_holder = _normalize_spaces(holder_match.group(1))

    return statement


def _parse_banregio(text: str, source_file: str, ocr_used: bool) -> TreasuryStatement:
    lines = _clean_lines(text)
    period_match = re.search(r"Fecha\s+Inicio[: ]*([0-9/]+)\s*-\s*Fecha\s+Fin[: ]*([0-9/]+)", text, re.IGNORECASE)
    statement = TreasuryStatement(
        id=_slugify(Path(source_file).stem),
        source_file=source_file,
        bank="Banregio",
        ocr_used=ocr_used,
        account_holder=_normalize_spaces(lines[2]) if len(lines) > 2 else None,
        account_number=_find_label_value(lines, ("CUENTA", "Cuenta")),
        clabe=_find_label_value(lines, ("CLABE", "Clabe")),
        period_start=_parse_date(period_match.group(1)) if period_match else None,
        period_end=_parse_date(period_match.group(2)) if period_match else None,
        opening_balance=_parse_money(re.search(r"Saldo Inicial[: ]*\$?([0-9,]+\.[0-9]{2})", text, re.IGNORECASE).group(1)) if re.search(r"Saldo Inicial[: ]*\$?([0-9,]+\.[0-9]{2})", text, re.IGNORECASE) else None,
        closing_balance=_parse_money(re.search(r"Saldo Final[: ]*\$?([0-9,]+\.[0-9]{2})", text, re.IGNORECASE).group(1)) if re.search(r"Saldo Final[: ]*\$?([0-9,]+\.[0-9]{2})", text, re.IGNORECASE) else None,
        total_debits=_parse_money(re.search(r"Total Cargos[: ]*\$?([0-9,]+\.[0-9]{2})", text, re.IGNORECASE).group(1)) if re.search(r"Total Cargos[: ]*\$?([0-9,]+\.[0-9]{2})", text, re.IGNORECASE) else None,
        total_credits=_parse_money(re.search(r"Total Abonos[: ]*\$?([0-9,]+\.[0-9]{2})", text, re.IGNORECASE).group(1)) if re.search(r"Total Abonos[: ]*\$?([0-9,]+\.[0-9]{2})", text, re.IGNORECASE) else None,
        currency="MXN",
        raw_text=text,
    )
    if ocr_used:
        statement.warnings.append("Se uso OCR para leer este estado de cuenta.")

    if "_sin registros" in _normalize(text) or "sin registros" in _normalize(text):
        statement.warnings.append("El PDF de ejemplo no contiene movimientos.")
        return statement

    body = lines[next((idx for idx, line in enumerate(lines) if _normalize(line) == "saldo"), len(lines)) + 1 :]
    idx = 0
    sequence = 1
    while idx < len(body):
        line = body[idx]
        if not DATE_SLASH_RX.match(line):
            idx += 1
            continue
        movement_date = _parse_date(line)
        idx += 1
        bucket: list[str] = []
        while idx < len(body) and not DATE_SLASH_RX.match(body[idx]) and "total cargos" not in _normalize(body[idx]):
            bucket.append(body[idx])
            idx += 1
        text_block = " ".join(bucket)
        money = [part for part in bucket if MONEY_ONLY_RX.match(part)]
        debit = _parse_money(money[0]) if len(money) >= 1 else None
        credit = _parse_money(money[1]) if len(money) >= 2 else None
        balance = _parse_money(money[2]) if len(money) >= 3 else None
        statement.movements.append(
            _make_movement(
                statement,
                sequence,
                movement_date=movement_date,
                description=text_block,
                debit=debit if debit and debit > 0 else None,
                credit=credit if credit and credit > 0 else None,
                balance=balance,
                raw_text=text_block,
            )
        )
        sequence += 1
    return statement


def _parse_bajio(text: str, source_file: str, ocr_used: bool) -> TreasuryStatement:
    lines = _clean_lines(text)
    statement = TreasuryStatement(
        id=_slugify(Path(source_file).stem),
        source_file=source_file,
        bank="BanBajio",
        ocr_used=ocr_used,
        account_number=_find_label_value(lines, ("Cuenta",)),
        currency="MXN" if "Saldo Total" in text else None,
        closing_balance=_parse_money(re.search(r"Saldo Total[: ]*\$?([0-9,]+\.[0-9]{2})", text, re.IGNORECASE).group(1)) if re.search(r"Saldo Total[: ]*\$?([0-9,]+\.[0-9]{2})", text, re.IGNORECASE) else None,
        raw_text=text,
    )
    # CLABE extraction (BanBajio CLABEs start with 030)
    statement.clabe = _find_label_value(lines, ("CLABE INTERBANCARIA", "CLABE Interbancaria", "CLABE"))
    if not statement.clabe:
        clabe_match = re.search(r"\b(030\d{15})\b", text)
        if clabe_match:
            statement.clabe = clabe_match.group(1)

    # Period extraction
    ps, pe = _parse_natural_period(text)
    if ps:
        statement.period_start = ps
        statement.period_end = pe

    # Account holder
    if not statement.account_holder:
        # Look for holder name before address (between title and "C.P.")
        holder_match = re.search(
            r"(?:ESTADO DE CUENTA|NUMERO DE CLIENTE)[^a-z]*?\n\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,\.]+?)(?:\n|C\.?P\.)",
            text, re.IGNORECASE,
        )
        if holder_match:
            statement.account_holder = _normalize_spaces(holder_match.group(1))

    if ocr_used:
        statement.warnings.append("Se uso OCR para leer este estado de cuenta.")

    sequence = 1
    idx = 0
    while idx < len(lines):
        if not BAJIO_ROW_RX.match(lines[idx]):
            idx += 1
            continue
        if idx + 1 >= len(lines) or not _parse_date(lines[idx + 1]):
            idx += 1
            continue

        row_number = int(lines[idx])
        movement_date = _parse_date(lines[idx + 1])
        idx += 2
        block: list[str] = []
        while idx < len(lines):
            if BAJIO_ROW_RX.match(lines[idx]) and idx + 1 < len(lines) and _parse_date(lines[idx + 1]):
                break
            if "registros" in _normalize(lines[idx]):
                break
            block.append(lines[idx])
            idx += 1

        amount_tokens = [item for item in block if MONEY_ONLY_RX.match(item)]
        balance = _parse_money(amount_tokens[-1]) if amount_tokens else None
        amount = _parse_money(amount_tokens[0]) if amount_tokens else None
        text_block = " ".join(block)
        normalized_block = _normalize(text_block)
        is_credit = "spei recibido" in normalized_block
        debit = None
        credit = None
        if amount and amount > 0:
            if is_credit:
                credit = amount
            else:
                debit = amount

        description_parts = [
            item
            for item in block
            if not MONEY_ONLY_RX.match(item)
            and not item.startswith("Hora:")
            and not item.startswith("Referencia:")
            and not item.startswith("Numero de Referencia:")
            and not item.startswith("Número de Referencia:")
            and not item.startswith("Numero de Autorizacion:")
            and not item.startswith("Número de Autorización:")
            and not item.startswith("Recibo")
        ]
        description = _normalize_spaces(" ".join(description_parts))
        reference = _find_first_prefixed(block, ("Referencia:", "Número de Referencia:", "Numero de Referencia:"))
        if not reference:
            reference = _extract_reference(text_block)
        time = _find_first_prefixed(block, ("Hora:",))
        counterparty = _extract_counterparty(text_block)

        statement.movements.append(
            _make_movement(
                statement,
                row_number or sequence,
                movement_date=movement_date,
                time=time,
                description=description,
                reference=reference,
                counterparty=counterparty,
                debit=debit,
                credit=credit,
                balance=balance,
                raw_text=text_block,
            )
        )
        sequence = max(sequence, row_number + 1)

    # Detect SALDO INICIAL as first movement and use as opening_balance
    if statement.movements:
        first = statement.movements[0]
        if first.description and _normalize(first.description).startswith("saldo inicial"):
            statement.opening_balance = first.balance
            statement.movements = statement.movements[1:]  # Remove it from movements
        elif first.balance is not None:
            amount = (first.credit or 0) - (first.debit or 0)
            statement.opening_balance = round(first.balance - amount, 2)

    # Summary totals
    dep_match = re.search(r"\(\+\)\s*DEPOSITOS[:\s]*\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
    if dep_match:
        statement.total_credits = _parse_money(dep_match.group(1))
    cargo_match = re.search(r"\(-\)\s*CARGOS[:\s]*\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
    if cargo_match:
        statement.total_debits = _parse_money(cargo_match.group(1))

    if not statement.movements:
        statement.warnings.append("No se detectaron filas del detalle en el PDF de ejemplo.")
    else:
        incomplete = sum(1 for item in statement.movements if item.debit is None and item.credit is None)
        if incomplete:
            statement.warnings.append(f"{incomplete} movimientos requieren validacion manual de importe.")
    return statement


def _parse_monex_new(text: str, source_file: str, ocr_used: bool) -> TreasuryStatement:
    """Parse Monex new format (2024+) with DD/Mon dates and natural language period."""
    lines = _clean_lines(text)

    # Extract header fields
    contract = _find_label_value(lines, ("CONTRATO",))
    clabe = _find_label_value(lines, ("CTA. CLABE", "CLABE"))
    client_no = _find_label_value(lines, ("CLIENTE No.", "CLIENTE No"))

    # Period - natural language
    period_text = _find_label_value(lines, ("PERIODO",)) or ""
    ps, pe = _parse_natural_period(period_text)
    if not ps:
        ps, pe = _parse_natural_period(text)

    # Determine year from period for short dates
    period_year = None
    if pe:
        try:
            period_year = int(pe[:4])
        except (ValueError, TypeError):
            pass
    if not period_year:
        # Fallback: look for a 4-digit year in the text
        year_match = re.search(r"\b(20\d{2})\b", text[:2000])
        period_year = int(year_match.group(1)) if year_match else datetime.now().year

    # Currency detection from "Resumen Cuenta" section
    currency = "MXN"
    currency_match = re.search(r"(?:Resumen\s+Cuenta|Movimientos\s+de)\s*[:\s]*.*?(Peso\s+Mexicano|Dolar\s+Americano|Dollar)", text, re.IGNORECASE)
    if currency_match:
        curr_text = _normalize(currency_match.group(1))
        if "dolar" in curr_text or "dollar" in curr_text:
            currency = "USD"
    # Also check "MOVIMIENTOS DE:" for old-style currency headers
    mov_de_match = re.search(r"MOVIMIENTOS\s+DE[:\s]+(.+)", text, re.IGNORECASE)
    if mov_de_match:
        mov_currency = _normalize(mov_de_match.group(1))
        if "dolar" in mov_currency:
            currency = "USD"

    # Account holder - first substantial text line (name, before address)
    account_holder = None
    for line in lines[:30]:
        norm = _normalize(line)
        if any(kw in norm for kw in ("estado de cuenta", "monex", "hoja", "folio", "oficina", "telefono", "cliente", "contrato", "clabe", "rfc", "periodo", "estatus", "asesor", "c.p.")):
            continue
        clean = _normalize_spaces(line)
        if clean and len(clean) > 10 and not clean[0].isdigit():
            account_holder = clean
            break

    statement = TreasuryStatement(
        id=_slugify(Path(source_file).stem),
        source_file=source_file,
        bank="Monex",
        ocr_used=ocr_used,
        account_holder=account_holder,
        contract=contract,
        clabe=clabe,
        currency=currency,
        period_start=ps,
        period_end=pe,
        raw_text=text,
    )

    # Extract balances from summary
    saldo_ini_match = re.search(r"Saldo\s+inicial[:\s]*\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
    if saldo_ini_match:
        statement.opening_balance = _parse_money(saldo_ini_match.group(1))
    saldo_fin_match = re.search(r"Saldo\s+(?:final|total|vista)[:\s]*\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
    if saldo_fin_match:
        statement.closing_balance = _parse_money(saldo_fin_match.group(1))

    abonos_match = re.search(r"\+?\s*Total\s+abonos[:\s]*\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
    if abonos_match:
        statement.total_credits = _parse_money(abonos_match.group(1))
    cargos_match = re.search(r"-?\s*Total\s+cargos[:\s]*\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
    if cargos_match:
        statement.total_debits = _parse_money(cargos_match.group(1))

    # Find movements section
    # New format uses "Movimientos de [month]" as section header
    mov_start = 0
    for idx, line in enumerate(lines):
        norm = _normalize(line)
        if norm.startswith("movimientos de ") or norm == "movimientos":
            mov_start = idx + 1
            break

    # Parse movements - look for DD/Mon date patterns
    SHORT_DATE_RX = re.compile(r"^(\d{1,2})/([A-Za-z]{3})$")

    sequence = 0
    idx = mov_start
    while idx < len(lines):
        line = lines[idx].strip()

        # Skip known headers and empty-ish lines
        norm = _normalize(line)
        if norm in ("fechas", "liquidacion (pactada)", "descripcion", "referencia", "abonos", "cargos", "saldo disponible", "saldo total", "movimiento garantia", "saldo en garantia"):
            idx += 1
            continue
        if norm.startswith("saldo inicial") or norm.startswith("saldo final"):
            idx += 1
            continue
        if norm.startswith("hoja ") or norm.startswith("estado de cuenta") or norm.startswith("contrato:") or norm.startswith("movimientos de "):
            idx += 1
            continue

        date_match = SHORT_DATE_RX.match(line)
        if not date_match:
            idx += 1
            continue

        # Found a movement start
        movement_date = _parse_short_date(line, period_year)

        # Collect description and money lines
        idx += 1
        desc_parts = []
        money_tokens = []
        reference = None

        while idx < len(lines):
            next_line = lines[idx].strip()
            next_norm = _normalize(next_line)

            # Stop if we hit another date or end markers
            if SHORT_DATE_RX.match(next_line):
                break
            if next_norm.startswith("saldo final") or next_norm.startswith("hoja ") or next_norm.startswith("movimientos de "):
                break

            # Check if this line has money tokens
            tokens = next_line.split()
            money_in_line = [t for t in tokens if MONEY_ONLY_RX.match(t)]

            if money_in_line and len(money_in_line) >= 2:
                # This is likely the amounts line (ref, abonos, cargos, ...)
                # Check if first non-money token is a reference number
                non_money = [t for t in tokens if not MONEY_ONLY_RX.match(t)]
                for nm in non_money:
                    if re.match(r"^\d{6,}$", nm):
                        reference = nm
                money_tokens = money_in_line
                idx += 1
                break
            else:
                # Description line
                desc_parts.append(next_line)
                # Check for reference number in description
                if re.match(r"^\d{6,}$", next_line):
                    reference = next_line
                    desc_parts.pop()  # Remove reference from description
            idx += 1

        # Parse amounts from money tokens
        # Pattern: [abono, cargo, mov_garantia, saldo_garantia, saldo_disponible, saldo_total]
        # or fewer columns
        credit = None
        debit = None
        balance = None

        if money_tokens:
            parsed_money = [_parse_money(t) for t in money_tokens]
            # In new Monex format: abonos, cargos, ..., saldo_disponible, saldo_total
            if len(parsed_money) >= 6:
                if parsed_money[0] and parsed_money[0] > 0:
                    credit = parsed_money[0]
                if parsed_money[1] and parsed_money[1] > 0:
                    debit = parsed_money[1]
                balance = parsed_money[-1]  # saldo total
            elif len(parsed_money) >= 2:
                # Try to figure out which is credit/debit
                # Look at the description for hints
                desc_text = " ".join(desc_parts).lower()
                if "deposito" in desc_text or "abono" in desc_text:
                    credit = parsed_money[0] if parsed_money[0] and parsed_money[0] > 0 else None
                elif "retiro" in desc_text or "cargo" in desc_text or "comision" in desc_text:
                    debit = parsed_money[0] if parsed_money[0] and parsed_money[0] > 0 else None
                else:
                    # Default: first is amount, last is balance
                    amount = parsed_money[0]
                    if amount and amount > 0:
                        credit = amount
                balance = parsed_money[-1]

        description = " ".join(desc_parts) if desc_parts else None

        # Extract counterparty from structured descriptions
        counterparty = None
        concept = None
        if description:
            # "Nombre del Ordenante:", "Nombre Beneficiario:", "Nombre Receptor:", "BENEFICIARIO"
            cp_match = re.search(r"(?:Nombre\s+(?:del\s+)?(?:Ordenante|Beneficiario|Receptor))[:\s]+(.+?)(?:\n|Clave|Cuenta|Referencia|Concepto|Fecha|$)", description, re.IGNORECASE)
            if cp_match:
                counterparty = _normalize_spaces(cp_match.group(1))
            # Concept
            cp_concept = re.search(r"Concepto\s+(?:de\s+)?(?:Pago|pago)[:\s]+(.+?)(?:\n|Fecha|$)", description, re.IGNORECASE)
            if cp_concept:
                concept = _normalize_spaces(cp_concept.group(1))

        # Determine movement type
        movement_type = "cargo" if debit else ("abono" if credit else "informativo")

        sequence += 1
        statement.movements.append(TreasuryMovement(
            statement_id=statement.id,
            source_file=source_file,
            bank="Monex",
            sequence=sequence,
            account_number=statement.account_number,
            account_holder=statement.account_holder,
            currency=currency,
            movement_date=movement_date,
            description=_normalize_spaces(description),
            concept=concept,
            reference=reference,
            counterparty=counterparty,
            movement_type=movement_type,
            category=_movement_category(description, concept, debit, credit),
            debit=debit,
            credit=credit,
            balance=balance,
            raw_text=description,
        ))

    # Derive period from movement dates if not found
    if statement.movements and not statement.period_start:
        dates = sorted(d for m in statement.movements if (d := m.movement_date))
        if dates:
            statement.period_start = dates[0]
            statement.period_end = dates[-1]

    # Closing balance from last movement
    if statement.movements and statement.closing_balance is None:
        statement.closing_balance = statement.movements[-1].balance

    # Account number from CLABE
    if not statement.account_number and statement.clabe:
        statement.account_number = statement.clabe

    if ocr_used:
        statement.warnings.append("Se uso OCR para leer este estado de cuenta.")

    return statement


def _parse_monex(text: str, source_file: str, ocr_used: bool) -> TreasuryStatement:
    # Detect new format (2024+)
    normalized_header = _normalize(text[:3000])
    if "estado de cuenta" in normalized_header and "sistema corporativo monex" not in normalized_header:
        return _parse_monex_new(text, source_file, ocr_used)

    lines = _clean_lines(text)
    period_match = re.search(r"del dia\s+([0-9/]+)\s+al\s+([0-9/]+)", _normalize(text), re.IGNORECASE)
    statement = TreasuryStatement(
        id=_slugify(Path(source_file).stem),
        source_file=source_file,
        bank="Monex",
        ocr_used=ocr_used,
        account_holder=_find_label_value(lines, ("Cliente",)),
        contract=_find_label_value(lines, ("Contrato",)),
        clabe=_find_label_value(lines, ("Clabe",)),
        period_start=_parse_date(period_match.group(1)) if period_match else None,
        period_end=_parse_date(period_match.group(2)) if period_match else None,
        raw_text=text,
    )

    sequence = 1
    currency: str | None = None
    idx = 0

    def looks_new(start: int) -> bool:
        line = lines[start]
        if (
            not line
            or DATE_SLASH_RX.match(line)
            or MONEY_ONLY_RX.match(line)
            or line.startswith("MOVIMIENTOS DE:")
            or line.startswith("Movimientos del dia:")
            or line.startswith("Movimientos del día:")
            or line in {"Inicio dia", "Inicio día", "Fin dia", "Fin día"}
            or line.startswith("Fecha Emision:")
            or line.startswith("Fecha Emisión:")
            or line.startswith("Fecha Operacion:")
            or line.startswith("Fecha Operación:")
            or line.startswith("Pagina ")
            or line.startswith("Página ")
            or line in MONEX_SKIP_LINES
        ):
            return False

        for offset in range(1, 8):
            probe_a = start + offset
            probe_b = probe_a + 1
            if probe_b < len(lines) and DATE_SLASH_RX.match(lines[probe_a]) and DATE_SLASH_RX.match(lines[probe_b]):
                return True
        return True

    while idx < len(lines):
        line = lines[idx]
        if line.startswith("MOVIMIENTOS DE:"):
            currency = _normalize_spaces(line.split(":", 1)[1])
            idx += 1
            continue
        if line.startswith("Movimientos del dia:") or line.startswith("Movimientos del día:"):
            idx += 1
            continue
        if line in {"Inicio dia", "Inicio día", "Fin dia", "Fin día"}:
            idx += 2
            continue
        if line.startswith(("Fecha Emision:", "Fecha Emisión:", "Fecha Operacion:", "Fecha Operación:", "Pagina ", "Página ")) or line in MONEX_SKIP_LINES:
            idx += 1
            continue
        if line.isdigit() and len(line) <= 2:
            idx += 1
            continue
        if not looks_new(idx):
            idx += 1
            continue

        desc_lines: list[str] = []
        while idx < len(lines) and not DATE_SLASH_RX.match(lines[idx]):
            current = lines[idx]
            if current not in MONEX_SKIP_LINES and not current.startswith(("Fecha Emision:", "Fecha Emisión:", "Fecha Operacion:", "Fecha Operación:", "Pagina ", "Página ")):
                desc_lines.append(current)
            idx += 1

        if idx + 1 >= len(lines) or not DATE_SLASH_RX.match(lines[idx]) or not DATE_SLASH_RX.match(lines[idx + 1]):
            continue

        movement_date = _parse_date(lines[idx])
        settlement_date = _parse_date(lines[idx + 1])
        idx += 2
        detail_lines: list[str] = []
        while idx < len(lines):
            probe = lines[idx]
            if probe.startswith("MOVIMIENTOS DE:") or probe.startswith("Movimientos del dia:") or probe.startswith("Movimientos del día:") or probe in {"Inicio dia", "Inicio día", "Fin dia", "Fin día"}:
                break
            if probe.startswith(("Fecha Emision:", "Fecha Emisión:", "Fecha Operacion:", "Fecha Operación:", "Pagina ", "Página ")) or probe in MONEX_SKIP_LINES:
                idx += 1
                continue
            if DATE_SLASH_RX.match(probe) and idx + 1 < len(lines) and DATE_SLASH_RX.match(lines[idx + 1]):
                break
            detail_lines.append(probe)
            idx += 1

        amount = next((_parse_money(item) for item in reversed(detail_lines) if MONEY_ONLY_RX.match(item)), None)
        reference = next(
            (
                item
                for item in detail_lines
                if item not in {"0", "0.000000"}
                and (item.isdigit() or item.startswith("DIVISA"))
            ),
            None,
        )
        debit = abs(amount) if amount is not None and amount < 0 else None
        credit = amount if amount is not None and amount > 0 else None
        description = _normalize_spaces(" ".join(desc_lines))
        raw_text_block = _normalize_spaces(" ".join(desc_lines + detail_lines))
        concept = None
        if detail_lines:
            concept = _normalize_spaces(" ".join(item for item in detail_lines if not MONEY_ONLY_RX.match(item)))

        statement.movements.append(
            _make_movement(
                statement,
                sequence,
                currency=currency,
                movement_date=movement_date,
                settlement_date=settlement_date,
                description=description,
                concept=concept,
                reference=reference,
                debit=debit,
                credit=credit,
                raw_text=raw_text_block,
            )
        )
        sequence += 1

    if not statement.movements:
        statement.warnings.append("No se pudieron estructurar movimientos de Monex.")
    else:
        incomplete = sum(1 for item in statement.movements if item.debit is None and item.credit is None)
        if incomplete:
            statement.warnings.append(f"{incomplete} movimientos de Monex requieren revision manual de importe.")
        currencies = sorted({item.currency for item in statement.movements if item.currency})
        if len(currencies) > 1:
            statement.currency = "MULTI"

    # Derive period from movement dates when regex didn't match
    if statement.movements and not statement.period_start:
        dates = sorted(d for m in statement.movements if (d := m.movement_date))
        if dates:
            statement.period_start = dates[0]
            statement.period_end = dates[-1]

    # Monex: try to find account number from "Cuenta" label
    if not statement.account_number:
        statement.account_number = _find_label_value(lines, ("Cuenta",))

    # Extract opening/closing balance from summary
    if statement.opening_balance is None:
        saldo_ini_match = re.search(r"SALDO\s+INICIAL[:\s]*\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
        if saldo_ini_match:
            statement.opening_balance = _parse_money(saldo_ini_match.group(1))
    if statement.closing_balance is None:
        saldo_fin_match = re.search(r"SALDO\s+FINAL[:\s]*\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
        if saldo_fin_match:
            statement.closing_balance = _parse_money(saldo_fin_match.group(1))

    # Total credits/debits from summary
    if statement.total_credits is None:
        abonos_match = re.search(r"\+?\s*(?:Total\s+)?abonos[:\s]*\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
        if abonos_match:
            statement.total_credits = _parse_money(abonos_match.group(1))
    if statement.total_debits is None:
        cargos_match = re.search(r"-?\s*(?:Total\s+)?cargos[:\s]*\$?\s*([\d,]+\.\d{2})", text, re.IGNORECASE)
        if cargos_match:
            statement.total_debits = _parse_money(cargos_match.group(1))

    return statement


def _parse_santander(text: str, source_file: str, ocr_used: bool) -> TreasuryStatement:
    lines = _clean_lines(text)
    contract_value = _find_label_value(lines, ("Contrato CMC",))
    statement = TreasuryStatement(
        id=_slugify(Path(source_file).stem),
        source_file=source_file,
        bank="Santander",
        ocr_used=ocr_used,
        contract=contract_value,
        account_number=_find_label_value(lines, ("Numero de Cuenta", "Número de Cuenta")),
        account_holder=_normalize_spaces(contract_value.split(" ", 1)[1]) if contract_value and " " in contract_value else None,
        period_start=_parse_date(re.search(r"Periodo:\s*([0-9/]+)", text).group(1)) if re.search(r"Periodo:\s*([0-9/]+)", text) else None,
        period_end=_parse_date(re.search(r"Periodo:\s*[0-9/]+\s+al\s+([0-9/]+)", text).group(1)) if re.search(r"Periodo:\s*[0-9/]+\s+al\s+([0-9/]+)", text) else None,
        opening_balance=_parse_money(re.search(r"Saldo Inicial:\s*\$([0-9,]+\.[0-9]{2})", text).group(1)) if re.search(r"Saldo Inicial:\s*\$([0-9,]+\.[0-9]{2})", text) else None,
        closing_balance=_parse_money(re.search(r"Saldo Final:\s*\$([0-9,]+\.[0-9]{2})", text).group(1)) if re.search(r"Saldo Final:\s*\$([0-9,]+\.[0-9]{2})", text) else None,
        total_credits=_parse_money(re.search(r"Importe Total Abonos:\s*\$([0-9,]+\.[0-9]{2})", text).group(1)) if re.search(r"Importe Total Abonos:\s*\$([0-9,]+\.[0-9]{2})", text) else None,
        total_debits=_parse_money(re.search(r"Importe Total Cargos:\s*\$([0-9,]+\.[0-9]{2})", text).group(1)) if re.search(r"Importe Total Cargos:\s*\$([0-9,]+\.[0-9]{2})", text) else None,
        currency="MXN",
        raw_text=text,
    )

    # CLABE extraction (Santander CLABEs start with 014)
    if not statement.clabe:
        statement.clabe = _find_label_value(lines, ("CUENTA CLABE", "Cuenta CLABE", "CLABE"))
    if not statement.clabe:
        clabe_match = re.search(r"\b(014\d{15})\b", text)
        if clabe_match:
            statement.clabe = clabe_match.group(1)

    # Currency from MONEDA field
    moneda = _find_label_value(lines, ("MONEDA", "Moneda"))
    if moneda:
        moneda_norm = _normalize(moneda)
        if "dolar" in moneda_norm or "usd" in moneda_norm:
            statement.currency = "USD"
        else:
            statement.currency = "MXN"

    # Alternate period format: DEL DD-MMM-YYYY AL DD-MMM-YYYY
    if not statement.period_start:
        period_alt = re.search(r"DEL\s+(\d{2}-[A-Z]{3}-\d{4})\s+AL\s+(\d{2}-[A-Z]{3}-\d{4})", text, re.IGNORECASE)
        if period_alt:
            statement.period_start = _parse_date(period_alt.group(1))
            statement.period_end = _parse_date(period_alt.group(2))

    # Alternate period with natural language
    if not statement.period_start:
        ps, pe = _parse_natural_period(text)
        if ps:
            statement.period_start = ps
            statement.period_end = pe

    # Alternate opening balance
    if statement.opening_balance is None:
        saldo_ant = _find_label_value(lines, ("SALDO FINAL DEL PERIODO ANTERIOR", "Saldo Inicial", "Saldo inicial"))
        if saldo_ant:
            statement.opening_balance = _parse_money(saldo_ant)

    sequence = 1
    idx = 0
    while idx < len(lines):
        if not SANTANDER_ACCOUNT_RX.match(lines[idx]):
            idx += 1
            continue
        if idx + 7 >= len(lines) or not SANTANDER_DATE_PART_RX.match(lines[idx + 1]) or not TIME_RX.match(lines[idx + 3]) or not BRANCH_RX.match(lines[idx + 4]):
            idx += 1
            continue

        movement_date = _parse_santander_date(lines[idx + 1], lines[idx + 2])
        time = lines[idx + 3]
        branch = lines[idx + 4]
        cursor = idx + 5
        desc_lines: list[str] = []
        while cursor < len(lines) and not MONEY_ONLY_RX.match(lines[cursor]):
            if SANTANDER_ACCOUNT_RX.match(lines[cursor]):
                break
            desc_lines.append(lines[cursor])
            cursor += 1

        if cursor + 2 >= len(lines):
            idx = cursor
            continue

        debit = _parse_money(lines[cursor]) or None
        credit = _parse_money(lines[cursor + 1]) or None
        balance = _parse_money(lines[cursor + 2])
        cursor += 3
        reference = lines[cursor] if cursor < len(lines) else None
        cursor += 1
        extra_lines: list[str] = []
        while cursor < len(lines) and not SANTANDER_ACCOUNT_RX.match(lines[cursor]):
            normalized = _normalize(lines[cursor])
            if normalized.startswith("para dudas o aclaraciones") or normalized.startswith("banco santander") or normalized.startswith("enlace http") or normalized.startswith("este documento no es"):
                break
            extra_lines.append(lines[cursor])
            cursor += 1

        concept = extra_lines[0] if extra_lines else None
        long_description = " ".join(extra_lines[1:]) if len(extra_lines) > 1 else None
        statement.movements.append(
            _make_movement(
                statement,
                sequence,
                movement_date=movement_date,
                time=time,
                branch=branch,
                description=" ".join(desc_lines),
                concept=concept,
                long_description=long_description,
                reference=reference,
                debit=debit,
                credit=credit,
                balance=balance,
                raw_text=" | ".join(desc_lines + [reference or ""] + extra_lines),
            )
        )
        sequence += 1
        idx = cursor

    return statement


# ── Public API ────────────────────────────────────────────

def parse_statement(path: Path) -> TreasuryStatement:
    """Parse a single bank statement PDF and return structured data."""
    text, ocr_used = _extract_pdf_text(path)
    bank = _detect_bank(text)
    if bank == "BBVA":
        statement = _parse_bbva(text, path.name, ocr_used)
    elif bank == "Banregio":
        statement = _parse_banregio(text, path.name, ocr_used)
    elif bank == "BanBajio":
        statement = _parse_bajio(text, path.name, ocr_used)
    elif bank == "Monex":
        statement = _parse_monex(text, path.name, ocr_used)
    elif bank == "Santander":
        statement = _parse_santander(text, path.name, ocr_used)
    else:
        statement = TreasuryStatement(
            id=_slugify(path.stem),
            source_file=path.name,
            bank=bank,
            ocr_used=ocr_used,
            raw_text=text,
            warnings=["No se reconocio el banco del PDF."],
        )

    if not statement.movements:
        statement.warnings.append("No se detectaron movimientos estructurados en este archivo.")
    return statement


def parse_statements(paths: list[Path]) -> list[TreasuryStatement]:
    """Parse multiple bank statement PDFs."""
    return [parse_statement(path) for path in paths]


def analysis_payload(statements: list[TreasuryStatement]) -> dict[str, Any]:
    """Build the analysis response payload from parsed statements."""
    flat_movements = [asdict(item) for statement in statements for item in statement.movements]
    banks = sorted({statement.bank for statement in statements})
    accounts = sorted({item["account_number"] for item in flat_movements if item.get("account_number")})

    return {
        "summary": {
            "statements": len(statements),
            "movements": len(flat_movements),
            "banks": banks,
            "accounts": len(accounts),
            "ocr_statements": sum(1 for item in statements if item.ocr_used),
        },
        "columns": [
            "bank", "source_file", "account_number", "account_holder", "currency",
            "movement_date", "settlement_date", "time", "movement_type", "category",
            "description", "concept", "reference", "counterparty", "debit", "credit", "balance",
        ],
        "statements": [asdict(item) for item in statements],
        "movements": flat_movements,
    }


def statement_from_payload(payload: dict[str, Any]) -> TreasuryStatement:
    """Reconstruct a TreasuryStatement from an analysis payload dict."""
    from dataclasses import fields as dc_fields

    movement_values = []
    for raw_movement in payload.get("movements") or []:
        if not isinstance(raw_movement, dict):
            continue
        movement_values.append(
            TreasuryMovement(
                **{
                    field_def.name: raw_movement.get(field_def.name)
                    for field_def in dc_fields(TreasuryMovement)
                    if field_def.name in raw_movement
                }
            )
        )

    statement_values = {
        field_def.name: payload.get(field_def.name)
        for field_def in dc_fields(TreasuryStatement)
        if field_def.name != "movements" and field_def.name in payload
    }
    return TreasuryStatement(**statement_values, movements=movement_values)


def statements_from_analysis_json(analysis_json: str | None) -> list[TreasuryStatement] | None:
    """Parse analysis JSON back into statement objects. Returns None if input is empty."""
    import json

    if not analysis_json or not analysis_json.strip():
        return None

    payload = json.loads(analysis_json)

    if not isinstance(payload, dict) or not isinstance(payload.get("statements"), list):
        return None

    statements = [
        statement_from_payload(item)
        for item in payload["statements"]
        if isinstance(item, dict)
    ]
    return statements if statements else None
