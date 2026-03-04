
"""
Geocoding utilities (Mexico-focused) for CFEDataExtraction.

Fix v24:
- Robust postal code extraction even when PDF text splits digits (e.g. "9 8 5 0 7" or "985 07")
- Remove odd PDF artifacts (e.g. "▒") during normalization
- Prefer postal-code based lookup via pgeocode (stable for batch)
- Backward compatible API: geocode_address(...) -> (lat, lon) | None
- Cache ONLY successful results (never cache failures)
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import requests

try:
    from geopy.geocoders import Nominatim, ArcGIS  # type: ignore
except Exception:  # pragma: no cover
    Nominatim = None
    ArcGIS = None

try:
    import pgeocode  # type: ignore
except Exception:  # pragma: no cover
    pgeocode = None


DEFAULT_USER_AGENT = os.environ.get("CFE_GEOCODE_USER_AGENT", "CFEDataExtraction/1.0 (contact: ops@loros.local)")
DEFAULT_TIMEOUT = float(os.environ.get("CFE_GEOCODE_TIMEOUT", "12"))
DEFAULT_SLEEP_SECONDS = float(os.environ.get("CFE_GEOCODE_SLEEP", "1.1"))  # be polite in batches

# NOTE: CP can appear broken in PDF text (spaces, dots, etc). We extract digits robustly.
CP_PIVOT_RE = re.compile(r"(?:C\s*\.?\s*P\s*\.?|CP)\s*[:\.\-]?\s*(.{0,20})", re.IGNORECASE)
ASCII_DIGIT_RE = re.compile(r"\d")
STATE_HINT_RE = re.compile(r"\b(ZACATECAS|ZAC)\b", re.IGNORECASE)


@dataclass
class _JsonCache:
    path: str
    data: Dict[str, Any]

    @classmethod
    def load(cls, path: str) -> "_JsonCache":
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return cls(path=path, data=json.load(f) or {})
            except Exception:
                # corrupt cache -> ignore
                return cls(path=path, data={})
        return cls(path=path, data={})

    def get(self, key: str) -> Any:
        return self.data.get(key)

    def set_success(self, key: str, value: Any) -> None:
        # never store None / failures
        if value is None:
            return
        self.data[key] = value
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass


def _normalize_text(s: str) -> str:
    # Drop common PDF replacement artifacts and control chars
    s = s.replace("\uFFFD", " ").replace("▒", " ").replace("\x00", " ")
    s = re.sub(r"[\r\n\t]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _strip_accents(s: str) -> str:
    # Minimal, no extra deps.
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _extract_postal_code(text: str) -> Optional[str]:
    """
    Extract a 5-digit Mexico postal code even if digits are separated.
    Strategy:
      1) Prefer digits right after CP/C.P pivot.
      2) Else: find any 5 consecutive digits in the whole text.
      3) Else: if digits are separated, collect digit tokens and search for 5-digit windows.
    """
    if not text:
        return None

    t = _normalize_text(text)
    t = _strip_accents(t)

    # (1) Pivot after "C.P." / "CP"
    m = CP_PIVOT_RE.search(t)
    if m:
        chunk = m.group(1)
        digits = "".join(ASCII_DIGIT_RE.findall(chunk))
        if len(digits) >= 5:
            return digits[:5]

    # (2) Plain 5 consecutive digits anywhere
    m2 = re.search(r"\b(\d{5})\b", t)
    if m2:
        return m2.group(1)

    # (3) Digits may be split "9 8 5 0 7" or "985 07"
    # Pull all digit runs, then also single-digit tokens, and scan windows.
    digit_tokens = re.findall(r"\d+", t)
    # If tokens already include 5-digit, take it
    for tok in digit_tokens:
        if len(tok) == 5:
            return tok
    # Join small tokens but keep order, then slide window of 5 digits.
    # Build a digit stream preserving order (only digits).
    stream = "".join(ASCII_DIGIT_RE.findall(t))
    # Find any 5-digit substring in the stream (take first that looks like MX CP: 01000-99999)
    for i in range(0, max(0, len(stream) - 4)):
        cand = stream[i:i+5]
        if cand.isdigit():
            return cand
    return None


def clean_address_for_geocode(raw: str) -> str:
    """
    Convert messy receipt address line into a more geocode-friendly query.
    Keep locality + state + CP if found.
    """
    if not raw:
        return ""

    s = _normalize_text(raw)
    s = _strip_accents(s).upper()

    cp = _extract_postal_code(s)

    # Heuristics: find likely municipality/city and state hints if present.
    # If the text already contains a state abbreviation like ZAC, keep it.
    state = None
    if STATE_HINT_RE.search(s):
        state = "Zacatecas"

    # Look for a token like "CALERA" (common in your failing case).
    city = None
    if " CALERA" in f" {s} ":
        city = "Calera"

    parts = []
    if city:
        parts.append(city)
    if state:
        parts.append(state)
    if cp:
        parts.append(cp)
    parts.append("Mexico")

    # If we found nothing, fallback to trimmed original
    if parts == ["Mexico"]:
        return raw.strip()
    return ", ".join(parts)


def _pgeocode_lookup(cp: str) -> Optional[Tuple[float, float]]:
    if not cp or pgeocode is None:
        return None
    try:
        nomi = pgeocode.Nominatim("mx")
        res = nomi.query_postal_code(cp)
        lat = getattr(res, "latitude", None)
        lon = getattr(res, "longitude", None)
        if lat is None or lon is None:
            # sometimes it's a pandas series
            try:
                lat = res["latitude"]
                lon = res["longitude"]
            except Exception:
                return None
        if lat is None or lon is None:
            return None
        # NaN check
        try:
            if float(lat) != float(lat) or float(lon) != float(lon):
                return None
        except Exception:
            pass
        return (float(lat), float(lon))
    except Exception:
        return None


def _nominatim_postal_only(cp: str, country: str = "Mexico") -> Optional[Tuple[float, float]]:
    """Direct HTTP Nominatim call (postal-only) for stability."""
    try:
        url = "https://nominatim.openstreetmap.org/search"
        params = {"postalcode": cp, "country": country, "format": "json", "limit": 1}
        headers = {"User-Agent": DEFAULT_USER_AGENT}
        r = requests.get(url, params=params, headers=headers, timeout=DEFAULT_TIMEOUT)
        r.raise_for_status()
        arr = r.json()
        if not arr:
            return None
        lat = float(arr[0]["lat"])
        lon = float(arr[0]["lon"])
        return (lat, lon)
    except Exception:
        return None


def geocode_address(query: str, cache: bool = True) -> Optional[Tuple[float, float]]:
    """
    Main entry point used by the pipeline.
    Returns (lat, lon) or None.
    """
    if not query:
        return None

    query_norm = _normalize_text(query)
    cache_path = os.path.join(os.path.dirname(__file__), "geocode_cache.json")
    c = _JsonCache.load(cache_path) if cache else _JsonCache(path=cache_path, data={})

    key = query_norm.lower().strip()
    if cache:
        hit = c.get(key)
        if isinstance(hit, list) and len(hit) == 2:
            return (float(hit[0]), float(hit[1]))

    # Always try postal code first (most stable)
    cp = _extract_postal_code(query_norm)
    if cp:
        ll = _pgeocode_lookup(cp) or _nominatim_postal_only(cp)
        if ll:
            if cache:
                c.set_success(key, [ll[0], ll[1]])
            return ll

    # Try cleaned query which may include CP
    cleaned = clean_address_for_geocode(query_norm)
    cp2 = _extract_postal_code(cleaned)
    if cp2:
        ll = _pgeocode_lookup(cp2) or _nominatim_postal_only(cp2)
        if ll:
            if cache:
                c.set_success(key, [ll[0], ll[1]])
            return ll

    # Online geocoders as last resort
    time.sleep(DEFAULT_SLEEP_SECONDS)

    # Nominatim via geopy
    if Nominatim is not None:
        try:
            geoloc = Nominatim(user_agent=DEFAULT_USER_AGENT, timeout=DEFAULT_TIMEOUT)
            loc = geoloc.geocode(cleaned, addressdetails=False)
            if loc:
                ll = (float(loc.latitude), float(loc.longitude))
                if cache:
                    c.set_success(key, [ll[0], ll[1]])
                return ll
        except Exception:
            pass

    # ArcGIS fallback
    if ArcGIS is not None:
        try:
            geoloc = ArcGIS(timeout=DEFAULT_TIMEOUT)
            loc = geoloc.geocode(cleaned)
            if loc:
                ll = (float(loc.latitude), float(loc.longitude))
                if cache:
                    c.set_success(key, [ll[0], ll[1]])
                return ll
        except Exception:
            pass

    return None


def infer_cfe_system_from_text(location_text: str) -> Optional[str]:
    """
    Best-effort inference of system/region.
    Keep this function if other modules import it.
    """
    if not location_text:
        return None
    t = _strip_accents(_normalize_text(location_text)).upper()
    if "CIUDAD DE MEXICO" in t or "CDMX" in t:
        return "Valle de Mexico"
    if "ZACATECAS" in t or " ZAC" in t:
        return "Centro-Occidente"
    return None
