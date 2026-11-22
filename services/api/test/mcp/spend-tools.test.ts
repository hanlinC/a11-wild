import { beforeEach, describe, expect, it } from "vitest";
import { approvedClient, config, createStudio, json, type Studio } from "../helpers/deps.js";

let studio: Studio;
let ownerToken: string;
let memberToken: string;

beforeEach(async () => {
  studio = await createStudio();
  await approvedClient(studio);
  ownerToken = await studio.signer.accessToken(config);
  memberToken = await studio.signer.accessToken(config, { sub: "sub-member" });
});

async function callTool(name: string, args: unknown, token = ownerToken) {
  const response = await studio.app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const { result } = await json(response);
  return { isError: result.isError === true, text: result.content[0].text as string };
}

describe("spend tools", () => {
  it("shows the caps and a zero month before anything is spent", async () => {
    const reply = await callTool("spend_get", {});
    expect(JSON.parse(reply.text)).toEqual({ month: "2026-11", monthUsd: 0, monthCapUsd: 25, batchCapUsd: 5, campaign: { usd: 0, capUsd: 73.6, batchCapUsd: 1.5 }, lines: [] });
  });

  it("shows a batch's own total and lines", async () => {
    await studio.spend.ledger.reserve({ service: "fal", kind: "draft", ref: "idea-1", batchId: "b1", usd: 0.2 });
    await studio.spend.ledger.reserve({ service: "parallel", kind: "extract", ref: "page", usd: 0.001 });
    const summary = JSON.parse((await callTool("spend_get", { batchId: "b1" })).text);
    expect(summary).toMatchObject({ batchId: "b1", batchUsd: 0.2, monthUsd: 0.201 });
    expect(summary.lines).toHaveLength(1);
  });

  it("records the owner's yes and refuses a member's", async () => {
    await studio.spend.gate.price("b1", "drafts", { firstUsd: 0.2, count: 9 });

    const refused = await callTool("spend_approve", { batchId: "b1", stage: "drafts" }, memberToken);
    expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(/Only the owner/) });
    await expect(studio.spend.gate.check("b1", "drafts")).rejects.toThrow(/waits for the owner's yes/);

    const approved = await callTool("spend_approve", { batchId: "b1", stage: "drafts" });
    expect(approved.isError).toBe(false);
    await expect(studio.spend.gate.check("b1", "drafts")).resolves.toMatchObject({ approvedBy: "owner@example.com" });
  });

  it("answers a yes with nothing to approve as a plain tool error", async () => {
    const reply = await callTool("spend_approve", { batchId: "nope", stage: "finals" });
    expect(reply).toMatchObject({ isError: true, text: expect.stringMatching(/no estimate/) });
  });
});
