import type { Idea } from "@a11-wild/shared";

export const IDEAS_PER_BATCH = 3;
export const ELEMENTS_MAX = 5;

export type IdeaInput = Omit<Idea, "id">;

/**
 * The countable facts of an idea burst. Each answer is true or false: how many ideas, how many
 * elements, whether a reference and both tests are there. Taste is not checked here; it stays with
 * the agent, the critic and the owner.
 */
export function ideaFaults(ideas: IdeaInput[]): string[] {
  const faults: string[] = [];
  if (ideas.length !== IDEAS_PER_BATCH) faults.push(`A batch holds ${IDEAS_PER_BATCH} ideas. This call has ${ideas.length}.`);
  for (const [index, idea] of ideas.entries()) {
    const name = `Idea ${index + 1} ("${idea.title}")`;
    if (idea.elements.length > ELEMENTS_MAX) faults.push(`${name} has ${idea.elements.length} elements. The most is ${ELEMENTS_MAX}: cut until one thing is left to look at.`);
    if (idea.elements.length === 0) faults.push(`${name} names no element.`);
    if (idea.references.length === 0) faults.push(`${name} has no reference from outside the product's category. Give at least one, with one line on what it does.`);
    if (!idea.killTest.passed) faults.push(`${name} fails its kill test (${idea.killTest.note}). It is cut: write another idea in its place.`);
  }
  return faults;
}
