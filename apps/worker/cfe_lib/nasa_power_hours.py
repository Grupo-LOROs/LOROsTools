"""
NASA POWER integration to compute:
- total hours Base/Intermedia/Punta over a billing period
- solar hours (Base/Intermedia) over the same period
- HSP (NASA) = average daily kWh/m²/day over the period

This module is designed to be called from the CFE receipt -> Excel pipeline.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, date, timedelta, timezone
from typing import Callable, Dict, List, Optional

import pandas as pd
import requests
from dateutil import parser as dtparser
from dateutil.tz import gettz

try:
    from timezonefinder import TimezoneFinder
except Exception:  # pragma: no cover
    TimezoneFinder = None

NASA_POWER_HOURLY_ENDPOINT = "https://power.larc.nasa.gov/api/temporal/hourly/point"
NASA_POWER_DAILY_ENDPOINT = "https://power.larc.nasa.gov/api/temporal/daily/point"


@dataclass(frozen=True)
class SolarAndHoursResult:
    total_base_hours: float
    total_intermedia_hours: float
    total_punta_hours: float
    solar_base_hours: float
    solar_intermedia_hours: float
    hsp_nasa: float  # kWh/m²/day averaged over days in the period


def _ensure_dt(x) -> datetime:
    if isinstance(x, datetime):
        return x
    if isinstance(x, date):
        return datetime(x.year, x.month, x.day)
    if isinstance(x, str):
        return dtparser.parse(x)
    raise TypeError(f"Unsupported date type: {type(x)}")


def _date_yyyymmdd(d: date) -> str:
    return f"{d.year:04d}{d.month:02d}{d.day:02d}"


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    # handle "1,234.56" and "1.234,56"
    s = s.replace(" ", "")
    if s.count(",") > 0 and s.count(".") > 0:
        # assume comma is thousand separator
        s = s.replace(",", "")
    else:
        # if only comma, treat comma as decimal separator
        if s.count(",") == 1 and s.count(".") == 0:
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    try:
        return float(s)
    except Exception:
        return None


def _get_timezone_name(lat: float, lon: float) -> str:
    if TimezoneFinder is None:
        return "America/Mexico_City"
    tf = TimezoneFinder()
    tzname = tf.timezone_at(lat=lat, lng=lon)
    return tzname or "America/Mexico_City"


def fetch_hourly_irradiance(
    lat: float,
    lon: float,
    start_date: date,
    end_date: date,
    cache_dir: str = "cache_nasa_power",
    timeout: int = 30,
) -> pd.DataFrame:
    """
    Returns a DataFrame with columns:
      - dt_utc (datetime, tz-aware UTC)
      - irradiance_wm2 (float)
    NASA POWER hourly point API returns values for ALLSKY_SFC_SW_DWN (W/m^2).
    """
    os.makedirs(cache_dir, exist_ok=True)
    key = f"hourly_{lat:.4f}_{lon:.4f}_{_date_yyyymmdd(start_date)}_{_date_yyyymmdd(end_date)}.json"
    cache_path = os.path.join(cache_dir, key)

    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    else:
        params = {
            "parameters": "ALLSKY_SFC_SW_DWN",
            "community": "RE",
            "longitude": lon,
            "latitude": lat,
            "start": _date_yyyymmdd(start_date),
            "end": _date_yyyymmdd(end_date),
            "format": "JSON",
        }
        r = requests.get(NASA_POWER_HOURLY_ENDPOINT, params=params, timeout=timeout)
        r.raise_for_status()
        payload = r.json()
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(payload, f)

    props = payload.get("properties", {})
    param = props.get("parameter", {})
    series = param.get("ALLSKY_SFC_SW_DWN", {})

    rows = []
    for k, v in series.items():
        # key format: YYYYMMDDHH
        if not (isinstance(k, str) and len(k) == 10 and k.isdigit()):
            continue
        y = int(k[0:4])
        m = int(k[4:6])
        d = int(k[6:8])
        hh = int(k[8:10])
        dt_utc = datetime(y, m, d, hh, tzinfo=timezone.utc)
        irr = _safe_float(v)
        if irr is None:
            continue
        # NASA uses -999 for missing sometimes
        if irr <= -900:
            continue
        rows.append((dt_utc, irr))

    df = pd.DataFrame(rows, columns=["dt_utc", "irradiance_wm2"]).sort_values("dt_utc")
    return df


def fetch_daily_hsp(
    lat: float,
    lon: float,
    start_date: date,
    end_date: date,
    cache_dir: str = "cache_nasa_power",
    timeout: int = 30,
) -> Optional[float]:
    """
    Consulta el endpoint DIARIO de NASA POWER para ALLSKY_SFC_SW_DWN y retorna el
    HSP PROMEDIO del periodo (kWh/m²/día), o None si no hay datos.

    Nota: En NASA POWER, ALLSKY_SFC_SW_DWN diario se reporta típicamente en kWh/m²/día.
    """
    os.makedirs(cache_dir, exist_ok=True)
    key = f"daily_{lat:.4f}_{lon:.4f}_{_date_yyyymmdd(start_date)}_{_date_yyyymmdd(end_date)}.json"
    cache_path = os.path.join(cache_dir, key)

    payload = None
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except Exception:
            payload = None

    if payload is None:
        params = {
            "parameters": "ALLSKY_SFC_SW_DWN",
            "community": "RE",
            "longitude": float(lon),
            "latitude": float(lat),
            "start": _date_yyyymmdd(start_date),
            "end": _date_yyyymmdd(end_date),
            "format": "JSON",
        }
        try:
            r = requests.get(NASA_POWER_DAILY_ENDPOINT, params=params, timeout=timeout)
            r.raise_for_status()
            payload = r.json()
            try:
                with open(cache_path, "w", encoding="utf-8") as fh:
                    json.dump(payload, fh)
            except Exception:
                pass
        except Exception:
            return None

    props = payload.get("properties", {})
    param = props.get("parameter", {})
    series = param.get("ALLSKY_SFC_SW_DWN", {})

    values: List[float] = []
    for _, v in series.items():
        fv = _safe_float(v)
        if fv is None:
            continue
        if fv <= -900:  # missing sentinel
            continue
        values.append(float(fv))

    if not values:
        return None
    return sum(values) / len(values)


def _overlap_hours(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> float:
    s = max(a_start, b_start)
    e = min(a_end, b_end)
    if e <= s:
        return 0.0
    return (e - s).total_seconds() / 3600.0


def _segment_start_end_for_date(seg: Dict[str, str], current_date: date, tz) -> Optional[tuple[datetime, datetime, str]]:
    cat = (seg.get("category") or "").strip().lower()
    if cat not in ("base", "intermedia", "punta"):
        return None

    try:
        sh, sm = [int(x) for x in seg["start"].split(":")]
        eh, em = [int(x) for x in seg["end"].split(":")]
    except Exception:
        return None

    # Python datetime() does not allow hour=24; interpret 24:00 as next day's 00:00
    if sh == 24 and sm == 0:
        seg_start = datetime(current_date.year, current_date.month, current_date.day, 0, 0, tzinfo=tz) + timedelta(days=1)
    else:
        seg_start = datetime(current_date.year, current_date.month, current_date.day, sh, sm, tzinfo=tz)

    if eh == 24 and em == 0:
        seg_end = datetime(current_date.year, current_date.month, current_date.day, 0, 0, tzinfo=tz) + timedelta(days=1)
    else:
        seg_end = datetime(current_date.year, current_date.month, current_date.day, eh, em, tzinfo=tz)

    if seg_end <= seg_start:
        # crosses midnight
        seg_end += timedelta(days=1)

    return seg_start, seg_end, cat


def compute_period_hours_and_solar_hours(
    period_start: datetime | str,
    period_end: datetime | str,
    lat: float,
    lon: float,
    schedule_for_local_date: Callable[[date], List[Dict[str, str]]],
    irradiance_threshold_wm2: float = 20.0,
    cache_dir: str = "cache_nasa_power",
) -> SolarAndHoursResult:
    """
    schedule_for_local_date(local_date) -> list of dicts with:
        {"start":"HH:MM", "end":"HH:MM", "category":"base|intermedia|punta"}

    Period is treated in LOCAL time for both schedule and overlap.
    Solar hours are counted where irradiance > threshold (W/m²) using NASA hourly data.
    HSP is computed from hourly irradiance as kWh/m²/day averaged over the days in the period.
    """
    ps = _ensure_dt(period_start)
    pe = _ensure_dt(period_end)
    if pe <= ps:
        raise ValueError("period_end must be after period_start")

    tzname = _get_timezone_name(lat, lon)
    tz = gettz(tzname) or gettz("America/Mexico_City")

    ps_local = ps.astimezone(tz) if ps.tzinfo else ps.replace(tzinfo=tz)
    pe_local = pe.astimezone(tz) if pe.tzinfo else pe.replace(tzinfo=tz)

    start_day_local = ps_local.date()
    end_day_local = pe_local.date()

    # Fetch NASA hourly for full local-day coverage (converted to UTC dates)
    fetch_start_local = datetime(start_day_local.year, start_day_local.month, start_day_local.day, tzinfo=tz)
    fetch_end_local = datetime(end_day_local.year, end_day_local.month, end_day_local.day, 23, tzinfo=tz)
    fetch_start_utc = fetch_start_local.astimezone(timezone.utc).date()
    fetch_end_utc = fetch_end_local.astimezone(timezone.utc).date()

    irr_df = fetch_hourly_irradiance(lat, lon, fetch_start_utc, fetch_end_utc, cache_dir=cache_dir)
    if not irr_df.empty:
        irr_df["dt_local"] = irr_df["dt_utc"].dt.tz_convert(tz)
        irr_df["is_solar"] = irr_df["irradiance_wm2"] > irradiance_threshold_wm2
    else:
        irr_df = pd.DataFrame(columns=["dt_utc", "irradiance_wm2", "dt_local", "is_solar"])

    totals = {"base": 0.0, "intermedia": 0.0, "punta": 0.0}
    solar = {"base": 0.0, "intermedia": 0.0}
    hsp_daily: List[float] = []

    current_date = start_day_local
    while current_date <= end_day_local:
        day_start = datetime(current_date.year, current_date.month, current_date.day, tzinfo=tz)
        day_end = day_start + timedelta(days=1)

        # Global billing overlap within this local day (for HSP and solar)
        bill_day_start = max(day_start, ps_local)
        bill_day_end = min(day_end, pe_local)
        if bill_day_end <= bill_day_start:
            current_date += timedelta(days=1)
            continue

        segs = schedule_for_local_date(current_date) or []
        seg_intervals: List[tuple[datetime, datetime, str]] = []
        for seg in segs:
            tmp = _segment_start_end_for_date(seg, current_date, tz)
            if tmp is None:
                continue
            seg_intervals.append(tmp)

        # 1) TOTAL HOURS by schedule (independent of NASA availability)
        for seg_start, seg_end, cat in seg_intervals:
            totals[cat] += _overlap_hours(seg_start, seg_end, ps_local, pe_local)

        # 2) SOLAR HOURS + 3) HSP (from NASA hourly, if available)
        day_irr_kwh_m2 = 0.0
        day_has_any_irr = False

        day_irr = irr_df[(irr_df["dt_local"] >= day_start) & (irr_df["dt_local"] < day_end)].copy()
        for _, hr in day_irr.iterrows():
            h_start = hr["dt_local"].to_pydatetime()
            h_end = h_start + timedelta(hours=1)

            # overlap of this hour with billing window
            oh_period = _overlap_hours(h_start, h_end, ps_local, pe_local)
            if oh_period <= 0:
                continue

            day_has_any_irr = True
            day_irr_kwh_m2 += (float(hr["irradiance_wm2"]) * oh_period) / 1000.0

            # classify into base/intermedia/punta using schedule segments
            for seg_start, seg_end, cat in seg_intervals:
                # overlap hour ∩ segment ∩ billing
                s = max(h_start, seg_start, ps_local)
                e = min(h_end, seg_end, pe_local)
                if e <= s:
                    continue
                oh = (e - s).total_seconds() / 3600.0
                if hr["is_solar"] and cat in ("base", "intermedia"):
                    solar[cat] += oh

        if day_has_any_irr:
            hsp_daily.append(day_irr_kwh_m2)

        current_date += timedelta(days=1)

    hsp_avg = (sum(hsp_daily) / len(hsp_daily)) if hsp_daily else 0.0

    return SolarAndHoursResult(
        total_base_hours=round(totals["base"], 6),
        total_intermedia_hours=round(totals["intermedia"], 6),
        total_punta_hours=round(totals["punta"], 6),
        solar_base_hours=round(solar["base"], 6),
        solar_intermedia_hours=round(solar["intermedia"], 6),
        hsp_nasa=round(hsp_avg, 6),
    )
