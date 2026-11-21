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
| 21-11-2026 | The owner gets an email when a new program waits for approval. | The studio publishes one notice per new program to a topic that emails the cost-alert address. The owner confirms the subscription once. |
| 22-11-2026 | A brand or a product is saved only from what the server itself read. | `brand_save` and `product_save` take an offer id from `brand_extract` or `product_extract`. An agent cannot save a kit it made up. |
| 22-11-2026 | A fact is kept only when its exact words are on the page it names. | The server reads the page again at save time. A number in a truth sheet with no such fact is marked `unverified`. |
| 22-11-2026 | The taste canon is plain text with versions. | Each save needs a reason and makes a new version. Old versions stay readable. Only the owner saves. |
| 22-11-2026 | The taste data of a11-adgen is copied once, through the two MCP servers. | Each record keeps its a11-adgen id, so a second copy changes nothing. Private picture links are not copied. The gold set is not copied (see the decision of 22-11-2026 below). |
| 22-11-2026 | Caps: US$25 a month, US$5 a batch. | A paid call holds its price first. A call that would pass a cap is refused. A call with an unknown result stays counted. |
| 22-11-2026 | Research waits for the owner at each US$1. | Research has no count to estimate from, so the gate reads the batch's total: under US$1 it goes on, and each further US$1 needs a new yes (`spend_approve`, stage `research`). Research that belongs to no batch is held the same way, on its total for the month. |
| 22-11-2026 | A product has one truth sheet, with versions. | The sheet describes the real product, so its batches share it. A save that changes it makes a new version and the earlier ones stay. A batch keeps the version it saved, so its ideas and finals trace to that exact sheet. |
| 22-11-2026 | A render waits for the owner at US$1 per stage. | The first draft of a batch is sent alone and its real price sets the estimate for the rest. Drafts and finals are two stages, each with its own yes (`spend_approve`). A render with an unknown result stays counted. |
| 22-11-2026 | No words are asked of the model. | `render_submit` adds the studio's own no-words and realism lines to each prompt and refuses a prompt that asks for a headline, a caption, a button, a price or a sign. |
| 22-11-2026 | The pixel tools run in their own function, with the scripts of a11-adgen unchanged. | `product_lock.py`, `pack_check.py`, `cap_check.py` and `photo_finish.py` are copied as they are, with their tests. Its role allows it to read and write pictures only: no table and no key. Only the API may start it, and the API looks up every picture; an agent names a picture by its id. |
| 22-11-2026 | A measure belongs to the tool that made it. | A failed `pack_check` or `cap_check` is saved on the picture as D11. `checks_save` cannot clear it; only a later pass of the same tool on the same picture does. |
| 22-11-2026 | A repair stands for its picture, and is checked as a new one. | A `product_reprint` or `product_swap` replaces the draft or the final on the board and as the source of the final. The old picture's checks are not carried over. |
| 22-11-2026 | One D item, or two F items, rejects a picture. | A draft with a D item cannot become a final. A batch is finished when each picked idea has a final that is checked, has no D item and has its real-camera finish. |
| 22-11-2026 | The board shows drafts in the order they were sent, with no rank. | Only the owner picks or passes, in their own words. Each pick and each pass goes into the taste log. A new pick replaces the old one and the log keeps both. |
| 22-11-2026 | A fresh critic judges blind, with a ticket that works once. | `critic_open` gives a helper that got the batch id only a packet with no owner pick, no earlier rank and none of the author's notes. `critic_pick` keeps or cuts each idea before any draft is made; `critic_rank` orders each idea's drafts before the board is ready. A caller that says it is not a fresh helper is refused. |
| 22-11-2026 | The critic's rank is hidden until the owner has picked. | The board and `board_show` give an idea's rank only after his pick or pass, and no rank is taken for an idea he has chosen for. |
| 22-11-2026 | No gold set. The critic is measured against the owner's real picks. | The owner called his 264 old marks mixed, so they are not copied and no gold test runs. The Calibration page and `calibration_report` count how often he picked the draft that the blind critic had put first. |
| 22-11-2026 | A batch is done when the owner picked a draft for each idea and each pick became a clean final. | `batch_done` gives each condition with its evidence and marks the batch done when both hold. A pass on an idea leaves the batch finished, not done. It lists the stranger test, which only the owner runs. |
| 22-11-2026 | The studio will make three kinds of ad. | v1 is the wild picture with the logo only. v2 and v3 are engine 2 and engine 3 of a11-adgen, with every step and stop, the Meta text, the client pack link and results upload. The agent asks which kind at the start of a batch. v1 is finished first, then v2, then v3. |
| 22-11-2026 | Calibration counts the owner's first choice only, beside a rank of the same picture. | After his first pick he sees the critic's order, so a changed pick is not blind: the pick keeps his first choice. A rank records the picture the critic looked at; a draft repaired later needs a new rank. A done batch whose final fails later goes back to its finals. |
