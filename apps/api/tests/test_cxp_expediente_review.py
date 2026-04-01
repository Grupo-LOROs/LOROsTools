import unittest

from app.routes.cxp_expediente_review import (
    _company_from_values,
    _extract_invoice_reference,
    _extract_order_snapshot,
    _extract_sat_snapshot,
)


ORDER_SAMPLE = """
Datos bancarios TALLER Y RENTAS TALLER Y RENTAS 2026 Proyecto: Pedido: Usuario que elaboró: Fecha: Requisición:
Lugar de entrega: 691 30-mar.-2026 684 Proveedor: REF-019 MTB930218UL0 MERCADO DE TORNILLOS BIRLOS Y HERRAMIENTAS, SA DE CV
TRANSFERENCIA Correo electrónico: Fecha límite de entrega: 30-marzo-2026
SUBTOTAL: $86.21
I.V.A: 16.00 % $13.79
TOTAL: $100.00
"""

SAT_SAMPLE = """
Verificación de comprobantes fiscales digitales por internet RFC del emisor Nombre o razón social del emisor
RFC del receptor Nombre o razón social del receptor MTB930218UL0 MERCADO DE TORNILLOS BIRLOS Y HERRAMIENTAS
CEM180706Q96 CARRETERAS Y EDIFICACIONES DE MICHOACAN
Folio fiscal Fecha de expedición Fecha certificación SAT PAC que certificó
F7E45CDA-951C-4C63-9431-393780AC25AA 2026-03-26T17:41:32 2026-03-26T17:41:33 MAS0810247C0
Total del CFDI $100.00 Ingreso Vigente Cancelable sin aceptación
"""

INVOICE_REFERENCE_SAMPLE = """
FACTURA FOLIO: A 6762
"""


class CxpExpedienteReviewTests(unittest.TestCase):
    def test_extract_order_snapshot(self):
        snapshot = _extract_order_snapshot(ORDER_SAMPLE)
        self.assertEqual(snapshot["order_number"], "691")
        self.assertEqual(snapshot["requisition_number"], "684")
        self.assertEqual(snapshot["order_date"], "30-mar.-2026")
        self.assertEqual(snapshot["supplier_rfc"], "MTB930218UL0")
        self.assertAlmostEqual(snapshot["total"] or 0, 100.0)

    def test_extract_sat_snapshot(self):
        snapshot = _extract_sat_snapshot(SAT_SAMPLE)
        self.assertEqual(snapshot["issuer_rfc"], "MTB930218UL0")
        self.assertEqual(snapshot["receiver_rfc"], "CEM180706Q96")
        self.assertEqual(snapshot["uuid"], "F7E45CDA-951C-4C63-9431-393780AC25AA")
        self.assertAlmostEqual(snapshot["total"] or 0, 100.0)
        self.assertEqual(snapshot["status"], "Vigente")

    def test_extract_invoice_reference(self):
        series, folio, reference = _extract_invoice_reference(INVOICE_REFERENCE_SAMPLE)
        self.assertEqual(series, "A")
        self.assertEqual(folio, "6762")
        self.assertEqual(reference, "A-6762")

    def test_detect_company_alias(self):
        alias, name = _company_from_values("CARRETERAS Y EDIFICACIONES DE MICHOACAN", "CEM180706Q96")
        self.assertEqual(alias, "CEMICH")
        self.assertIn("MICHOACAN", name)


if __name__ == "__main__":
    unittest.main()
