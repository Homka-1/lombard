from fastapi import APIRouter

from app.api import (
    admin_users,
    applications,
    auth,
    calculator,
    catalog,
    expert,
    health,
    photos,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(catalog.router)
api_router.include_router(applications.router)
api_router.include_router(expert.router)
api_router.include_router(calculator.router)
api_router.include_router(photos.router)
api_router.include_router(admin_users.router)
