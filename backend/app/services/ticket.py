"""Pledge ticket (залоговый билет) as a self-contained printable HTML page.

"Save as PDF" in the browser's print dialog gives the PDF; no PDF library is needed.
"""

from datetime import datetime
from html import escape

from app.domain.loan_calc import format_rate, interest_for
from app.domain.loans import LOAN_STATUS_LABELS, PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS
from app.domain.logistics import KZ_TZ
from app.domain.money import format_kzt
from app.domain.phone import format_kz_phone
from app.domain.pricing import CONDITION_LABELS, METAL_LABELS
from app.models import Loan
from app.services.loans import loan_figures

_CSS = """
:root { --ink:#1d1b18; --muted:#6b645b; --line:#d9d2c5; --accent:#7a5c1e; }
* { box-sizing:border-box; }
body { margin:0; padding:32px 16px; background:#f6f3ee; color:var(--ink);
  font:15px/1.5 "Golos Text","Segoe UI",Roboto,Arial,sans-serif; }
.sheet { max-width:760px; margin:0 auto; background:#fff; border:1px solid var(--line);
  padding:40px 44px; }
header { display:flex; justify-content:space-between; gap:24px; align-items:flex-start;
  border-bottom:2px solid var(--ink); padding-bottom:16px; margin-bottom:24px; }
h1 { font:600 26px/1.2 Georgia,"Times New Roman",serif; margin:0 0 4px; }
.num { font:600 18px/1.3 ui-monospace,Menlo,Consolas,monospace; color:var(--accent); }
.muted { color:var(--muted); font-size:13px; }
h2 { font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted);
  margin:28px 0 8px; }
table { width:100%; border-collapse:collapse; }
td, th { padding:7px 0; border-bottom:1px solid var(--line); text-align:left;
  vertical-align:top; }
th { font-weight:500; color:var(--muted); width:44%; }
td.money, th.money { text-align:right; font-variant-numeric:tabular-nums; }
.total td { font-weight:600; font-size:17px; border-bottom:2px solid var(--ink); }
.sign { display:flex; gap:40px; margin-top:40px; }
.sign div { flex:1; border-top:1px solid var(--ink); padding-top:6px; font-size:13px;
  color:var(--muted); }
.note { font-size:12px; color:var(--muted); margin-top:24px; }
@media print { body { background:#fff; padding:0; } .sheet { border:0; padding:0; } }
@media (max-width:560px) { .sheet { padding:24px 18px; } header { flex-direction:column; } }
"""


def _row(label: str, value: str, money: bool = False) -> str:
    cls = ' class="money"' if money else ""
    return f"<tr><th>{escape(label)}</th><td{cls}>{escape(value)}</td></tr>"


def _dt(moment: datetime) -> str:
    return moment.astimezone(KZ_TZ).strftime("%d.%m.%Y %H:%M")


def render_ticket(loan: Loan, now: datetime, grace_days: int) -> str:
    app = loan.application
    client = app.client
    f = loan_figures(loan, now, grace_days)
    at_due = loan.principal + interest_for(loan.principal, loan.daily_rate_bp, loan.term_days)

    item = [_row("Изделие", app.title), _row("Категория", app.category.name)]
    if app.metal:
        metal = METAL_LABELS[app.metal]
        if app.fineness:
            metal += f", проба {app.fineness}"
        item.append(_row("Металл", metal))
    if app.weight_mg:
        item.append(_row("Вес", f"{app.weight_mg / 1000:.2f} г".replace(".", ",")))
    if app.brand:
        item.append(_row("Бренд", app.brand))
    if app.condition:
        item.append(_row("Состояние", CONDITION_LABELS[app.condition]))
    insp = [a for a in app.appraisals if a.kind.value == "INSPECTION"]
    if insp:
        item.append(_row("Оценка при осмотре", format_kzt(insp[-1].value), money=True))

    terms = [
        _row("Сумма займа", format_kzt(loan.principal), money=True),
        _row("Ставка", format_rate(loan.daily_rate_bp)),
        _row("Срок текущего периода", f"{loan.term_days} дн."),
        _row("Дата выдачи", _dt(loan.issued_at)),
        _row("Вернуть до", f"{f.due_date.strftime('%d.%m.%Y')} включительно"),
        _row("К возврату в срок", format_kzt(at_due), money=True),
        _row("Льготный период", f"до {f.grace_until.strftime('%d.%m.%Y')}"),
        _row("Продлений", str(loan.extensions_count)),
        _row("Статус", LOAN_STATUS_LABELS[loan.status]),
    ]
    payments = "".join(
        f"<tr><td>{escape(_dt(p.created_at))}</td>"
        f"<td>{escape(PAYMENT_KIND_LABELS[p.kind])}</td>"
        f"<td>{escape(p.destination or '—')}</td>"
        f"<td>{escape(PAYMENT_STATUS_LABELS[p.status])}</td>"
        f'<td class="money">{escape(format_kzt(p.amount))}</td></tr>'
        for p in loan.payments
    )
    open_now = loan.status.value in {"ACTIVE", "OVERDUE"}
    today = (
        f'<tr class="total"><td>К оплате на {escape(now.astimezone(KZ_TZ).strftime("%d.%m.%Y"))}'
        f" ({f.days_used} дн.)</td>"
        f'<td class="money">{escape(format_kzt(f.total_to_repay))}</td></tr>'
        if open_now
        else ""
    )
    phone = format_kz_phone(client.phone) if client.phone else "—"
    return f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Залоговый билет {escape(loan.ticket_number)}</title>
<style>{_CSS}</style></head>
<body><main class="sheet">
<header>
  <div><h1>Залоговый билет</h1>
  <div class="muted">ТОО «Ломбард онлайн» · учебный проект · Казахстан</div></div>
  <div style="text-align:right"><div class="num">{escape(loan.ticket_number)}</div>
  <div class="muted">заявка {escape(app.number)}</div></div>
</header>
<h2>Залогодатель</h2>
<table>{_row("ФИО", client.full_name)}{_row("Телефон", phone)}{_row("E-mail", client.email)}</table>
<h2>Предмет залога</h2>
<table>{"".join(item)}</table>
<h2>Условия займа</h2>
<table>{"".join(terms)}{today}</table>
<h2>Операции</h2>
<table><tr><th>Дата</th><th>Операция</th><th>Карта</th><th>Статус</th>
<th class="money">Сумма</th></tr>{payments}</table>
<p class="note">Проценты начисляются за каждый день пользования займом (не меньше одного дня)
с даты выдачи или последнего продления. Если займ не погашен и не продлён до окончания
льготного периода, изделие переходит в собственность ломбарда. Время — Казахстан (UTC+5).
Документ сформирован {escape(_dt(now))}.</p>
<div class="sign"><div>Залогодатель</div><div>Представитель ломбарда</div></div>
</main></body></html>
"""
