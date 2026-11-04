import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { validatePhotos } from "../../lib/photos";
import { Accordion } from "./Accordion";
import { Button } from "./Button";
import { StatusBadge } from "./Feedback";
import { Field, Input, Segmented } from "./Form";
import { Modal } from "./Modal";
import { Stepper } from "./Stepper";
import { ToastProvider, useToast } from "./Toast";
import { Uploader } from "./Uploader";

describe("Button", () => {
  it("disables itself and reports busy state while loading", () => {
    render(<Button loading>Отправить</Button>);
    const btn = screen.getByRole("button", { name: "Отправить" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
});

describe("StatusBadge", () => {
  it("uses labels and tones from design tokens", () => {
    render(<StatusBadge status="OFFER_SENT" />);
    const badge = screen.getByText("Предложение");
    expect(badge).toHaveAttribute("data-tone", "gold");
  });

  it("falls back to the raw status", () => {
    render(<StatusBadge status="SOMETHING_NEW" />);
    expect(screen.getByText("SOMETHING_NEW")).toHaveAttribute("data-tone", "neutral");
  });
});

describe("Field", () => {
  it("links label, hint and error to the control", () => {
    const { rerender } = render(
      <Field label="Вес" hint="Без камней">
        {(f) => <Input {...f} suffix="г" />}
      </Field>,
    );
    const input = screen.getByLabelText("Вес");
    expect(input).toHaveAccessibleDescription("Без камней");
    expect(input).not.toHaveAttribute("aria-invalid");

    rerender(
      <Field label="Вес" hint="Без камней" error="Укажите вес">
        {(f) => <Input {...f} suffix="г" />}
      </Field>,
    );
    expect(screen.getByLabelText("Вес")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Вес")).toHaveAccessibleDescription("Укажите вес");
  });
});

describe("Segmented", () => {
  it("is a radio group operated by click", async () => {
    function Demo() {
      const [v, setV] = useState("gold");
      return (
        <Segmented
          label="Металл"
          value={v}
          onChange={setV}
          options={[
            { value: "gold", label: "Золото" },
            { value: "silver", label: "Серебро" },
          ]}
        />
      );
    }
    render(<Demo />);
    const group = screen.getByRole("radiogroup", { name: "Металл" });
    expect(within(group).getByRole("radio", { name: "Золото" })).toBeChecked();
    await userEvent.click(within(group).getByText("Серебро"));
    expect(within(group).getByRole("radio", { name: "Серебро" })).toBeChecked();
  });
});

describe("Stepper", () => {
  it("marks done steps and the current one", () => {
    render(<Stepper steps={["Изделие", "Параметры", "Фото", "Проверка"]} current={2} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Изделие — готово");
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(items[3]).not.toHaveAttribute("aria-current");
  });
});

describe("Modal", () => {
  it("opens as a labelled dialog and closes via the close button", async () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Открыть</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Отказаться от предложения?">
            <p>Заявка будет закрыта.</p>
          </Modal>
        </>
      );
    }
    render(<Demo />);
    expect(screen.queryByText("Заявка будет закрыта.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Открыть"));
    const dialog = screen.getByRole("dialog", { name: "Отказаться от предложения?" });
    expect(dialog).toHaveAttribute("open");
    await userEvent.click(within(dialog).getByRole("button", { name: "Закрыть" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(screen.queryByText("Заявка будет закрыта.")).not.toBeInTheDocument();
  });
});

describe("Toast", () => {
  it("shows a message and hides it after a few seconds", () => {
    vi.useFakeTimers();
    function Demo() {
      const toast = useToast();
      return <button onClick={() => toast.show({ title: "Курьер вызван" })}>Вызвать</button>;
    }
    render(
      <ToastProvider>
        <Demo />
      </ToastProvider>,
    );
    act(() => screen.getByText("Вызвать").click());
    expect(screen.getByRole("status")).toHaveTextContent("Курьер вызван");
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.queryByText("Курьер вызван")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("Accordion", () => {
  it("renders questions as disclosure widgets", () => {
    render(
      <Accordion
        defaultOpen="a"
        items={[
          { id: "a", title: "Какие изделия вы принимаете?", content: "Золото" },
          { id: "b", title: "Как вернуть изделие?", content: "Курьером" },
        ]}
      />,
    );
    const groups = screen.getAllByRole("group");
    expect(groups[0]).toHaveAttribute("open");
    expect(groups[1]).not.toHaveAttribute("open");
  });
});

const file = (name: string, type: string, size = 1000) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("Uploader", () => {
  it("validates type, size and count", () => {
    const { accepted, errors } = validatePhotos(
      [
        file("a.jpg", "image/jpeg"),
        file("doc.pdf", "application/pdf"),
        file("big.png", "image/png", 11 * 1024 * 1024),
        file("b.webp", "image/webp"),
        file("c.jpg", "image/jpeg"),
      ],
      4,
    );
    expect(accepted.map((f) => f.name)).toEqual(["a.jpg", "b.webp"]);
    expect(errors).toEqual([
      "«doc.pdf»: нужен JPG, PNG или WebP",
      "«big.png»: больше 10 МБ",
      "Можно загрузить не больше 6 фото",
    ]);
  });

  it("adds chosen photos with previews and removes them", async () => {
    function Demo() {
      const [files, setFiles] = useState<File[]>([]);
      return <Uploader files={files} onChange={setFiles} />;
    }
    const { container } = render(<Demo />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, [file("ring.jpg", "image/jpeg"), file("stamp.png", "image/png")]);
    expect(screen.getByRole("list", { name: "Загружено фото: 2 из 6" })).toBeInTheDocument();
    expect(screen.getByAltText("Фото 1: ring.jpg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Удалить фото 1" }));
    expect(screen.getByRole("list", { name: "Загружено фото: 1 из 6" })).toBeInTheDocument();
    expect(screen.getByAltText("Фото 1: stamp.png")).toBeInTheDocument();
  });
});
