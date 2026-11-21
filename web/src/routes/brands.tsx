import { Link } from "react-router";
import { Loading } from "@/components/loading";
import { Card, Empty, PageHeader } from "@/components/page";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";

export function Brands() {
  const { value: brands, error } = useLoad(api.brands);

  return (
    <>
      <PageHeader title="Brands" lead="Each brand the studio knows, with the kit you chose and its products. Your agent adds a brand when you give it the brand's address." />
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
                    <span className="block truncate text-subtitle font-medium">{brand.name}</span>
                    <span className="block text-caption text-muted-foreground">
                      {products.length === 0 ? "No product yet" : products.map((product) => product.name).join(", ")}
                    </span>
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
