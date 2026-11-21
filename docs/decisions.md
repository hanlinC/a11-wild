# Decisions

Each owner decision, newest last. Dates are day-month-year.

| Date | Decision | Effect |
|---|---|---|
| 21-11-2026 | The backend is AWS, in one Region. | Everything Cloudflare gave a11-adgen comes from AWS here. |
| 21-11-2026 | The agent connects to the a11-wild MCP only. | The server holds the Parallel and fal keys and makes every call itself. |
| 21-11-2026 | One pipeline, the wild one. No engine switch. | Static 4:5 is rendered. Any other format gets a text spec. |
| 21-11-2026 | Copy is off by default. The picture carries the logo only. | No words are painted in a picture. |
| 21-11-2026 | Sign-in is Cognito, by invitation only. | There is no sign-up form. The invited people are the allow-list. |
| 21-11-2026 | A new MCP client waits for the owner's approval. | Cognito lets any program register itself and shows no consent page, so the studio adds the consent step. A daily job deletes programs nobody approved within 24 hours. |
| 21-11-2026 | No AWS firewall (WAF) for now. | The API stage limits the request rate. A cost alert fires at US$10 a month. |
| 21-11-2026 | Spend gate: under US$1 continue, otherwise the owner says yes. | Applies to Parallel and fal, per batch. |
| 21-11-2026 | The shape, print, cap and real-camera checks of a11-adgen stay. | They run as server tools at fixed points of the pipeline. |
| 21-11-2026 | Fluid components stay as the registry ships them. | The dashboard turns off two strict type checks that the registry code does not pass. |
