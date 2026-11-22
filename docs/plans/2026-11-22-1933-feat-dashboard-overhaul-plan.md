---
title: Dashboard Overhaul - Plan
type: feat
date: 2026-11-22
topic: dashboard-overhaul
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Dashboard Overhaul - Plan

## Goal Capsule

- **Objective:** The owner opens any page of the dashboard and sees, without asking an agent, what waits for him, what is in work, and what he can ignore.
- **Means:** One read that joins everything that waits for the owner, a start page built on it, one frame for every page (needs you, in work, the rest folded), and a top bar that counts what waits and works on a phone.
- **Product authority:** Han, the owner. He left the design to the agent ("ill simply go with ur recommendations on what should be discarded, adjusted, added, reworked").
- **Execution profile:** Four pull requests, in order. Each is merged under the standing rule, deployed, probed, and shown to the owner in screenshots.
- **Who finishes and ships:** The agent builds, tests, merges and deploys.
- **Stop conditions:** Stop and ask before any new write, any spend, and any change to what a client or a prospect sees.
- **Open blockers:** None.

---

## Product Contract

### Summary

Every dashboard page gets the same order: what needs the owner first, what is in work second, reference material folded away. The Studio page becomes the start page that lists everything that waits for him across batches, outreach, clients, taste and connections. The top bar shows a count where something waits and no longer scrolls sideways on a phone.

### Problem Frame

The dashboard grew page by page with each feature. The Studio page still shows a box for connecting an agent and six cards that describe the pipeline, written when nothing else existed; it lists batches by date and does not say which one waits for the owner. To learn what he must do, the owner asks an agent or opens page after page. On a phone the top bar hides two of its five items off-screen with no hint.

The owner asked for "beautiful design that guides intent, so that i don't have to be asking u on what to do, the design guides my attention", on "every single page that exists in our entire pipeline".

### Actors

- A1. The owner. He picks, approves, answers and sends. Every "needs you" line is for him.
- A2. A member. A signed-in person who is not the owner. Sees studio pages, not outreach or clients.
- A3. An agent. It does the work between the owner's steps. The dashboard tells the owner when the agent is the one who acts.

### Requirements

**Start page**

- R1. The Studio page shows first every thing that waits for the owner: a batch that waits for his pick, his concept pick, his yes to words, to a spend estimate or to the Meta text; ads that wait for his yes or no; replies owed; follow-ups due; first messages ready to send; client change requests that wait; taste changes that wait for his yes; programs that wait for approval.
- R2. Each such line names the thing, says in plain words what is asked of him, and has one link to the place where he does it. Where he answers an agent in chat and not in the dashboard, the line says so.
- R3. Below, the page shows what is in work: each open batch with the step it is at in plain words, and that the agent acts next.
- R4. Done batches and test batches are folded. Nothing is deleted.
- R5. When nothing waits, the page says so in one line and says what happens next.
- R6. The "Connect your agent" box moves to the Connections page. The six "What the studio does" cards are removed. The build number moves to the foot of every page.

**Every page**

- R7. Each dashboard page orders its sections: what needs the owner, what is in work, reference. Reference sections with more than a few rows are folded and open with one click.
- R8. A page header holds one sentence. A thing the owner must know to use a control sits beside that control; the rest of the old explanation is removed.
- R9. An empty section says that nothing waits, what will make something appear, and who acts.
- R10. A section offers one main action. Other actions are quiet.

**Top bar**

- R11. Each item of the top bar shows a count when something waits there for the owner; "More" shows the sum of its pages.
- R12. At phone width every destination and Sign out are reachable with no sideways scroll.

**Limits**

- R13. A member sees no outreach, client, taste or connection line and no count for them. A batch that waits shows to a member as "Waits for the owner", with no action.
- R14. The overhaul adds no write, no paid call and no agent tool. It changes no link page a client opens.
- R15. Every page shows no sideways page scroll at 390 px and at 1280 px.

### Key Flows

- F1. The owner opens the studio. The first line reads "Wongi: pick one draft for each idea". He follows it to the pick board, picks, and returns; the line is gone and the batch is under "In work".
- F2. The owner opens the studio on a phone. He taps the menu, sees "Clients 2", opens it and sets the status of two change requests.
- F3. Nothing waits. The start page says so and shows the three batches agents are working on with their steps.

### Scope Boundaries

- No new feature: no studio reply, no email to clients, no new upload.
- No change to the pack page and the client page a link opens; they were redone in PR #17 and PR #22.
- No change to the Fluid components in `web/src/components/ui`.
- No change to house rules, prompts or MCP tools.

### Deferred to Follow-Up Work

- A live count that refreshes without a page load.
- A search across brands, batches and prospects.

### Success Criteria

- The owner can name what waits for him from the start page alone.
- No page needs an agent's explanation to be used.
- The phone bar finding of the live test of 22-11-2026 (Packs and Clients off-screen) is gone.

### Assumptions

- The owner wants one start page for the whole studio, with the Outreach day page kept for sending.
- An outreach batch is not a "needs you" line: its agent chooses in the owner's place, and its ad waits for him on the prospect.
- The words of a headline ad, a spend estimate and the Meta text are answered in chat with the agent; the start page points at the batch and says that the agent asks.
- The top bar keeps its five items and "More"; counts and a phone menu are added, the order is not changed.

### Open Questions

- None that blocks. Which reference sections are long enough to fold is decided per page while building (R7).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **One read, computed on request.** `GET /api/attention` joins the existing stores at request time and stores nothing. One owner and low traffic make a stored counter a risk (stale counts) with no gain.
- KTD2. **What waits is derived from the batch state, in one place.** A new pure function beside `services/api/src/batch/state.ts` maps kind, state and `teachesNothing` to "owner acts" or "agent acts" with the plain step text. The start page, the top bar and the batch pages all read it, so they cannot disagree.
- KTD3. **The owner's lines reuse the pages' own tests, not the pages' own reads.** Outreach counts use the stage functions that `services/api/src/outreach/today.ts` uses (`owedAnswer`, `adWaits`, the due follow-up, the ready first message); client requests use the comment store behind `GET /api/portal`; taste uses proposals with the status `proposed`; connections use programs with the status `pending` (the list behind `GET /api/clients`). The page reads sign a picture address for each line; the attention read signs none and returns counts. No second definition of "waits".
- KTD4. **Role decides the content on the server.** A member's answer holds batch lines only. The dashboard hides nothing the server sent.
- KTD5. **One frame in `web/src/components/page.tsx`.** `PageHeader` takes one sentence; a `Fold` component carries the fold that Spend already has; a `NeedsYou` line carries one ask and one link; `Empty` keeps its look. Pages are composed from these; the Fluid components stay as shipped.
- KTD6. **The phone bar is a menu, not a scroller.** Below the `sm` width the bar shows the studio name, the open page and one menu button; the menu lists every destination with its count and Sign out. The desktop bar keeps its shape.
- KTD7. **Four pull requests.** Part 1: U57, U60, U58, U59, U65. Part 2: U61. Part 3: U62. Part 4: U63, U64. The frame and the start page come first, because every later page uses the frame. A page pass changes order, wording and folds, not behaviour, so each pass is safe to ship alone.
- KTD8. **Weight follows urgency.** A line that needs the owner carries the amber dot the board already uses, the stronger text weight and the one filled button of its section. Work in progress is plain text with a quiet badge. Folded reference is muted. No new colour and no new component style enters; the page reads top to bottom in the order the owner acts.
- KTD9. **Every read has three faces.** Loading, failed and empty each have one look across pages (`Loading` and `Empty`). A failed count read never blocks a page.

### High-Level Technical Design

```
GET /api/attention  (session)
  needsYou: [{ kind, title, ask, to, count?, since? }]     owner lines only for the owner
  inWork:   [{ batchId, label, brand, product, step, kindName, test }]
  counts:   { studio, outreach, clients, taste, connections }   owner only, else studio only

Shell  --reads counts-->  bar items and the phone menu
Home   --reads needsYou, inWork-->  "Needs you" / "In work" / folded "Done" and "Test batches"
```

The shape is a direction, not a specification. `to` is a dashboard path, never an outside address.

### Risks and Dependencies

- **A wrong "waits" line** sends the owner to a page with nothing to do. KTD2 and KTD3 keep one definition; U57's tests cover each state and kind.
- **A slow start page.** The read joins five stores and walks the prospect list once. It runs the stores in parallel, signs no picture address (KTD3) and bounds each list; the start page shows at most 20 lines per group and a count for the rest. The top bar asks for it once per page change and shows no count until it answers.
- **A leak to a member.** KTD4, with a route test for a member's answer.
- **Live browser check.** The dashboard needs an owner sign-in. The pages are checked at both widths against a local mock; a live browser check needs a temporary owner account and the owner's yes.

### Sources

- The owner's message of 22-11-2026, 18:53 SGT, and his screenshot of the Studio page.
- The live browser test of 22-11-2026 (phone bar finding).
- `services/api/src/batch/state.ts` (steps and what each needs), `services/api/src/outreach/today.ts`, `web/src/components/shell.tsx`, `web/src/components/page.tsx`, `web/src/routes/spend.tsx` (the fold).

---

## Implementation Units

### U57. The read of what waits

- **Goal:** One answer that says what waits for the owner and what is in work.
- **Requirements:** R1, R2, R3, R11, R13, R14.
- **Dependencies:** None.
- **Files:** `packages/shared/src/index.ts`, `services/api/src/batch/waits.ts`, `services/api/test/batch/waits.test.ts`, `services/api/src/attention/service.ts`, `services/api/test/attention/service.test.ts`, `services/api/src/outreach/today.ts`, `services/api/src/wire.ts`, `services/api/src/http/studio-routes.ts`, `services/api/test/http/studio-routes.test.ts`, `scripts/probe.mjs`.
- **Approach:** KTD1 to KTD4. The batch function returns who acts and the plain step. The attention service takes the stores it needs as arguments, runs them in parallel, and leaves out the owner's parts for a member. The outreach counts come from one function in `today.ts` that the day page also uses, so the two cannot drift.
- **Patterns to follow:** `services/api/src/outreach/today.ts` for a joined read; `STEP` in `services/api/src/batch/state.ts` for the step words.
- **Test scenarios:**
  - A v1 batch in `waiting_pick` is an owner line that leads to its pick board.
  - A v3 batch in `reviewed` is an owner line that leads to its Concepts page.
  - A v2 batch in `judged` is an owner line that says the agent asks for his yes to the words.
  - A batch in `waiting_spend` is an owner line that says the agent asks for his yes to the estimate.
  - A batch with a picked ad whose Meta text is saved and not approved is an owner line that says the agent asks for his yes to the text.
  - The outreach counts equal the lengths of the day page's lists for the same prospects.
  - For a member, a batch that waits carries no action and reads "Waits for the owner".
  - A batch in `drafting` is in work, with the agent as the one who acts.
  - An outreach batch and a test batch in `waiting_pick` are not owner lines.
  - A done batch is neither an owner line nor in work.
  - Outreach, client, taste and connection lines appear with their counts for the owner and are absent for a member.
  - With nothing waiting, `needsYou` is empty and the counts are zero.
  - No sign-in gives 401 (also a live probe).
- **Verification:** The route answers for the owner and a member as the scenarios say; the probe passes after the deploy.

### U60. One frame for every page

- **Goal:** The parts every page is built from.
- **Requirements:** R7, R8, R9, R10.
- **Dependencies:** None.
- **Files:** `web/src/components/page.tsx`, `web/src/components/page.test.tsx`, `web/src/routes/spend.tsx`.
- **Approach:** KTD5, KTD8, KTD9. Move the fold out of Spend into `Fold` and use it there. `PageHeader` keeps one sentence.
- **Patterns to follow:** The fold and "Show N older" in `web/src/routes/spend.tsx`.
- **Test scenarios:**
  - A fold shows its summary and hides its body until it is opened, and says so to a screen reader.
  - A `NeedsYou` line is one link whose text is the ask, with its count when it has one.
  - Spend still groups, opens and shows older groups as before.
- **Verification:** Spend's own tests pass unchanged in meaning.

### U58. The start page

- **Goal:** The Studio page shows what needs the owner, what is in work, and folds the rest.
- **Requirements:** R1 to R6, R13, R15.
- **Dependencies:** U57, U60.
- **Files:** `web/src/routes/home.tsx`, `web/src/routes/home.test.tsx`, `web/src/lib/api.ts`, `web/src/routes/connections.tsx`, `web/src/routes/connections.test.tsx`.
- **Approach:** "Needs you" lines are links with the ask as their text. "In work" shows the step. "Done" and "Test batches" are folds. The connect box moves to Connections as it is.
- **Test scenarios:**
  - With two owner lines, both show before any batch in work, each with its link.
  - With none, the page says nothing waits and names what happens next.
  - A done batch and a test batch are inside their folds.
  - A member sees batch lines only.
  - The connect box is on Connections and not on the start page.
  - A failed read shows the failure and no stale line.
- **Verification:** Screenshots at 390 px and 1280 px against the mock show F1 and F3.

### U59. The top bar

- **Goal:** Counts where something waits, and a phone menu.
- **Requirements:** R6, R11, R12, R13, R15.
- **Dependencies:** U57.
- **Files:** `web/src/components/shell.tsx`, `web/src/components/shell.test.tsx`.
- **Approach:** KTD6. The shell loads the counts once per page change. The build number sits in the shell's foot.
- **Test scenarios:**
  - An item with a count shows it and says it to a screen reader; an item with zero shows none.
  - "More" shows the sum of its pages' counts.
  - At phone width the menu lists every destination and Sign out, closes on Escape, on a tap outside and on a page change.
  - A member sees no owner item and no owner count.
  - A failed count read leaves the bar usable with no count.
- **Verification:** Screenshot at 390 px shows no sideways scroll and every destination in the menu.

### U61. The studio pages

- **Goal:** Brands, a brand, the pick board and Concepts in the frame.
- **Requirements:** R7 to R10, R15.
- **Dependencies:** U60.
- **Files:** `web/src/routes/brands.tsx`, `web/src/routes/brand.tsx`, `web/src/routes/board.tsx`, `web/src/routes/concepts.tsx`, their `*.test.tsx`.
- **Approach:** The board and Concepts lead with the one thing asked ("Pick one draft for each idea") and how many are left; the truth sheet folds once the owner has seen it. A brand leads with its open batches; kit, rules and products follow; long product facts fold.
- **Test scenarios:**
  - A board that waits for a pick shows the ask and the number left before the drafts.
  - A board with every pick made shows what happens next and who acts.
  - A brand with an open batch shows it first.
  - Existing pick, pass and note behaviour is unchanged.
- **Verification:** The existing route tests pass; screenshots at both widths.

### U62. The outreach pages

- **Goal:** The day page, the list, a prospect and Messages in the frame.
- **Requirements:** R7 to R10, R15.
- **Dependencies:** U60.
- **Files:** `web/src/routes/outreach.tsx`, `web/src/routes/prospects.tsx`, `web/src/routes/prospect.tsx`, `web/src/routes/templates.tsx`, `web/src/components/outreach.tsx`, their `*.test.tsx`.
- **Approach:** The day page keeps its order and hides a section that is empty behind one "nothing else today" line. A prospect leads with its one next step; "How to reach it", "What happened" and the timeline fold; the test-prospect tools fold at the foot of the list.
- **Test scenarios:**
  - A day with one owed reply shows it first and no empty section above it.
  - A prospect with an ad that waits shows the yes or no first.
  - A prospect with a message ready shows the message and "Mark as sent" first.
  - "Mark as sent", the upload and opt-out behave as before.
- **Verification:** The existing route tests pass; screenshots at both widths.

### U63. Packs and Clients

- **Goal:** Both pages in the frame.
- **Requirements:** R7 to R10, R15.
- **Dependencies:** U60.
- **Files:** `web/src/routes/packs.tsx`, `web/src/routes/clients.tsx`, their `*.test.tsx`.
- **Approach:** Clients leads with change requests that wait; each client folds to one row with what is new. Packs lists the newest version of each pack and folds earlier versions.
- **Test scenarios:**
  - A waiting change request shows before the client list.
  - A client with nothing new is one row.
  - An earlier pack version is inside its fold.
  - Status clicks and link actions behave as before.
- **Verification:** The existing route tests pass; screenshots at both widths.

### U64. Taste, Calibration, Spend and Connections

- **Goal:** The four pages under "More" in the frame.
- **Requirements:** R6 to R10, R15.
- **Dependencies:** U60, U58.
- **Files:** `web/src/routes/taste.tsx`, `web/src/routes/calibration.tsx`, `web/src/routes/spend.tsx`, `web/src/routes/connections.tsx`, their `*.test.tsx`.
- **Approach:** Taste leads with changes that wait for his yes; canon, log and swipe file fold. Connections leads with programs that wait; the connect box follows; removed programs fold.
- **Test scenarios:**
  - A taste change that waits shows first.
  - A program that waits for approval shows first, with its approve action as the one main action.
  - Canon save, restore, approve and remove behave as before.
- **Verification:** The existing route tests pass; screenshots at both widths.

### U65. The record

- **Goal:** The decision, the security check and the probe are written down.
- **Requirements:** R14.
- **Dependencies:** U57.
- **Files:** `docs/decisions.md`, `docs/security-checklist.md`.
- **Approach:** One decision entry for the overhaul and its rule; one checklist line for the new read.
- **Test scenarios:** Test expectation: none -- documentation only.
- **Verification:** `npm run check` and `npm run check:public` pass.

---

## Verification Contract

- `npm run check`, `npm run check:public` and `npm audit --omit=dev` pass on each pull request.
- Each pull request carries screenshots of its pages at 390 px and 1280 px against the local mock.
- After each deploy: the live probes pass, and the owner is told what was not seen in a live browser.

## Definition of Done

- R1 to R15 hold on the live studio.
- The four pull requests are merged with clean checks and review.
- The owner has the screenshots of every page and the list of what was dropped, moved and added.

## Review Record

- **22-11-2026, document review.** The host of this session has no tool to start an independent reviewer, so the plan's author applied the coherence, feasibility, scope and design lenses himself against the code. Coverage: not independent.
- **Fixed:** the client requests come from the read behind `GET /api/portal`, not `GET /api/clients` (KTD3). The page reads sign picture addresses, so the attention read uses their tests and returns counts (KTD3, risks). The Meta text is one more thing that waits for the owner (R1, U57). Every owner write is owner-only, so a member gets no action on a batch line (R13). The folded "About this page" is dropped as a part nobody asked for (R8). The parts of each pull request are named (KTD7). The visual rule and the three faces of a read are written down (KTD8, KTD9).
- **Left open:** none.
