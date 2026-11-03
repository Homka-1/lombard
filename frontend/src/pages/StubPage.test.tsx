import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StubPage } from "./StubPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StubPage />
    </QueryClientProvider>,
  );
}

const healthBody = {
  status: "ok",
  app: "Ломбард онлайн",
  version: "0.1.0",
  environment: "test",
  currency: "KZT",
  time: "2026-11-03T10:00:00Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("StubPage", () => {
  it("shows the API version when /api/health responds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(healthBody)));
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Оценим изделие");
    expect(await screen.findByText(/Сервер на связи/)).toHaveTextContent("версия 0.1.0");
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.any(Object));
  });

  it("explains how to start the backend and lets the user retry", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify(healthBody)));
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер не отвечает");
    await userEvent.click(screen.getByRole("button", { name: "Проверить снова" }));
    expect(await screen.findByText(/Сервер на связи/)).toBeInTheDocument();
  });
});
