import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

const GITHUB_ISSUER = "token.actions.githubusercontent.com";

export interface GithubDeployStackProps extends StackProps {
  /** The one repository that may deploy. GitHub's API gives the two public ids. */
  repository: { owner: string; ownerId: number; name: string; id: number };
}

/**
 * The subject GitHub puts in the token of a run on the main branch. Repositories
 * made after 15 July 2026 get the immutable form, which carries the owner id and
 * the repository id, so a new repository that takes over the name cannot deploy.
 */
export function mainBranchSubject(repository: GithubDeployStackProps["repository"]): string {
  const { owner, ownerId, name, id } = repository;
  return `repo:${owner}@${ownerId}/${name}@${id}:ref:refs/heads/main`;
}

/**
 * Lets a GitHub Actions run on the main branch of one repository take a
 * short-lived role. The role can do one thing: assume the CDK roles that deploy.
 */
export class GithubDeployStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubDeployStackProps) {
    super(scope, id, props);

    const provider = new iam.OidcProviderNative(this, "GithubOidc", {
      url: `https://${GITHUB_ISSUER}`,
      clientIds: ["sts.amazonaws.com"],
    });

    const role = new iam.Role(this, "DeployRole", {
      description: "GitHub Actions deploy of a11-wild from the main branch.",
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.oidcProviderArn, {
        StringEquals: {
          [`${GITHUB_ISSUER}:aud`]: "sts.amazonaws.com",
          [`${GITHUB_ISSUER}:sub`]: mainBranchSubject(props.repository),
        },
      }),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          this.formatArn({ service: "iam", region: "", resource: "role", resourceName: "cdk-hnb659fds-*" }),
        ],
      }),
    );

    new CfnOutput(this, "DeployRoleArn", { value: role.roleArn });
  }
}
