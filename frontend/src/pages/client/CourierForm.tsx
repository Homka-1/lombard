import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../api/client";
import { applicationsApi, deliveryApi } from "../../api/endpoints";
import type { Application, VisitInput } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../components/ui/Button";
import { Alert, Spinner } from "../../components/ui/Feedback";
import { ChoiceGroup, Field, Input, Select } from "../../components/ui/Form";
import { Icon } from "../../components/ui/Icon";
import { formatPhoneInput, formatTenge, phoneDigits } from "../../lib/format";
import { addDaysIso, formatSlotDay, formatTimeKz, todayKz } from "./clientLib";
import styles from "./Client.module.css";

export type CourierMode = "pickup" | "reschedule" | "return";

const SUBMIT_LABEL: Record<CourierMode, string> = {
  pickup: "Вызвать курьера",
  reschedule: "Перенести визит",
  return: "Вызвать курьера",
};

type Errors = Partial<Record<"city" | "address" | "slot" | "phone" | "comment" | "form", string>>;

const FIELD: Record<string, keyof Errors> = {
  city: "city",
  address: "address",
  slot_start: "slot",
  contact_phone: "phone",
  comment: "comment",
};

/** Адрес, день и интервал визита курьера — забрать изделие или вернуть его после погашения. */
export function CourierForm({
  app,
  mode,
  onDone,
  onCancel,
}: {
  app: Application;
  mode: CourierMode;
  onDone: (app: Application) => void;
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const visit = app.courier_visit;
  const [city, setCity] = useState(visit?.city ?? app.client.city ?? user?.city ?? "");
  const [address, setAddress] = useState(visit?.address ?? "");
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [phone, setPhone] = useState(
    formatPhoneInput(visit?.contact_phone ?? app.client.phone ?? user?.phone ?? ""),
  );
  const [comment, setComment] = useState(visit?.comment ?? "");
  const [errors, setErrors] = useState<Errors>({});

  const cities = useQuery({ queryKey: ["delivery", "cities"], queryFn: deliveryApi.cities });
  useEffect(() => {
    const list = cities.data;
    if (list?.length && !list.some((c) => c.city === city)) setCity(list[0]!.city);
  }, [cities.data, city]);

  const served = !!cities.data?.some((c) => c.city === city);
  const slots = useQuery({
    queryKey: ["delivery", "slots", city],
    queryFn: () => deliveryApi.slots(city),
    enabled: served,
  });

  const days = useMemo(() => {
    const today = todayKz();
    const tomorrow = addDaysIso(today, 1);
    const seen = new Map<string, boolean>();
    for (const s of slots.data ?? []) seen.set(s.date, (seen.get(s.date) ?? false) || s.available);
    return [...seen].map(([date, any]) => ({
      value: date,
      label: formatSlotDay(date),
      note:
        date === today ? "Сегодня" : date === tomorrow ? "Завтра" : any ? undefined : "Всё занято",
      disabled: !any,
    }));
  }, [slots.data]);

  // первый день со свободными интервалами
  useEffect(() => {
    if (!days.length) return;
    if (!day || !days.some((d) => d.value === day && !d.disabled)) {
      setDay(days.find((d) => !d.disabled)?.value ?? null);
      setSlot(null);
    }
  }, [days, day]);

  const daySlots = (slots.data ?? []).filter((s) => s.date === day);

  const mutation = useMutation({
    mutationFn: (data: VisitInput) => {
      if (mode === "pickup") return applicationsApi.scheduleCourier(app.id, data);
      if (mode === "reschedule") return applicationsApi.rescheduleCourier(app.id, data);
      return applicationsApi.scheduleReturn(app.id, data);
    },
    onSuccess: onDone,
    onError: (err) => {
      const out: Errors = { form: err.message };
      if (err instanceof ApiError)
        for (const f of err.fields) if (FIELD[f.field]) out[FIELD[f.field]!] = f.message;
      setErrors(out);
      if (err instanceof ApiError && err.status === 409) void slots.refetch();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const out: Errors = {};
    if (!served) out.city = "Выберите город";
    if (address.trim().length < 5) out.address = "Укажите улицу, дом и квартиру";
    if (!slot) out.slot = "Выберите удобный интервал";
    const digits = phoneDigits(phone);
    if (digits.length !== 10) out.phone = "Номер в формате +7 7XX XXX-XX-XX";
    setErrors(out);
    if (Object.keys(out).length) return;
    mutation.mutate({
      city,
      address: address.trim(),
      contact_phone: phone,
      slot_start: slot!,
      comment: comment.trim() || null,
    });
  };

  const insured = app.inspection?.value ?? app.offer?.market_value ?? null;

  return (
    <form onSubmit={submit} noValidate className={styles.courierForm}>
      <div className={styles.row2}>
        <Field label="Город" error={errors.city}>
          {(p) => (
            <Select
              {...p}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={!cities.data}
            >
              {!cities.data && <option value={city}>{city || "Загрузка…"}</option>}
              {cities.data?.map((c) => (
                <option key={c.city} value={c.city}>
                  {c.city}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Адрес" error={errors.address} className={styles.grow2}>
          {(p) => (
            <Input
              {...p}
              value={address}
              autoComplete="street-address"
              placeholder="ул. Розыбакиева, 247, кв. 18"
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
        </Field>
      </div>

      {slots.isPending && served ? (
        <div className={styles.loadingRow}>
          <Spinner label="Загружаем свободное время" /> Загружаем свободное время…
        </div>
      ) : slots.isError ? (
        <Alert tone="danger" title="Не удалось загрузить расписание">
          {slots.error.message}
        </Alert>
      ) : (
        <>
          <ChoiceGroup
            label="День"
            value={day}
            onChange={(d) => {
              setDay(d);
              setSlot(null);
            }}
            options={days}
          />
          {day && (
            <ChoiceGroup
              label="Время"
              variant="slot"
              value={slot}
              error={errors.slot}
              onChange={(s) => {
                setSlot(s);
                setErrors((e) => ({ ...e, slot: undefined }));
              }}
              options={daySlots.map((s) => ({
                value: s.start,
                label: s.available ? `${formatTimeKz(s.start)}–${formatTimeKz(s.end)}` : "Занято",
                disabled: !s.available,
              }))}
            />
          )}
        </>
      )}

      <div className={styles.row2}>
        <Field label="Телефон для курьера" error={errors.phone}>
          {(p) => (
            <Input
              {...p}
              type="tel"
              autoComplete="tel"
              value={phone}
              placeholder="+7 701 555-24-18"
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            />
          )}
        </Field>
        <Field label="Комментарий" error={errors.comment}>
          {(p) => (
            <Input
              {...p}
              value={comment}
              maxLength={1000}
              placeholder="Подъезд, домофон, этаж"
              onChange={(e) => setComment(e.target.value)}
            />
          )}
        </Field>
      </div>

      {errors.form && <Alert tone="danger" title={errors.form} />}

      <div className={styles.courierFoot}>
        {mode !== "return" && insured ? (
          <p className={styles.insured}>
            <Icon name="shield" size={22} />
            <span>
              <strong>Изделие застраховано на {formatTenge(insured)}</strong>
              <span>Курьер упакует его в сейф-пакет при вас</span>
            </span>
          </p>
        ) : (
          <p className={styles.insured}>
            <Icon name="shield" size={22} />
            <span>
              <strong>Курьер привезёт изделие в сейф-пакете</strong>
              <span>Вскройте пакет при курьере и проверьте изделие</span>
            </span>
          </p>
        )}
        <div className={styles.actions}>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Отмена
            </Button>
          )}
          <Button type="submit" loading={mutation.isPending}>
            {SUBMIT_LABEL[mode]}
          </Button>
        </div>
      </div>
    </form>
  );
}
