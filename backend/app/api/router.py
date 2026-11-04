from fastapi import APIRouter

from app.api import (
    admin,
    admin_users,
    applications,
    auth,
    calculator,
    catalog,
    expert,
    health,
    loans,
    logistics,
    notifications,
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
api_router.include_router(logistics.delivery_router)
api_router.include_router(logistics.visit_router)
api_router.include_router(logistics.courier_router)
api_router.include_router(admin_users.router)
api_router.include_router(logistics.admin_router)
api_router.include_router(loans.application_router)
api_router.include_router(loans.router)
api_router.include_router(notifications.router)
api_router.include_router(admin.router)
