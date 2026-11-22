import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderSignedIn, stubApi } from "@/test-helpers";
import { Templates } from "./templates";

const steps = [
  { titles: ["New ad for {Brand}", "{Brand}, I made this for you"], body: "Hi, I made this ad for {Brand}." },
  { titles: ["Re: New ad for {Brand}", "{Brand}, still yours"], body: "Hi, Han again." },
  { titles: ["Last one, {Brand}", "{Brand}, one more before I go"], body: "Hi, last note from me." },
];
const page = (extra: object = {}) => ({ templates: { steps, savedAt: "2026-11-22T08:00:00.000Z" }, daily: 5, dailyMin: 1, dailyMax: 20, placeholder: "{Brand}", ...extra });

describe("Messages page", () => {
  it("shows the three messages with both titles, and saves his change", async () => {
    let sent: { steps: typeof steps } | undefined;
    stubApi({ "GET /api/outreach/templates": () => ({ body: page() }), "POST /api/outreach/templates": (body) => ((sent = body as { steps: typeof steps }), { body: { templates: { steps, savedAt: "2026-11-23T08:00:00.000Z" } } }) });
    renderSignedIn(<Templates />);
    expect(await screen.findAllByLabelText("Title, version 2")).toHaveLength(3);
    expect(screen.getAllByLabelText("Title, version 1")[2]).toHaveValue("Last one, {Brand}");
    const first = screen.getAllByLabelText("Text")[0]!;
    await userEvent.clear(first);
    await userEvent.type(first, "Hello.");
    await userEvent.click(screen.getByRole("button", { name: "Save the messages" }));
    expect(await screen.findByText("The messages are saved.")).toBeInTheDocument();
    expect(sent?.steps[0]?.body).toBe("Hello.");
    expect(sent?.steps[1]).toEqual(steps[1]);
  });

  it("shows the server's reason when a message is refused, and saves the daily number", async () => {
    let daily: unknown;
    stubApi({
      "GET /api/outreach/templates": () => ({ body: page({ templates: undefined }) }),
      "POST /api/outreach/templates": () => ({ status: 400, body: { error: "refused", message: "The first message holds a placeholder the studio does not know: {Name}." } }),
      "POST /api/outreach/daily": (body) => ((daily = body), { body: { daily: 8 } }),
    });
    renderSignedIn(<Templates />);
    for (const field of await screen.findAllByRole("textbox")) await userEvent.type(field, "x");
    await userEvent.click(screen.getByRole("button", { name: "Save the messages" }));
    expect(await screen.findByText(/placeholder the studio does not know/)).toBeInTheDocument();
    const number = screen.getByRole("spinbutton");
    await userEvent.clear(number);
    await userEvent.type(number, "8");
    await userEvent.click(screen.getByRole("button", { name: "Save the number" }));
    await waitFor(() => expect(daily).toEqual({ daily: 8 }));
    expect(await screen.findByText("The daily number is saved.")).toBeInTheDocument();
  });
});
