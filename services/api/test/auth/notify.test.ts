import { describe, expect, it } from "vitest";
import { waitingMessage } from "../../src/notify.js";
import { createStudio } from "../helpers/deps.js";

describe("the email when a program waits for approval", () => {
  it("is sent once, the first time the program is seen", async () => {
    const s = await createStudio();
    s.cognito.register("client-1");

    expect(await s.approvals.statusOf("client-1", "owner@example.com")).toBe("pending");
    expect(await s.approvals.statusOf("client-1", "owner@example.com")).toBe("pending");

    expect(s.notices).toHaveLength(1);
    expect(s.notices[0]).toMatchObject({ seenBy: "owner@example.com" });
  });

  it("is not sent for a program the user pool does not know", async () => {
    const s = await createStudio();
    expect(await s.approvals.statusOf("stranger", "owner@example.com")).toBe("unknown");
    expect(s.notices).toHaveLength(0);
  });

  it("does not stop the sign-in when the email fails", async () => {
    const s = await createStudio();
    s.cognito.register("client-1");
    s.notifier.fails = true;

    expect(await s.approvals.statusOf("client-1", "owner@example.com")).toBe("pending");
    expect((await s.approvals.list()).map((client) => client.clientId)).toEqual(["client-1"]);
  });

  it("names the program, where it sends the owner back to, and the Connections page", () => {
    const { subject, body } = waitingMessage(
      { name: "Devin", callbackUrls: ["https://agent.example/callback"], seenBy: "owner@example.com" },
      "https://studio.example",
    );
    expect(subject).toMatch(/waits for your approval/);
    expect(body).toContain('"Devin"');
    expect(body).toContain("https://agent.example/callback");
    expect(body).toContain("https://studio.example/connections");
  });
});
