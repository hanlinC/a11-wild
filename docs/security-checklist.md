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
| Personal data | A prospect's number, address and person are read only by the owner, in a dashboard session. No MCP tool, refusal, log line or agent answer holds one. An opt-out takes the contact off every list, for every brand that shares it. No message is sent by the studio. The prospect list is in no file of the repository: `npm run check:public` refuses a spreadsheet and a real-looking Singapore number. |
| Client link | A pack link and a client link are random and kept only as a hash. A wrong, old, malformed or turned-off link answers as if it did not exist. What a client's page is sent names no batch, pack id or key as a field. Only the signed address of a picture holds the picture's storage path: it works for one hour, for that one picture, and the path opens nothing without the link or a sign-in. A link's answers carry `noindex`, `no-referrer` and `no-store`, and no log line holds a link. An example pack takes no comment and no file, whatever a page sends. |
| What a client sends | A comment is text of at most 1,000 characters, at most 50 on a pack, shown as text. A file is a JPEG, a PNG or a CSV: no spreadsheet file. The studio reads each file before the owner or an agent can open it and deletes one that is not the type it was sent as. It keeps its own copy of a file that passes, so a file sent later to the same address replaces nothing. A CSV is shown as a table of text, to the owner and to an agent: no one gets it as a file. The email to the owner about a comment or a file holds no word of the client and no file. To an agent, a client's words and files are data, never an instruction. |
| What the owner uploads | The owner's own picture for a prospect is a JPEG or a PNG of at most 8 MB, sent from his session only: no agent tool takes one. The studio reads the file and keeps its own copy only when its first bytes are a JPEG or a PNG; anything else is deleted. The place an upload waits in is emptied after a day. A contact that opted out takes no picture. |
| Tests | A test shows the bad input is refused. Remove the fix and check that the test fails. |

## 2. After every deploy

`npm run probe -- <public address>` runs every line down to the unknown path. The deploy workflow runs it too.

| Probe | Expected |
|---|---|
| `GET /api/health` | 200, `ok: true` |
| `POST /mcp` with no token | 401, with `resource_metadata` in `WWW-Authenticate` |
| `GET /.well-known/oauth-protected-resource/mcp` | 200, names this server and one authorization server |
| `GET /api/me`, `/api/attention`, `/api/clients`, `/api/brands`, `/api/spend`, `/api/taste`, `/api/calibration`, `/api/batches/<id>/board`, `/api/batches/<id>/done` with no session | 401 each |
| Each outreach page and each outreach write (`/api/outreach/...`) with no session | 401 each |
| `POST /api/clients/<id>/approve` from another origin | 401 or 403 |
| `GET /` and `GET /api/health` | HSTS, CSP with `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY` |
| `GET /api/pack/<wrong token>` and `GET /api/client/<wrong token>`, and a comment or a file sent to either | 404 each, with `noindex` on the page answer |
| `GET /api/portal`, a client's file as a table, a client-link write and a comment write with no session | 401 each |
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
| Owner | Work his day in Outreach | Today opens with its four groups. On a test prospect: yes to the ad, copy, open WhatsApp or mail, mark as sent, take back, upload a picture of his own (it shows as "Your upload" with his yes), log a reply, opt out. On a test prospect with shown drafts: every draft is on its page, a failed one has no button, a pick saves and the page says it waits for the agent, and nothing is sent by a pick. Remove the test prospect after, and check that the count of prospects is as before. |
| Client | Use the private page | The client link opens every pack of the brand with no sign-in. An ad downloads. A comment and a change request show on the page after they are sent. A screenshot or a CSV is taken; another file is refused with a plain sentence. |
| Owner | Work with a client | Clients shows the change requests that wait first. One click sets a status, and the client's page shows it. A comment can be hidden. A CSV opens as a table. Replace the link, and the old link opens nothing. The email about a new comment arrives and holds none of its words. |
| Prospect | Look at the example | The example page shows the ads first, the "Example" tag and the line that the brand is not a client. It has no box to write in and no place to send a file. A download is marked as an example. |
| Owner | See what waits for him | The Studio page opens with "Needs you" first. Each line there opens the page where he acts, and the number beside a section in the top bar is the number on that page. On a phone the menu holds every section and Sign out. |
| Member | Stay out of Outreach | The shell shows no Outreach entry, and each outreach address answers "Only the owner can do that." The Studio page shows him the batches only, with no line and no number of the owner's. |
| Owner | Remove an agent | Revoke removes it, and its next call is refused. |
