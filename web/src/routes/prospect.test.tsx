import { screen, waitFor, within } from "@testing-library/react";
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
/** Opens a folded part of the page, when the page has loaded. */
const unfold = async (title: RegExp | string) => userEvent.click(await screen.findByRole("button", { name: title }));
const sendOf = (day: string) => ({ step: 0 as const, day, channel: "whatsapp" as const, title: "New ad for Koi Tea", text: "Hi", at: `${day}T03:00:00.000Z` });

afterEach(() => vi.restoreAllMocks());

describe("Prospect page", () => {
  it("shows the contact: a checked value as a link, any other as text", async () => {
    stubApi({ [GET]: () => ({ body: prospectPage({ contact: { whatsapp: [{ number: "6580000001", href: "https://wa.me/6580000001" }], instagram: { name: "javascript:alert(1)" }, decisionMaker: "A Person", dmTitle: "Founder" } }) }) });
    open();
    expect(screen.queryByRole("link", { name: "+6580000001" })).not.toBeInTheDocument();
    await unfold("How to reach it");
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
    expect(screen.getByRole("status")).toHaveTextContent("Asked of youFirst message is ready. Send it yourself, then mark it as sent.");
    await unfold(/^Timeline/);
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
    await unfold("Upload your own picture");
    await user.upload(await screen.findByLabelText("Choose your picture"), new File(["PNG"], "ad.png", { type: "image/png" }));
    expect(await screen.findByText("Your upload")).toBeInTheDocument();
    expect(screen.getByText("You said yes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeInTheDocument();
    await unfold(/^Timeline/);
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
    await unfold("Upload your own picture");
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
    expect(await screen.findByRole("status")).toHaveTextContent("Nothing is asked of youThis contact opted out.");
    expect(screen.queryByRole("button", { name: "Upload your own picture" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Note, stage and opt-out" })).not.toBeInTheDocument();
  });

  it("asks once before an opt-out, and the brand then offers no action", async () => {
    let asked = 0;
    stubApi({
      [GET]: () => ({ body: prospectPage() }),
      "POST /api/outreach/prospects/00001/optout": () => ((asked += 1), { body: prospectPage({ prospect: prospectRow({ stage: "opted_out" }) }) }),
    });
    open();
    await unfold("Note, stage and opt-out");
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
    await unfold("Note, stage and opt-out");
    expect(await screen.findByRole("button", { name: 'Take back "First message sent"' })).toBeInTheDocument();
    unmount();
    stubApi({ [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ stage: "contacted", next: { step: 1, due: "2026-11-24" } }), sends: [sendOf("2026-11-20")] }) }) });
    open();
    // The reply is logged without opening anything: after a message it is the next thing that can happen.
    expect(await screen.findByRole("button", { name: "They said more" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Nothing is asked of youFollow-up 1 is due Tue, 24 Nov 2026. Log a reply below when one comes.");
    await unfold("Note, stage and opt-out");
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
    expect(screen.getByRole("status")).toHaveTextContent("Asked of youAnswer the reply yourself, then mark it as answered.");
    expect(sent).toEqual([{ reply: "more", text: "Show me another." }]);
  });

  it("removes a test prospect, and offers no removal for a brand of the list", async () => {
    stubApi({ [GET]: () => ({ body: prospectPage({ ads: [adView()] }) }) });
    const { unmount } = open();
    expect(await screen.findByRole("button", { name: "Yes, send this ad" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Asked of youSay yes or no to the ad.");
    expect(screen.queryByRole("button", { name: "Test prospect" })).not.toBeInTheDocument();
    unmount();
    const calls = stubApi({ [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ test: true }) }) }), "POST /api/outreach/prospects/00001/remove": () => ({ body: { removed: true } }) });
    open();
    await unfold("Test prospect");
    await userEvent.click(await screen.findByRole("button", { name: "Remove the test prospect" }));
    expect(await screen.findByText("The list")).toBeInTheDocument();
    await waitFor(() => expect(calls).toContain("POST /api/outreach/prospects/00001/remove"));
  });
});

describe("the one next step on the prospect page", () => {
  const step = async (page: ReturnType<typeof prospectPage>) => {
    stubApi({ [GET]: () => ({ body: page }) });
    const { unmount } = open();
    const text = (await screen.findByRole("status")).textContent;
    unmount();
    return text;
  };
  const parkedBy = (by: "agent" | "owner") => ({ id: "e1", type: "stage" as const, stage: "parked" as const, ...(by === "agent" ? { reason: "No clean pack photo." } : {}), at: "2026-11-23T01:00:00.000Z", by });

  it("names who set a brand aside and why, before anything its ads would ask", async () => {
    expect(await step(prospectPage({ prospect: prospectRow({ stage: "parked" }), ads: [adView()], events: [parkedBy("agent")] }))).toBe(
      "Nothing is asked of youThe agent parked this brand: No clean pack photo. Nothing happens with it until you set it back to its own stage below.",
    );
    expect(await step(prospectPage({ prospect: prospectRow({ stage: "parked" }), events: [parkedBy("owner")] }))).toMatch(/You set this brand to "Parked"\./);
    expect(await step(prospectPage({ prospect: prospectRow({ stage: "parked" }), events: [] }))).toMatch(/Parked: you said no to its ads, and the studio makes no third try\./);
  });

  it("says when the agent acts, and what a brand with no ad or no route waits for", async () => {
    expect(await step(prospectPage({ prospect: prospectRow({ stage: "pick_made" }), ads: [], candidates: candidates({ waits: false, agentOwes: true }) }))).toMatch(/^In workYou picked\. The agent makes the full-size version of your pick, and the message is then ready\./);
    expect(await step(prospectPage({ prospect: prospectRow({ stage: "new" }), ads: [] }))).toMatch(/^Nothing is asked of youNo ad yet\./);
    expect(await step(prospectPage({ prospect: prospectRow({ stage: "new" }), ads: [], candidates: candidates({ waits: false }) }))).toMatch(/The drafts made so far are below, and you can pick one now\./);
    expect(await step(prospectPage({ prospect: prospectRow({ stage: "no_route" }), ads: [] }))).toMatch(/no WhatsApp number and no address/);
    expect(await step(prospectPage({ prospect: prospectRow({ stage: "ready" }), ads: [adView({ verdict: "yes" })] }))).toMatch(/^Asked of youReady to send, but your message text is not saved yet\./);
  });

  it("asks for the pick of a later ad, and names the agent's work on it, when the stage stays at the reply", async () => {
    // After the first message the stage is "Contacted", "Replied" or "In talks" whatever the drafts wait for.
    const sends = [sendOf("2026-11-20")];
    const asked = prospectPage({ prospect: prospectRow({ stage: "replied" }), sends, candidates: candidates() });
    expect(await step(asked)).toBe("Asked of you4 draftsPick the one draft to send. The agent then makes it full size.");
    stubApi({ [GET]: () => ({ body: asked }) });
    const { unmount } = open();
    expect(await screen.findByRole("heading", { name: /^Pick the ad to send/ })).toBeInTheDocument();
    unmount();
    expect(await step(prospectPage({ prospect: prospectRow({ stage: "in_talks" }), sends, candidates: candidates({ waits: false, agentOwes: true }) }))).toBe(
      "In workYou picked. The agent makes the full-size version of your pick, and it then shows under Ads.",
    );
    expect(await step(prospectPage({ prospect: prospectRow({ stage: "contacted" }), sends, ads: [adView()] }))).toBe("Asked of youSay yes or no to the ad.");
  });

  it("gives the reason a write failed beside its own action, not inside a closed fold", async () => {
    const refused = () => ({ status: 409, body: { error: "refused", message: "The studio could not save that." } });
    stubApi({
      [GET]: () => ({ body: prospectPage({ prospect: prospectRow({ stage: "replied", sameContactAs: "Kopi Lane" }), sends: [sendOf("2026-11-20")], owed: { at: "2026-11-23T03:00:00.000Z" } }) }),
      "POST /api/outreach/prospects/00001/answered": refused,
      "POST /api/outreach/prospects/00001/choose": refused,
      "POST /api/outreach/prospects/00001/channel": refused,
    });
    open();
    await userEvent.click(await screen.findByRole("button", { name: "I answered" }));
    expect(await screen.findByText("The studio could not save that.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Note, stage and opt-out" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByRole("button", { name: "Send to this brand too" }));
    await waitFor(() => expect(screen.getAllByText("The studio could not save that.")).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "How to reach it" }));
    await userEvent.click(screen.getByRole("button", { name: "Use Email" }));
    await waitFor(() => expect(within(screen.getByRole("button", { name: "How to reach it" }).closest("section")!).getByText("The studio could not save that.")).toBeInTheDocument());
  });
});

describe("the owner's pick on the prospect page", () => {
  const waiting = (overrides = {}) => prospectPage({ prospect: prospectRow({ stage: "pick_waits" }), ads: [], candidates: candidates(overrides) });

  it("shows every draft under its headline before anything else, in colour, with what the checks found as a note", async () => {
    stubApi({ [GET]: () => ({ body: waiting() }) });
    open();
    expect(await screen.findByRole("heading", { name: /Pick the ad to send/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "One fork tap and it crumbles." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your visiting gift, baked fresh." })).toBeInTheDocument();
    expect(screen.getByText("Twelve tarts in a box.")).toBeInTheDocument();
    const pictures = screen.getAllByRole("img", { name: /^Draft \d of/ });
    expect(pictures).toHaveLength(4);
    // No check greys a draft or takes its button away: the draft the agent faulted can be picked like the others.
    for (const picture of pictures) expect(picture.className).not.toMatch(/grayscale|opacity/);
    expect(screen.getAllByRole("button", { name: "Pick this one" })).toHaveLength(3);
    expect(screen.getByText("The agent saw: The box is too tall.")).toBeInTheDocument();
    expect(screen.getAllByText("The checks found")).toHaveLength(1);
    // Only a draft that is not an ad yet has no button.
    expect(screen.getByText("Not ready to pick: Its words are not set yet.")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent by a pick/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Draft \d of/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
  });

  it("opens a draft large over the page, steps through every draft, and closes back to the page", async () => {
    stubApi({ [GET]: () => ({ body: waiting() }) });
    open();
    const [first] = await screen.findAllByRole("button", { name: /^Draft \d of/ });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(first!);
    const viewer = within(screen.getByRole("dialog", { name: "Picture 1 of 4, large" }));
    expect(viewer.getByText("1 / 4")).toBeInTheDocument();
    expect(viewer.getByRole("img", { name: 'Draft 1 of "One fork tap and it crumbles." for Koi Tea' })).toHaveAttribute("src", "https://pictures.example/idea-1-1.jpg");
    // The first picture has nothing before it, and the last nothing after: the row does not go round.
    expect(viewer.queryByRole("button", { name: "Previous picture" })).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}");
    expect(viewer.getByText("1 / 4")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(viewer.getByText("3 / 4")).toBeInTheDocument();
    // Large, what the checks found is one line above the one button.
    expect(viewer.getByText("The checks found: The agent saw: The box is too tall.")).toBeInTheDocument();
    expect(viewer.getByRole("button", { name: "Pick this one" })).toBeInTheDocument();
    await userEvent.click(viewer.getByRole("button", { name: "Next picture" }));
    expect(viewer.getByText("4 / 4")).toBeInTheDocument();
    expect(viewer.getByText("Not ready to pick: Its words are not set yet.")).toBeInTheDocument();
    expect(viewer.queryByRole("button", { name: "Pick this one" })).not.toBeInTheDocument();
    expect(viewer.queryByRole("button", { name: "Next picture" })).not.toBeInTheDocument();
    await userEvent.click(viewer.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /^Draft \d of/ })).toHaveLength(4);
  });

  it("closes at the first Close also after the page took an earlier large picture away", async () => {
    stubApi({ [GET]: () => ({ body: waiting() }) });
    open();
    const drafts = await screen.findAllByRole("button", { name: /^Draft \d of/ });
    await userEvent.click(drafts[2]!);
    // "Other words" takes the large picture away itself, with no Close and no Back of the reader.
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Other words" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Its step in the history is given back, so a later Back does not open nothing.
    await waitFor(() => expect((window.history.state as { viewer?: boolean } | null)?.viewer).toBeUndefined());
    await userEvent.click(drafts[0]!);
    // The second large picture has a step of its own, so the browser's Back closes it too.
    expect((window.history.state as { viewer?: boolean } | null)?.viewer).toBe(true);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getAllByRole("img", { name: /^Draft \d of/ })).toHaveLength(4);
  });

  it("takes the pick from the large picture and closes it", async () => {
    const sent: unknown[] = [];
    stubApi({
      [GET]: () => ({ body: waiting() }),
      "POST /api/outreach/prospects/00001/pick": (body) => (
        sent.push(body),
        { body: prospectPage({ prospect: prospectRow({ stage: "pick_made" }), ads: [], candidates: candidates({ waits: false, agentOwes: true, picked: { ideaId: "idea-2", imageId: "idea-2-draft-1" } }) }) }
      ),
    });
    open();
    await userEvent.click((await screen.findAllByRole("button", { name: /^Draft \d of/ }))[2]!);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Pick this one" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent).toEqual([{ imageId: "idea-2-draft-1" }]);
    expect(await screen.findByText(/You picked\. The agent makes the full-size version of your pick/)).toBeInTheDocument();
  });

  it("gives what the checks found on the full-size ad of his pick, beside Mark as sent, and opens the ad large", async () => {
    const warning = "The pack is drawn 5% wider than in its photo. The limit is 2%.";
    stubApi({ [GET]: () => ({ body: prospectPage({ ads: [{ ...adView({ verdict: "yes", picked: true }), warning }], message: { step: 0, messages: messages() } }) }) });
    open();
    // Beside "Mark as sent", where he decides, and again in the list of ads.
    expect(await screen.findByText(`${warning} It is your call before you send.`)).toBeInTheDocument();
    expect(screen.getByText(`${warning} It is your call.`)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: /^Ad 1 for/ })[0]!);
    const viewer = within(screen.getByRole("dialog"));
    expect(viewer.getByRole("img", { name: /^Ad 1 for/ })).toBeInTheDocument();
    expect(viewer.queryByRole("button", { name: "Next picture" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("status")).toHaveTextContent("In workYou picked. The agent makes the full-size version of your pick, and the message is then ready.");
    expect(screen.getByText("Your pick is marked. You can still pick another.")).toBeInTheDocument();
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
    // The row keeps to one action for each draft; other words are asked for beside the large picture, which then closes.
    expect(await screen.findAllByRole("button", { name: "Pick this one" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Other words" })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /^Draft \d of/ })[1]!);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Other words" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Draft 2 with other words/)).toHaveFocus();
    await user.type(screen.getByLabelText(/Draft 2 with other words/), "Say the price.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText('You asked for other words on one draft: "Say the price."')).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("In workThe agent sets the other words you asked for.");
    expect(sent[1]).toEqual({ imageId: "idea-1-draft-2", ownerSaid: "Say the price." });
    expect(screen.queryByRole("button", { name: "Pick this one" })).not.toBeInTheDocument();
  });

  it("offers no other words when the pictures carry none, and no choice for a brand that takes no ad", async () => {
    stubApi({ [GET]: () => ({ body: waiting({ words: false }) }) });
    const first = open();
    expect(await screen.findAllByRole("button", { name: "Pick this one" })).toHaveLength(3);
    await userEvent.click(screen.getAllByRole("button", { name: /^Draft \d of/ })[0]!);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Pick this one" })).toBeInTheDocument();
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

