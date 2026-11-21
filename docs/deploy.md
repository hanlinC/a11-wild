# Deploy

A merge to `main` deploys the studio to AWS through `.github/workflows/deploy.yml`. This file is the one-time setup and the manual path.

Nothing here names the account, the Region or a live address. They come from the credentials in use and from the stack's outputs.

## What gets deployed

| Stack | Holds |
|---|---|
| `A11WildStudio` | The table, the buckets, the functions, the HTTP API, CloudFront, the user pool, the cost alert |
| `A11WildGithubDeploy` | The role that GitHub Actions on `main` takes through OpenID Connect |

## One-time setup

Run these once, signed in to AWS with the owner's browser sign-in (`aws login`), in the Region the owner chose.

1. **CDK bootstrap.** `cd infra && npx cdk bootstrap`.
2. **Cost alert address.** The address that gets the US$10 alert is kept out of the repository:
   `aws ssm put-parameter --name /a11-wild/alert-email --type String --value <address>`
3. **First deploy.** `npm run build && cd infra && npx cdk deploy A11WildStudio A11WildGithubDeploy`.
4. **Invite the owner.** `npm run user:invite -- <address> owner`. The user pool emails a temporary password. The owner sets their own at first sign-in.
5. **Let GitHub deploy.** In the repository settings, under Secrets and variables, Actions, add:
   - Secret `AWS_DEPLOY_ROLE_ARN`: the `DeployRoleArn` output of `A11WildGithubDeploy`.
   - Variable `AWS_REGION`: the Region.

   The role grants nothing by itself: it trusts only the `main` branch of this repository, named by its owner id and repository id (`infra/bin/app.ts`). The role matches all four values: the owner's name and id, and the repository's name and id. A rename changes the name, a transfer changes the owner, and a repository made again gets a new id. After any of them, put the current four values in that file and deploy `A11WildGithubDeploy` again, or the job fails with "Not authorized to perform sts:AssumeRoleWithWebIdentity". It is a secret because it holds the account number, and the workflow log of a public repository is public. The workflow also masks the account number, the live address and the pool id in its log. Until the variable is set, the deploy job is skipped.

## Each deploy

The workflow runs `npm run check`, deploys `A11WildStudio`, then runs the live probes. A failed probe fails the run.

By hand, with the owner's browser sign-in:

```
npm run check
cd infra && npx cdk deploy A11WildStudio
npm run probe -- <public address>
```

The public address is the `PublicOrigin` output of the stack.

## People

| Do | How |
|---|---|
| Invite | `npm run user:invite -- <address> owner` or `member` |
| Stop a person | Set `disabled` to `true` on their `USER` row in the table, and disable them in the user pool |

Inviting or stopping a person needs the owner's yes.

## Provider keys

The Parallel and fal keys are SecureString parameters in Parameter Store. The owner gives each one through a secure form at the step that first needs it. They are never in the repository, a workflow or a log.

## Rollback

Deploy the previous commit of `main` again: revert the merge, or run the manual deploy from that commit. The table and the picture bucket are kept when a stack is deleted.
