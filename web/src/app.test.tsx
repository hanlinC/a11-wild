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
      "GET /api/attention": () => ({ body: { batches: [], lines: [], counts: { studio: 0, outreach: 0, clients: 0, taste: 0, connections: 0 } } }),
    });
    renderApp();

    expect(await screen.findByRole("heading", { name: "Studio" })).toBeInTheDocument();
    expect(await screen.findByText(/nothing waits for you/i)).toBeInTheDocument();
    expect(screen.getByText(/no batch is in work/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect one" })).toHaveAttribute("href", "/connections");
    expect(screen.queryByText(/mcp/i)).not.toBeInTheDocument();
    expect(screen.queryByText("What the studio does")).not.toBeInTheDocument();
    expect(screen.getByText(/owner@example\.com/)).toBeInTheDocument();
    expect(await screen.findByText("Build abc123")).toBeInTheDocument();
  });
});
