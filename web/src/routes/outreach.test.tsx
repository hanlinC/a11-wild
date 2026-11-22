import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { adView, firstLine, prospectPage, prospectRow, todayPage } from "@/outreach-fixtures";
import { MEMBER, renderSignedIn, stubApi } from "@/test-helpers";
import { Outreach } from "./outreach";

const section = (name: string) => within(screen.getByRole("heading", { name: new RegExp(`^${name}`) }).closest("section")!);

describe("Today page", () => {
  it("shows the three groups in order, the day's count and the empty state of each group", async () => {
    stubApi({ "GET /api/outreach/today": () => ({ body: todayPage() }) });
    renderSignedIn(<Outreach />);
    expect(await screen.findByRole("status")).toHaveTextContent("3 of 5 first messages sent today");
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Replies that are owed an answer0", "Follow-ups due0", "New first messages0", "Ads that wait for your yes or no0"]);
    expect(section("Replies").getByText("No reply waits for your answer.")).toBeInTheDocument();
    expect(section("Follow-ups").getByText("No follow-up is due today.")).toBeInTheDocument();
    expect(section("New first").getByText(/No brand is ready/)).toBeInTheDocument();
    expect(section("Ads that wait").getByText("No ad waits for you.")).toBeInTheDocument();
  });

  it("says that a Saturday is not a planned day, names the next one, and still offers the messages to send", async () => {
    const owed = { prospect: prospectRow({ stage: "replied" }), reply: { text: "Show me another.", at: "2026-11-20T03:00:00.000Z" } };
    stubApi({ "GET /api/outreach/today": () => ({ body: todayPage({ day: "2026-11-21", sendingDay: false, nextSendingDay: "2026-11-23", owed: [owed], firsts: [firstLine()] }) }) });
    renderSignedIn(<Outreach />);
    expect(await screen.findByRole("status")).toHaveTextContent("3 of 5 first messages sent today, Sat, 21 Nov 2026. Not a planned sending day: the next one is Mon, 23 Nov 2026. You can still send today.");
    expect(section("Replies").getByText("Show me another.")).toBeInTheDocument();
    expect(section("New first").getByRole("button", { name: "Mark as sent" })).toBeInTheDocument();
    expect(section("Follow-ups").getByText("No follow-up is due today.")).toBeInTheDocument();
  });

  it("gives a first message its ad, both titles and the four actions, and marks it as sent with the title he chose", async () => {
    let sent: unknown;
    stubApi({
      // After the mark the day holds one more, and the line is gone.
      "GET /api/outreach/today": () => ({ body: sent ? todayPage({ firstsSent: 4 }) : todayPage({ firsts: [firstLine()] }) }),
      "POST /api/outreach/prospects/00001/sent": (body) => ((sent = body), { body: prospectPage() }),
    });
    renderSignedIn(<Outreach />);
    const line = within((await screen.findByRole("link", { name: "Koi Tea" })).closest("li")!);
    expect(line.getByRole("img", { name: "Ad 1 for Koi Tea" })).toBeInTheDocument();
    expect(line.getByRole("button", { name: "Copy the text" })).toBeInTheDocument();
    expect(line.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", "https://wa.me/6580000001?text=one");
    expect(line.getByRole("link", { name: "Save the picture" })).toHaveAttribute("href", "https://pictures.example/1.png?download=1");
    await userEvent.click(line.getByRole("radio", { name: "Koi Tea, I made this for you" }));
    expect(line.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", "https://wa.me/6580000001?text=two");
    await userEvent.click(line.getByRole("button", { name: "Mark as sent" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("4 of 5"));
    expect(sent).toEqual({ step: 0, title: 1 });
    expect(screen.queryByRole("link", { name: "Koi Tea" })).not.toBeInTheDocument();
  });

  it("leaves the line and shows the reason when the save fails", async () => {
    stubApi({
      "GET /api/outreach/today": () => ({ body: todayPage({ firsts: [firstLine()] }) }),
      "POST /api/outreach/prospects/00001/sent": () => ({ status: 400, body: { error: "refused", message: "Today's 5 first messages are sent. More can go tomorrow, or raise the daily number." } }),
    });
    renderSignedIn(<Outreach />);
    await userEvent.click(await screen.findByRole("button", { name: "Mark as sent" }));
    expect(await screen.findByText(/Today's 5 first messages are sent/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Koi Tea" })).toBeInTheDocument();
  });

  it("takes a yes to an ad that waits, and a no only with his words", async () => {
    const sent: unknown[] = [];
    stubApi({
      "GET /api/outreach/today": () => ({ body: todayPage({ adsWaiting: [{ prospect: prospectRow({ stage: "ad_waits", adWaits: true }), ad: adView() }] }) }),
      "POST /api/outreach/prospects/00001/ad": (body) => (sent.push(body), { body: prospectPage() }),
    });
    renderSignedIn(<Outreach />);
    await userEvent.click(await screen.findByRole("button", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Save the no" }));
    expect(sent).toEqual([]);
    await userEvent.type(screen.getByLabelText(/What is wrong with it/), "The cup is too small.");
    await userEvent.click(screen.getByRole("button", { name: "Save the no" }));
    await waitFor(() => expect(sent).toEqual([{ ad: 1, yes: false, ownerSaid: "The cup is too small." }]));
  });

  it("lists a brand whose drafts wait for his pick with one link to its page, and no section when none waits", async () => {
    stubApi({ "GET /api/outreach/today": () => ({ body: todayPage({ picks: [{ prospect: prospectRow({ stage: "pick_waits" }), drafts: 8 }] }) }) });
    const first = renderSignedIn(<Outreach />);
    expect(await screen.findByText(/8 drafts to choose from/)).toBeInTheDocument();
    const picks = section("Brands that wait for your pick");
    expect(picks.getByRole("link", { name: "Pick the ad" })).toHaveAttribute("href", "/outreach/prospects/00001");
    expect(picks.queryByRole("button")).not.toBeInTheDocument();
    first.unmount();
    stubApi({ "GET /api/outreach/today": () => ({ body: todayPage() }) });
    renderSignedIn(<Outreach />);
    await screen.findAllByRole("heading", { level: 2 });
    expect(screen.queryByRole("heading", { name: /Brands that wait for your pick/ })).not.toBeInTheDocument();
  });

  it("shows a brand name with markup as text", async () => {
    stubApi({ "GET /api/outreach/today": () => ({ body: todayPage({ firsts: [firstLine({ prospect: prospectRow({ brand: '<img src=x onerror="alert(1)">' }) })] }) }) });
    renderSignedIn(<Outreach />);
    expect(await screen.findByRole("link", { name: '<img src=x onerror="alert(1)">' })).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  it("shows a member the refusal", async () => {
    stubApi({ "GET /api/outreach/today": () => ({ status: 403, body: { error: "owner_only" } }) });
    renderSignedIn(<Outreach />, MEMBER);
    expect(await screen.findByText("Only the owner can do that.")).toBeInTheDocument();
  });
});
