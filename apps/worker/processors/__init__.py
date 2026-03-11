"""
Processor registry.

Each batch app_key maps to a function with signature:

    def process(ctx: JobContext) -> str:
        ...
        return relative_output_path

To register a new processor, import it here and add to REGISTRY.
"""

from .base import JobContext, make_output_dir  # noqa: F401

# Import processors (add new ones here)
from . import era_ventas_comisionador
from . import era_compras_generador_oc
from . import era_importaciones_oc
from . import tesoreria_saldos
from . import era_proyectos_comisionador_cfe
from . import cxp_autorizacion_pagos

# app_key → process(ctx) function
REGISTRY: dict[str, callable] = {
    "era_ventas_comisionador": era_ventas_comisionador.process,
    "era_compras_generador_ordenes_compra": era_compras_generador_oc.process,
    "era_importaciones_generador_oc": era_importaciones_oc.process,
    "tesoreria_automatizacion_saldos": tesoreria_saldos.process,
    "era_proyectos_comisionador_cfe": era_proyectos_comisionador_cfe.process,
    "cuentas_por_pagar_autorizacion_pagos": cxp_autorizacion_pagos.process,
}
