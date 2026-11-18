"""Entry point FastAPI untuk Layanan Slip Gaji ASN."""

from __future__ import annotations

from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.dashboard import router as dashboard_router
from app.api.payroll import router as payroll_router
from app.api.potongan import router as potongan_router
from app.db import get_db
from app.schemas import HealthResponse

WEB_DIR = Path(__file__).resolve().parent / "web"

app = FastAPI(
    title="Layanan API Slip Gaji ASN",
    version="1.0.0",
    description=(
        "API import SIMGAJI PNS, data gaji per NIP/periode, potongan internal, "
        "dan cetak slip F4."
    ),
)

# Router import didaftarkan sebelum route dinamis /{nip} agar
# /api/v1/payroll/import-excel tidak tertangkap sebagai NIP.
app.include_router(payroll_router)
app.include_router(dashboard_router)
app.include_router(potongan_router)

if WEB_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/health", response_model=HealthResponse, tags=["Ops"])
def health_check(db: Session = Depends(get_db)) -> HealthResponse:
    """Liveness/readiness sederhana termasuk konektivitas database."""

    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database tidak tersedia.",
        ) from exc
    return HealthResponse(status="ok", database="ok")


@app.get("/", include_in_schema=False)
def root():
    """Sajikan dashboard Aero Glass; fallback JSON bila aset web belum ada."""

    index_file = WEB_DIR / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)
    return {
        "name": "Layanan API Slip Gaji ASN",
        "version": "1.0.0",
        "docs": "/docs",
    }
