"""
Tesorería – Automatización de Saldos
─────────────────────────────────────
Input:  Multiple PDFs (bank statements: Santander, Monex, Bajío, BBVA, Banregio)
        + 1 XLSX template (plantilla de saldos)
Output: Updated XLSX template with balances inserted.

Uses the shared services extracted from the API:
  - treasury_parser: PDF parsing per bank
  - treasury_template: balance matching and Excel rendering
"""

from __future__ import annotations

import json
from pathlib import Path

from .base import JobContext


def process(ctx: JobContext) -> str:
    """Process Tesorería saldos job. Returns relative output path."""
    # Late import to keep module loadable even if services aren't available yet
    from services.treasury_parser import parse_statement, analysis_payload
    from services.treasury_template import prepare_balance_template, render_balance_workbook

    ctx.report_progress(5, "Iniciando automatización de saldos...")

    pdfs = ctx.input_files(".pdf")
    if not pdfs:
        raise ValueError("No se encontraron estados de cuenta PDF")

    if not ctx.template_abs or not ctx.template_abs.exists():
        raise ValueError("Se requiere la plantilla XLSX de saldos")

    # ── Parse PDFs ────────────────────────────────────────
    ctx.report_progress(10, f"Procesando {len(pdfs)} estado(s) de cuenta...")

    statements = []
    warnings = []
    for i, pdf in enumerate(pdfs):
        try:
            statement = parse_statement(pdf)
            statements.append(statement)
            if statement.warnings:
                warnings.extend(
                    f"{pdf.name}: {w}" for w in statement.warnings
                )
        except Exception as exc:
            warnings.append(f"{pdf.name}: Error al procesar — {exc}")

        pct = 10 + int(60 * (i + 1) / len(pdfs))
        ctx.report_progress(pct, f"Procesado {pdf.name}")

    if not statements:
        raise ValueError(
            "No se pudo procesar ningún estado de cuenta. "
            + "; ".join(warnings)
        )

    # ── Match and update balance template ─────────────────
    ctx.report_progress(75, "Analizando plantilla de saldos...")

    balance_data = prepare_balance_template(ctx.template_abs, statements)
    updates = balance_data.get("updates", [])

    if not updates:
        raise ValueError(
            "No se encontraron coincidencias entre los estados de cuenta y la plantilla de saldos. "
            "Verifica que los bancos y números de cuenta coincidan."
        )

    ctx.report_progress(80, f"Actualizando {len(updates)} saldo(s) en la plantilla...")

    balance_bytes = render_balance_workbook(ctx.template_abs, updates)

    # ── Write output ──────────────────────────────────────
    out = ctx.output_path("saldos_actualizados.xlsx")
    out.write_bytes(balance_bytes)

    ctx.report_progress(85, "Generando reporte de cambios...")

    # ── Build change report ───────────────────────────────
    report = _build_report(statements, balance_data, warnings)
    report_path = ctx.output_path("reporte_saldos.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    # Store summary in params for the job record
    ctx.params["accounts_updated"] = len(updates)
    ctx.params["accounts_unmatched"] = len(balance_data.get("unmatched_statements", []))
    ctx.params["pdfs_processed"] = len(statements)
    ctx.params["pdfs_with_warnings"] = len([s for s in statements if s.warnings])
    ctx.params["warnings"] = warnings[:10]

    ctx.report_progress(90, "Saldos actualizados correctamente.")
    return ctx.output_rel("saldos_actualizados.xlsx")


def _build_report(
    statements,
    balance_data: dict,
    warnings: list[str],
) -> dict:
    """Build a JSON-serializable change report."""
    updates = balance_data.get("updates", [])

    accounts_summary = []
    for update in updates:
        accounts_summary.append({
            "banco": update.get("bank"),
            "cuenta": update.get("account_label"),
            "tipo": update.get("column_key"),
            "saldo_anterior": update.get("current_value"),
            "saldo_nuevo": update.get("new_value"),
            "confianza": update.get("confidence"),
            "razon": update.get("reason"),
            "estado_de_cuenta": update.get("statement_label"),
        })

    return {
        "resumen": {
            "estados_procesados": len(statements),
            "cuentas_actualizadas": len(updates),
            "cuentas_no_encontradas": len(balance_data.get("unmatched_statements", [])),
            "bancos": sorted({s.bank for s in statements}),
        },
        "actualizaciones": accounts_summary,
        "no_encontrados": balance_data.get("unmatched_statements", []),
        "advertencias": warnings,
    }
