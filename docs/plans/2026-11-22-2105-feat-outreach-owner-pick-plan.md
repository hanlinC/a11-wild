# Plan: the owner picks the outreach ad himself

Date: 22-11-2026, 21:05 SGT. Owner's words: "there needs to be a human review element where i could see all the ads generated and ill pick the best one to be sent for cold outreach", "maybe we could include all the needed human review loop thing inside of each particular prospect's page", "i wanna be seeing all the ads generated for the brand tho, ill select the best one."

This plan stands beside the dashboard overhaul plan (2026-11-22-1933); that one stays in force for its Parts 2 to 4.

## Goal

For an outreach brand the agent makes the candidates and stops. The owner sees every picture made for the brand on the prospect's page and picks the one to send. This moves the goal: the ad that opens a conversation is the one the owner judged best, not the one an agent guessed.

## What changes

| # | Change | Where |
|---|---|---|
| P1 | An outreach batch makes drafts of every idea the critic kept, checks them, has one critic rank them, and stops at the board. The agent picks nothing: `pick_save` over MCP is refused for an outreach batch. | `houserules.ts` (rule `outreach`, raise version), `mcp/prompts.ts` (OUTREACH steps 5, 6), `board/service.ts`, `critic/service.ts` next steps |
| P2 | The prospect's page shows the candidates of the brand's newest outreach batch: every draft of every idea as the owner would see it (words set), with its headline. A draft with a D item, or two F items, is shown greyed with the reason and cannot be picked. | `outreach/candidates.ts` (new, reads `board.board`), `GET /api/outreach/prospects/:id`, `web/src/routes/outreach/prospect.tsx` |
| P3 | "Send this one": the owner's pick. It saves the pick for that idea and a pass for each other idea. Owner only, from the dashboard. He can pick another until the first message is marked sent. | `POST /api/outreach/prospects/:id/pick` |
| P4 | The agent then makes the one final, runs `batch_done` and `outreach_attach`. An ad attached from a batch the owner picked in carries `picked: true` and counts as his yes (as his own upload does). "Not this after all" is the existing no. | `outreach/desk.ts`, `outreach/stage.ts` (`verdictOf`), shared `OutreachAd` |
| P5 | "None of these" with one line why: event `none` with the batch. It counts as a no of the two tries; the agent's next try reads his words (`wantsAd` → `again`). After the second, parked. | shared `OutreachEvent`, `stage.ts`, route |
| P6 | "This picture, other words" (ads with words only): one line from the owner on one draft, event `words`. The agent reads it in `outreach_next`, sets new words on that picture, and the candidates wait for the owner again. | event, `desk.ts` next, route |
| P7 | New stage values are not stored: `stageOf` gives `pick_waits` (candidates wait for the owner) and `pick_made` (waits for the agent's final). Today page: one line per brand that waits for a pick, linking to its page. Studio counts them under outreach ads. | `stage.ts`, `today.ts`, `attention/service.ts`, `web` |
| P8 | `outreach_next` gives the agent, first, the brands whose pick is made and whose final is owed, then the "other words" asks, then the list. | `desk.ts` |

## What ifs

- Every draft failed a check: the agent repairs once, else parks the brand with the reason; the pictures stay on the page.
- The final comes out worse: it shows as the ad with "Not this after all" (a no); the candidates are still there to pick from.
- The owner's own upload still counts as his yes and wins.
- A first message already sent, or an opt-out: no pick is asked.
- Old batches (Ding Bakery, Nano Singapore, Rehues) where the agent picked: their drafts show as candidates; the owner's pick replaces the agent's.

## Not in it

No automatic sending, no new paid call (the final is the same US$0.093 as today; nine drafts US$0.35), no change to a client's batch, no taste learning from outreach picks yet.

## Tests

Stage machine (pick_waits, pick_made, none twice → parked, words ask), route auth (owner only, member 403, no session 401), MCP refusal of `pick_save` for outreach, attach with `picked`, candidates view (greyed draft not pickable), Today and attention counts, prospect page states.

## Verification

`npm run check`, `npm audit --omit=dev`, security checklist, screenshots at 390 and 1280 px with made-up data, then a live browser check with a temporary owner account and a test prospect (standing yes, 22-11-2026).
