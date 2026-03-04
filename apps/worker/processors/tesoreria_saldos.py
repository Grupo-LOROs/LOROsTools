"""
Tesorería – Automatización de Saldos
─────────────────────────────────────
Input:  Multiple PDFs (bank statements: Santander, Monex, Bajío, BBVA, Banregio)
        + 1 XLSX template (plantilla de saldos)
Output: Updated XLSX template with new movements inserted.

Notes from spec:
  - Account number is taken from the PDF file (name may be in uppercase).
  - New movements that don't exist in the template are added.
  - Movements should be persisted in the DB.

TODO: Replace stub with actual business logic.
      The existing script should:
      1. Parse each bank PDF (different format per bank)
      2. Extract movements (date, description, amount, balance)
      3. Identify which account from the PDF filename/content
      4. Load the template XLSX
      5. Match movements against existing entries (avoid duplicates)
      6. Insert new movements
      7. Save updated XLSX
"""

from .base import JobContext


def process(ctx: JobContext) -> str:
    """Process Tesorería saldos job. Returns relative output path."""
    ctx.report_progress(5, "Iniciando automatización de saldos...")

    pdfs = ctx.input_files(".pdf")
    if not pdfs:
        raise ValueError("No se encontraron estados de cuenta PDF")

    if not ctx.template_abs or not ctx.template_abs.exists():
        raise ValueError("Se requiere la plantilla XLSX de saldos")

    ctx.report_progress(10, f"Procesando {len(pdfs)} estado(s) de cuenta...")

    # ── TODO: insert real logic here ──────────────────────────
    # from some_module import parse_bank_statement, update_template
    #
    # movements = []
    # for i, pdf in enumerate(pdfs):
    #     bank = detect_bank(pdf)
    #     new_movements = parse_bank_statement(pdf, bank)
    #     movements.extend(new_movements)
    #     pct = 10 + int(60 * (i + 1) / len(pdfs))
    #     ctx.report_progress(pct, f"Procesado {pdf.name} ({bank})")
    #
    # ctx.report_progress(75, "Actualizando plantilla...")
    # update_template(ctx.template_abs, movements, output_path)
    # ──────────────────────────────────────────────────────────

    # Placeholder: copy template as output
    import shutil

    out = ctx.output_path("saldos_actualizados.xlsx")
    shutil.copyfile(ctx.template_abs, out)

    ctx.report_progress(90, "Generando archivo de saldos...")
    return ctx.output_rel("saldos_actualizados.xlsx")
