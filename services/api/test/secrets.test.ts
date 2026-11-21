import { ParameterNotFound } from "@aws-sdk/client-ssm";
import { describe, expect, it } from "vitest";
import { MissingKeyError, ParameterKeys } from "../src/secrets.js";

function fakeSsm(parameters: Record<string, string>) {
  const calls: { Name?: string; WithDecryption?: boolean }[] = [];
  const send = async (command: { input: { Name?: string; WithDecryption?: boolean } }) => {
    calls.push(command.input);
    const value = parameters[command.input.Name ?? ""];
    if (value === undefined) throw new ParameterNotFound({ message: "missing", $metadata: {} });
    return { Parameter: { Value: value } };
  };
  return { ssm: { send } as never, calls };
}

describe("provider keys", () => {
  it("reads a key decrypted, once for each function instance", async () => {
    const { ssm, calls } = fakeSsm({ "/studio/keys/parallel": " key-value\n" });
    const keys = new ParameterKeys(ssm, "/studio/keys");
    expect(await keys.get("parallel")).toBe("key-value");
    expect(await keys.get("parallel")).toBe("key-value");
    expect(calls).toEqual([{ Name: "/studio/keys/parallel", WithDecryption: true }]);
  });

  it("says plainly that a key is not stored yet, and asks for none", async () => {
    const keys = new ParameterKeys(fakeSsm({}).ssm, "/studio/keys");
    await expect(keys.get("fal")).rejects.toThrow(MissingKeyError);
    await expect(keys.get("fal")).rejects.toThrow(/no fal key yet/);
  });
});
