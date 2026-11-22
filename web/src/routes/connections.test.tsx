import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { client, MEMBER, OWNER, renderSignedIn, stubApi } from "@/test-helpers";
import { Connections } from "./connections";

const section = (name: RegExp) => screen.getByRole("heading", { name }).closest("section")!;

describe("Connections page", () => {
  it("shows a waiting program with its name, return address and first sign-in", async () => {
    stubApi({ "GET /api/clients": () => ({ body: { clients: [client()] } }) });
    renderSignedIn(<Connections />);

    const waiting = within(await waitFor(() => section(/waiting for approval/i)));
    expect(await waiting.findByText("Devin")).toBeInTheDocument();
    expect(waiting.getByText("https://agent.example.com/callback")).toBeInTheDocument();
    expect(waiting.getByText(/signed in as owner@example\.com/)).toBeInTheDocument();
    expect(waiting.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("leads with the program that waits, before the address and the approved programs", async () => {
    stubApi({ "GET /api/clients": () => ({ body: { clients: [client({ clientId: "client-2", name: "Older", status: "approved" }), client()] } }) });
    renderSignedIn(<Connections />);

    expect(await screen.findByRole("status")).toHaveTextContent("Asked of you1 program waits for your approval, and can do nothing until then. Approve only a program you started yourself, and check where it sends you back to.");
    const order = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(order).toEqual(["Waiting for approval1", "Connect an agent", "Approved1"]);
    // One filled button on the page: the approval.
    expect(within(section(/waiting for approval/i)).getAllByRole("button").map((button) => button.textContent)).toEqual(["Approve", "Reject"]);
  });

  it("names the time zone beside each time", async () => {
    stubApi({ "GET /api/clients": () => ({ body: { clients: [client()] } }) });
    renderSignedIn(<Connections />);
    const zone = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" }).formatToParts(new Date("2026-11-21T10:00:00.000Z")).find((part) => part.type === "timeZoneName")!.value;
    expect(await screen.findByText(new RegExp(`${zone.replace("+", "\\+")} · signed in as`))).toBeInTheDocument();
  });

  it("approves a program and moves it to the approved list", async () => {
    const calls = stubApi({
      "GET /api/clients": () => ({ body: { clients: [client()] } }),
      "POST /api/clients/client-1/approve": () => ({
        body: { client: client({ status: "approved", decidedAt: "2026-11-21T10:05:00.000Z" }) },
      }),
    });
    renderSignedIn(<Connections />);

    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(within(section(/^approved/i)).getByText("Devin")).toBeInTheDocument());
    // Nothing waits any more: the section is gone, and the page says so.
    expect(screen.queryByRole("heading", { name: /waiting for approval/i })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No program waits for approval.");
    expect(calls).toContain("POST /api/clients/client-1/approve");
  });

  it("asks once more before it removes a program", async () => {
    const calls = stubApi({
      "GET /api/clients": () => ({ body: { clients: [client({ status: "approved" })] } }),
      "POST /api/clients/client-1/revoke": () => ({ body: { client: client({ status: "revoked" }) } }),
    });
    renderSignedIn(<Connections />);

    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    expect(calls).not.toContain("POST /api/clients/client-1/revoke");

    await userEvent.click(screen.getByRole("button", { name: "Yes, remove it" }));
    // A removed program is folded away: one row with a count, and the program inside it.
    const removed = await screen.findByRole("button", { name: /^Removed\s*1$/ });
    expect(screen.queryByText("Devin")).not.toBeInTheDocument();
    await userEvent.click(removed);
    expect(within(section(/^removed/i)).getByText("Devin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("keeps the program when the owner backs out of removing it", async () => {
    const calls = stubApi({ "GET /api/clients": () => ({ body: { clients: [client({ status: "approved" })] } }) });
    renderSignedIn(<Connections />);

    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));

    expect(calls).toEqual(["GET /api/clients"]);
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
  });

  it("gives a member the list but no way to approve or remove", async () => {
    stubApi({
      "GET /api/clients": () => ({ body: { clients: [client(), client({ clientId: "client-2", status: "approved" })] } }),
    });
    renderSignedIn(<Connections />, MEMBER);

    expect(await screen.findAllByText("Devin")).toHaveLength(2);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Copy address"]);
    expect(screen.getByText(/only the owner can approve or remove/i)).toBeInTheDocument();
    expect(screen.getByText("1 program waits for the owner's approval, and can do nothing until then.")).toBeInTheDocument();
    expect(screen.getByText("Nothing is asked of you")).toBeInTheDocument();
  });

  it("shows a program's name as text, never as markup", async () => {
    const name = '<img src=x onerror="alert(1)"><b>Trusted</b>';
    stubApi({ "GET /api/clients": () => ({ body: { clients: [client({ name })] } }) });
    const { container } = renderSignedIn(<Connections />);

    expect(await screen.findByText(name)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("says so when nothing is waiting and nothing is connected", async () => {
    stubApi({ "GET /api/clients": () => ({ body: { clients: [] } }) });
    renderSignedIn(<Connections />);

    expect(await screen.findByRole("status")).toHaveTextContent("Nothing is asked of youNo program waits for approval. One shows here after it signs in for the first time");
    expect(screen.queryByRole("heading", { name: /waiting for approval/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no program is connected yet/i)).toBeInTheDocument();
  });

  it("tells the owner when an approval fails and shows the true state again", async () => {
    let listCalls = 0;
    stubApi({
      "GET /api/clients": () => ({ body: { clients: (listCalls += 1) === 1 ? [client()] : [] } }),
      "POST /api/clients/client-1/approve": () => ({ status: 404, body: { error: "not_found" } }),
    });
    renderSignedIn(<Connections />, OWNER);

    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));

    expect(await screen.findByText("That is no longer there.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Devin")).not.toBeInTheDocument());
  });

  it("gives the address an agent connects to, also before the list has loaded", async () => {
    stubApi({ "GET /api/clients": () => ({ body: { clients: [] } }) });
    renderSignedIn(<Connections />);
    expect(screen.getByRole("heading", { name: "Connect an agent" })).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/mcp`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
  });

  it("tells the person when the session has ended", async () => {
    stubApi({ "GET /api/clients": () => ({ status: 401, body: { error: "signed_out" } }) });
    renderSignedIn(<Connections />);

    expect(await screen.findByText("Your session ended. Sign in again.")).toBeInTheDocument();
  });
});
