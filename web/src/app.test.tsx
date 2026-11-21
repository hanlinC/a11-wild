import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./app";
import { OWNER, stubApi } from "./test-helpers";

const renderApp = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

afterEach(() => window.history.replaceState(null, "", "/"));

describe("dashboard", () => {
  it("shows only the sign-in page to a visitor with no session", async () => {
    stubApi({ "GET /api/me": () => ({ status: 401, body: { error: "signed_out" } }) });
    renderApp("/connections");

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText(/mcp/i)).not.toBeInTheDocument();
  });

  it("tells an uninvited person why sign-in was refused", async () => {
    window.history.replaceState(null, "", "/signed-out?reason=denied");
    stubApi({ "GET /api/me": () => ({ status: 401, body: { error: "signed_out" } }) });
    renderApp("/signed-out");

    expect(await screen.findByText(/not on the invitation list/i)).toBeInTheDocument();
  });

  it("does not put an unknown reason from the address on the page", async () => {
    window.history.replaceState(null, "", "/signed-out?reason=%3Cb%3Eowned%3C%2Fb%3E");
    stubApi({ "GET /api/me": () => ({ status: 401, body: { error: "signed_out" } }) });
    renderApp("/signed-out");

    await screen.findByRole("link", { name: "Sign in" });
    expect(screen.queryByText(/owned/)).not.toBeInTheDocument();
  });

  it("says the studio did not answer when the session check fails for another reason", async () => {
    stubApi({ "GET /api/me": () => ({ status: 502, body: {} }) });
    renderApp();

    expect(await screen.findByText(/did not answer/i)).toBeInTheDocument();
  });

  it("shows the studio with honest empty states to a signed-in owner", async () => {
    stubApi({
      "GET /api/me": () => ({ body: OWNER }),
      "GET /api/health": () => ({ body: { ok: true, buildId: "abc123" } }),
      "GET /api/batches": () => ({ body: { batches: [] } }),
    });
    renderApp();

    expect(await screen.findByRole("heading", { name: "Studio" })).toBeInTheDocument();
    expect(await screen.findByText(/no batch yet/i)).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/mcp`)).toBeInTheDocument();
    expect(screen.getAllByText("Live")).toHaveLength(6);
    expect(screen.queryByText("Not built yet")).not.toBeInTheDocument();
    expect(screen.getByText(/owner@example\.com/)).toBeInTheDocument();
    expect(await screen.findByText("Build abc123")).toBeInTheDocument();
  });

  it("lists the batches on the studio page, each with a link to its board", async () => {
    const at = "2026-11-22T03:00:00.000Z";
    stubApi({
      "GET /api/me": () => ({ body: OWNER }),
      "GET /api/health": () => ({ body: { ok: true, buildId: "abc123" } }),
      "GET /api/batches": () => ({
        body: {
          batches: [
            {
              batch: { id: "b1", brandId: "br1", productId: "p1", format: "static_4x5", label: "First run", state: "waiting_pick", createdAt: at, updatedAt: at, createdBy: "owner@example.com" },
              brand: { id: "br1", name: "WonGi" },
              product: { id: "p1", name: "Seaweed crisps" },
            },
          ],
        },
      }),
    });
    renderApp();

    expect(await screen.findByRole("link", { name: "First run" })).toHaveAttribute("href", "/batches/b1");
    expect(screen.getByText("WonGi: Seaweed crisps")).toBeInTheDocument();
    expect(screen.getByText("waiting pick")).toBeInTheDocument();
    expect(screen.queryByText(/no batch yet/i)).not.toBeInTheDocument();
  });
});
