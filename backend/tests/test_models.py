from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, StatementError

from app.domain.enums import (
    ApplicationStatus,
    AppraisalKind,
    CourierTaskKind,
    LoanStatus,
    Metal,
    NotificationChannel,
    OfferStatus,
    PaymentKind,
    PaymentStatus,
    Role,
)
from app.domain.state_machine import TransitionForbiddenError
from app.models import (
    Application,
    Appraisal,
    Category,
    CourierTask,
    Loan,
    Notification,
    Offer,
    Payment,
    Photo,
    StatusHistory,
    User,
)
from app.services.status import change_status, record_created


def _user(session, email: str, role: Role) -> User:
    user = User(email=email, full_name=email, role=role, password_hash="x", phone="+77011234567")
    session.add(user)
    return user


@pytest.fixture
def people(session):
    users = {
        "client": _user(session, "c@test.kz", Role.CLIENT),
        "expert": _user(session, "e@test.kz", Role.EXPERT),
        "courier": _user(session, "k@test.kz", Role.COURIER),
    }
    session.flush()
    return users


@pytest.fixture
def gold(session) -> Category:
    cat = Category(code="gold", name="Золото", ltv_percent=80, daily_rate_bp=25)
    session.add(cat)
    session.flush()
    return cat


@pytest.fixture
def application(session, people, gold) -> Application:
    app = Application(
        client=people["client"],
        category=gold,
        title="Кольцо",
        metal=Metal.GOLD,
        fineness=585,
        weight_mg=3520,
    )
    session.add(app)
    session.flush()
    return app


def test_defaults_and_number(session, application):
    session.commit()
    assert application.status is ApplicationStatus.DRAFT
    assert application.number == f"Л-{application.id:06d}"
    assert application.created_at.tzinfo is not None
    assert application.category.min_term_days == 7
    assert application.category.max_term_days == 60


def test_datetimes_round_trip_as_utc(session, people):
    almaty = datetime(2026, 11, 3, 15, 0, tzinfo=UTC).astimezone(ZoneInfo("Asia/Almaty"))
    people["client"].last_login_at = almaty
    session.commit()
    session.expire_all()
    stored = session.get(User, people["client"].id).last_login_at
    assert stored == datetime(2026, 11, 3, 15, 0, tzinfo=UTC)
    assert stored.utcoffset() == timedelta(0)


def test_naive_datetime_rejected(session, people):
    people["client"].last_login_at = datetime(2026, 1, 1)
    with pytest.raises(StatementError):
        session.flush()


def test_unique_email(session, people):
    _user(session, "c@test.kz", Role.CLIENT)
    with pytest.raises(IntegrityError):
        session.flush()


def test_category_check_constraint(session):
    session.add(Category(code="bad", name="Bad", ltv_percent=150, daily_rate_bp=10))
    with pytest.raises(IntegrityError):
        session.flush()


def test_full_object_graph(session, people, application):
    session.add_all(
        [
            Photo(
                application=application,
                storage_key="a/1.jpg",
                original_name="1.jpg",
                content_type="image/jpeg",
                size_bytes=1000,
                position=1,
            ),
            Photo(
                application=application,
                storage_key="a/0.jpg",
                original_name="0.jpg",
                content_type="image/jpeg",
                size_bytes=1000,
                position=0,
            ),
        ]
    )
    auto = Appraisal(
        application=application,
        kind=AppraisalKind.AUTO,
        value_min=100_000_00,
        value=120_000_00,
        value_max=140_000_00,
        confidence=60,
        details={"formula": "weight × fineness × price"},
    )
    expert = Appraisal(
        application=application,
        kind=AppraisalKind.EXPERT,
        appraiser=people["expert"],
        value_min=125_000_00,
        value=125_000_00,
        value_max=125_000_00,
        confidence=95,
    )
    offer = Offer(
        application=application,
        appraisal=expert,
        expert=people["expert"],
        loan_amount=100_000_00,
        daily_rate_bp=25,
        term_days=30,
        total_to_repay=107_500_00,
    )
    now = datetime.now(UTC)
    task = CourierTask(
        application=application,
        courier=people["courier"],
        kind=CourierTaskKind.PICKUP,
        city="Алматы",
        address="пр. Абая, 10, кв. 5",
        contact_phone="+77011234567",
        slot_start=now,
        slot_end=now + timedelta(hours=2),
    )
    loan = Loan(
        application=application,
        offer=offer,
        ticket_number="ЗБ-000001",
        principal=100_000_00,
        daily_rate_bp=25,
        term_days=30,
        issued_at=now,
        due_at=now + timedelta(days=30),
    )
    payment = Payment(
        loan=loan,
        kind=PaymentKind.DISBURSEMENT,
        amount=100_000_00,
        destination="4400 43** **** 1234",
    )
    note = Notification(
        user=people["client"],
        application_id=None,
        channel=NotificationChannel.SMS,
        title="Оценка готова",
        body="Предварительная оценка: 100 000–140 000 ₸",
    )
    session.add_all([auto, expert, offer, task, loan, payment, note])
    session.commit()
    session.expire_all()

    app = session.get(Application, application.id)
    assert [p.position for p in app.photos] == [0, 1]
    assert [a.kind for a in app.appraisals] == [AppraisalKind.AUTO, AppraisalKind.EXPERT]
    assert app.appraisals[0].details == {"formula": "weight × fineness × price"}
    assert app.offers[0].status is OfferStatus.SENT
    assert app.courier_tasks[0].courier.role is Role.COURIER
    assert app.loan.status is LoanStatus.ACTIVE
    assert app.loan.payments[0].status is PaymentStatus.PENDING
    assert people["client"].notifications[0].channel is NotificationChannel.SMS


def test_loan_unique_per_application(session, people, application):
    expert = Appraisal(
        application=application,
        kind=AppraisalKind.EXPERT,
        value_min=1,
        value=1,
        value_max=1,
        confidence=90,
    )
    offer = Offer(
        application=application,
        appraisal=expert,
        expert=people["expert"],
        loan_amount=100,
        daily_rate_bp=25,
        term_days=7,
        total_to_repay=200,
    )
    session.add(offer)
    session.flush()
    now = datetime.now(UTC)

    def loan(ticket: str) -> Loan:
        return Loan(
            application_id=application.id,
            offer_id=offer.id,
            ticket_number=ticket,
            principal=100,
            daily_rate_bp=25,
            term_days=7,
            issued_at=now,
            due_at=now + timedelta(days=7),
        )

    session.add(loan("ЗБ-1"))
    session.flush()
    session.add(loan("ЗБ-2"))
    with pytest.raises(IntegrityError):
        session.flush()


def test_deleting_application_cascades(session, people, application):
    record_created(session, application, people["client"])
    session.add(
        Photo(
            application=application,
            storage_key="x.jpg",
            original_name="x.jpg",
            content_type="image/jpeg",
            size_bytes=1,
        )
    )
    session.commit()
    session.delete(application)
    session.commit()
    assert session.scalar(select(Photo)) is None
    assert session.scalar(select(StatusHistory)) is None


def test_change_status_writes_history(session, people, application):
    record_created(session, application, people["client"])
    change_status(session, application, ApplicationStatus.SUBMITTED, user=people["client"])
    change_status(session, application, ApplicationStatus.PRE_ESTIMATED, comment="авто")
    session.commit()
    session.expire_all()

    app = session.get(Application, application.id)
    assert app.status is ApplicationStatus.PRE_ESTIMATED
    assert app.submitted_at is not None
    rows = [(h.from_status, h.to_status, h.actor_role) for h in app.history]
    assert rows == [
        (None, ApplicationStatus.DRAFT, Role.CLIENT),
        (ApplicationStatus.DRAFT, ApplicationStatus.SUBMITTED, Role.CLIENT),
        (ApplicationStatus.SUBMITTED, ApplicationStatus.PRE_ESTIMATED, None),
    ]
    assert app.history[-1].comment == "авто"


def test_change_status_rejects_wrong_role(session, people, application):
    with pytest.raises(TransitionForbiddenError):
        change_status(session, application, ApplicationStatus.SUBMITTED, user=people["expert"])
    assert application.status is ApplicationStatus.DRAFT
    assert application.history == []
