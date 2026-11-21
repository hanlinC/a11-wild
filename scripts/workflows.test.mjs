import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.join(import.meta.dirname, "../.github/workflows");
const files = readdirSync(DIR).filter((name) => name.endsWith(".yml"));

describe("GitHub workflows", () => {
  it("pin every action to a full commit SHA with the release tag as a comment", () => {
    const uses = files.flatMap((name) =>
      readFileSync(path.join(DIR, name), "utf8")
        .split("\n")
        .filter((line) => /^\s*-?\s*uses:/.test(line))
        .map((line) => ({ name, line: line.trim() })),
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const { name, line } of uses) {
      expect(line, name).toMatch(/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    }
  });

  it("give a job only read access unless it deploys", () => {
    for (const name of files) {
      const text = readFileSync(path.join(DIR, name), "utf8");
      expect(text, name).toMatch(/^permissions:\n {2}contents: read\n/m);
      expect(text, name).not.toMatch(/: write-all|contents: write|pull_request_target/);
    }
  });

  it("deploy only from main, with no stored AWS key", () => {
    const text = readFileSync(path.join(DIR, "deploy.yml"), "utf8");
    expect(text).toMatch(/on:\n {2}push:\n {4}branches: \[main\]\n/);
    expect(text).not.toMatch(/aws-access-key-id|aws-secret-access-key/);
    // The only secret is the role's name, kept secret for the account number in it.
    expect([...text.matchAll(/secrets\.(\w+)/g)].map((match) => match[1])).toEqual(["AWS_DEPLOY_ROLE_ARN"]);
  });

  it("keep the account number, the live address and the pool id out of the public deploy log", () => {
    const text = readFileSync(path.join(DIR, "deploy.yml"), "utf8");
    expect(text).toMatch(/mask-aws-account-id: true/);
    expect(text).not.toMatch(/vars\.AWS_DEPLOY_ROLE_ARN/);
    expect(text).toMatch(/cdk deploy[^\n]*2>&1 \\\n\s+\| sed -E/);
    expect(text).toMatch(/::add-mask::/);
  });
});
