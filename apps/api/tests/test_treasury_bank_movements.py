import unittest

from app.routes.treasury_bank_movements import (
    _detect_bank,
    _extract_counterparty,
    _movement_category,
    _parse_bajio,
    _parse_banregio,
    _parse_bbva,
    _parse_santander,
)


BBVA_SAMPLE = """
BBVA
Fecha de consulta
03/02/2026 10:06:58 AM
No. Contrato
00610828
Nombre del Cliente
CONSTRUCCIONES LOROS SA DE CV
Detalle de Movimientos
Fecha
Concepto/ Referencia
Cargo
Abono
Saldo
31/01/2026
PAGO DE NOMINA / BC 4203836649 CONSTRUCCIONES LOROS SA DE CV
-63,574.84
46,670.52
29/01/2026
DEPOSITO DE TERCERO / REFBNTC00642703 SALDO DE FACTURA BMRCASH 893,582.12 4,833,729.46
"""

BANREGIO_SAMPLE = """
banregio
Detalle de Movimientos Cuenta de Cheques
CONSTRUCCIONES LOROS S.A. DE C.V.
CUENTA: 210994250013
CLABE: 058470000000903792
Fecha Inicio:01/02/2026 - Fecha Fin: 28/02/2026
Saldo Inicial: $27635.23
Fecha
Descripción
Referencia
Cargos
Abonos
Saldo
_Sin registros
Total Cargos: $0.00
Total Abonos: $0.00
Saldo Final: $27635.23
"""

BAJIO_SAMPLE = """
CUENTA CONECTA BANBAJIO
Cuenta: 339222200201
Saldo Total: $23,166.52
#
Fecha Movimiento
Descripción
Cargos
Abonos
Saldo
1
12-Dic-2025
SPEI Recibido:
Institucion contraparte: BBVA MEXICO Ordenante: CARRETERAS Y EDIFICACIONES DE MICHOACAN
Referencia: 121225
$4,766.66
$23,166.52
Hora: 17:58:30
Clave de Rastreo: 002601002512150000887834 Concepto del Pago: PAGO
"""

SANTANDER_SAMPLE = """
Consulta de Movimientos de la Cuenta de Cheques
Contrato CMC: 80152454770 ENERGIA RENOVABLE DE AMERICA SA DE CV
Número de Cuenta: 65511207359
Periodo: 01/10/2025 al 26/12/2025
Saldo Inicial: $1,912.15 MXN
Saldo Final: $15,000.00 MXN
Importe Total Abonos: $3,117,598.44 MXN
Importe Total Cargos: $3,122,798.44 MXN
Cuenta
Fecha
Hora
Sucursal
Descripción
Importe Cargo
Importe Abono
Saldo
Referencia
Concepto
Descripción Larga
65511207359
03112
025
17:28
7465
ABONO
TRANSFERENCIA
SPEI
0.00
40,390.40
40,390.40
005240091
TRASPASO BBVA A SANTANDER
012470001692707448
ABONO TRANSFERENCIA SPEI
65511207359
03112
025
17:28
7465
I V A  POR
COMISION
400.00
0.00
37,490.40
OCT 2025
I V A  POR COMISION
"""


class TreasuryBankMovementsTests(unittest.TestCase):
    def test_detect_bank(self):
        self.assertEqual(_detect_bank(BBVA_SAMPLE), "BBVA")
        self.assertEqual(_detect_bank(BANREGIO_SAMPLE), "Banregio")
        self.assertEqual(_detect_bank(BAJIO_SAMPLE), "BanBajio")
        self.assertEqual(_detect_bank(SANTANDER_SAMPLE), "Santander")

    def test_parse_bbva_credit_and_debit(self):
        statement = _parse_bbva(BBVA_SAMPLE, "bbva.pdf", ocr_used=True)
        self.assertEqual(statement.bank, "BBVA")
        self.assertEqual(len(statement.movements), 2)
        self.assertEqual(statement.movements[0].movement_type, "cargo")
        self.assertEqual(statement.movements[1].movement_type, "abono")
        self.assertAlmostEqual(statement.movements[1].credit or 0, 893582.12)

    def test_parse_banregio_without_rows(self):
        statement = _parse_banregio(BANREGIO_SAMPLE, "banregio.pdf", ocr_used=True)
        self.assertEqual(statement.account_number, "210994250013")
        self.assertEqual(len(statement.movements), 0)
        self.assertTrue(any("no contiene movimientos" in warning.lower() for warning in statement.warnings))

    def test_parse_bajio_transfer_in(self):
        statement = _parse_bajio(BAJIO_SAMPLE, "bajio.pdf", ocr_used=True)
        self.assertEqual(len(statement.movements), 1)
        movement = statement.movements[0]
        self.assertEqual(movement.movement_type, "abono")
        self.assertEqual(movement.category, "transferencia_entrada")
        self.assertEqual(movement.counterparty, "CARRETERAS Y EDIFICACIONES DE MICHOACAN")

    def test_parse_santander_rows(self):
        statement = _parse_santander(SANTANDER_SAMPLE, "santander.pdf", ocr_used=False)
        self.assertEqual(len(statement.movements), 2)
        self.assertEqual(statement.movements[0].credit, 40390.40)
        self.assertEqual(statement.movements[1].category, "iva_comision")

    def test_counterparty_and_category_helpers(self):
        self.assertEqual(
            _extract_counterparty("Ordenante: CONSTRUCCIONES LOROS SA DE CV | Cuenta ordenante: 123"),
            "CONSTRUCCIONES LOROS SA DE CV",
        )
        self.assertEqual(_movement_category("IVA por comision", None, 12.0, None), "iva_comision")


if __name__ == "__main__":
    unittest.main()
