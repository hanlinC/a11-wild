# The one-time copy from a11-adgen

The studio starts with the owner's existing taste. An agent that is connected to both MCP servers reads it from a11-adgen and writes it to a11-wild. a11-adgen is only read.

## Who can run it

The owner, through an approved agent. `import_ingest` refuses a `member`.

## Steps

1. Read from a11-adgen with its free read tools:
   - `canon_get` with `includeRetired` true.
   - `taste_log` with `limit` 100.
   - `swipe_search` with no words.
   - `brand_list`, then `brand_get` for each `slug`.
2. Change each record to the shape in [mapping.md](mapping.md).
3. Send the records to a11-wild with `import_ingest`, 50 or fewer a call.
4. On the last call set `buildCanon` to true. The active canon lines become one canon version.
5. Compare the counts.

## How to check it

The reply of `import_ingest` holds `counts`: the records of each kind that a11-wild now holds. Each count must equal the number that a11-adgen returned. Read a11-adgen once more and see that its own counts did not change.

## What a second run does

Nothing. Each record is kept under its a11-adgen id. A record that is sent again is counted under `already`.

## What is refused

A record with a field that [mapping.md](mapping.md) does not name is refused, and the reply names it with the reason. The other records are kept. Correct the record and send it again.

## Pictures

a11-adgen gives its stored pictures as private links that stop working after a short time. The copy does not use them. A brand's logo is copied from the public address that the logo first came from (`logo.sourceUrl`). When that address no longer gives a picture, the kit is saved without a logo and the reply says so. Product photos are not copied: read the product's page again with `product_extract`. The pictures of swipe items are not copied; the title and the reason are.

## What is not copied here

The gold set. The owner dropped it on 22-11-2026: his old marks are mixed, so the critic is measured against his real picks instead (`docs/decisions.md`).
