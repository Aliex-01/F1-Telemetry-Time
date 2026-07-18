"""Comprobación del token de F1TV que FastF1 usa para el directo.

El feed oficial exige un JWT de F1TV que FastF1 cachea en disco (`f1auth.json`).
Caduca cada pocos días. Lo delicado: si caduca, FastF1 **no falla** al conectar;
`get_auth_token()` intenta reautenticar levantando un servidor local e imprimiendo
una URL, y se queda **bloqueado** esperando que autentiques en el navegador
(`_auth_finished.wait()`). Es decir, el hilo del directo se cuelga en silencio.

Por eso validamos el token nosotros ANTES de arrancar el cliente. La comprobación
es **offline**: decodificamos el JWT sin verificar la firma (no hace falta red ni
el JWKS) y solo miramos `exp`. Si no sirve, ni tocamos el cliente: avisamos.
"""
from __future__ import annotations

from datetime import datetime, timezone

# Cómo renovar el token (se muestra tal cual en el aviso de la UI).
REAUTH_CMD = "cd backend && uv run python -m fastf1 auth f1tv --authenticate"


def f1_auth_status() -> dict:
    """Estado del token de F1TV, sin red.

    Devuelve un dict con:
      - ok:        bool, si el token sirve para conectar.
      - state:     "ok" | "expired" | "missing" | "unreadable".
      - expiresAt: ISO-8601 (UTC) de caducidad, o None.
      - message:   texto listo para enseñar al usuario.
    """
    try:
        import jwt
        from fastf1.internals.f1auth import AUTH_DATA_FILE
    except Exception:  # noqa: BLE001 - FastF1 sin instalar/roto: no bloqueamos por ello
        return _status(False, "unreadable", None,
                       "No se pudo cargar la autenticación de FastF1.")

    try:
        token = AUTH_DATA_FILE.read_text().strip()
    except OSError:
        token = ""

    if not token:
        return _status(False, "missing", None,
                       f"No hay token de F1TV. Autentícate: {REAUTH_CMD}")

    try:
        claims = jwt.decode(token, options={"verify_signature": False})
    except Exception:  # noqa: BLE001 - token corrupto o con formato inesperado
        return _status(False, "unreadable", None,
                       f"El token de F1TV no se pudo leer. Renuévalo: {REAUTH_CMD}")

    exp = claims.get("exp")
    expires_at = (
        datetime.fromtimestamp(exp, tz=timezone.utc).isoformat() if exp else None
    )
    if exp and exp < datetime.now(tz=timezone.utc).timestamp():
        return _status(False, "expired", expires_at,
                       f"El token de F1TV caducó. Renuévalo: {REAUTH_CMD}")

    return _status(True, "ok", expires_at, "Token de F1TV válido.")


def _status(ok: bool, state: str, expires_at: str | None, message: str) -> dict:
    return {"ok": ok, "state": state, "expiresAt": expires_at, "message": message}


# Margen por defecto para renovar "por adelantado": si al token le quedan menos
# horas que esto, conviene renovarlo ya (p.ej. antes de una carrera) y no jugársela
# a que caduque a mitad de sesión.
RENEW_MARGIN_HOURS = 24


def needs_renewal(within_hours: float = RENEW_MARGIN_HOURS) -> bool:
    """¿Conviene renovar el token ya? True si falta, es ilegible, caducó o le
    quedan menos de `within_hours`."""
    status = f1_auth_status()
    if not status["ok"]:
        return True
    exp_iso = status["expiresAt"]
    if not exp_iso:
        return False
    exp = datetime.fromisoformat(exp_iso)
    remaining = exp.timestamp() - datetime.now(tz=timezone.utc).timestamp()
    return remaining < within_hours * 3600


if __name__ == "__main__":
    # Uso desde start-online.bat: sale con código 1 si hay que renovar el token
    # (para que el .bat lance la reautenticación), 0 si el token aguanta.
    import sys

    st = f1_auth_status()
    exp = f" (caduca el {st['expiresAt']})" if st["expiresAt"] else ""
    if needs_renewal():
        print(f"Token de F1TV: hay que renovar [{st['state']}]{exp}")
        sys.exit(1)
    print(f"Token de F1TV: OK{exp}")
    sys.exit(0)
