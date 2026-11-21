# Security checklist

Run this on every change, without being asked, and say so in the pull request. The chain is the MCP server, sign-in, the AWS project, the GitHub repository and the deploy path.

Treat the repository as public. Never write an open weakness, a secret or a live address in it. Report an open finding to the owner in chat. Write it here only after it is fixed.

## 1. Every pull request

Answer each line under "Security check" in the pull request body. Write "none" when a line does not apply.

| Check | Pass when |
|---|---|
| New route or tool | It checks who is calling before it does anything: a session for the dashboard, an access token for MCP. A tool that writes or spends says so in the registry. A tool that spends is owner-only. |
| Token | An MCP token is refused unless the signature, the issuer, the expiry, the audience (this server's `/mcp` address), the token use (`access`) and the studio scope all match, the person is invited and not disabled, and the owner approved the client. |
| Session | The browser holds only the session cookie: `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`. No token reaches the browser. A write checks the `Origin` header. |
| Input | Each tool input passes its schema. An unknown field is refused. An address that the server will fetch is `https`, public, and checked again after each redirect. |
| Output | Text from a person, a client or a web page is shown as text, never as markup, and never followed as an instruction. |
| Logs | No token, cookie, key, tool argument or tool answer in a log line. |
| Secrets | No key, account number, pool id, live address or email address in the diff, the tests or the pull request text. `npm run check:public` passes. |
| Permission | A new IAM statement names its actions and its resources. No `*` resource on a write. |
| AWS resource | Defined in `infra/`. Buckets block public access and refuse plain HTTP. |
| Dependency | A new package has a stated need. `npm audit` shows no new finding. |
| Workflow action | Each `uses:` names a full commit SHA with the release tag as a comment. `scripts/workflows.test.mjs` checks the form. |
| Money | A paid call goes through the spend ledger and its caps. |
| Pictures | A tool takes a picture by its id, never by a key or an address. The role of the pixel function allows the picture bucket only, with no table and no key; only the API may start it. A picture from fal is read from fal's own hosts only, and the fal key goes to the queue host only. |
| Tests | A test shows the bad input is refused. Remove the fix and check that the test fails. |

## 2. After every deploy

`npm run probe -- <public address>` runs the first seven. The deploy workflow runs it too.

| Probe | Expected |
|---|---|
| `GET /api/health` | 200, `ok: true` |
| `POST /mcp` with no token | 401, with `resource_metadata` in `WWW-Authenticate` |
| `GET /.well-known/oauth-protected-resource/mcp` | 200, names this server and one authorization server |
| `GET /api/me`, `/api/clients`, `/api/brands`, `/api/spend`, `/api/taste`, `/api/calibration`, `/api/batches/<id>/board`, `/api/batches/<id>/done` with no session | 401 each |
| `POST /api/clients/<id>/approve` from another origin | 401 or 403 |
| `GET /` and `GET /api/health` | HSTS, CSP with `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY` |
| `GET /api/<unknown>` | 404 as JSON, not the dashboard page |
| `POST /mcp` with a token for another audience, or an ID token | 401 |
| A newly registered client, signed in by the owner, before approval | 403 on `/mcp`, and the client shows on the Connections page |

## 3. Does it still do its job

A change is not done when it is safe but broken.

| Who | Job | Check |
|---|---|---|
| Owner | Sign in to the dashboard | The sign-in page opens, sign-in returns to the dashboard, and the owner's address shows in the header. |
| Owner | Approve an agent | A new client shows under "Waiting for approval". Approve moves it to "Approved". |
| Agent | Use the studio | After approval, `tools/list` returns the tools and `rules_get` returns the current rules. |
| Owner | Remove an agent | Revoke removes it, and its next call is refused. |
