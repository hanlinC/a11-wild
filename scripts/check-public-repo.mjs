#!/usr/bin/env node
// Fails when a tracked file holds something a public repository must not hold.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EXAMPLE_EMAIL_DOMAINS = new Set(["example.com", "example.org", "example.net"]);

export const RULES = [
  { id: "aws-account-id", pattern: /arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:\d{12}:/g },
  { id: "aws-account-id", pattern: /account[^\n]{0,20}\b\d{12}\b/gi },
  { id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: "cognito-pool-id", pattern: /\b[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]{9}\b/g },
  { id: "live-address", pattern: /\b[a-z0-9-]+\.cloudfront\.net\b/g },
  { id: "live-address", pattern: /\b[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com\b/g },
  { id: "live-address", pattern: /\b[a-z0-9]{10}\.execute-api\.[a-z0-9-]+\.amazonaws\.com\b/g },
  {
    id: "email-address",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    allow: (match) => {
      const [local, domain] = match.split("@");
      return EXAMPLE_EMAIL_DOMAINS.has(domain.toLowerCase()) || (local === "git" && domain === "github.com");
    },
  },
];

/** Returns one finding per forbidden match in `text`. */
export function scan(text) {
  const findings = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      for (const match of line.matchAll(rule.pattern)) {
        if (rule.allow?.(match[0])) continue;
        findings.push({ rule: rule.id, line: index + 1 });
      }
    }
  });
  return findings;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
  });
  return out.split("\0").filter(Boolean);
}

function main() {
  let failed = false;
  for (const file of trackedFiles()) {
    if (file.endsWith("package-lock.json")) continue;
    let content;
    try {
      content = readFileSync(file);
    } catch {
      continue;
    }
    if (content.includes(0)) continue;
    for (const finding of scan(content.toString("utf8"))) {
      failed = true;
      // The match itself is not printed: CI logs of a public repository are public too.
      console.error(`${file}:${finding.line}: ${finding.rule}`);
    }
  }
  if (failed) {
    console.error("\nThis repository is public. Remove the values above before you push.");
    process.exit(1);
  }
  console.log("public-repo check: clean");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
