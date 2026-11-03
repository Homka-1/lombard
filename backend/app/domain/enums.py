"""Domain enumerations. Values are stored as strings in the database."""

from enum import StrEnum


class Role(StrEnum):
    CLIENT = "CLIENT"
    EXPERT = "EXPERT"
    COURIER = "COURIER"
    ADMIN = "ADMIN"


class Actor(StrEnum):
    """Who performs a status transition: a user role or the system itself."""

    CLIENT = "CLIENT"
    EXPERT = "EXPERT"
    COURIER = "COURIER"
    ADMIN = "ADMIN"
    SYSTEM = "SYSTEM"

    @classmethod
    def from_role(cls, role: Role) -> "Actor":
        return cls(role.value)


class ApplicationStatus(StrEnum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    PRE_ESTIMATED = "PRE_ESTIMATED"
    UNDER_REVIEW = "UNDER_REVIEW"
    NEED_INFO = "NEED_INFO"
    OFFER_SENT = "OFFER_SENT"
    OFFER_ACCEPTED = "OFFER_ACCEPTED"
    OFFER_DECLINED = "OFFER_DECLINED"
    REJECTED = "REJECTED"
    COURIER_SCHEDULED = "COURIER_SCHEDULED"
    COURIER_EN_ROUTE = "COURIER_EN_ROUTE"
    ITEM_PICKED_UP = "ITEM_PICKED_UP"
    ITEM_DELIVERED = "ITEM_DELIVERED"
    INSPECTED = "INSPECTED"
    FUNDS_ISSUED = "FUNDS_ISSUED"
    LOAN_ACTIVE = "LOAN_ACTIVE"
    EXTENDED = "EXTENDED"
    OVERDUE = "OVERDUE"
    REPAID = "REPAID"
    ITEM_RETURNED = "ITEM_RETURNED"
    FORFEITED = "FORFEITED"


class Metal(StrEnum):
    GOLD = "GOLD"
    SILVER = "SILVER"
    PLATINUM = "PLATINUM"
    PALLADIUM = "PALLADIUM"


class ItemCondition(StrEnum):
    NEW = "NEW"
    EXCELLENT = "EXCELLENT"
    GOOD = "GOOD"
    FAIR = "FAIR"
    POOR = "POOR"


class AppraisalKind(StrEnum):
    AUTO = "AUTO"  # pre-estimate from photos and parameters
    EXPERT = "EXPERT"  # expert appraisal by photos
    INSPECTION = "INSPECTION"  # in-person inspection after delivery


class OfferStatus(StrEnum):
    SENT = "SENT"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    EXPIRED = "EXPIRED"
    SUPERSEDED = "SUPERSEDED"


class CourierTaskKind(StrEnum):
    PICKUP = "PICKUP"  # client -> pawnshop
    RETURN = "RETURN"  # pawnshop -> client after repayment


class CourierTaskStatus(StrEnum):
    SCHEDULED = "SCHEDULED"
    EN_ROUTE = "EN_ROUTE"
    PICKED_UP = "PICKED_UP"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"


class LoanStatus(StrEnum):
    ACTIVE = "ACTIVE"
    OVERDUE = "OVERDUE"
    REPAID = "REPAID"
    FORFEITED = "FORFEITED"


class PaymentKind(StrEnum):
    DISBURSEMENT = "DISBURSEMENT"  # pawnshop -> client
    REPAYMENT = "REPAYMENT"  # full repayment: principal + interest
    EXTENSION = "EXTENSION"  # accrued interest paid to extend the term


class PaymentStatus(StrEnum):
    PENDING = "PENDING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


class NotificationChannel(StrEnum):
    IN_APP = "IN_APP"
    SMS = "SMS"
    EMAIL = "EMAIL"
