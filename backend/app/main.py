"""FastAPI entry point: `uvicorn app.main:app --reload`."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_exception_handlers
from app.api.router import api_router
from app.core.config import Settings, get_settings
from app.core.db import make_engine, make_session_factory
from app.services.clock import Clock
from app.services.payments import MockPaymentGateway
from app.services.photo_appraiser import HeuristicPhotoAppraiser
from app.storage.photos import LocalPhotoStorage, PhotoUrlSigner


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.version,
        description="API онлайн-ломбарда: оценка залога по фото, оферта, курьер, займ.",
        docs_url=f"{settings.api_prefix}/docs",
        openapi_url=f"{settings.api_prefix}/openapi.json",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.engine = make_engine(settings.database_url, echo=settings.db_echo)
    app.state.session_factory = make_session_factory(app.state.engine)
    # Replaceable integrations: S3-like storage, ML photo model, acquiring bank.
    app.state.photo_storage = LocalPhotoStorage(settings.upload_dir)
    app.state.photo_appraiser = HeuristicPhotoAppraiser()
    app.state.photo_signer = PhotoUrlSigner(
        settings.secret_key,
        prefix=settings.api_prefix,
        ttl_seconds=settings.photo_url_ttl_seconds,
    )
    app.state.payment_gateway = MockPaymentGateway()
    app.state.clock = Clock()  # adjustable "now" for demos (admin: /api/admin/clock)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)
    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()
