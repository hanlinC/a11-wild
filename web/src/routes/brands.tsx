import { Link } from "react-router";
import { Loading } from "@/components/loading";
import { Card, Empty, PageHeader, Waiting } from "@/components/page";
import { api } from "@/lib/api";
import { useAttention } from "@/lib/attention";
import { useMe } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

export function Brands() {
  const { value: brands, error } = useLoad(api.brands);
  const isOwner = useMe().role === "owner";
  // The batches that move, by brand: how many ask the owner, and how many an agent is at. Tests and outreach batches are not counted.
  const moving = (useAttention().value?.batches ?? []).filter((line) => !line.batch.test && line.batch.purpose !== "outreach" && line.who !== "nobody");
  const of = (brandId: string) => {
    const own = moving.filter((line) => line.brand.id === brandId);
    const asked = isOwner ? own.filter((line) => line.who === "owner").length : 0;
    return { asked, inWork: own.length - asked };
  };

  return (
    <>
      <PageHeader title="Brands" lead="Each brand the studio knows. A brand with a batch that waits for you is marked." />
      {brands === undefined ? (
        <Loading error={error} />
      ) : brands.length === 0 ? (
        <Empty>No brand yet. Ask your agent to read a brand's home page; you choose the logo and colours it finds.</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {brands.map(({ brand, logoUrl, products }) => (
            <li key={brand.id}>
              <Link to={`/brands/${brand.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
                <Card className="flex items-center gap-4 transition-colors hover:bg-(--tint)">
                  <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-(--tint)">
                    {logoUrl ? <img src={logoUrl} alt="" className="max-h-10 max-w-10 object-contain" /> : null}
                  </div>
                  <div className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-subtitle font-medium">{brand.name}</span>
                      <Waiting count={of(brand.id).asked} className="shrink-0" />
                    </span>
                    <span className="block text-caption text-muted-foreground">
                      {products.length === 0 ? "No product yet" : products.map((product) => product.name).join(", ")}
                    </span>
                    <Moves {...of(brand.id)} />
                  </div>
                  <span className="ml-auto flex shrink-0 gap-1" aria-hidden="true">
                    {brand.palette.slice(0, 5).map((colour) => (
                      <span key={`${colour.role}${colour.hex}`} className="size-4 rounded-full border border-border" style={{ backgroundColor: colour.hex }} />
                    ))}
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** What moves for a brand, in a few words. Nothing is said for a brand at rest. */
function Moves({ asked, inWork }: { asked: number; inWork: number }) {
  const parts = [asked > 0 ? `${asked} ${asked === 1 ? "batch waits" : "batches wait"} for you` : "", inWork > 0 ? `${inWork} in work` : ""].filter(Boolean);
  if (parts.length === 0) return null;
  return <span className="mt-1 block text-caption text-foreground">{parts.join(" · ")}</span>;
}
