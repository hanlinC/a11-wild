import type { BrandPage, Measure } from "@a11-wild/shared";
import { useCallback } from "react";
import { Link, useParams } from "react-router";
import { Loading, OutLink } from "@/components/loading";
import { Card, Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { when } from "@/lib/when";

export function Brand() {
  const { brandId = "" } = useParams();
  const { value: page, error } = useLoad(useCallback(() => api.brand(brandId), [brandId]));

  if (page === undefined) return <Loading error={error} />;
  const { brand, logoUrl, products, batches } = page;

  return (
    <>
      <p className="mb-4 text-caption">
        <Link to="/brands" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Brands
        </Link>
      </p>
      <PageHeader title={brand.name} lead="The kit you chose, and what the studio can prove about each product. Copy and pictures may state only the facts here." />

      <Section title="Kit">
        <Card className="grid gap-5 sm:grid-cols-[auto_1fr]">
          <div className="flex size-24 items-center justify-center rounded-lg bg-(--tint)">
            {logoUrl ? <img src={logoUrl} alt={`${brand.name} logo`} className="max-h-16 max-w-16 object-contain" /> : <span className="text-caption text-muted-foreground">No logo</span>}
          </div>
          <dl className="grid content-start gap-x-4 gap-y-2 text-caption sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Home page</dt>
            <dd>
              <OutLink href={brand.url}>{brand.url}</OutLink>
            </dd>
            <dt className="text-muted-foreground">Colours</dt>
            <dd className="flex flex-wrap gap-x-4 gap-y-1">
              {brand.palette.length === 0
                ? "None chosen"
                : brand.palette.map((colour) => (
                    <span key={`${colour.role}${colour.hex}`} className="flex items-center gap-1.5">
                      <span className="size-3.5 rounded-full border border-border" style={{ backgroundColor: colour.hex }} aria-hidden="true" />
                      <span className="font-mono">{colour.hex}</span>
                      <span className="text-muted-foreground">{colour.note ?? colour.role}</span>
                    </span>
                  ))}
            </dd>
            <dt className="text-muted-foreground">Fonts</dt>
            <dd>
              {brand.fonts.length === 0 ? "None chosen" : brand.fonts.join(", ")}
              {brand.fontFiles && brand.fontFiles.length > 0 ? (
                <span className="block text-muted-foreground">Files held: {brand.fontFiles.map((file) => `${file.family} ${file.weight}`).join(", ")}</span>
              ) : null}
            </dd>
            {brand.voice ? (
              <>
                <dt className="text-muted-foreground">Voice</dt>
                <dd className="whitespace-pre-line">{brand.voice}</dd>
              </>
            ) : null}
            {brand.neverSay?.length ? (
              <>
                <dt className="text-muted-foreground">Never says</dt>
                <dd>
                  <ul className="list-disc pl-4">
                    {brand.neverSay.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </dd>
              </>
            ) : null}
            {brand.notes ? (
              <>
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="whitespace-pre-line">{brand.notes}</dd>
              </>
            ) : null}
          </dl>
        </Card>
      </Section>

      {products.length === 0 ? (
        <Section title="Products">
          <Empty>No product yet. Ask your agent to read one of this brand's product pages.</Empty>
        </Section>
      ) : (
        products.map((entry) => <ProductSection key={entry.product.id} entry={entry} />)
      )}

      <Section title="Batches" count={batches.length}>
        {batches.length === 0 ? (
          <Empty>No batch yet for this brand.</Empty>
        ) : (
          <ul className="grid gap-3">
            {batches.map((batch) => (
              <li key={batch.id}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Link to={`/batches/${batch.id}`} className="text-body font-medium underline underline-offset-2">
                    {batch.label ?? "Batch"}
                  </Link>
                  <Badge variant="dot" color={batch.state === "done" ? "green" : "amber"}>
                    {batch.state.replace("_", " ")}
                  </Badge>
                  <span className="text-caption text-muted-foreground">Started {when(batch.createdAt)}</span>
                  {batch.truthVersion ? <span className="text-caption text-muted-foreground">Truth sheet version {batch.truthVersion}</span> : null}
                  <span className="ml-auto font-mono text-caption text-muted-foreground">{batch.id}</span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function ProductSection({ entry }: { entry: BrandPage["products"][number] }) {
  const { product, facts, truthSheet } = entry;
  return (
    <Section title={product.name}>
      <div className="grid gap-3">
        <Card>
          <p className="text-caption text-muted-foreground">
            Product page: <OutLink href={product.url}>{product.url}</OutLink>
          </p>
          {product.photos.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-3">
              {product.photos.map((photo) => (
                <li key={photo.key} className="w-28">
                  <img src={photo.viewUrl} alt={`${product.name}, ${photo.kind} photo`} className="aspect-square w-full rounded-lg bg-(--tint) object-contain" />
                  <span className="mt-1 block text-caption text-muted-foreground">{photo.what ?? (photo.kind === "pack" ? "As sold" : photo.kind === "food" ? "The food" : "A prop")}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card>
          <h3 className="text-body font-medium">
            Truth sheet
            {truthSheet ? <span className="ml-2 text-caption font-normal text-muted-foreground">Version {truthSheet.version}</span> : null}
          </h3>
          {truthSheet === null ? (
            <p className="mt-2 text-caption text-muted-foreground">Not written yet. It is saved when a batch starts for this product.</p>
          ) : (
            <>
              <dl className="mt-3 grid gap-x-4 gap-y-2 text-caption sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">Shape</dt>
                <dd>{truthSheet.shape}</dd>
                <dt className="text-muted-foreground">Packaging</dt>
                <dd>{truthSheet.packaging}</dd>
                {truthSheet.food ? (
                  <>
                    <dt className="text-muted-foreground">Food</dt>
                    <dd>{truthSheet.food.proportions}</dd>
                  </>
                ) : null}
              </dl>
              {truthSheet.measures.length > 0 ? (
                <ul className="mt-4 grid gap-2">
                  {truthSheet.measures.map((measure) => (
                    <MeasureRow key={measure.name} measure={measure} />
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </Card>

        <Card>
          <h3 className="text-body font-medium">
            Facts <span className="text-caption font-normal text-muted-foreground">{facts.length}</span>
          </h3>
          {facts.length === 0 ? (
            <p className="mt-2 text-caption text-muted-foreground">No fact yet. A fact is kept only when its exact words are on the page it names.</p>
          ) : (
            <ul className="mt-3 grid gap-4">
              {facts.map((fact) => (
                <li key={fact.id} className="text-caption">
                  <p className="text-body">{fact.claim}</p>
                  <blockquote className="mt-1 border-l-2 border-border pl-3 text-muted-foreground">“{fact.quote}”</blockquote>
                  <p className="mt-1 text-muted-foreground">
                    <OutLink href={fact.url}>{fact.url}</OutLink> · checked {when(fact.checkedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Section>
  );
}

function MeasureRow({ measure }: { measure: Measure }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-caption">
      <span className="text-muted-foreground">{measure.name}</span>
      <span className="font-mono text-body">
        {measure.value} {measure.unit}
      </span>
      {measure.source ? (
        <span className="text-muted-foreground">
          “{measure.source.quote}” · <OutLink href={measure.source.url}>source</OutLink>
        </span>
      ) : (
        <Badge color="amber">unverified</Badge>
      )}
    </li>
  );
}
