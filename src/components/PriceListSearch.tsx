import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { buildGroupLookup, sellingPrice, type PriceGroup } from "@/lib/price-list";
import {
  getPriceGroupCategories,
  getPriceGroups,
  getPriceListCategories,
  getPriceLists,
  searchPriceList,
  PRICE_GROUP_CATEGORIES_KEY,
  PRICE_GROUPS_KEY,
  PRICE_LISTS_KEY,
  type PriceList,
  type PriceListItem,
} from "@/lib/price-list-api";

export interface PricedRow extends PriceListItem {
  list: PriceList | undefined;
  group: PriceGroup | null;
  /** SDP plus the group's markup, rounded up to ₱10. */
  price: number | null;
}

/** Lists, groups and sheet links, shared by every price list screen. */
export function usePriceListData() {
  const lists = useQuery({ queryKey: PRICE_LISTS_KEY, queryFn: getPriceLists });
  const groups = useQuery({ queryKey: PRICE_GROUPS_KEY, queryFn: getPriceGroups });
  const links = useQuery({ queryKey: PRICE_GROUP_CATEGORIES_KEY, queryFn: getPriceGroupCategories });
  return {
    lists: lists.data ?? [],
    groups: groups.data ?? [],
    links: links.data ?? [],
    isLoading: lists.isLoading,
  };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const ALL = "__all__";

/**
 * Search box, list and category pickers, and the results with their selling
 * price. `onPick` makes each result clickable (the quotation picker); without
 * it the results are a read-only table.
 */
export function PriceListSearch({
  onPick,
  autoFocus,
  compact,
}: {
  onPick?: (row: PricedRow) => void;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const { lists, groups, links, isLoading } = usePriceListData();
  const active = useMemo(() => lists.filter((l) => l.is_active), [lists]);
  const [listId, setListId] = useState<string>("");
  const [category, setCategory] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const q = useDebounced(query, 250);

  // Opens on the newest active list.
  useEffect(() => {
    if (!listId && active.length > 0) setListId(active[0].id);
  }, [active, listId]);
  useEffect(() => setCategory(ALL), [listId]);

  const list = lists.find((l) => l.id === listId);
  const { data: categories = [] } = useQuery({
    queryKey: ["price-list-categories", listId],
    queryFn: () => getPriceListCategories(listId),
    enabled: !!listId,
    staleTime: 5 * 60_000,
  });

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["price-list-search", listId, category, q],
    queryFn: () => searchPriceList({ priceListIds: [listId], query: q, category: category === ALL ? null : category, limit: 100 }),
    enabled: !!listId,
    placeholderData: (prev) => prev,
  });

  const lookup = useMemo(() => (list ? buildGroupLookup(list.brand, groups, links) : () => null), [list, groups, links]);
  const rows: PricedRow[] = useMemo(
    () => results.map((r) => {
      const group = lookup(r.category);
      return { ...r, list, group, price: sellingPrice(r.sdp, group) };
    }),
    [results, lookup, list],
  );

  if (!isLoading && active.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
        No price lists yet. An admin uploads one from the Price Lists page.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search model or description, e.g. 7608NI or 4MP bullet"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Select value={listId} onValueChange={setListId}>
          <SelectTrigger className="h-9 w-full text-sm sm:w-56"><SelectValue placeholder="Price list" /></SelectTrigger>
          <SelectContent>
            {active.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-full text-sm sm:w-56"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {isFetching ? "Searching…" : rows.length === 100 ? "First 100 matches. Type more to narrow it down." : `${rows.length} match${rows.length === 1 ? "" : "es"}`}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
          {isFetching ? "Searching…" : "No models match."}
        </div>
      ) : (
        <div className={cn("rounded-lg border bg-card", compact && "max-h-[55vh] overflow-y-auto")}>
          {/* Header only on wider screens; phones get stacked rows. */}
          <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_minmax(0,1fr)_96px_104px] gap-3 border-b px-3 py-2 text-[11px] font-medium text-muted-foreground md:grid">
            <span>Model</span><span>Description</span><span>Category</span>
            <span className="text-right">SDP</span><span className="text-right">Your price</span>
          </div>
          {rows.map((r) => {
            const Row = onPick ? "button" : "div";
            return (
              <Row
                key={r.id}
                type={onPick ? "button" : undefined}
                onClick={onPick ? () => onPick(r) : undefined}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b px-3 py-2 text-left text-sm last:border-b-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_minmax(0,1fr)_96px_104px] md:items-center",
                  onPick && "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                )}
              >
                <span className="truncate font-medium" title={r.model}>{r.model}</span>
                <span className="text-right font-semibold tabular-nums md:hidden">{r.price != null ? peso(r.price) : "—"}</span>
                <span className="col-span-2 line-clamp-2 text-xs text-muted-foreground md:col-span-1 md:truncate" title={r.description}>{r.description || "—"}</span>
                <span className="truncate text-xs text-muted-foreground md:text-sm" title={r.group ? `${r.category} · ${r.group.name}` : r.category}>
                  {r.category}
                  {r.group && <span className="hidden text-[11px] md:block">{r.group.name}</span>}
                </span>
                <span className="text-right text-xs tabular-nums text-muted-foreground md:text-sm">
                  <span className="md:hidden">SDP </span>{peso(r.sdp)}
                </span>
                <span className="hidden text-right font-semibold tabular-nums md:block">{r.price != null ? peso(r.price) : "—"}</span>
              </Row>
            );
          })}
        </div>
      )}
    </div>
  );
}
