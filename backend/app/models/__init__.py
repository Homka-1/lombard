"""SQLAlchemy models. Import everything here so `Base.metadata` is complete."""

from app.models.application import Application, Photo, StatusHistory
from app.models.appraisal import Appraisal, Offer
from app.models.base import Base
from app.models.catalog import Category, MetalPrice
from app.models.courier import CourierTask
from app.models.loan import Loan, Payment
from app.models.notification import Notification
from app.models.user import User

__all__ = [
    "Application",
    "Appraisal",
    "Base",
    "Category",
    "CourierTask",
    "Loan",
    "MetalPrice",
    "Notification",
    "Offer",
    "Payment",
    "Photo",
    "StatusHistory",
    "User",
]
