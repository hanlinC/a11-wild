# Mapping: a11-adgen to a11-wild

Each record that goes to `import_ingest` has `kind`, `originId` and the fields of its kind. No other field is accepted.

## `canon_line`, from `canon_get` `rules[]`

| a11-wild | a11-adgen | Note |
|---|---|---|
| `originId` | `id` | |
| `text` | `rule` | |
| `stage` | `stage` | `all`, `tof`, `mof` or `bof` |
| `status` | `status` | `active` or `retired` |
| `evidence[]` | `evidence[]` | `at`, `source`, `quote` |

Left out: `scope`, `evidenceCount`, `hits`, `misses`, `hitRate`, `daysSinceEvidence`, `retireDue`. They are counters of a11-adgen's own rule engine.

## `taste`, from `taste_log`

One record for each row of `picks[]`, `verdicts[]` and `copyCorrections[]`.

| Source | `originId` | `entry` | `ownerSaid` | `about` |
|---|---|---|---|---|
| `picks[]` | `pick:` + `batch` + `:` + `stage` + `:` + `at` + `:` + mark | `pick` | `ownerSaid` | The headline, the visual, and the critic's reason for the chosen draft |
| `verdicts[]` with `mark` `pass` | `verdict:` + `key` + `:` + `at` + `:` + mark | `pass` | `ownerSaid` | The idea's headline, and `notes` |
| `verdicts[]` with another mark | `verdict:` + `key` + `:` + `at` + `:` + mark | `note` | `ownerSaid` | The mark, `stage`, the idea's headline, and `notes` |
| `copyCorrections[]` | `copy:` + `batch` + `:` + `stage` + `:` + `at` + `:` + mark | `note` | `ownerSaid` | The words as written, then the words he approved |

`at` is the row's `at`. The mark is the first 8 hex characters of the SHA-256 of `ownerSaid` followed by `about`. It keeps two rows apart when they share a batch, a stage and a time, or when a verdict has no `key`; without it the second row would be taken for a copy of the first. The same row always gives the same mark, so a second run still saves nothing twice. A row with no `ownerSaid` is not copied: the taste log holds the owner's words only.

## `swipe`, from `swipe_search` `examples[]`

| a11-wild | a11-adgen | Note |
|---|---|---|
| `originId` | `id` | |
| `title` | `title` | |
| `why` | `why` | |
| `source` | `source` | |
| `sourceUrl` | `source_url` | Leave it out when it is empty |
| `tags[]` | `stage`, `brand_slug` | Leave out an empty one |
| `addedAt` | `created_at` | |

Left out: `image_key`. See "Pictures" in the README.

## `brand`, from `brand_get`

| a11-wild | a11-adgen | Note |
|---|---|---|
| `originId` | `brand.slug` | |
| `name` | `brand.name` | |
| `url` | `brand.siteUrl` | |
| `logoSourceUrl` | `kit.kit.logo.sourceUrl` | The public address, never `logo.url` |
| `palette[].hex` | `kit.kit.palette[].hex` | |
| `palette[].role` | chosen from `palette[].role` | One of `primary`, `secondary`, `accent`, `background`, `text` |
| `palette[].note` | `kit.kit.palette[].role` | The owner's own words for the colour |
| `fonts[]` | `kit.kit.fonts[]` | |
| `voice` | `kit.kit.voice` | |
| `neverSay[]` | `kit.kit.neverSay[]` | |
| `notes` | `kit.kit.notes`, then `kit.kit.food` | Both texts, the food text under the line "Food:" |

Left out: `refs[]` (product photos, read again with `product_extract`), `placement` (the logo's place is set when finals are composed), `kit.version`, `kit.note`.
