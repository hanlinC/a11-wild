import type { PixelEvent, PixelRunner } from "../../src/pixels/runner.js";
import type { MemoryPictures } from "./pictures.js";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

type Answer = { ok: true; line?: string; passed?: boolean } | { ok: false; error: string } | "silent";

/**
 * A pixel function in memory. It writes its result into the picture store as the real one does.
 * With no answer given, a tool that makes a picture makes one, and a check passes.
 */
export function fakePixels(pictures: MemoryPictures, answer: (event: PixelEvent) => Answer = () => ({ ok: true })) {
  const events: PixelEvent[] = [];
  const runner: PixelRunner = {
    async start(event) {
      events.push(event);
      const given = answer(event);
      if (given === "silent") return;
      let result: Record<string, unknown> = { tool: event.tool, ...given };
      if (given.ok) {
        result = { line: `${event.tool} ran`, ...result };
        if (event.outKey) {
          await pictures.put(event.outKey, JPEG, "image/jpeg");
          result = { ...result, imageKey: event.outKey, type: "image/jpeg" };
        } else if (given.passed === undefined) {
          result = { ...result, passed: true };
        }
      }
      await pictures.put(event.resultKey, new TextEncoder().encode(JSON.stringify(result)), "application/json");
    },
  };
  return { runner, events };
}
