import os
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.models import Announcement, AppDefinition, User, UserAppPermission


DEFAULT_ADMIN_USER = "admin"
DEFAULT_ADMIN_PASS = os.getenv("DEFAULT_ADMIN_PASS", "Biloros123")


# Canonical app registry (source of truth for the portal)
# NOTE: for interactive tools, set mode="interactive" + ui_url.
APPS = [
    {
        "key": "gi_cotizador_era_gi",
        "name": "GI - Cotizador ERA/GI",
        "unit": "gi",
        "mode": "interactive",
        "ui_type": "next",
        "ui_url": "/tools/gi/cotizador-era-gi",
        "spec": {
            "inputs": [],
            "outputs": [{"type": "data"}],
        },
    },
    {
        "key": "era_ventas_comisionador",
        "name": "ERA Ventas - Comisionador",
        "unit": "era_ventas",
        "mode": "batch",
        "spec": {
            "inputs": [
                {"type": "xlsx", "multiple": False},
                {"type": "xlsm", "multiple": False, "role": "schema"},
            ],
            "outputs": [{"type": "xlsx"}, {"type": "pdf"}],
        },
    },
    {
        "key": "era_ventas_cotizador_catalogo",
        "name": "ERA Ventas - Cotizador de catálogo",
        "unit": "era_ventas",
        "mode": "interactive",
        "ui_type": "next",
        "ui_url": "/tools/era/ventas/cotizador-catalogo",
        "spec": {
            "inputs": [{"type": "xlsx", "multiple": False, "optional": True}],
            "outputs": [{"type": "xlsx"}],
        },
    },
    {
        "key": "era_compras_generador_ordenes_compra",
        "name": "ERA Compras - Generador desde Órdenes de Compra",
        "unit": "era_compras",
        "mode": "batch",
        "spec": {
            "inputs": [
                {"type": "pdf", "multiple": True},
                {"type": "xlsx", "multiple": False, "role": "plantilla"},
            ],
            "outputs": [{"type": "xlsx"}],
        },
    },
    {
        "key": "era_importaciones_generador_oc",
        "name": "ERA Importaciones - Cartas complementarias desde órdenes de compra",
        "unit": "era_importaciones",
        "mode": "batch",
        "ui_type": "next",
        "ui_url": "/tools/era/importaciones/generador-oc",
        "spec": {
            "inputs": [
                {"type": "pdf", "multiple": True},
                {"type": "xlsx", "multiple": False, "role": "plantilla"},
            ],
            "outputs": [{"type": "xlsx"}, {"type": "pdf"}],
            "notes": {
                "template": "Sube el archivo de programación de entregas en Excel.",
                "behavior": "Actualiza la hoja de programación y genera una carta complementaria PDF por documento.",
            },
        },
    },
    {
        "key": "era_compras_seguimiento_importaciones",
        "name": "ERA Compras - Seguimiento de importaciones",
        "unit": "era_compras",
        "mode": "interactive",
        "ui_type": "next",
        "ui_url": "/tools/era/compras/seguimiento-importaciones",
        "spec": {
            "inputs": [
                {"type": "pdf", "multiple": True},
                {"type": "xlsx", "multiple": False, "optional": True, "role": "operativo"},
            ],
            "outputs": [{"type": "data"}],
        },
    },
    {
        "key": "tesoreria_automatizacion_saldos",
        "name": "Tesorería - Captura de movimientos bancarios",
        "unit": "tesoreria",
        "mode": "interactive",
        "ui_type": "next",
        "ui_url": "/tools/tesoreria/movimientos-bancarios",
        "spec": {
            "inputs": [
                {
                    "type": "pdf",
                    "multiple": True,
                    "banks": ["Santander", "Monex", "Bajio", "BBVA", "Banregio"],
                }
            ],
            "outputs": [{"type": "data"}],
            "notes": {
                "behavior": "Analiza PDFs bancarios, normaliza movimientos y opcionalmente prepara el Excel de movimientos.",
                "ocr": "Usa OCR cuando el PDF venga escaneado o sin capa de texto.",
            },
        },
    },
    {
        "key": "tesoreria_generacion_conciliacion",
        "name": "Tesorería - Actualización de saldos diarios",
        "unit": "tesoreria",
        "mode": "interactive",
        "ui_type": "next",
        "ui_url": "/tools/tesoreria/formato-asistido",
        "spec": {
            "inputs": [
                {
                    "type": "pdf",
                    "multiple": True,
                    "banks": ["Santander", "Monex", "Bajio", "BBVA", "Banregio"],
                },
                {"type": "xlsx", "multiple": False, "optional": True, "role": "saldos"},
            ],
            "outputs": [{"type": "data"}],
            "notes": {
                "behavior": "Actualiza el Excel de saldos diarios usando el saldo final detectado en los estados de cuenta PDF.",
                "focus": "Solo llena saldos por cuenta; no prepara clasificaciones de movimientos.",
            },
        },
    },
    {
        "key": "cuentas_por_pagar_autorizacion_pagos",
        "name": "ERA Cuentas por Pagar - Autorización de pagos",
        "unit": "era_cuentas_por_pagar",
        "mode": "batch",
        "spec": {
            "inputs": [{"type": "xlsx", "multiple": False}],
            "outputs": [{"type": "pdf"}],
            "notes": {
                "behavior": "Genera el PDF de autorización de pagos a partir del archivo semanal de provisión.",
                "selection": "Toma las partidas del día de pago objetivo usando la fecha real de pago y las hojas resumen del libro.",
            },
        },
    },
    {
        "key": "cuentas_por_pagar_revision_expedientes",
        "name": "ERA Cuentas por Pagar - Revisión de expedientes",
        "unit": "era_cuentas_por_pagar",
        "mode": "interactive",
        "ui_type": "next",
        "ui_url": "/tools/era/cuentas-por-pagar/revision-expedientes",
        "spec": {
            "inputs": [{"type": "pdf", "multiple": True}],
            "outputs": [{"type": "data"}],
            "notes": {
                "behavior": "Lee expedientes PDF, extrae datos fiscales y operativos, y marca coincidencias rápidas para capturar en Neodata.",
                "ocr": "Usa OCR cuando el expediente venga escaneado o con páginas sin capa de texto.",
            },
        },
    },
    {
        "key": "era_proyectos_comisionador_cfe",
        "name": "ERA Proyectos - Comisionador CFE",
        "unit": "era_proyectos",
        "mode": "batch",
        "spec": {
            "inputs": [{"type": "pdf", "multiple": True}],
            "outputs": [{"type": "xlsx"}],
        },
    },
]


ANNOUNCEMENTS = [
    {
        "slug": "bienvenida-plataforma",
        "title": "Bienvenido a LOROs Tools",
        "body": "Plataforma de herramientas de automatización. Selecciona una aplicación para comenzar.",
        "level": "info",
        "app_keys": [],  # global
    },
    {
        "slug": "mejora-tesoreria-movimientos",
        "title": "Mejora en Captura de Movimientos Bancarios",
        "body": "Se mejoró la detección de bancos y el parseo de PDFs para estados de cuenta de BBVA, Santander, BanBajío y Monex.",
        "level": "success",
        "app_keys": ["tesoreria_automatizacion_saldos", "tesoreria_generacion_conciliacion"],
    },
    {
        "slug": "mejora-importaciones-oc",
        "title": "Actualización en Cartas Complementarias",
        "body": "Se actualizó el generador de cartas complementarias desde órdenes de compra con mejor manejo de formatos.",
        "level": "info",
        "app_keys": ["era_importaciones_generador_oc"],
    },
]


def seed(db: Session) -> None:
    """Idempotent seed."""

    # admin user
    admin = db.query(User).filter(User.username == DEFAULT_ADMIN_USER).first()
    if not admin:
        db.add(
            User(
                username=DEFAULT_ADMIN_USER,
                password_hash=hash_password(DEFAULT_ADMIN_PASS),
                is_admin=True,
            )
        )
        db.commit()

    # apps registry
    for a in APPS:
        existing = db.get(AppDefinition, a["key"])
        if not existing:
            db.add(
                AppDefinition(
                    key=a["key"],
                    name=a["name"],
                    unit=a["unit"],
                    enabled=True,
                    mode=a.get("mode", "batch"),
                    ui_type=a.get("ui_type"),
                    ui_url=a.get("ui_url"),
                    spec=a.get("spec", {}),
                )
            )
        else:
            existing.name = a["name"]
            existing.unit = a["unit"]
            existing.mode = a.get("mode", existing.mode)
            existing.ui_type = a.get("ui_type")
            existing.ui_url = a.get("ui_url")
            existing.spec = a.get("spec", existing.spec)

    db.commit()

    # announcements
    for ann in ANNOUNCEMENTS:
        existing = db.query(Announcement).filter(Announcement.slug == ann["slug"]).first()
        if not existing:
            db.add(
                Announcement(
                    slug=ann["slug"],
                    title=ann["title"],
                    body=ann["body"],
                    level=ann.get("level", "info"),
                    app_keys=ann.get("app_keys", []),
                    active=True,
                )
            )
        else:
            existing.title = ann["title"]
            existing.body = ann["body"]
            existing.level = ann.get("level", "info")
            existing.app_keys = ann.get("app_keys", [])

    db.commit()

    # Backward compatibility:
    # existing non-admin users with no explicit permissions keep access to all apps.
    all_app_keys = sorted([a["key"] for a in APPS])
    non_admin_users = db.query(User).filter(User.is_admin.is_(False)).all()

    for user in non_admin_users:
        current_count = (
            db.query(UserAppPermission.id)
            .filter(UserAppPermission.user_id == user.id)
            .count()
        )
        if current_count > 0:
            continue

        for app_key in all_app_keys:
            db.add(UserAppPermission(user_id=user.id, app_key=app_key))

    db.commit()
