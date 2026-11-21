import { RULES_VERSION } from "../houserules.js";

export interface Prompt {
  name: string;
  title: string;
  description: string;
  text: string;
}

const WILD_ADS = `Wild ads for one brand and one product. House rules version ${RULES_VERSION}.

Step 0. Ask first. If the brand or the product is not given, ask the owner two things and wait for both answers:
(a) which brand: one of the saved brands, or a new https address;
(b) which product of that brand: list the product pages you find and let him pick one.
Then ask for the deliverable: format, channel, size and count. This prompt is for a v1 batch: the picture carries the logo and no words. For an ad with a headline, use the prompt headline_ads.

Step 1. Set-up. Call rules_get with role "main" and kind "v1". Start the batch with kind "v1". Read the taste canon, the taste log, the swipe file and references_get. Save a real photo of each thing a picture will show. Read the taste canon, the taste log and the swipe file. Follow the house rules that fit this product. If a rule conflicts with the owner's input, follow his input and name the rule.

Step 2. Route. The studio renders static 4:5 pictures only. For any other format, deliver the brief, the ideas and a text spec (layout, shot list or panel script), and say which step the studio cannot do.

Step 3. Truth first. Save the facts, each with an exact quote and its page address. Build the truth sheet: real size, shape and packaging, and for food the brand's real photos and cut proportions. Mark a number with no source "unverified".

Step 4. Ideas. Write three ideas. Each has one device, one focal point and five elements or fewer. Find references outside the category and write one line on what each does. Apply the cover test and the kill test, and cut what fails.

Step 5. Judge. Give only the batch id to a fresh critic: a new helper that has seen nothing of this batch. It calls critic_open with step "ideas" and says keep or cut for each idea, with a reason (critic_pick). Write a new idea in place of each one it cuts, and send a fresh critic again. If you cannot start a fresh helper, tell the owner and stop.

Step 6. Spend gate. Send one draft first to read the real price. Under US$1 for the batch, continue. At US$1 or more, show the owner the count and the estimate and wait for his yes. Then make three drafts for each idea, each from its own skeleton; change camera, crop and scale. Save the shape, print, D and F checks for every draft, and name every draft that has a D item. Then give only the batch id to a fresh critic again: it ranks each idea's drafts blind (critic_open with step "drafts", critic_rank). Its rank stays hidden until the owner has picked; never ask for it.

Step 7. Show. Show the drafts with the logo in the picture and no words, numbered 1 to 3 with no rank, each beside its truth sheet. Give the result first.

Step 8. Stop. The owner picks. Then make the finals under the same spend gate and measure them again. Call batch_done: it says which of his conditions hold, and lists what remains for the stranger test. He runs that test himself.

Done when: the owner has picked one draft for each idea; no final has a D item; shape and proportions match the truth sheet; every claim traces to the fact sheet.

If a step names work for which the server lists no tool, stop and tell the owner which step is missing.`;

const HEADLINE_ADS = `Headline ads (v2) for one brand and one product: three ads, one each for top, middle and bottom of funnel, each with a headline and a subline set in the brand's own font. House rules version ${RULES_VERSION}.

Step 0. Ask first. If the brand or the product is not given, ask the owner for both and wait. Ask which kind of ad he wants; this prompt is for v2.

Step 1. Set-up. Call rules_get with role "main" and kind "v2". Start the batch with kind "v2". Read the taste canon, the taste log, the swipe file and references_get with kind "v2": the owner's own proud ads are the bar.

Step 2. Truth first. Save the facts, each with an exact quote and its page address, and the buyer's own words from reviews. Read how rivals advertise for the angle only; never copy a picture or a line. Build the truth sheet. Save a real photo of every thing a picture will show: the pack, the food, each variant, each prop (product_save). A draft with a missing photo is refused.

Step 3. Burst. Write 24 to 30 ideas, 8 or more for each of tof, mof and bof, and save all of them in one ideas_save call before any is chosen. Each has one picture device, a headline that points at it, a subline, the fact behind each claim, and the real photos it shows.

Step 4. Judge. Give only the batch id to a fresh critic. It calls critic_open with step "ideas" and chooses one idea for each stage (critic_select). When it refuses a stage, write more ideas and send a fresh critic again. If you cannot start a fresh helper, tell the owner and stop.

Step 5. Words. Show the owner the three ideas with their headline and subline as text, and at most one other headline each. Wait for his yes. Save his exact words (copy_approve). No draft is made before this.

Step 6. Drafts. Save the brand's font (font_save). Send one draft first to read the real price; at US$1 or more for the batch, wait for the owner's yes. Make three drafts for each idea, each from its own skeleton, with another camera, crop or scale. The model paints no words: keep the headline area plain backdrop. Set the approved words and the real logo on each draft (type_set). Save the checks of every draft. Then a fresh critic ranks each idea's drafts blind (critic_open with step "drafts", critic_rank). Its rank stays hidden until the owner has picked.

Step 7. Show. Show the drafts with their words and logo, numbered 1 to 3 with no rank. Name every draft that has a D item. The owner picks one draft for each idea, or passes on all three.

Step 8. Finals. Make each final from the picked draft, run the real-camera finish, set the same words again and measure it again. Call batch_done.

Done when: the owner has picked one draft for each idea; each final has its approved words, no D item and the right shape; every claim traces to a saved fact.

If a step names work for which the server lists no tool, stop and tell the owner which step is missing.`;

const CONCEPT_ADS = `Concept ads (v3) for one brand and one product: three ads, each one picture device and the line that points at it. The owner picks the three concepts himself from the whole set. House rules version ${RULES_VERSION}.

Step 0. Ask first. If the brand or the product is not given, ask the owner for both and wait. Ask which kind of ad he wants; this prompt is for v3.

Step 1. Set-up. Call rules_get with role "main" and kind "v3". Start the batch with kind "v3". Read the taste canon, the taste log, the swipe file and references_get with kind "v3": the owner's own proud ads are the bar, never a layout to copy.

Step 2. Truth first. Save the facts, each with an exact quote and its page address. Build the truth sheet. Save a real photo of every thing a picture will show: the pack, the food, each variant, each prop (product_save). A rough or a draft with a missing photo is refused.

Step 3. Brief. Read what buyers say in public: reviews, forums, comments. Save the brief (brief_save): each insight marked as evidence (with the buyer's exact words and the page), an interpretation, or a hypothesis. With fewer than three insights that are no hypothesis, stop and tell the owner. Never invent an insight.

Step 4. Concepts. Write 6 to 15 concepts in 3 to 5 territories, each territory on its own insight, and save the whole set in one concepts_save call. A concept is a pair: neither the picture nor the line works alone. For food, the food is the device.

Step 5. Roughs. Make a rough of each concept worth one (render_submit with kind "rough"): from the product's real photos, with no words in the picture, two at most for a concept and eight for the batch. Send one first to read the real price; at US$1 or more, wait for the owner's yes. Look at each rough yourself.

Step 6. Review. Give only the batch id to a fresh critic. It calls critic_open with step "concepts", looks at every rough beside the reference ads, and saves its review of every concept (concept_review_save). It may recommend none. If you cannot start a fresh helper, tell the owner and stop.

Step 7. The owner's pick. Show the owner every concept with its rough, its words and the critic's notes (concept_board, or the concept board in the dashboard), not only the ones the critic recommends. He picks three, of any funnel stage. Save his pick with his own words (concept_pick). Never pick for him. If he wants more, write more concepts and go back to step 5.

Step 8. Words. Show him the words of his three concepts as text and wait for his yes (copy_approve). His pick of a concept is not his yes to its words.

Step 9. Follow batch_get: its nextStep names what comes next, from the direction of each concept to the drafts, the owner's pick of a draft and the finals.

If a step names work for which the server lists no tool, stop and tell the owner which step is missing.`;

export const PROMPTS: readonly Prompt[] = [
  {
    name: "concept_ads",
    title: "Concept ads (v3)",
    description: "The v3 pipeline: a brief from what buyers say, a set of concepts with a rough of each, a fresh critic's review, and the owner's own pick of three.",
    text: CONCEPT_ADS,
  },
  {
    name: "headline_ads",
    title: "Headline ads (v2)",
    description: "The v2 pipeline: three ads with a headline and a subline, one each for top, middle and bottom of funnel.",
    text: HEADLINE_ADS,
  },
  {
    name: "wild_ads",
    title: "Wild ads",
    description: "The studio's pipeline, from brand and product to three finished 4:5 ads.",
    text: WILD_ADS,
  },
];
