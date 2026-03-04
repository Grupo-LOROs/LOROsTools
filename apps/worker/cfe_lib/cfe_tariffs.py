# -*- coding: utf-8 -*-
"""
cfe_tariffs.py

Robust scraper/parser for CFE "Tarifa GDMTH" (Gran Demanda en Media Tensión Horaria)
used by CFEDataExtraction.

Key issue fixed in v16:
- The CFE page sometimes renders a "big table" where pandas.read_html returns integer
  columns (0..N) and the real header row is embedded inside the table (e.g. a row
  containing: Tarifa | Descripción | Int. Horario | Cargo | Unidades | JUL-25).
  Older parsers fail to find rows/columns and return nothing.
- This version detects that header row and re-headers the DataFrame, then extracts:
    cargo_fijo ($/mes), energia_base ($/kWh), energia_intermedia ($/kWh),
    energia_punta ($/kWh), distribucion ($/kW), capacidad ($/kW)

Public API used by the app:
- get_tariffs_for_period_start(period_start: date, location_text: str, cache: TariffCache|None = None) -> dict

Optional env vars:
- CFE_TARIFFS_DEBUG=1  (dumps HTML/tables to cache_cfe_html/)
"""

from __future__ import annotations

import os
import re
import json
import time
import random
from dataclasses import dataclass
from datetime import date
from typing import Dict, Optional, List, Tuple

import requests
import pandas as pd
from bs4 import BeautifulSoup
from io import StringIO
from .logging_setup import logger

DEFAULT_URL = "https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCRENegocio/Tarifas/GranDemandaMTH.aspx"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/123.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
    "Connection": "keep-alive",
}

DEBUG = os.environ.get("CFE_TARIFFS_DEBUG", "").strip() == "1"
DEBUG_DIR = "cache_cfe_html"

# -------------------------
# Utilities
# -------------------------

def _norm(s: str) -> str:
    s = ("" if s is None else str(s)).strip().lower()
    s = s.replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s)
    # remove accents
    s = (s.replace("á","a").replace("é","e").replace("í","i")
           .replace("ó","o").replace("ú","u").replace("ñ","n"))
    return s.strip()

def _to_float(x) -> Optional[float]:
    if x is None:
        return None
    s = str(x).strip()
    if not s or s.lower() in {"nan", "none"}:
        return None
    s = s.replace("\xa0", " ").strip()
    # remove currency symbols and thousands separators
    s = re.sub(r"[^0-9,.\-]", "", s)
    # Heuristic: if both comma and dot exist, assume comma is thousands separator.
    if "," in s and "." in s:
        s = s.replace(",", "")
    else:
        # if only comma exists, treat comma as decimal separator
        if "," in s and "." not in s:
            s = s.replace(",", ".")
    try:
        return float(s)
    except Exception:
        return None

def _ensure_debug_dir():
    if DEBUG and not os.path.isdir(DEBUG_DIR):
        os.makedirs(DEBUG_DIR, exist_ok=True)

def _dump_text(fname: str, text: str):
    if not DEBUG:
        return
    _ensure_debug_dir()
    path = os.path.join(DEBUG_DIR, fname)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)

# -------------------------
# Cache
# -------------------------

@dataclass
class TariffCache:
    """Simple JSON cache keyed by (year, month, region_key)."""
    path: str = "cache_tariffs.json"
    _data: Optional[dict] = None

    def _load(self):
        if self._data is not None:
            return
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    self._data = json.load(f)
            except Exception:
                self._data = {}
        else:
            self._data = {}

    def get(self, key: str) -> Optional[dict]:
        self._load()
        return self._data.get(key)

    def set(self, key: str, value: dict):
        self._load()
        self._data[key] = value
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

# -------------------------
# HTTP helpers
# -------------------------

def _http_with_retries(session: requests.Session, method: str, url: str, *, data=None, params=None) -> requests.Response:
    max_retries = 6
    backoff = 1.0
    last = None
    for attempt in range(1, max_retries + 1):
        try:
            if method.lower() == "get":
                r = session.get(url, headers=HEADERS, timeout=45, params=params)
            else:
                r = session.post(url, headers=HEADERS, timeout=45, data=data)
            if r.status_code >= 500:
                raise requests.HTTPError(f"{r.status_code} Server Error")
            r.raise_for_status()
            return r
        except Exception as ex:
            last = ex
            if attempt == max_retries:
                raise
            sleep = backoff * (2 ** (attempt - 1)) + random.random() * 0.35
            time.sleep(min(sleep, 20.0))
    raise RuntimeError(str(last))

def _parse_html(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")

def _parse_form_state(doc: BeautifulSoup) -> Dict[str, str]:
    def get_val(name: str) -> str:
        el = doc.find("input", {"name": name})
        return "" if el is None else el.get("value", "")
    return {
        "__VIEWSTATE": get_val("__VIEWSTATE"),
        "__VIEWSTATEGENERATOR": get_val("__VIEWSTATEGENERATOR"),
        "__EVENTVALIDATION": get_val("__EVENTVALIDATION"),
    }

def _find_select(doc: BeautifulSoup, id_regex: str) -> Optional[BeautifulSoup]:
    # search select by id regex (case-insensitive)
    for sel in doc.find_all("select"):
        sid = sel.get("id") or ""
        if re.search(id_regex, sid, flags=re.I):
            return sel
    return None

def _pick_option_value(select_el: BeautifulSoup, desired_label: str) -> Optional[str]:
    want = _norm(desired_label)
    options = select_el.find_all("option")
    # exact match
    for o in options:
        lab = _norm(o.get_text(" ", strip=True))
        if lab == want:
            return o.get("value")
    # contains match
    for o in options:
        lab = _norm(o.get_text(" ", strip=True))
        if want and want in lab:
            return o.get("value")
    # fallback: first non-zero / non-empty
    for o in options:
        val = (o.get("value") or "").strip()
        if val and val != "0":
            return val
    return None

def _postback(session: requests.Session, url: str, doc: BeautifulSoup, eventtarget: str, updates: Dict[str, str]) -> BeautifulSoup:
    data = _parse_form_state(doc)
    data.update(updates)
    data["__EVENTTARGET"] = eventtarget
    data["__EVENTARGUMENT"] = ""
    # ASP.NET often needs all inputs; keep it minimal but include dropdown values
    r = _http_with_retries(session, "post", url, data=data)
    return _parse_html(r.text)

def _infer_region_from_location_text(location_text: str) -> Tuple[str, str]:
    """
    Best-effort: returns (estado_label, municipio_label).
    Input examples:
      "CUAUHTEMOC, CIUDAD DE MEXICO"
      "Calera, Zacatecas"
    """
    txt = (location_text or "").strip()
    parts = [p.strip() for p in re.split(r"[,\n]", txt) if p.strip()]
    if len(parts) >= 2:
        municipio = parts[0]
        estado = parts[1]
    elif len(parts) == 1:
        municipio = parts[0]
        estado = parts[0]
    else:
        municipio, estado = "", ""
    # normalize some common variants
    if _norm(estado) in {"cdmx", "ciudad de mexico", "ciudad de méxico", "distrito federal", "df"}:
        estado = "Ciudad de México"
    return estado, municipio

# -------------------------
# Table parsing (the critical part)
# -------------------------

def _rehdr_if_embedded_header(df: pd.DataFrame, month: Optional[int] = None, year: Optional[int] = None) -> pd.DataFrame:
    """
    The CFE ASP.NET page often returns a single large table where the *real* header row
    appears inside the table body (pandas gives columns like 0..N).

    Old logic re-headed on the first row that merely *mentions* "Cargo" and "Unidades",
    which can match the "Identifica tu región tarifaria" row and break parsing.

    This version scores candidate rows and chooses the best header row, requiring:
      - at least 4 non-empty cells
      - multiple header tokens present as distinct cells (Tarifa, Descripción, Cargo, Unidades, Horario)
      - (optional) a month label like JUL-25

    Works for both numeric columns (0..N) and stringified numeric columns ("0","1",...).
    """
    if df is None or df.empty:
        return df

    def _is_generic_col(c: Any) -> bool:
        if isinstance(c, (int, float)):
            return True
        cs = str(c).strip().lower()
        return cs.isdigit() or cs.startswith("unnamed") or cs in ("nan", "")

    # If it already has meaningful column names, keep.
    if not all(_is_generic_col(c) for c in df.columns):
        return df

    month_map_es = {1:"ene",2:"feb",3:"mar",4:"abr",5:"may",6:"jun",7:"jul",8:"ago",9:"sep",10:"oct",11:"nov",12:"dic"}
    month_map_en = {1:"jan",2:"feb",3:"mar",4:"apr",5:"may",6:"jun",7:"jul",8:"aug",9:"sep",10:"oct",11:"nov",12:"dec"}
    m_es = month_map_es.get(int(month or 0), "")
    m_en = month_map_en.get(int(month or 0), "")
    y2 = str(year)[-2:] if year else ""
    y4 = str(year) if year else ""

    def score_row(cells: List[str]) -> int:
        nonempty = [c for c in cells if c and c != "nan"]
        if len(nonempty) < 4:
            return 0

        hits = set()
        for c in nonempty:
            if c in ("tarifa",):
                hits.add("tarifa")
            if c in ("descripcion", "descripción"):
                hits.add("descripcion")
            if c in ("cargo",):
                hits.add("cargo")
            if c in ("unidades", "unidad"):
                hits.add("unidades")
            if "horario" in c and ("int" in c or "interv" in c or "." in c):
                hits.add("horario")

        score = len(hits)

        # Bonus if month label appears as a distinct cell
        if m_es or m_en:
            for c in nonempty:
                if (((m_es and m_es in c) or (m_en and m_en in c)) and (y2 in c or y4 in c)):
                    score += 1
                    break

        # Penalize "concatenated header" cells (e.g. '...TarifaDescripciónInt. HorarioCargoUnidades...')
        for c in nonempty:
            if len(c) > 60 and ("tarifa" in c and "cargo" in c and "unidades" in c):
                score -= 1
                break

        return score

    best_idx: Optional[int] = None
    best_score: int = 0

    max_rows = min(len(df), 120)
    for idx in range(max_rows):
        cells = [_norm(x) for x in df.iloc[idx].astype(str).tolist()]
        sc = score_row(cells)
        if sc > best_score:
            best_score = sc
            best_idx = idx

    # Require a decent score; otherwise don't touch
    if best_idx is None or best_score < 3:
        return df

    new_cols = [str(x).strip() for x in df.iloc[best_idx].tolist()]
    out = df.iloc[best_idx + 1:].copy()
    out.columns = new_cols
    out = out.reset_index(drop=True)
    return out

def _flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        df = df.copy()
        df.columns = [" ".join([str(x) for x in tup if str(x) != "nan"]).strip() for tup in df.columns]
    return df

def _find_value_column(df: pd.DataFrame, month: int, year: int) -> Optional[str]:
    """
    Find the column containing the month-year numeric tariffs.
    Often appears like 'JUL-25' or 'JUL-2025', or the last column.
    """
    if df is None or df.empty:
        return None
    cols = [str(c) for c in df.columns]
    # try match month name abbreviations
    month_map = {1:"ene",2:"feb",3:"mar",4:"abr",5:"may",6:"jun",7:"jul",8:"ago",9:"sep",10:"oct",11:"nov",12:"dic"}
    m = month_map.get(int(month), "")
    y2 = str(year)[-2:]
    y4 = str(year)
    # pick first column that contains month abbrev and year
    for c in cols:
        cn = _norm(c)
        if m and m in cn and (y2 in cn or y4 in cn):
            return c
    # otherwise prefer the last column that is not a known descriptor
    bad = {"tarifa","descripcion","descripción","int. horario","int horario","cargo","unidades"}
    for c in reversed(cols):
        if _norm(c) not in {_norm(b) for b in bad}:
            return c
    return cols[-1] if cols else None

def _extract_from_df(df: pd.DataFrame, month: int, year: int) -> Dict[str, float]:
    """
    Extract tariff fields from a standardized DF with columns like:
      Tarifa | Descripción | Int. Horario | Cargo | Unidades | JUL-25
    """
    out: Dict[str, float] = {}
    if df is None or df.empty:
        return out

    # normalize columns (case-insensitive)
    cols_norm = {_norm(c): c for c in df.columns}
    cargo_col = cols_norm.get("cargo")
    unidad_col = cols_norm.get("unidades")
    horario_col = None
    for key in ["int. horario", "int horario", "int. horario "]:
        if _norm(key) in cols_norm:
            horario_col = cols_norm[_norm(key)]
            break
    if horario_col is None:
        # sometimes column is 'Int. Horario' without dot
        for cn, orig in cols_norm.items():
            if "horario" in cn:
                horario_col = orig
                break

    value_col = _find_value_column(df, month, year)
    if cargo_col is None or value_col is None:
        return out

    # Iterate rows
    for _, row in df.iterrows():
        cargo = _norm(row.get(cargo_col, ""))
        unidad = _norm(row.get(unidad_col, "")) if unidad_col else ""
        horario = _norm(row.get(horario_col, "")) if horario_col else ""
        val = _to_float(row.get(value_col))
        if val is None:
            continue

        # Fixed charge
        if cargo == "fijo" or ("fijo" in cargo and ("mes" in unidad or "/mes" in unidad)):
            out["cargo_fijo"] = val
            continue

        # Energy variable charges by time band
        if ("energia" in cargo) or ("variable" in cargo):
            if "base" in horario:
                out["energia_base"] = val
            elif "intermedia" in horario:
                out["energia_intermedia"] = val
            elif "punta" in horario:
                out["energia_punta"] = val
            continue

        # Distribution / Capacity
        if "distribu" in cargo:
            out["distribucion"] = val
            continue
        if "capacid" in cargo:
            out["capacidad"] = val
            continue

    return out

def _extract_tariffs_from_html(html: str, *, month: int, year: int) -> Dict[str, float]:
    """Parse GDMTH tariffs from the HTML response.

    The CFE page often returns several tables (headers, selectors, etc.). We:
      1) Parse all tables with pandas
      2) Keep only tables that *look like* the tariff table (Tarifa/Cargo/Unidades present)
      3) Re-header the embedded header row safely
      4) Extract expected rows (fijo, energía base/intermedia/punta, distribución, capacidad)

    Returns an empty dict if nothing could be extracted.
    """
    if not html:
        return {}

    try:
        dfs = pd.read_html(StringIO(html))
    except Exception:
        # Sometimes the HTML is incomplete/blocked. Caller handles empty dict.
        return {}

    best: Dict[str, float] = {}
    essential = {"energia_base", "energia_intermedia", "energia_punta"}

    for df in dfs:
        try:
            df = _flatten_columns(df)
            blob = " ".join(_norm(x) for x in df.astype(str).values.flatten()[:1200])
            if not ("tarifa" in blob and "cargo" in blob and ("unidades" in blob or "unidad" in blob)):
                continue

            df = _rehdr_if_embedded_header(df, month=month, year=year)
            got = _extract_from_df(df, month=month, year=year)
            if not got:
                continue

            best = got
            if essential.issubset(set(got.keys())):
                return got
        except Exception:
            continue

    return best



def _fetch_tariff_html_for_region(year: int, month: int, estado_label: str, municipio_label: str, url: str = DEFAULT_URL) -> str:
    """
    Uses ASP.NET postbacks to select:
      Año -> Mes -> Estado -> Municipio -> División (best-effort)
    and returns final HTML.
    """
    sess = requests.Session()

    # small throttle to avoid being blocked when running many months
    time.sleep(0.4 + random.random()*0.4)

    r = _http_with_retries(sess, "get", url)
    doc = _parse_html(r.text)

    # Find dropdowns by id pattern (the site changes ids; use suffixes)
    # Typical ids: ctl00$MainContent$ddAnio, ddMes, ddEstado, ddMunicipio, ddDivision
    def pick_select_id(regex: str) -> Optional[str]:
        sel = _find_select(doc, regex)
        return None if sel is None else sel.get("name") or sel.get("id")

    # We'll search again after each postback because the DOM updates.
    # Year
    sel = _find_select(doc, r"ddAnio|ddlAnio|Anio")
    if sel:
        sid = sel.get("name") or sel.get("id")
        val = _pick_option_value(sel, str(year))
        if sid and val:
            doc = _postback(sess, url, doc, sid, {sid: val})

    # Month
    sel = _find_select(doc, r"ddMes|ddlMes|Mes")
    if sel:
        sid = sel.get("name") or sel.get("id")
        val = _pick_option_value(sel, str(month))
        if sid and val:
            doc = _postback(sess, url, doc, sid, {sid: val})

    # State
    sel = _find_select(doc, r"ddEstado|ddlEstado|Estado")
    if sel:
        sid = sel.get("name") or sel.get("id")
        val = _pick_option_value(sel, estado_label)
        if sid and val:
            doc = _postback(sess, url, doc, sid, {sid: val})

    # Municipality
    sel = _find_select(doc, r"ddMunicipio|ddlMunicipio|Municipio")
    if sel:
        sid = sel.get("name") or sel.get("id")
        val = _pick_option_value(sel, municipio_label)
        if sid and val:
            doc = _postback(sess, url, doc, sid, {sid: val})

    # Division (optional, pick first non-empty)
    sel = _find_select(doc, r"ddDivision|ddlDivision|Division")
    if sel:
        sid = sel.get("name") or sel.get("id")
        val = _pick_option_value(sel, "")  # first non-empty
        if sid and val:
            doc = _postback(sess, url, doc, sid, {sid: val})

    return str(doc)

# -------------------------
# Main client
# -------------------------

class TariffClient:
    def __init__(self, url: str = DEFAULT_URL):
        self.url = url

    def get_tariffs(self, year: int, month: int, *, location_text: str, cache: Optional[TariffCache] = None) -> Dict[str, float]:
        estado, municipio = _infer_region_from_location_text(location_text)
        region_key = f"{_norm(estado)}|{_norm(municipio)}"
        cache_key = f"gdmth|{year}-{month:02d}|{region_key}"
        if cache:
            cached = cache.get(cache_key)
            if isinstance(cached, dict) and cached.get("_ok"):
                return {k: v for k, v in cached.items() if not k.startswith("_")}

        html = _fetch_tariff_html_for_region(year, month, estado, municipio, url=self.url)
        if DEBUG:
            _dump_text(f"gdmth_{year}-{month:02d}_{region_key}.html", html)

        tariffs = _extract_tariffs_from_html(html, month=month, year=year)

        # Do not hard-fail if missing some fields; return partial and let caller fill what exists.
        if cache:
            cache.set(cache_key, {"_ok": True, **tariffs})

        # If completely empty, raise (to surface real errors)
        if not tariffs:
            raise RuntimeError("Se encontraron tabla(s) pero no se pudieron extraer campos de tarifa (parser no encontró encabezados/filas esperadas).")

        return tariffs

def get_tariffs_for_period_start(period_start: date, location_text: str, cache: Optional[TariffCache] = None) -> Dict[str, float]:
    """
    Convenience wrapper expected by the app. Uses period_start's year & month.
    """
    if not isinstance(period_start, date):
        raise TypeError("period_start must be datetime.date")
    client = TariffClient()
    return client.get_tariffs(period_start.year, period_start.month, location_text=location_text, cache=cache)

# wrapper in some helper module or inside cfe_tariffs.py
def get_tariffs_with_cache(period_start: date, location_text: str, cache: TariffCache=None):
    cache = cache or TariffCache()
    region = _norm(location_text or "unknown")
    key = f"{period_start.year}-{period_start.month:02d}-{region}"
    cached = cache.get(key)
    if cached:
        return cached
    try:
        tariffs = get_tariffs_for_period_start(period_start, location_text=location_text, cache=None)
        cache.set(key, tariffs)
        return tariffs
    except Exception as e:
        # intentar fallback de cache sin bloquear (si hay)
        cached_any = cache.get(key)
        if cached_any:
            logger.warning("cfe_using_stale_cache", extra={"extra":{"key":key}})
            return cached_any
        # si viene response con .text (requests), guardar
        raw = getattr(e, "response", None)
        if raw is not None and getattr(raw, "text", None):
            fname = f"cache_cfe_html/error_{period_start.year}_{period_start.month:02d}_{region}.html"
            os.makedirs(os.path.dirname(fname), exist_ok=True)
            with open(fname,"w",encoding="utf-8") as f:
                f.write(raw.text)
            logger.error("cfe_error_saved_html", extra={"extra":{"pdf":"-", "row":"-", "file":fname, "err":str(e)}})
        raise
