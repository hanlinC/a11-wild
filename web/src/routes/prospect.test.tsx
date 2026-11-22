import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adView, candidates, messages, prospectPage, prospectRow } from "@/outreach-fixtures";
import { renderSignedIn, stubApi } from "@/test-helpers";
import { Prospect } from "./prospect";

const open = () =>
  renderSignedIn(
    <Routes>
      <Route path="outreach/prospects/:id" element={<Prospect />} />
      <Route path="outreach/prospects" element={<p>The list</p>} />
    </Routes>,
    undefined,
    "/outreach/prospects/00001",
  );
const GET = "GET /api/outreach/prospects/00001";
const sendOf = (day: string) => ({ step: 0 as const, day, channel: "whatsapp" as const, title: "New ad for Koi Tea", text: "Hi", at: `${day}T03:00:00.000Z` });

afterEach(() => vi.restoreAllMocks());

describe("Prospect page", () => {
  it("shows the contact: a checked value as a link, any other as text", async () => {
    stubApi({ [GET]: () => ({ body: prospectPage({ contact: { whatsapp: [{ number: "6580000001", href: "https://wa.me/6580000001" }], instagram: { name: "javascript:alert(1)" }, decisionMaker: "A Person", dmTitle: "Founder" } }) }) });
    open();
    expect(await screen.findByRole("link", { name: "+6580000001" })).toHaveAttribute("href", "https://wa.me/6580000001");
    expect(screen.getByText("javascript:alert(1)").closest("a")).toBeNull();
    expect(screen.getByText("A Person, Founder")).toBeInTheDocument();
  });

  it("shows the message to send now, and the timeline newest first", async () => {
    stubApi({
      [GET]: () => ({
        body: prospectPage({
          message: { step: 0, messages: messages() },
          events: [
            { id: "e2", type: "note", text: "Met at a fair.", at: "2026-11-23T02:00:00.000Z", by: "owner" },
            { id: "e1", type: "ad_yes", ad: 1, at: "2026-11-23T01:30:00.000Z", by: "owner" },
          ],
        }),
      }),
    });
    open();
    expect(await screen.findByRole("button", { name: "Mark as sent" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent).filter((text) => /Note|Yes to|attached/.test(text ?? "")).map((text) => text!.split(/You|The agent/)[0])).toEqual(["Note: Met at a fair.", "Yes to ad 1.", "Ad 1 attached: The cup on its own colour."]);
  });

  it("uploads the owner's own picture from his computer, and shows it as his ad with his yes", async () => {
    const own = adView({ from: "owner", batchId: "owner", verdict: "yes", why: "Your own picture, uploaded from your computer." });
    const calls = stubApi({
      [GET]: () => ({ body: prospectPage({ ads: [] }) }),
      "POST /api/outreach/prospects/00001/picture": (sent) => {
        const { type, bytes } = sent as { type: string; bytes: number };
        return { body: { uploadId: "u1", putUrl: `/put?type=${type}&bytes=${bytes}` } };
      },
      "PUT /put?type=image/png&bytes=3": () => ({ body: {} }),
      "POST /api/outreach/prospects/00001/picture/u1/done": () => ({ body: prospectPage({ ads: [own], message: { step: 0, messages: messages() } }) }),
    });
    const user = userEvent.setup();
    open();
    await user.upload(await screen.findByLabelText("Choose your picture"), new File(["PNG"], "ad.png", { type: "image/png" }));
    expect(await screen.findByText("Your upload")).toBeInTheDocument();
    expect(screen.getByText("You said yes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeInTheDocument();
    expect(screen.getByText("Ad 1 uploaded from your computer.")).toBeInTheDocument();
    expect(calls.filter((call) => !call.startsWith("GET"))).toEqual(["POST /api/outreach/prospects/00001/picture", "PUT /put?type=image/png&bytes=3", "POST /api/outreach/prospects/00001/picture/u1/done"]);
  });

  it("sends no file that is not a JPEG or a PNG, or that is too large, and says why the studio kept none", async () => {
    const calls = stubApi({
      [GET]: () => ({ body: prospectPage({ ads: [] }) }),
      "POST /api/outreach/prospects/00001/picture": () => ({ body: { uploadId: "u1", putUrl: "/put" } }),
      "PUT /put": () => ({ body: {} }),
      "POST /api/outreach/prospects/00001/picture/u1/done": () => ({ status: 400, body: { error: "refused", message: "This file is not a JPEG or a PNG picture. Nothing of it was kept." } }),
    });
    // applyAccept is off: a person can still drop any file on the field.
    const user = userEvent.setup({ applyAccept: false });
    open();
    const field = await screen.findByLabelText("Choose your picture");
    await user.upload(field, new File(["%PDF"], "ad.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("Choose a JPEG or a PNG picture.")).toBeInTheDocument();
    const large = new File(["x"], "ad.png", { type: "image/png" });
    Object.defineProperty(large, "size", { value: 8_000_001 });
    await user.upload(field, large);
    expect(await screen.findByText("The picture can be up to 8 MB.")).toBeInTheDocument();
    expect(calls.filter((call) => !call.startsWith("GET"))).toEqual([]);
    await user.upload(field, new File(["MZ"], "ad.png", { type: "image/png" }));
    expect(await screen.findByText("This file is not a JPEG or a PNG picture. Nothing of it was kept.")).toBeInTheDocument();
  });

  it("offers no upload for a contact that opted out", async () => {
    stubApi({ [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ stage: "opted_out" }) }) }) });
    open();
    expect(await screen.findByText(/This contact opted out/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Choose your picture")).not.toBeInTheDocument();
  });

  it("asks once before an opt-out, and the brand then offers no action", async () => {
    let asked = 0;
    stubApi({
      [GET]: () => ({ body: prospectPage() }),
      "POST /api/outreach/prospects/00001/optout": () => ((asked += 1), { body: prospectPage({ prospect: prospectRow({ stage: "opted_out" }) }) }),
    });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Opt this contact out" }));
    expect(asked).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Yes, opt out" }));
    expect(await screen.findByText(/This contact opted out/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save the note" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
  });

  it("offers take back on the day of the mark only", async () => {
    stubApi({ [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ stage: "contacted" }), sends: [sendOf("2026-11-23")] }) }) });
    const { unmount } = open();
    expect(await screen.findByRole("button", { name: 'Take back "First message sent"' })).toBeInTheDocument();
    unmount();
    stubApi({ [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ stage: "contacted" }), sends: [sendOf("2026-11-20")] }) }) });
    open();
    expect(await screen.findByRole("button", { name: "They said more" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Take back/ })).not.toBeInTheDocument();
  });

  it("logs a reply of more with its text, and asks before a no", async () => {
    const sent: unknown[] = [];
    stubApi({
      [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ stage: "contacted" }), sends: [sendOf("2026-11-20")] }) }),
      "POST /api/outreach/prospects/00001/reply": (body) => (sent.push(body), { body: prospectPage({ prospect: prospectRow({ stage: "replied" }), sends: [sendOf("2026-11-20")], owed: { text: "Show me another.", at: "2026-11-23T03:00:00.000Z" } }) }),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    open();
    await userEvent.type(await screen.findByLabelText(/Log a reply/), "Show me another.");
    await userEvent.click(screen.getByRole("button", { name: "They said no" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "They said more" }));
    expect(await screen.findByRole("heading", { name: "A reply waits for your answer" })).toBeInTheDocument();
    expect(sent).toEqual([{ reply: "more", text: "Show me another." }]);
  });

  it("removes a test prospect, and offers no removal for a brand of the list", async () => {
    stubApi({ [GET]: () => ({ body: prospectPage({ ads: [adView()] }) }) });
    const { unmount } = open();
    expect(await screen.findByRole("button", { name: "Yes, send this ad" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove the test prospect" })).not.toBeInTheDocument();
    unmount();
    const calls = stubApi({ [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ test: true }) }) }), "POST /api/outreach/prospects/00001/remove": () => ({ body: { removed: true } }) });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Remove the test prospect" }));
    expect(await screen.findByText("The list")).toBeInTheDocument();
    await waitFor(() => expect(calls).toContain("POST /api/outreach/prospects/00001/remove"));
  });
});

describe("the owner's pick on the prospect page", () => {
  const waiting = (overrides = {}) => prospectPage({ prospect: prospectRow({ stage: "pick_waits" }), ads: [], candidates: candidates(overrides) });

  it("shows every draft under its headline before anything else, and a failed one with its reason and no button", async () => {
    stubApi({ [GET]: () => ({ body: waiting() }) });
    open();
    expect(await screen.findByRole("heading", { name: /Pick the ad to send/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "One fork tap and it crumbles." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your visiting gift, baked fresh." })).toBeInTheDocument();
    expect(screen.getByText("Twelve tarts in a box.")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /^Draft \d of/ })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Pick this one" })).toHaveLength(3);
    expect(screen.getByText("Cannot be sent: The box is too tall.")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent by a pick/)).toBeInTheDocument();
    // A picture opens large in a new tab: a click on it picks nothing.
    expect(screen.getAllByRole("link", { name: /^Draft \d of/ })[0]).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
  });

  it("saves the pick of one draft, and then says that the agent makes it full size", async () => {
    const sent: unknown[] = [];
    stubApi({
      [GET]: () => ({ body: waiting() }),
      "POST /api/outreach/prospects/00001/pick": (body) => (
        sent.push(body),
        { body: prospectPage({ prospect: prospectRow({ stage: "pick_made" }), ads: [], candidates: candidates({ waits: false, agentOwes: true, picked: { ideaId: "idea-2", imageId: "idea-2-draft-1" } }) }) }
      ),
    });
    open();
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Pick this one" }))[2]!);
    expect(sent).toEqual([{ imageId: "idea-2-draft-1" }]);
    expect(await screen.findByText("Your pick")).toBeInTheDocument();
    expect(screen.getByText(/Waits for the agent: it makes the full-size version of your pick/)).toBeInTheDocument();
    // He can still pick another, and no longer says none: he has picked.
    expect(screen.getAllByRole("button", { name: "Pick this one" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "None of these" })).not.toBeInTheDocument();
  });

  it("asks for one line with none of these, and with other words for one draft", async () => {
    const sent: unknown[] = [];
    stubApi({
      [GET]: () => ({ body: waiting() }),
      "POST /api/outreach/prospects/00001/none": (body) => (sent.push(body), { body: prospectPage({ prospect: prospectRow({ stage: "new" }), ads: [], candidates: candidates({ waits: false }) }) }),
      "POST /api/outreach/prospects/00001/words": (body) => (
        sent.push(body),
        { body: prospectPage({ prospect: prospectRow({ stage: "pick_made" }), ads: [], candidates: candidates({ waits: false, agentOwes: true, choosing: "agent", wordsAsked: { imageId: "idea-1-draft-2", ownerSaid: "Say the price." } }) }) }
      ),
    });
    const user = userEvent.setup();
    const first = open();
    await user.click(await screen.findByRole("button", { name: "None of these" }));
    await user.type(screen.getByLabelText(/What is missing, in one line/), "The headlines say nothing.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([{ ownerSaid: "The headlines say nothing." }]));
    first.unmount();
    open();
    await user.click((await screen.findAllByRole("button", { name: "Other words" }))[1]!);
    await user.type(screen.getByLabelText(/Draft 2 with other words/), "Say the price.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/it sets the other words you asked for \("Say the price\."\)/)).toBeInTheDocument();
    expect(sent[1]).toEqual({ imageId: "idea-1-draft-2", ownerSaid: "Say the price." });
    expect(screen.queryByRole("button", { name: "Pick this one" })).not.toBeInTheDocument();
  });

  it("offers no other words when the pictures carry none, and no choice for a brand that takes no ad", async () => {
    stubApi({ [GET]: () => ({ body: waiting({ words: false }) }) });
    const first = open();
    expect(await screen.findAllByRole("button", { name: "Pick this one" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Other words" })).not.toBeInTheDocument();
    first.unmount();
    stubApi({ [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ stage: "opted_out" }), ads: [], candidates: candidates({ choosing: "closed", waits: false }) }) }) });
    open();
    expect(await screen.findByText("This brand takes no ad now, so nothing is picked.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pick this one" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "None of these" })).not.toBeInTheDocument();
  });

  it("shows the full-size ad of his pick with his yes, and takes it back with one line", async () => {
    const sent: unknown[] = [];
    const final = adView({ verdict: "yes", picked: true });
    stubApi({
      [GET]: () => ({ body: prospectPage({ ads: [final], candidates: candidates({ waits: false, picked: { ideaId: "idea-1", imageId: "idea-1-draft-1" } }), message: { step: 0, messages: messages() } }) }),
      "POST /api/outreach/prospects/00001/ad": (body) => (sent.push(body), { body: waiting() }),
    });
    open();
    const user = userEvent.setup();
    expect(await screen.findByText("Your pick, full size")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Not this after all" }));
    await user.type(screen.getByLabelText(/What is wrong with the full-size version/), "The pack went soft.");
    await user.click(screen.getByRole("button", { name: "Save the no" }));
    await waitFor(() => expect(sent).toEqual([{ ad: 1, yes: false, ownerSaid: "The pack went soft." }]));
    expect(await screen.findByRole("heading", { name: /Pick the ad to send/ })).toBeInTheDocument();
  });
});

