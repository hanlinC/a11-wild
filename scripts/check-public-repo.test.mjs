import { describe, expect, it } from "vitest";
import { FORBIDDEN_FILE, scan } from "./check-public-repo.mjs";

// Fixtures are joined at run time so that this file itself stays clean.
const accountId = "1234" + "5678" + "9012";
const rules = (text) => scan(text).map((finding) => finding.rule);

describe("public-repo check", () => {
  it("flags an account number inside an ARN and names the line", () => {
    const text = `first line\nrole: arn:aws:iam::${accountId}:role/deploy\n`;
    expect(scan(text)).toEqual([{ rule: "aws-account-id", line: 2 }]);
  });

  it("flags an account number written beside the word account", () => {
    expect(rules(`AWS account ${accountId}`)).toEqual(["aws-account-id"]);
  });

  it("flags an access key id", () => {
    expect(rules("key = " + "AKIA" + "ABCDEFGHIJKLMNOP")).toEqual(["aws-access-key"]);
  });

  it("flags a private key block", () => {
    expect(rules("-----BEGIN RSA " + "PRIVATE KEY-----")).toEqual(["private-key"]);
  });

  it("flags a Cognito pool id", () => {
    expect(rules("pool: ap-southeast-2" + "_AbCdEf123")).toEqual(["cognito-pool-id"]);
  });

  it("flags a full CloudFront host name but not the bare domain", () => {
    expect(rules("open https://d111abcdef8" + ".cloudfront.net/")).toEqual(["live-address"]);
    expect(rules("the address ends in cloudfront.net")).toEqual([]);
  });

  it("flags a managed login host and an API Gateway host", () => {
    expect(rules("a11wild-1a2b3c" + ".auth.ap-southeast-2.amazoncognito.com")).toEqual(["live-address"]);
    expect(rules("abcde12345" + ".execute-api.ap-southeast-2.amazonaws.com")).toEqual(["live-address"]);
  });

  it("flags a real email address and allows example addresses", () => {
    expect(rules("mail owner" + "@studio-mail.io now")).toEqual(["email-address"]);
    expect(rules("mail owner@example.com now")).toEqual([]);
  });

  it("does not flag package specifiers, action refs or dates", () => {
    const text = [
      "npx shadcn@latest add @fluid/button",
      "uses: actions/checkout@v4",
      '"@aws-sdk/client-ssm": "3.1175.0"',
      "docs/plans/2026-11-21-2216-feat-wild-ad-studio-plan.md",
      "git@github.com:owner/repo.git",
    ].join("\n");
    expect(scan(text)).toEqual([]);
  });

  it("passes a clean text", () => {
    expect(scan("# a11-wild\n\nA private ad studio on AWS.\n")).toEqual([]);
  });

  it("flags a Singapore number with its country code, written three ways", () => {
    const number = "9" + "387" + " " + "2" + "615";
    expect(rules(`call +65 ${number}`)).toEqual(["phone-number"]);
    expect(rules(`call +65${number.replace(" ", "")}`)).toEqual(["phone-number"]);
    expect(rules(`https://wa.me/65${number.replace(" ", "")}?text=hi`)).toEqual(["phone-number"]);
  });

  it("lets a made-up number and a longer run of digits pass", () => {
    expect(rules("+65 8000 0001, +65 8999 0000, +65 6123 4567, 6581234567, wa.me/6580000004")).toEqual([]);
    expect(rules("id 16593872615 and 659387261544")).toEqual([]);
  });

  it("refuses a spreadsheet by its name, and no other file", () => {
    expect(["list.xlsx", "docs/Prospects.XLSX", "a/b.csv", "old.xls", "x.numbers"].every((file) => FORBIDDEN_FILE.test(file))).toBe(true);
    expect(["README.md", "src/xlsx.ts", "csv-parser.test.ts"].some((file) => FORBIDDEN_FILE.test(file))).toBe(false);
  });

  it("lets an address under a reserved test name pass, and no look-alike", () => {
    expect(rules("hello@brand.example, a@b.test, x@y.invalid")).toEqual([]);
    expect(rules("hello@example" + ".co, a@brand.example" + ".sg")).toEqual(["email-address", "email-address"]);
  });
});
