# a11-wild

A private ad studio on AWS. An AI agent takes a brand and a product to three finished, truthful static 4:5 ads through one MCP server, and the studio learns the owner's taste from each pick.

- Agents: start with `AGENTS.md`, then `docs/plans/`.
- Run the checks: `npm ci && npm run check`.
- Deploy: `docs/deploy.md`.

## Tech stack

| Layer | Choice |
|---|---|
| Brain | Claude Code (the owner's subscription), or any MCP client the owner approves. The server never calls a language model. |
| MCP | Our own remote MCP server: hand-written, stateless, JSON over one `POST /mcp`. No MCP SDK. |
| Frontend | Vite, React, TypeScript, Tailwind v4, shadcn/ui, Fluid Functionalism (`@fluid`, Radix flavour), Plus Jakarta Sans |
| Backend | TypeScript on Node.js 22; pixel tools in Python (Pillow, NumPy, OpenCV) |
| Sign-in | Email and password, by invitation only. An MCP client signs in with OAuth and PKCE, then waits for the owner's approval. |
| Research | Parallel (search, extract, image search, tasks), called by the server |
| Images | fal.ai GPT Image 2.5 Sunburst, 4:5 only. Roughs and drafts `low` at 1024x1280, finals `high` at 1536x1920. |
| Infrastructure as code | AWS CDK in TypeScript (`infra/`) |
| Checks and deploy | GitHub Actions, ESLint, Vitest. A merge to `main` deploys. |

### AWS services

| Service | What it does here |
|---|---|
| CloudFront | The studio's address: serves the dashboard, passes API paths on, adds security headers |
| S3 | The studio's two private buckets: the dashboard files and the pictures (shown through short-lived signed links). CDK keeps a third for deploy files. |
| API Gateway (HTTP API) | The door to the API and the MCP server |
| Lambda | Runs the API and MCP server, the daily clean-up, and the pixel tools (a container) |
| DynamoDB | The database: one table, on-demand, with point-in-time recovery |
| Cognito | Sign-in for people and MCP clients on its own hosted page, with optional authenticator codes |
| Systems Manager Parameter Store | The secret store: the Parallel and fal keys as encrypted parameters |
| SNS | Emails the owner when something waits on him, such as a new MCP client |
| Budgets | Emails the owner when the month's AWS cost passes the alert amount |
| EventBridge | Starts the clean-up once a day |
| CloudWatch Logs | Keeps the functions' logs |
| ECR | Holds the container image of the pixel tools |
| IAM and STS | Least-privilege roles; GitHub deploys through a short-lived role (OIDC), with no stored AWS key |
| CloudFormation | Applies what CDK defines |

