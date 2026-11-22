import type { OutreachAd, ProspectContact, ProspectFile, ProspectPage, ProspectsPage, TemplatesPage } from "@a11-wild/shared";
import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Deps } from "../app.js";
import { log } from "../log.js";
import { Refusal } from "../mcp/registry.js";
import { singaporeDay } from "../outreach/days.js";
import { makeTestProspect } from "../outreach/load.js";
import { BRAND, mailLink, messagesFor, profileLink } from "../outreach/messages.js";
import { filtered, filterOf, numbersOf } from "../outreach/numbers.js";
import { DAILY, nextStep, sameContact } from "../outreach/sequence.js";
import { approvedAd, channelOf, kindOf, owedAnswer, stageOf } from "../outreach/stage.js";
import { adView, rowOf, todayPage } from "../outreach/today.js";
import { requireOwner, type SessionEnv } from "./guards.js";

const STEP = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const TEXT = z.string().trim().min(1).max(2000);
const NONE = z.strictObject({});
const TEMPLATE = z.strictObject({ titles: z.tuple([z.string().max(200), z.string().max(200)]), body: z.string().max(4000) });

/** The bodies of the owner's writes. Each is strict: an unknown field is refused. */
const BODY = {
  ad: z.strictObject({ ad: z.number().int().min(1).max(99), yes: z.boolean(), ownerSaid: TEXT.optional() }),
  sent: z.strictObject({ step: STEP, title: z.union([z.literal(0), z.literal(1)]) }),
  unsent: z.strictObject({ step: STEP }),
  reply: z.strictObject({ reply: z.enum(["more", "no", "other"]), text: TEXT.optional() }),
  answered: NONE,
  optout: NONE,
  stage: z.strictObject({ stage: z.enum(["in_talks", "client", "lost", "parked", "auto"]), reason: z.string().trim().min(1).max(500).optional() }),
  note: z.strictObject({ text: TEXT }),
  channel: z.strictObject({ channel: z.enum(["whatsapp", "email"]) }),
  kind: z.strictObject({ kind: z.enum(["product", "service"]) }),
  choose: NONE,
  remove: NONE,
} as const;
const TEMPLATES = z.strictObject({ steps: z.tuple([TEMPLATE, TEMPLATE, TEMPLATE]) });
const DAILY_BODY = z.strictObject({ daily: z.number().int() });
const TEST = z.strictObject({ whatsapp: z.string().max(40).optional(), email: z.string().max(254).optional() });

/** The picture of a test prospect's ad: a small grey block. One file, written again each time, so a test leaves nothing new behind. */
const TEST_AD = { key: "outreach/test-ad.png", png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAIAAADtz9qMAAAAEUlEQVR42mO4efMKHDGQwQEAaTsyeReyIfkAAAAASUVORK5CYII=" } as const;

/**
 * The owner's outreach pages. Every route, read or write, needs a dashboard session in the owner's role; a write also needs the dashboard's own origin.
 * These routes hold contacts of people, so no MCP token opens them: only the session cookie does.
 */
export function outreachRoutes(
  routes: Hono<SessionEnv>,
  deps: Deps,
  session: MiddlewareHandler<SessionEnv>,
  ownerWrite: readonly [MiddlewareHandler<SessionEnv>, MiddlewareHandler, MiddlewareHandler<SessionEnv>],
): void {
  const { store, sequence } = deps.studio.outreach;
  const ownerRead = [session, requireOwner] as const;
  const refused = (error: unknown) => {
    if (error instanceof Refusal) return { error: "refused", message: error.message };
    throw error;
  };

  const contactOf = ({ profile }: ProspectFile): ProspectContact => {
    const link = (href: string | undefined) => (href ? { href } : {});
    return {
      whatsapp: profile.whatsapp.map((number) => ({ number, ...link(/^\d{10,15}$/.test(number) ? `https://wa.me/${number}` : undefined) })),
      ...(profile.email ? { email: { address: profile.email, ...link(mailLink(profile.email, "", "")?.split("?")[0]) } } : {}),
      ...(profile.phone ? { phone: profile.phone } : {}),
      ...(profile.instagram ? { instagram: { name: profile.instagram, ...link(profileLink("instagram", profile.instagram)) } } : {}),
      ...(profile.decisionMaker ? { decisionMaker: profile.decisionMaker } : {}),
      ...(profile.dmTitle ? { dmTitle: profile.dmTitle } : {}),
      ...(profile.linkedin ? { linkedin: { text: profile.linkedin, ...link(profileLink("linkedin", profile.linkedin)) } } : {}),
      ...(profile.bestRoute ? { bestRoute: profile.bestRoute } : {}),
      ...(profile.secondRoute ? { secondRoute: profile.secondRoute } : {}),
    };
  };

  async function prospectPage(id: string): Promise<ProspectPage | undefined> {
    const [files, optOuts, templates] = await Promise.all([store.all(), store.optOuts(), sequence.templates()]);
    const file = files.find((entry) => entry.profile.id === id);
    if (!file) return undefined;
    const day = singaporeDay(deps.now());
    const stage = stageOf(file, optOuts);
    const sells = kindOf(file);
    const reply = owedAnswer(file);
    // The message that can be sent now, on any day: the first one for a brand that is ready, or a follow-up that is due.
    const due = stage === "contacted" ? nextStep(file) : undefined;
    const step = stage === "ready" ? 0 : due && due.due <= day ? due.step : undefined;
    const ads = await Promise.all([...file.ads].sort((a, b) => b.n - a.n).map((ad: OutreachAd) => adView(file, ad, deps.pictures)));
    return {
      prospect: rowOf(file, optOuts, sameContact(files)),
      ...(file.profile.newestAd ? { newestAd: file.profile.newestAd } : {}),
      ...(sells ? { sells } : {}),
      contact: contactOf(file),
      ads,
      sends: [...file.sends].sort((a, b) => a.step - b.step),
      events: [...file.events].sort((a, b) => b.at.localeCompare(a.at)),
      day,
      ...(step !== undefined && templates && approvedAd(file) ? { message: { step, messages: messagesFor(templates.steps[step], file.profile, channelOf(file)) } } : {}),
      ...(reply && (stage === "replied" || stage === "in_talks") ? { owed: { ...(reply.text ? { text: reply.text } : {}), at: reply.at } } : {}),
    };
  }

  routes.get("/api/outreach/today", ...ownerRead, async (c) => c.json(await todayPage({ store, sequence, pictures: deps.pictures, now: deps.now })));

  routes.get("/api/outreach/prospects", ...ownerRead, async (c) => {
    const filter = filterOf(c.req.query());
    if (!filter) return c.json({ error: "bad_request", message: "The tier or the stage of the filter is not one the list has." }, 400);
    const [files, optOuts] = await Promise.all([store.all(), store.optOuts()]);
    const shared = sameContact(files);
    const rows = files.map((file) => rowOf(file, optOuts, shared));
    return c.json({
      numbers: numbersOf(files, optOuts),
      sectors: [...new Set(files.map((file) => file.profile.sector))].sort(),
      rows: filtered(rows, filter),
    } satisfies ProspectsPage);
  });

  routes.get("/api/outreach/prospects/:id", ...ownerRead, async (c) => {
    const page = await prospectPage(c.req.param("id"));
    return page ? c.json(page) : c.json({ error: "not_found" }, 404);
  });

  routes.get("/api/outreach/templates", ...ownerRead, async (c) => {
    const [templates, daily] = await Promise.all([sequence.templates(), sequence.daily()]);
    return c.json({ ...(templates ? { templates } : {}), daily, dailyMin: DAILY.min, dailyMax: DAILY.max, placeholder: BRAND } satisfies TemplatesPage);
  });

  /** One write on one prospect: a strict body, the change, then the prospect as it now stands. */
  const write = <K extends keyof typeof BODY>(action: K, change: (id: string, body: z.infer<(typeof BODY)[K]>) => Promise<unknown>) =>
    routes.post(`/api/outreach/prospects/:id/${action}`, ...ownerWrite, async (c) => {
      const body = BODY[action].safeParse(await c.req.json().catch(() => undefined));
      if (!body.success) return c.json({ error: "bad_request", message: "The request has a field that is missing, wrong or not known." }, 400);
      // The path is built from the action, so the type of its parameter is not known to the compiler.
      const id = c.req.param("id") ?? "";
      try {
        await change(id, body.data as z.infer<(typeof BODY)[K]>);
      } catch (error) {
        return c.json(refused(error), 400);
      }
      // The id and the action only: a note, a reply or a number never goes to a log.
      log.info("outreach_write", { action, prospect: id, by: c.get("session").sub });
      return action === "remove" ? c.json({ removed: true }) : c.json((await prospectPage(id)) ?? { error: "not_found" });
    });

  write("ad", (id, body) => sequence.verdict(id, body));
  write("sent", (id, body) => sequence.send(id, body));
  write("unsent", (id, body) => sequence.takeBack(id, body.step));
  write("reply", (id, body) => sequence.reply(id, body));
  write("answered", (id) => sequence.answered(id));
  write("optout", (id) => sequence.optOut(id));
  write("stage", (id, body) => sequence.setStage(id, body.stage, body.reason));
  write("note", (id, body) => sequence.note(id, body.text));
  write("channel", (id, body) => sequence.setChannel(id, body.channel));
  write("kind", (id, body) => sequence.setKind(id, body.kind, "owner"));
  write("choose", (id) => sequence.choose(id));
  write("remove", (id) => store.removeTest(id));

  routes.post("/api/outreach/templates", ...ownerWrite, async (c) => {
    const body = TEMPLATES.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request", message: "Send the three messages, each with two titles and its text." }, 400);
    try {
      const templates = await sequence.saveTemplates(body.data.steps);
      log.info("outreach_templates_saved", { by: c.get("session").sub });
      return c.json({ templates });
    } catch (error) {
      return c.json(refused(error), 400);
    }
  });

  routes.post("/api/outreach/daily", ...ownerWrite, async (c) => {
    const body = DAILY_BODY.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request", message: "Send the daily number of first messages." }, 400);
    try {
      const daily = await sequence.setDaily(body.data.daily);
      log.info("outreach_daily_set", { daily, by: c.get("session").sub });
      return c.json({ daily });
    } catch (error) {
      return c.json(refused(error), 400);
    }
  });

  /** A prospect to try the pages with, and a grey block as its ad. It is in no number and takes no place of the day. */
  routes.post("/api/outreach/test-prospect", ...ownerWrite, async (c) => {
    const body = TEST.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "bad_request", message: "A test prospect takes a WhatsApp number, an address, or neither." }, 400);
    try {
      const profile = await makeTestProspect(store, { brand: "TEST prospect", ...body.data }, deps.now);
      await deps.pictures.put(TEST_AD.key, Uint8Array.from(Buffer.from(TEST_AD.png, "base64")), "image/png");
      await store.addAd(profile.id, { batchId: "test", imageId: "test", kind: "v1", key: TEST_AD.key, why: "A grey block, to try the pages." });
      log.info("outreach_test_prospect_made", { prospect: profile.id, by: c.get("session").sub });
      return c.json({ id: profile.id });
    } catch (error) {
      return c.json(refused(error), 400);
    }
  });
}
