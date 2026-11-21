import { describe, expect, it } from "vitest";
import { estimateUsd, FalClient } from "../../src/fal/client.js";
import { MissingKeyError } from "../../src/secrets.js";
import { fakeFal, JPEG } from "../helpers/fal.js";
import { testKeys } from "../helpers/parallel.js";

const JOB = { requestId: "req-1", statusUrl: "https://queue.fal.run/requests/req-1/status", responseUrl: "https://queue.fal.run/requests/req-1" };

describe("fal client", () => {
  it("sends a final at high quality and 1536 by 1920, and uses the words alone when there is no reference", async () => {
    const fal = fakeFal();
    const job = await new FalClient(testKeys, fal.fetchFn).submit({ kind: "final", prompt: "A pack on a rock.", referenceUrls: [] });
    expect(job).toEqual(JOB);
    expect(fal.calls[0]?.url).toBe("https://queue.fal.run/openai/gpt-image-2.5/sunburst/text-to-image");
    expect(fal.calls[0]?.body).toMatchObject({ image_size: { width: 1536, height: 1920 }, quality: "high" });
    expect(fal.calls[0]?.body).not.toHaveProperty("image_urls");
  });

  it("prices a draft and a final from the list, with each reference", () => {
    expect(estimateUsd("draft", 0)).toBe(0.009);
    expect(estimateUsd("draft", 2)).toBe(0.029);
    expect(estimateUsd("final", 1)).toBe(0.073);
  });

  it("sends nothing when the key is not stored", async () => {
    const fal = fakeFal();
    const keys = { get: async () => Promise.reject(new MissingKeyError("fal")) };
    await expect(new FalClient(keys, fal.fetchFn).submit({ kind: "draft", prompt: "A pack.", referenceUrls: [] })).rejects.toThrow(MissingKeyError);
    expect(fal.calls).toEqual([]);
  });

  it("copies the picture when the job is done", async () => {
    const fal = fakeFal();
    expect(await new FalClient(testKeys, fal.fetchFn).poll(JOB)).toEqual({ state: "done", body: JPEG, type: "image/jpeg", ext: "jpg" });
  });

  it("does not follow a redirect that leaves fal, so the key goes nowhere else", async () => {
    const fal = fakeFal((call) => (call.url.endsWith("/status") ? { status: 302, location: "https://evil.example/status" } : undefined));
    expect(await new FalClient(testKeys, fal.fetchFn).poll(JOB)).toEqual({ state: "failed", error: expect.stringMatching(/not at an https fal address/) });
    expect(fal.calls.map((call) => call.url)).toEqual([JOB.statusUrl]);
  });

  it("refuses what is not a picture", async () => {
    const fal = fakeFal((call) => (call.url.includes("fal.media") ? { bytes: new TextEncoder().encode("<html>") } : undefined));
    expect(await new FalClient(testKeys, fal.fetchFn).poll(JOB)).toEqual({ state: "failed", error: expect.stringMatching(/not a PNG, JPEG or WebP/) });
  });
});
