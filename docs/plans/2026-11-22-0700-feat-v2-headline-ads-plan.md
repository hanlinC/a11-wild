---
title: v2 Headline Ads - Plan
type: feat
date: 2026-11-22
topic: v2-headline-ads
artifact_contract: ce-unified-plan/v1
execution: code
---

# v2 Headline Ads - Plan

## Goal Capsule

- **Objective:** The studio makes a second kind of ad, v2: a picture with a headline and a subline that the owner approved, set by code in the brand's real font. A v2 batch ends in three finals (top, middle and bottom of funnel), their Meta text, a private client pack link and a place for the client's results.
- **Means:** The same AWS studio, MCP server, spend gate and pixel service as v1. Engine 2 of a11-adgen is the model for the steps. No new provider.
- **Product authority:** Han, the owner. He approves the words, picks the drafts and judges the finals. On 22-11-2026 he gave the agent leave to merge for one night when the checks, the review and the tests are clean.
- **Execution profile:** Two pull requests. PR6 makes the ad (kind, ideas, words, type, tools, reference set). PR7 delivers it (Meta text, client pack, results). Each is deployed and tried live before it is merged.
- **Stop conditions:** Stop at the spend cap the owner set for the night (US$75 in total; fal under US$0.50 for each brand). Stop before any deletion of the owner's data.
- **Open blockers:** None.

---

## Product Contract

### Summary

A batch has a kind: `v1` (the wild picture with the logo only), `v2` (this plan) or `v3` (engine 3, its own plan). The agent asks the owner which kind at the start of each batch. There is no default.

A v2 batch: facts and buyer words, 24 to 30 ideas with at least 8 for each funnel stage, a fresh blind critic that picks one idea for each stage, the owner's approval of the words as text, three drafts for each idea with the approved words and the real logo set by code, the blind rank, the owner's pick, finals, Meta text, the client pack link, results.

### Requirements

**Kind**
- R1. `batch_create` needs `kind`. A batch saved before this plan reads as `v1`.
- R2. The house rules are served for a kind and a role (`main`, `writer`, `critic`, `art_director`). The rule "no words on the picture" holds for v1 only. "No sticker and no button on the picture" holds for every kind (owner, 22-11-2026).

**Ideas and words**
- R3. A v2 idea has a funnel stage (`tof`, `mof`, `bof`), a headline, a subline, the claims in its words each with the saved fact that proves it, and the names of the real photos of each brand item it shows.
- R4. The whole burst is saved before any idea is picked: 24 to 30 ideas, at least 8 for each stage.
- R5. Hard checks in code, true or false only: a headline has 8 words or fewer and a subline 8 or fewer; a top-of-funnel idea has no price, saving or delivery term; each number in the words is in the value or the quote of a saved fact; the stage counts of R4.
- R6. The fresh critic sees the burst in a shuffled order with no author notes, and picks one idea for each stage with a reason. It may refuse a stage; then more ideas are written and the bar is not lowered.
- R7. The owner approves the words as text before any draft. The agent saves his exact words. At most one other headline is offered for each idea. After approval the words are locked: a change needs a new approval.
- R8. Real photos first, for every kind: a draft is refused when a brand item that the idea shows has no real photo saved with the product.

**Type**
- R9. The model paints no words. The server sets the approved headline and subline, and the real logo, with `headline.py` from a11-adgen, unchanged, in the brand's real font. The words come from the approved copy by idea, never from free text in the call.
- R10. The font file is the brand's own: its family from Google Fonts, or the file that the brand's site serves. When a fallback family is used, the reply says so and the owner is told.
- R11. The owner's type rules are the defaults and are refused when broken: 4% margin, 3% between logo and words, 4% between words and product, subline at 0.4 to 0.5 of the headline, words on one tone.
- R12. The board shows each v2 draft with its words. A draft with no words set is never shown for a pick.
- R13. A final is rendered from the picked draft without its words, gets the real-camera finish, and then gets the same words set again. The done gate of a v2 batch also asks that each final has its words.

**Pixel tools**
- R14. `box_print.py` and `food_grade.py` are copied unchanged and run on the server. Relight, vary-food and the open-neck tool of `product_lock.py` are switched on.

**Reference set**
- R15. The owner's proud ads are saved as pictures, each for a kind: 16 headline ads for v2 and v3, and 2 logo-only ads for v1 marked as a loose reference. The writer, the art director and the critic get them before they work. The pictures never enter the repository.

**Delivery (PR7)**
- R16. Meta text for each final: primary text, headline, description and a CTA from a fixed list, two variants each. It opens with the picture's own line. Every number is in a saved fact (code check). Approved text is copied by the server into later versions, never retyped.
- R17. Ad names are made by the server: Singapore week, brand, the brand's batch number, stage, idea, version.
- R18. `pack_publish` makes a private link for the client: three finals, the Meta text, one line of why for each ad, the launch plan, and the fact check. A failed final cannot enter a pack.
- R19. `pack_update` puts a newer approved version into the same link. The old content is kept and can be put back. A link is never revoked to replace its ads.
- R20. The client can upload results files (JPEG, PNG, CSV, XLSX) through the link. The owner or his agent can type the numbers in. A result belongs to one ad name and one pack version.
- R21. The dashboard shows each pack, its link state and its results.

### Key Flows

1. Agent: `rules_get(kind: v2)` -> `batch_create(kind: v2)` -> facts and truth as in v1 -> `references_get(v2)` -> `ideas_save` (burst).
2. Fresh critic: `critic_open(step: ideas)` -> `critic_pick` (one for each stage).
3. Agent shows the three ideas with their words. Owner answers in chat. `copy_approve` with his exact words -> state `worded`.
4. Agent: price, drafts as in v1 (no words in the prompt) -> `type_set` on each draft -> checks -> blind rank -> owner's pick -> finals -> finish -> `type_set` -> checks -> `batch_done`.
5. Agent: `meta_save` -> `pack_publish` -> the owner sends the link -> client uploads -> `results_save`.

### Scope Boundaries

- Not in this plan: v3 (its own plan), the outreach CRM (its own plan), redesign batches, the week report, client comments with alerts, 9:16.
- The gold set stays dropped. Calibration uses the owner's real picks.

### Success Criteria

- A v2 batch runs live from brand to three finals with words in the brand's font, inside the spend gate.
- The owner's reference ads are served to the agent and the critic.
- A client pack link opens with no sign-in, shows only that pack, and takes a results file.

---

## Planning Contract

### Key Technical Decisions

- KTD1. `Batch.kind` is `"v1" | "v2" | "v3"`; a missing value reads as `v1` in `BatchStore`. The state machine takes the kind: v2 adds `worded` between `judged` and `priced`.
- KTD2. One `Idea` type with optional v2 fields (`stage`, `headline`, `subline`, `claims`, `footnote`, `shows`). `ideas/checks.ts` holds the true-or-false checks of R5 by kind. Taste stays in words, not in code.
- KTD3. Approved copy lives in its own item (`COPY#<ideaId>` under the batch) with the owner's words, the time and the version. `type_set` reads it; it has no text input.
- KTD4. The pixel service gets the ops `headline`, `box_print`, `food_grade`, `relight`, `vary_food` and `open_source`. The scripts are copied byte for byte, with a test that compares their hash with a recorded one.
- KTD5. The API fetches a font file once (`font_save`) through `urlsafety`, checks its type and size, and stores it in the private bucket. The pixel function has no outbound call.
- KTD6. A typeset picture is a new `ImageKind` `typeset` that stands for its draft or final, as a reprint does. The board, the critic packet and the client pack show it. The bare picture stays the source of a final.
- KTD7. The reference set is a store (`REF#<kind>`) with private pictures. An owner-run script loads pictures from a folder outside the repository. `references_get` returns short links.
- KTD8. House rules get `kinds` and the roles `writer` and `art_director`. `rules_get` takes `kind` and `role`. The version rises.
- KTD9. A pack link is `/c/<token>`: 32 random bytes, only the SHA-256 stored, no index, no listing. The page is public and read-only, and gets pictures through short links. Uploads go to a quarantine prefix with a type list, a 10 MB limit and a count limit for each pack.
- KTD10. Ad names and the week come from the server clock in `Asia/Singapore`.

### Risks and Dependencies

- A public route is new. It gets its own probes: a wrong token gives 404, a token of another pack shows nothing of this one, and an upload over the limit or of another type is refused.
- `headline.py` refuses when the words cross a colour edge. The art director then moves the area or the draft is made again; the check is not weakened.
- A brand font that no public file serves: the fallback is named in the reply and the owner is told.
- fal credit is limited. Drafts stay at low quality, and a final is made only for a picked draft.

### Sources

- a11-adgen: `docs/creative-playbook.md`, `docs/render-checklist.md`, `docs/decisions.md`, `worker/houserules.ts`, `plugin/agents/*.md`, `plugin/commands/*.md`, `scripts/headline.py`, `scripts/box_print.py`, `scripts/food_grade.py`, `scripts/product_lock.py`.
- The owner's answers of 22-11-2026 (`docs/decisions.md`).

---

## Implementation Units

### PR6: the v2 ad

### U18. Batch kind and rules by kind and role
- Files: `packages/shared/src/index.ts`, `services/api/src/batch/{state,store}.ts`, `services/api/src/houserules.ts`, `services/api/src/mcp/tools/{core,batch}.ts`, `docs/decisions.md`.
- Tests: an old batch reads as v1; `batch_create` with no kind is refused; a v2 batch cannot reach `priced` before `worded`; a v1 batch never needs `worded`; `rules_get` gives the right rules for each kind and role.

### U19. The v2 burst, its checks and the critic's stage pick
- Files: `packages/shared/src/index.ts`, `services/api/src/ideas/checks.ts`, `services/api/src/critic/{packet,service}.ts`, `services/api/src/mcp/tools/{batch,critic}.ts`.
- Tests: each check of R5 with a passing and a failing idea; a burst of 23 or with 7 for one stage is refused; the packet is shuffled, holds no author note and is stable for one ticket; a pick needs one idea for each stage; a refused stage keeps the batch at `ideas`.

### U20. Words approval
- Files: `services/api/src/copy/store.ts` (new), `services/api/src/mcp/tools/copy.ts` (new), `services/api/src/wire.ts`.
- Tests: approval saves the owner's exact words; words that fail R5 are refused; a second alternative is refused; a change after approval needs a new approval and raises the version; a member cannot approve.

### U21. Fonts and type on the server
- Files: `services/pixels/headline.py` (copy), `services/pixels/handler.py`, `services/pixels/tests/`, `services/api/src/fonts/store.ts` (new), `services/api/src/pixels/service.ts`, `services/api/src/mcp/tools/pixels.ts`.
- Tests: the script's hash; a set headline on a plain picture; the refusal when words cross an edge; the refusal under the margins; `type_set` with no approved copy is refused; a font of a wrong type or over the size limit is refused; a private address is refused.

### U22. Box print, food grade, relight, vary-food, open neck
- Files: `services/pixels/{box_print,food_grade}.py` (copies), `services/pixels/handler.py`, `services/api/src/pixels/service.ts`, `services/api/src/mcp/tools/pixels.ts`.
- Tests: the scripts' hashes and their own tests from a11-adgen; each op through the handler with a small picture.

### U23. Real photos first
- Files: `services/api/src/ideas/checks.ts`, `services/api/src/render/service.ts`.
- Tests: a draft of an idea whose shown item has no saved photo is refused, for v1 and v2; an idea saved before this plan still renders.

### U24. Reference set
- Files: `services/api/src/references/store.ts` (new), `services/api/src/mcp/tools/taste.ts`, `services/api/src/http/studio-routes.ts`, `scripts/add-references.mjs` (new), `web/src/routes/taste.tsx`.
- Tests: `references_get` by kind; v1 references carry the loose note; the script refuses a file that is not a picture; the Taste page shows the set.

### U25. Board, done gate and dashboard for v2
- Files: `services/api/src/board/service.ts`, `services/api/src/batch/done.ts`, `web/src/routes/{board,home}.tsx`.
- Tests: the board shows the typeset picture and the words of each idea; a draft with no words is "not ready"; the done gate names a final with no words; the Studio list shows the kind.

### PR7: delivery

### U26. Meta text and ad names
- Files: `services/api/src/meta/{store,checks,names}.ts` (new), `services/api/src/mcp/tools/meta.ts` (new).
- Tests: the number check; the opening line; the week on the Singapore clock at a Monday boundary; names of two batches of one brand differ.

### U27. Client pack link
- Files: `services/api/src/pack/{store,service}.ts` (new), `services/api/src/http/pack-routes.ts` (new), `web/src/routes/pack.tsx` (new), `infra/lib/constructs/*`, `scripts/probe.mjs`.
- Tests: publish refuses a failed final; the token is stored as a hash; update keeps history and undo restores it; a wrong token gives 404; the page shows no other pack.

### U28. Results
- Files: `services/api/src/results/store.ts` (new), `services/api/src/http/pack-routes.ts`, `services/api/src/mcp/tools/results.ts` (new), `web/src/routes/results.tsx` (new).
- Tests: an upload of a wrong type or size is refused; the count limit; a result is tied to an ad name and a pack version; the dashboard lists them.

---

## Verification Contract

- `npm run check`, `npm run check:public`, `npm audit` and the Python tests of the pixel service pass.
- `docs/security-checklist.md` is run for each pull request; the public pack route gets new probes.
- Each pull request is deployed from its branch, the live probes pass, and a recorded browser test covers its pages.
- One real v2 batch is run live through the MCP inside the spend cap: burst, blind stage pick, words, drafts with type, rank, pick, finals with type.

## Definition of Done

- PR6 and PR7 are merged and live, and `docs/decisions.md` records the owner's decisions of 22-11-2026.
- A live v2 batch reached three finals with words, and a pack link opened for it.
