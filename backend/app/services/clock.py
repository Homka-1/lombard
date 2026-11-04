"""Application clock with an adjustable offset — "time travel" for demos and tests.

Loans, overdue processing, courier slots and offers read the time from the clock, so an
admin can move it forward (`POST /api/admin/clock`) to show an extension, an overdue
loan or a forfeit without waiting for weeks. The offset lives in memory of the running
process (one uvicorn worker) and is reset on restart. Disabled outside development/test.
"""

from datetime import datetime, timedelta

from app.models.base import utcnow


class Clock:
    def __init__(self, offset: timedelta = timedelta(0)) -> None:
        self.offset = offset

    def now(self) -> datetime:
        return utcnow() + self.offset

    def advance(self, delta: timedelta) -> datetime:
        if delta < timedelta(0):
            raise ValueError("Время можно только перемотать вперёд")
        self.offset += delta
        return self.now()

    def reset(self) -> datetime:
        self.offset = timedelta(0)
        return self.now()
