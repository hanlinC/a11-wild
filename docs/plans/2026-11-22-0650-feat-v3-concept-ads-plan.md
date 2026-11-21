---
title: v3 Concept Ads - Plan
type: feat
date: 2026-11-22
topic: v3-concept-ads
artifact_contract: ce-unified-plan/v1
execution: code
---

# v3 Concept Ads - Plan

## Goal Capsule

- **Objective:** The studio makes a third kind of ad, v3: a concept-led ad. A concept is a pair: one picture device and the line that points at it. A v3 batch ends in three finals that the owner would be proud to send, with the same delivery as v2 (Meta text, the client pack link, results).
- **Means:** The same AWS studio, MCP server, spend gate, pixel service, words approval, type tools, blind rank, pick board and delivery as v2. Engine 3 of a11-adgen, with its overhaul of 18-11-2026, is the model for the steps. No new provider. The server calls no model to reason.
- **Product authority:** Han, the owner. In v3 he picks the three concepts himself, approves the words, picks the drafts and judges the finals. The critic advises.
- **Execution profile:** Three pull requests on top of the v2 delivery. PR9 makes the concepts (brief, concepts, roughs, critic review, the owner's concept pick). PR10 makes the pictures (direction, drafts from the rough, real-photo plans, lockups, checks). PR11 makes the studio learn (scopes, learning records, brand notes).
- **Stop conditions:** Stop at the spend cap (US$75 in total for the night; fal under US$0.50 for each brand). Stop before any deletion of the owner's data. Make no owner decision for the owner: no concept pick, no words approval, no draft pick.
- **Open blockers:** A full live v3 run needs three owner gates. Until the owner answers on the test batch (PR #7), the live run stops after the roughs, which need no owner gate.

---

## Product Contract

### Summary

A v3 batch: a brief with buyer insights that say how sure they are, 6 to 15 concepts in 3 to 5 territories, a cheap rough picture for the concepts worth one, a fresh critic that judges the roughs as pictures against the owner's reference ads, the owner's pick of any three concepts from all of them with the critic's notes beside each, his approval of the words, one direction for each picked concept, three drafts that each ask him a different question, the blind rank, his pick, finals, and the v2 delivery.

The first real engine 3 batch of a11-adgen failed the owner's bar for five reasons: copy ideas with no picture idea, one pasted packshot angle on every draft, beige art direction, one centred type template, and a critic that judged words. Each requirement below removes one of them.

### Requirements

**Kind and state**
- R1. `batch_create` accepts `kind: "v3"`. A v3 batch has three states of its own: `briefed` (the brief is saved), `reviewed` (the critic's review of the concepts is saved) and `directed` (each picked concept has its direction). Its path: `truth`, `briefed`, `ideas` (the concepts), `reviewed`, `judged` (the owner's concept pick), `worded`, `directed`, then the states of v2 from `priced`. Roughs are no state: a batch may have none.
- R2. Scope is packaged products (food, drink, packaged wellness and beauty). Services, restaurant plates and 9:16 stay parked.

**Brief**
- R3. `brief_save` holds the buyer insights of the batch. Each insight has its text, a basis (`evidence`, `interpretation` or `hypothesis`), and for `evidence` the source link and the quote. It also holds what the category does, what it leaves unused, the constraints, and the unknowns. An unknown is never filled in.
- R4. Fewer than three usable insights: the batch stops at `briefed` and the owner is told. No insight is invented.

**Concepts**
- R5. A concept has: territory, name, the insight it stands on, the proposition, the picture device, the mechanism (type and how), the role of the product, the role of the brand, the funnel stage, the headline, the subline and its basis (`fact` with the fact, `second_beat`, or `none`), the writer's two cover-test answers (picture alone, headline alone), the claims with their facts, the real photos of each brand item it shows, and its risks.
- R6. The whole set is saved before any review: 6 to 15 concepts, 3 to 5 territories, each territory on a different insight. Rework adds concepts; it deletes none.
- R7. Hard checks in code, true or false only: the counts of R6; each concept names a saved insight; the word checks of v2 (lengths, numbers in a saved fact, no offer term on a top-of-funnel concept); each brand item it shows has a real photo (the rule "real photos first").
- R8. The picture device comes first and is found for this product. For food, the food is the device: no prop beside food. At most one prop. These are rules in words for the writer and the critic, not code.

**Roughs**
- R9. A rough is a new render kind: low quality, at the draft price, through the spend gate, with no words approval. At most 2 for each concept and 8 for each batch.
- R10. A rough of a food concept starts from the brand's real photos (R19), never from a model's guess of the food.

**Critic review**
- R11. A fresh critic gets a packet: the concepts in a shuffled order with no author note, the rough of each as a picture, and the owner's reference ads for the kind. It judges at phone size, in this order: does it stop me, do I get it in a second, do I want it.
- R12. For each concept the critic saves nine scores (originality, appropriateness, insight, headline, visual concept, product relevance, brand recognition, commercial purpose, execution potential), the point test (the headline points at something seen), the local-truth test (real Singapore buyer behaviour), the pay question, its own answer to the cover test from the rough, and a note. It may reject the whole set.
- R13. A concept with no rough is marked "judged from words". The critic cannot recommend it.

**The owner's concept pick**
- R14. The owner sees every concept with its rough and the critic's notes and scores, and picks any three, from any funnel stage, in his own words. Only the owner's role can save the pick. The agent never answers for him.
- R15. When a picked concept fails a soft gate (a critic score under 4, a failed point test, no rough), the pick is saved with a warning. A hard check of R7 still refuses.
- R16. The words of the picked concepts go through the v2 words approval unchanged. At most one other headline is offered for each concept.

**Direction and drafts**
- R17. `direction_save` holds one direction for each picked concept whose words are approved: why the look says the concept, the production risk (`low`, `medium`, `high`; `high` needs a reason), the shared look, the type lockup, and exactly three drafts. Each draft has the question it asks the owner and eight axes (composition, product position, scale, camera, light, environment, negative space, staging).
- R18. Hard check in code: each pair of drafts differs on three axes or more, and one of them is composition, camera or scale.
- R19. Real-photo plans: a pixel tool cuts out the brand's real product and food photos and composes them into a reference plan (the method of the real-slices sheet). Food in a v3 picture comes only from such a plan or from a real photo used as a texture reference at high quality.
- R20. A draft starts from the picked rough when there is one: the rough is the first reference, then the real photos, and the prompt changes only what the draft's question asks. With no rough it starts from a real-photo plan.
- R21. The product is drawn by a reference render by default, so it can be held, turned or opened. Each such draft passes a fidelity check before it is shown: the shape ratio from `pack_check` (tolerance 0.02), and the label and the logo as check points. Product lock stays as the fallback and as the repair (reprint, box print).
- R22. The stage is the brand's own colour by default: a seamless with one hard shadow, two colour blocks, or a coloured wall and floor. A real room only when the concept needs a place. Rules in words.
- R23. Type lockups: flush-left column, flush-right column, top band left. The logo is small at the head of the column. No separate panel or colour block behind the words. The lockup changes with the idea; the direction names it and `type_set` applies it. The owner's type rules of v2 stay.

**Checks, picks, finals**
- R24. A draft that is not eligible is made again once, with a prompt that names the fault. With fewer than two eligible drafts after that, the direction is written again with a lower risk.
- R25. A newer owner verdict corrects an older pass on the same concept, so a usable draft can be picked again.
- R26. A final is checked at full size and at phone size on eight points (concept, product truth, brand identity, copy accuracy, food, composition, craft, render checklist). A failed final never enters a pack.
- R27. The board, the done gate, Meta text, the pack, ad names and results work for v3 as for v2. The stage in an ad name comes from the concept.

**Learning (PR11)**
- R28. A canon rule has a scope: owner taste, a brand, creative craft, or performance. A batch reads the rules of no brand and of its own brand.
- R29. A learning record holds: the observation, its source, the scope, the proposed lesson, the evidence count, the confidence, the examples, the counterexamples, the expected effect and the test result. One correction makes no rule for every brand. A record never changes a product fact.
- R30. A proposed canon change is saved as a proposal. Only the owner makes it active. Every version stays and can be restored.
- R31. A brand keeps notes of what the owner chose for it (for example the cap, not the pump). The next batch of that brand gets them.

### Key Flows

- F1. Agent: research and truth as today, `brief_save`, `concepts_save`, `rough_render` for the concepts worth one.
- F2. Fresh critic: `concept_packet`, looks at roughs and reference ads, `concept_review_save`.
- F3. Owner: opens the concept board, reads the notes, says which three. Agent: `concept_pick` with his words, then the words approval.
- F4. Art director: `direction_save`. Agent: plans, drafts, checks, one redo. Critic: blind rank. Owner: pick. Agent: finals, type, checks, delivery.

### Scope Boundaries

- No new hard check of taste. Code checks counts, links between records, and measures.
- No 9:16, no services, no plates, no new provider, no model call from the server.
- The CRM and the outreach ads are a later plan.

### Success Criteria

- A v3 batch cannot reach drafts without a brief, a full concept set, the owner's concept pick and his words approval.
- The critic's packet shows pictures, not only words, and the reference ads.
- Three drafts of one concept differ in what they ask, by a check in code.
- No food in a v3 picture is drawn from nothing: a test proves that a food concept without real photos is refused.
- The owner's bar: he would pay for the finals and be proud of them. Only he can say so.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Concepts are `Idea` items with an optional `concept` part (R5 fields), so the copy store, the board, picks, finals, Meta text and the pack keep one id and one path. `ideas/checks.ts` gets the v3 checks.
- KTD2. The state machine takes the kind, as for v2. v3 adds `briefed`, `reviewed` and `directed`; in a v3 batch `judged` means the owner's concept pick. `worded` and all later states are shared with v2. `batch_create` refuses v3 until the last unit of PR9 is in, so no batch can stop at a step that has no tool.
- KTD3. The brief is one item under the batch (`BRIEF`), with insight ids that the server makes.
- KTD4. `rough` is an `ImageKind`. `RenderService` counts roughs for each concept and each batch inside the same conditional step as the spend reservation.
- KTD5. The concept review is its own item (`CREVIEW#<ticket>`), made by a client in the critic role, as the rank is. Unlike the draft rank, its notes are shown to the owner: he asked for them (18-11-2026). The rank of drafts stays hidden until he picks.
- KTD6. The owner's concept pick is one item (`CPICK`) with his words, written only by the owner's role. It sets `Idea.picked` for three concepts and moves the batch to `chosen`. In a test batch it teaches nothing (PR #7).
- KTD7. The direction is one item for each concept (`DIR#<ideaId>`), versioned. The axis check of R18 runs at save.
- KTD8. The cut-out and compose tool is an op of the pixel service on top of the `cutout` and `layout` of `product_lock.py`; no new script unless a11-adgen has one to copy byte for byte.
- KTD9. A reference render is a normal draft render with product pictures as references. The fidelity check reuses `checks_save` with a measured ratio; a draft with no saved fidelity check is not eligible.
- KTD10. Lockups are parameters of the existing `headline` op. `type_set` reads the lockup from the direction, never from free input.
- KTD11. Canon scopes are a field on a rule; a missing scope reads as owner taste. Learning records and brand notes are new items. The `learn` tool only proposes.

### Risks and Dependencies

- This plan stacks on PR #6, #7 and #8, which wait for the owner. A change he asks for there may move this work.
- The owner's bar cannot be tested by code. The live proof needs him. Until then the proof is the gates, the tests and the roughs.
- A reference render can draw a wrong label. The fidelity check and the product-lock repair are the answer; the check is not weakened.
- fal credit: a rough costs as a draft. The caps of R9 bound a batch at 8 roughs and 9 drafts before finals.
- The concept review shows critic notes to the owner before he picks concepts. The draft rank stays blind, so calibration on draft picks is not changed.

### Sources

- a11-adgen: `docs/a11-engine-v3.md` (the owner's specification, 15-11-2026), `docs/engine-3-overhaul.md` (18-11-2026), `docs/creative-playbook.md` 7.8 to 7.12, `plugin/agents/{writer,critic,art-director}.md`, `worker/houserules.ts`.
- The owner in this session, 22-11-2026: real photos first for everything; no sticker; the v1 references are loose; the 16 headline ads are the bar for v2 and v3.
- a11-wild: `docs/plans/2026-11-22-0700-feat-v2-headline-ads-plan.md`, `docs/decisions.md`.

---

## Implementation Units

### PR9: the v3 concepts

### U29. v3 kind, states and rules by role
- Files: `packages/shared/src/index.ts`, `services/api/src/batch/state.ts`, `services/api/src/mcp/tools/batch.ts`, `services/api/src/houserules.ts`, `docs/decisions.md`.
- Tests: `batch_create` takes v3; a v3 batch cannot reach `ideas` before `briefed`, `worded` before the owner's concept pick, nor `priced` before `directed`; v1 and v2 paths are unchanged; `rules_get` gives the v3 rules for each role.

### U30. Brief
- Files: `services/api/src/brief/store.ts`, `services/api/src/mcp/tools/brief.ts`, `packages/shared/src/index.ts`.
- Tests: an `evidence` insight with no link or quote is refused; fewer than three usable insights keeps the batch at `briefed`; the server makes the ids.

### U31. Concepts and their checks
- Files: `services/api/src/ideas/checks.ts`, `services/api/src/mcp/tools/batch.ts`, `packages/shared/src/index.ts`.
- Tests: 5 or 16 concepts, 2 or 6 territories, two territories on one insight, an unknown insight, a number with no fact, an offer on a top-of-funnel concept, a shown item with no real photo: each refused; rework adds and deletes nothing.

### U32. Roughs
- Files: `services/api/src/render/service.ts`, `services/api/src/mcp/tools/render.ts`, `packages/shared/src/index.ts`.
- Tests: a rough needs no words approval; the third rough of a concept and the ninth of a batch are refused, also when two calls overlap; a rough goes through the spend gate; a v1 or v2 batch has no roughs; a food concept with no real photo gets no rough.

### U33. Critic concept review
- Files: `services/api/src/critic/{packet,service}.ts`, `services/api/src/mcp/tools/critic.ts`.
- Tests: the packet is shuffled, stable for one ticket, holds no author note, and carries rough links and reference ads; only the critic role saves a review; a review must cover every concept; a concept with no rough cannot be recommended; a rough made after the review makes the review stale.

### U34. The owner's concept pick
- Files: `services/api/src/concepts/pick.ts`, `services/api/src/mcp/tools/concepts.ts`, `services/api/src/copy/*`.
- Tests: only the owner's role; exactly three; his words are kept as given; a soft gate gives a warning and saves; a hard check refuses; the pick is refused before a current review; the words approval then works as in v2; a test batch writes nothing to the taste log.

### U35. Concept board
- Files: `services/api/src/http/*`, `web/src/routes/concepts.tsx`, `web/src/lib/api.ts`, `web/src/routes/batch.tsx`.
- Tests: every concept with its rough, words, scores and notes; the picked three marked; a phone width shows it without sideways scroll; a member sees it read-only.

### PR10: the v3 pictures

### U36. Direction
- Files: `services/api/src/direction/store.ts`, `services/api/src/mcp/tools/direction.ts`, `packages/shared/src/index.ts`.
- Tests: not before the words are approved; exactly three drafts; the pair check of R18 with a passing and a failing set; `high` risk with no reason refused; a new direction is a new version.

### U37. Drafts from the rough and the reference render
- Files: `services/api/src/render/service.ts`, `services/api/src/mcp/tools/render.ts`, `services/api/src/checks/*`.
- Tests: a v3 draft needs a current direction; it takes the rough as its first reference when one exists; a reference-render draft with no fidelity check is not eligible; a ratio outside 0.02 is not eligible; product lock still works as today.

### U38. Real-photo plans
- Files: `services/pixels/*`, `services/api/src/pixels/*`, `services/api/src/mcp/tools/pixels.ts`.
- Tests (Python and API): cut-outs composed at given places keep their pixels; an input that is no saved real photo of the product is refused; the plan is saved beside its picture.

### U39. Lockups
- Files: `services/pixels/*`, `services/api/src/mcp/tools/type.ts`.
- Tests: each lockup places the column where it says; the v2 type rules still refuse; `type_set` takes the lockup from the direction.

### U40. One redo, final points, verdict correction
- Files: `services/api/src/checks/*`, `services/api/src/board/service.ts`, `services/api/src/picks/*`.
- Tests: a second redo is refused; a final with a failed point is not delivered; a newer verdict brings a passed concept back to the pick board.

### U41. Board, done gate and delivery for v3
- Files: `services/api/src/board/service.ts`, `services/api/src/pack/service.ts`, `web/src/routes/board.tsx`.
- Tests: the v3 board shows eligible typeset drafts with their question; the done gate asks for words on each final; a v3 pack has the right stage in each ad name.

### PR11: learning

### U42. Canon scopes, learning records, brand notes
- Files: `services/api/src/taste/*`, `services/api/src/brand/*`, `services/api/src/mcp/tools/taste.ts`, `web/src/routes/taste.tsx`.
- Tests: a rule with no scope reads as owner taste; a batch gets no rule of another brand; a proposal is not active until the owner says so; a restore brings back the earlier version; a record cannot write a fact; brand notes reach the next batch of that brand.

---

## Verification Contract

- `npm run check`, `npm run check:public`, `npm audit` and the Python tests of the pixel service pass.
- `docs/security-checklist.md` is run for each pull request.
- Each pull request is deployed from its branch, the live probes pass, and a recorded browser test covers its pages.
- Live, inside the spend cap and with no owner gate: a v3 batch on a real brand through the brief, the concepts, the roughs and the critic's review. The rest of the live run waits for the owner.

## Definition of Done

- PR9, PR10 and PR11 are open with clean checks and review; they merge when the owner has answered on PR #6 to #8.
- `docs/decisions.md` records what v3 keeps from engine 3 and what it changes.
- The owner has seen one v3 concept board with real roughs.
