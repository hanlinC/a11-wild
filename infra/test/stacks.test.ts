import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { GithubDeployStack } from "../lib/github-deploy-stack.js";
import { StudioStack } from "../lib/studio-stack.js";

/** Synthesises without bundling the functions' code, which these tests do not read. */
function newApp(): App {
  return new App({ context: { "aws:cdk:bundling-stacks": [] } });
}

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const asList = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

describe("studio stack", () => {
  let template: Template;
  beforeAll(() => {
    template = Template.fromStack(new StudioStack(newApp(), "Studio", { buildId: "test" }));
  });

  it("blocks public access on every bucket", () => {
    const buckets = Object.values(template.findResources("AWS::S3::Bucket"));
    expect(buckets.length).toBeGreaterThanOrEqual(2);
    for (const bucket of buckets) {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
  });

  it("denies plain HTTP on every bucket", () => {
    const buckets = Object.keys(template.findResources("AWS::S3::Bucket"));
    const policies = Object.values(template.findResources("AWS::S3::BucketPolicy"));
    for (const bucket of buckets) {
      const policy = policies.find((entry) => entry.Properties.Bucket.Ref === bucket);
      const denies = policy?.Properties.PolicyDocument.Statement.filter(
        (statement: { Effect: string; Condition?: unknown }) =>
          statement.Effect === "Deny" && JSON.stringify(statement.Condition).includes('"aws:SecureTransport":"false"'),
      );
      expect(denies?.length, `bucket ${bucket}`).toBe(1);
    }
  });

  it("protects the table: recovery, deletion protection, expiry attribute, kept on stack delete", () => {
    template.hasResource("AWS::DynamoDB::GlobalTable", {
      DeletionPolicy: "Retain",
      Properties: {
        BillingMode: "PAY_PER_REQUEST",
        TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
        Replicas: [
          Match.objectLike({
            DeletionProtectionEnabled: true,
            PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
          }),
        ],
      },
    });
  });

  it("gives the functions no write action on every resource", () => {
    const policies = Object.values(template.findResources("AWS::IAM::Policy"));
    const functionPolicies = policies.filter((policy) => /Api|ManageRegisteredClients/.test(JSON.stringify(policy.Properties.Roles)));
    expect(functionPolicies.length).toBeGreaterThanOrEqual(3);
    for (const policy of functionPolicies) {
      for (const statement of policy.Properties.PolicyDocument.Statement as Statement[]) {
        expect(asList(statement.Resource), JSON.stringify(statement.Action)).not.toContain("*");
        expect(asList(statement.Action).some((action) => action.endsWith(":*"))).toBe(false);
      }
    }
  });

  it("lets only the API function read the provider keys and use the picture bucket", () => {
    const policies = Object.entries(template.findResources("AWS::IAM::Policy"));
    const holds = (...texts: string[]) =>
      policies.filter(([, policy]) => texts.every((text) => JSON.stringify(policy).includes(text))).map(([id]) => id);
    const keyReaders = holds("parameter/a11-wild/keys/*");
    expect(keyReaders).toHaveLength(1);
    expect(keyReaders[0]).toMatch(/ApiFunction/);
    expect(holds("DataPictures")).toEqual(keyReaders);

    const functions = Object.entries(template.findResources("AWS::Lambda::Function"));
    const withKeys = functions.filter(([, fn]) => fn.Properties.Environment?.Variables?.KEYS_PREFIX !== undefined);
    expect(withKeys.map(([id]) => id)).toEqual([expect.stringMatching(/ApiFunction/)]);
    // The key's place is named, never the key.
    expect(withKeys[0]?.[1].Properties.Environment.Variables.KEYS_PREFIX).toBe("/a11-wild/keys");
  });

  it("lets only the API function publish a notice to the owner, to an address that is in no file", () => {
    template.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "email", Endpoint: { Ref: Match.stringLikeRegexp("SsmParameterValuea11wildalertemail") } });
    const publishers = Object.entries(template.findResources("AWS::IAM::Policy")).filter(([, policy]) => JSON.stringify(policy).includes("sns:Publish"));
    expect(publishers.map(([id]) => id)).toEqual([expect.stringMatching(/ApiFunction/)]);
    const statement = (publishers[0]![1].Properties.PolicyDocument.Statement as Statement[]).find((s) => asList(s.Action).includes("sns:Publish"))!;
    expect(JSON.stringify(statement.Resource)).toContain("AlertsOwnerNotices");
  });

  it("has no sign-up: only an administrator creates users, and errors hide whether a user exists", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      UserPoolTier: "ESSENTIALS",
      DeletionProtection: "ACTIVE",
      Policies: { PasswordPolicy: Match.objectLike({ MinimumLength: 12 }) },
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      PreventUserExistenceErrors: "ENABLED",
      GenerateSecret: false,
      AllowedOAuthFlows: ["code"],
    });
  });

  it("lets MCP clients register for the code grant and the studio scope only", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      DcrConfiguration: {
        EnableStatus: "Enabled",
        OpenDcrEnabled: true,
        OpenDcrGrantTypes: ["code"],
        AuthenticatedGrantTypes: [],
        AllowedScopes: [Match.anyValue()],
      },
    });
    const pool = Object.values(template.findResources("AWS::Cognito::UserPool"))[0]!;
    const scope = JSON.stringify(pool.Properties.DcrConfiguration.AllowedScopes);
    expect(scope).toContain("/mcp/studio");
    expect(scope).not.toContain("aws.cognito.signin.user.admin");
    template.hasResourceProperties("AWS::Cognito::UserPoolDomain", { ManagedLoginVersion: 2 });
  });

  it("sends only the API paths to the API, uncached and over HTTPS", () => {
    const distribution = Object.values(template.findResources("AWS::CloudFront::Distribution"))[0]!;
    const behaviors = distribution.Properties.DistributionConfig.CacheBehaviors as {
      PathPattern: string;
      ViewerProtocolPolicy: string;
    }[];
    expect(behaviors.map((behavior) => behavior.PathPattern).sort()).toEqual(
      ["/.well-known/*", "/api/*", "/auth/*", "/mcp"].sort(),
    );
    for (const behavior of behaviors) expect(behavior.ViewerProtocolPolicy).toBe("https-only");
    expect(distribution.Properties.DistributionConfig.CustomErrorResponses).toBeUndefined();
  });

  it("sets the security headers", () => {
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31536000 }),
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: "DENY", Override: true },
        }),
      },
    });
  });

  it("lets the dashboard load pictures from itself and the pictures bucket only", () => {
    const [policy] = Object.values(template.findResources("AWS::CloudFront::ResponseHeadersPolicy"));
    const csp = JSON.stringify(policy?.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy);
    expect(csp).toMatch(/default-src 'self'.*frame-ancestors 'none'/);
    // The bucket's own regional host name, made at deploy: no wildcard and no other host.
    expect(csp).toMatch(/img-src 'self' data: blob: https:\/\/",\{"Fn::GetAtt":\["DataPictures[A-Z0-9]+","RegionalDomainName"\]\},"; font-src/);
    expect(csp).not.toMatch(/\*/);
  });

  it("limits the request rate on the API stage and keeps logs for a month", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
    });
    for (const group of Object.values(template.findResources("AWS::Logs::LogGroup"))) {
      expect(group.Properties.RetentionInDays).toBe(30);
    }
  });

  it("alerts at US$10 a month, to an address that is in no file", () => {
    template.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 10, Unit: "USD" }, TimeUnit: "MONTHLY" }),
    });
    const budget = Object.values(template.findResources("AWS::Budgets::Budget"))[0]!;
    const address = budget.Properties.NotificationsWithSubscribers[0].Subscribers[0].Address;
    expect(address).toHaveProperty("Ref");
  });

  it("names no account and no Region", () => {
    expect(JSON.stringify(template.toJSON())).not.toMatch(/\b\d{12}\b/);
  });
});

describe("GitHub deploy stack", () => {
  let template: Template;
  beforeAll(() => {
    template = Template.fromStack(
      new GithubDeployStack(newApp(), "Deploy", { repository: { owner: "owner", ownerId: 11, name: "repo", id: 22 } }),
    );
  });

  it("trusts only the main branch of the one repository", () => {
    const role = Object.values(template.findResources("AWS::IAM::Role"))[0]!;
    const statements = role.Properties.AssumeRolePolicyDocument.Statement;
    expect(statements).toHaveLength(1);
    expect(statements[0].Action).toBe("sts:AssumeRoleWithWebIdentity");
    expect(statements[0].Condition).toEqual({
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        // The immutable form. GitHub no longer sends "repo:owner/repo:..." for a new repository.
        "token.actions.githubusercontent.com:sub": "repo:owner@11/repo@22:ref:refs/heads/main",
      },
    });
  });

  it("can only assume the CDK deploy roles", () => {
    const policies = Object.values(template.findResources("AWS::IAM::Policy"));
    expect(policies).toHaveLength(1);
    const statements = policies[0]!.Properties.PolicyDocument.Statement as Statement[];
    expect(statements).toHaveLength(1);
    expect(statements[0]!.Action).toBe("sts:AssumeRole");
    expect(JSON.stringify(statements[0]!.Resource)).toContain(":role/cdk-hnb659fds-*");
  });
});

describe("function code", () => {
  // The runtime's own AWS SDK is older than the one the tests run with. It dropped
  // the field that marks a self-registered client, so every agent was "unknown".
  it("ships its own AWS SDK and imports none from the runtime", () => {
    const outdir = mkdtempSync(path.join(tmpdir(), "a11-wild-bundle-"));
    try {
      new StudioStack(new App({ outdir }), "Studio", { buildId: "test" });
      const bundles = readdirSync(outdir)
        .filter((name) => name.startsWith("asset."))
        .map((name) => path.join(outdir, name, "index.mjs"))
        .filter((file) => existsSync(file));
      expect(bundles.length).toBeGreaterThanOrEqual(2);
      for (const file of bundles) {
        expect(readFileSync(file, "utf8")).not.toMatch(/from\s*"@aws-sdk\//);
      }
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  }, 60_000);
});
