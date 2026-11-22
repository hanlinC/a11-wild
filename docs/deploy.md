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
4. **Confirm the notices.** After the first deploy, AWS emails the cost-alert address a "Subscription confirmation". The owner opens its link once. Until then the email about a program that waits for approval is not delivered.
5. **Invite the owner.** `npm run user:invite -- <address> owner`. The user pool emails a temporary password. The owner sets their own at first sign-in.
6. **Let GitHub deploy.** In the repository settings, under Secrets and variables, Actions, add:
   - Secret `AWS_DEPLOY_ROLE_ARN`: the `DeployRoleArn` output of `A11WildGithubDeploy`.
   - Variable `AWS_REGION`: the Region.

   The role grants nothing by itself: it trusts only the `main` branch of this repository, named by its owner id and repository id (`infra/bin/app.ts`). The role matches all four values: the owner's name and id, and the repository's name and id. A rename changes the name, a transfer changes the owner, and a repository made again gets a new id. After any of them, put the current four values in that file and deploy `A11WildGithubDeploy` again, or the job fails with "Not authorized to perform sts:AssumeRoleWithWebIdentity". It is a secret because it holds the account number, and the workflow log of a public repository is public. The workflow also masks the account number, the live address and the pool id in its log. Until the variable is set, the deploy job is skipped.

## Each deploy

The workflow runs `npm run check`, deploys `A11WildStudio`, then runs the live probes. A failed probe fails the run.

The pixel function is a container, so a deploy needs Docker on the machine that runs it. GitHub's runner has it. CDK builds the image from `services/pixels` and pushes it to the bootstrap repository of the account.

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

## The outreach list

The owner's list of prospects is private. It is never a file of this repository, and `npm run check:public` refuses a spreadsheet.

1. The owner gives the list to his agent in a private session. The agent reads it there and sends the rows with the tool `outreach_load`, at most 200 in one call, with the three messages in the first call. The tool answers with counts only.
2. A second load changes the list's own fields and keeps each brand's history, its ads and the owner's message text.
3. After the load, compare the Prospects page with the list: the count of brands, and the counts by sector and by tier.
4. To try the pages, make a test prospect on the Prospects page and remove it on its own page after. A brand of the list cannot be removed.

## Client links and the example

A client link and an example link are private. Neither is ever a file of this repository, a log line or a pull request text.

1. **A client's link.** The owner makes it on the Clients page, or his agent with the tool `client_link`. The link is shown once and the studio keeps only its hash. The owner sends it to the client himself. If it is lost or was sent to the wrong person, replace it: the old link opens nothing from that moment.
2. **A pack made outside the studio.** The agent sends each picture with `pack_carry_start` and saves the pack with `pack_carry`. A carried pack of a client shows on that client's page. A carried pack marked as an example shows on no client's page: it has its own link, takes no comment and no file, and marks each download as an example.
3. **The notices.** A comment, a change request and a file that passed the studio's reading each send one email to the owner, on the same topic as the notice of a program that waits (step 4 of the one-time setup). The email names the brand and the kind of event, and holds no word of the client and no file.
4. **After the deploy**, run the three client rows of section 3 of `docs/security-checklist.md` on a test brand, and turn its link off after.

## Provider keys

The Parallel and fal keys are SecureString parameters in Parameter Store, at `/a11-wild/keys/parallel` and `/a11-wild/keys/fal`. Only the API function may read them. Until a key is there, each tool that needs it refuses and says so. The owner gives each one through a secure form at the step that first needs it. They are never in the repository, a workflow or a log.

## Rollback

Deploy the previous commit of `main` again: revert the merge, or run the manual deploy from that commit. The table and the picture bucket are kept when a stack is deleted.
