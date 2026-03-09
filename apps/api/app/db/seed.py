import os
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.models import AppDefinition, User, UserAppPermission


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
        "name": "Tesorería - Automatización de Saldos",
        "unit": "tesoreria",
        "mode": "batch",
        "spec": {
            "inputs": [
                {
                    "type": "pdf",
                    "multiple": True,
                    "banks": ["Santander", "Monex", "Bajio", "BBVA", "Banregio"],
                },
                {"type": "xlsx", "multiple": False, "role": "plantilla"},
            ],
            "outputs": [{"type": "xlsx"}],
            "notes": {
                "account_number": "Se toma del archivo (nombre puede venir en mayusculas).",
                "movement_rule": "Agregar movimientos nuevos que no esten en la plantilla; persistir en BD.",
            },
        },
    },
    {
        "key": "tesoreria_generacion_conciliacion",
        "name": "Tesorería - Generación de Conciliación",
        "unit": "tesoreria",
        "mode": "interactive",
        "ui_type": "next",
        "ui_url": "/tools/tesoreria/conciliacion",
        "spec": {
            "inputs": [{"type": "xlsx", "multiple": False, "optional": True}],
            "outputs": [{"type": "xlsx"}],
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
