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
Then ask for the deliverable: format, channel, size and count.

Step 1. Set-up. Call rules_get with role "main". Read the taste canon, the taste log and the swipe file. Follow the house rules that fit this product. If a rule conflicts with the owner's input, follow his input and name the rule.

Step 2. Route. The studio renders static 4:5 pictures only. For any other format, deliver the brief, the ideas and a text spec (layout, shot list or panel script), and say which step the studio cannot do.

Step 3. Truth first. Save the facts, each with an exact quote and its page address. Build the truth sheet: real size, shape and packaging, and for food the brand's real photos and cut proportions. Mark a number with no source "unverified".

Step 4. Ideas. Write three ideas. Each has one device, one focal point and five elements or fewer. Find references outside the category and write one line on what each does. Apply the cover test and the kill test, and cut what fails.

Step 5. Judge. Give only the batch id to a fresh critic: a new helper that has seen nothing of this batch. It calls critic_open with step "ideas" and says keep or cut for each idea, with a reason (critic_pick). Write a new idea in place of each one it cuts, and send a fresh critic again. If you cannot start a fresh helper, tell the owner and stop.

Step 6. Spend gate. Send one draft first to read the real price. Under US$1 for the batch, continue. At US$1 or more, show the owner the count and the estimate and wait for his yes. Then make three drafts for each idea, each from its own skeleton; change camera, crop and scale. Save the shape, print, D and F checks for every draft, and name every draft that has a D item. Then give only the batch id to a fresh critic again: it ranks each idea's drafts blind (critic_open with step "drafts", critic_rank). Its rank stays hidden until the owner has picked; never ask for it.

Step 7. Show. Show the drafts with the logo in the picture and no words, numbered 1 to 3 with no rank, each beside its truth sheet. Give the result first.

Step 8. Stop. The owner picks. Then make the finals under the same spend gate and measure them again. Call batch_done: it says which of his conditions hold, and lists what remains for the stranger test. He runs that test himself.

Done when: the owner has picked one draft for each idea; no final has a D item; shape and proportions match the truth sheet; every claim traces to the fact sheet.

If a step names work for which the server lists no tool, stop and tell the owner which step is missing.`;

export const PROMPTS: readonly Prompt[] = [
  {
    name: "wild_ads",
    title: "Wild ads",
    description: "The studio's pipeline, from brand and product to three finished 4:5 ads.",
    text: WILD_ADS,
  },
];
