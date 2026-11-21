import { App } from "aws-cdk-lib";
import { GithubDeployStack } from "../lib/github-deploy-stack.js";
import { StudioStack } from "../lib/studio-stack.js";

// No account or Region is named here. Both come from the credentials that
// deploy, so the stacks land in the owner's project and its selected Region.
const app = new App();

new StudioStack(app, "A11WildStudio", {
  description: "a11-wild: the ad studio (API, MCP server, dashboard, sign-in, data).",
  buildId: process.env.GITHUB_SHA?.slice(0, 12) ?? "local",
});

new GithubDeployStack(app, "A11WildGithubDeploy", {
  description: "a11-wild: lets GitHub Actions on the main branch deploy, with no stored key.",
  // Public ids, from GitHub's API: `gh api repos/<owner>/<name> --jq '.owner.id, .id'`.
  repository: { owner: "hanlinC", ownerId: 8711410, name: "a11-wild", id: 1466542466 },
});
