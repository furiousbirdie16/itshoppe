import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Copy, Info, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { buildGroupLookup, priceLabel, sellingPrice, splitDescription, visiblePriceKeys, type PriceGroup } from "@/lib/price-list";
import { useAuth } from "@/contexts/AuthContext";
import {
  getPriceGroupCategories,
  getPriceGroups,
  getPriceListCategories,
  getPriceLists,
  isMultiPrice,
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
  /**
   * The price a quotation line gets: SDP plus the group's markup (rounded up
   * to ₱10) on an SDP list, or the chosen named price (SRP by default) on a
   * list like TP-Link's.
   */
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
 * Search box, list and category pickers, and the results with their prices.
 * An SDP list (Hikvision) shows SDP and your price; a list with named prices
 * (TP-Link) shows those, admins seeing all four and staff only Bottom and
 * SRP. `onPick` makes each result clickable (the quotation picker), and on a
 * named-price list adds a "Quote at" choice; without it the results are a
 * read-only table.
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
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { lists, groups, links, isLoading } = usePriceListData();
  const active = useMemo(() => lists.filter((l) => l.is_active), [lists]);
  const [listId, setListId] = useState<string>("");
  const [category, setCategory] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [quoteAt, setQuoteAt] = useState<string>("srp");
  // The one row whose details are open, if any.
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(query, 250);

  // Opens on the newest active list.
  useEffect(() => {
    if (!listId && active.length > 0) setListId(active[0].id);
  }, [active, listId]);
  useEffect(() => setCategory(ALL), [listId]);

  const list = lists.find((l) => l.id === listId);
  const multi = isMultiPrice(list);
  const priceKeys = useMemo(() => (multi ? visiblePriceKeys(list!.price_columns ?? [], isAdmin) : []), [multi, list, isAdmin]);
  // SRP unless this person can't see it or the list has none.
  useEffect(() => {
    if (priceKeys.length > 0 && !priceKeys.includes(quoteAt)) setQuoteAt(priceKeys.includes("srp") ? "srp" : priceKeys[priceKeys.length - 1]);
  }, [priceKeys, quoteAt]);

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
      if (multi) {
        const p = r.prices?.[quoteAt as keyof typeof r.prices];
        return { ...r, list, group: null, price: p ?? null };
      }
      const group = lookup(r.category);
      return { ...r, list, group, price: sellingPrice(r.sdp, group) };
    }),
    [results, lookup, list, multi, quoteAt],
  );

  if (!isLoading && active.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
        No price lists yet. An admin uploads one from the Price Lists page.
      </div>
    );
  }

  // Columns after Model, Description and Category.
  const priceCols: { key: string; label: string; value: (r: PricedRow) => number | null | undefined; strong?: boolean }[] = multi
    ? priceKeys.map((k) => ({ key: k, label: priceLabel(k), value: (r) => r.prices?.[k as keyof typeof r.prices], strong: !!onPick && k === quoteAt }))
    : [
        { key: "sdp", label: "SDP", value: (r) => r.sdp },
        { key: "price", label: "Your price", value: (r) => r.price, strong: true },
      ];
  const showWarranty = multi;
  // The model gets the most room: it's what you read out to the customer.
  const grid = `minmax(0,1.6fr) minmax(0,2fr) minmax(0,1fr)${priceCols.map(() => (multi ? " 84px" : " 92px")).join("")}${showWarranty ? " 68px" : ""} 28px`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search model or description, e.g. 7608NI or 8 port poe switch"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Select value={listId} onValueChange={setListId}>
          <SelectTrigger className="h-9 w-full text-sm sm:w-56"><SelectValue placeholder="Price list" /></SelectTrigger>
          <SelectContent>
            {active.map((l) => <SelectItem key={l.id} value={l.id}>{l.brand} · {l.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-full text-sm sm:w-56"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        {onPick && multi && priceKeys.length > 0 && (
          <Select value={quoteAt} onValueChange={setQuoteAt}>
            <SelectTrigger className="h-9 w-full text-sm sm:w-40" aria-label="Quote at"><SelectValue /></SelectTrigger>
            <SelectContent>
              {priceKeys.map((k) => <SelectItem key={k} value={k}>Quote at {priceLabel(k)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
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
          <div className="hidden gap-3 border-b px-3 py-2 text-[11px] font-medium text-muted-foreground md:grid" style={{ gridTemplateColumns: grid }}>
            <span>Model</span><span>Description</span><span>Category</span>
            {priceCols.map((c) => <span key={c.key} className="text-right">{c.label}</span>)}
            {showWarranty && <span className="text-right">Warranty</span>}
            <span />
          </div>
          {rows.map((r) => {
            const open = openId === r.id;
            const toggle = () => setOpenId(open ? null : r.id);
            // On the Price Lists page a click opens the details; in the
            // quotation picker a click adds the model and the ⓘ opens them.
            const activate = onPick ? () => onPick(r) : toggle;
            return (
              <div key={r.id} className={cn("border-b last:border-b-0", open && "bg-muted/30")}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={onPick ? undefined : open}
                  onClick={activate}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      activate();
                    }
                  }}
                  className="relative block w-full cursor-pointer px-3 py-2 pr-10 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none md:grid md:items-center md:gap-3 md:pr-3"
                  style={{ gridTemplateColumns: grid }}
                >
                  {/* Wraps rather than cuts off: a model number half-shown is no use. */}
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="font-medium [overflow-wrap:anywhere]">{r.model}</span>
                    <Tags r={r} />
                  </span>
                  <span className={cn("mt-0.5 block text-xs text-muted-foreground md:mt-0", open ? "hidden md:block md:truncate" : "line-clamp-2 md:truncate")}>{r.description || "—"}</span>
                  <span className="block truncate text-xs text-muted-foreground md:text-sm">
                    {r.category}
                    {r.group && <span className="hidden text-[11px] md:block">{r.group.name}</span>}
                  </span>
                  {/* Phones: the prices as a row of small label/value pairs. */}
                  <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 md:hidden">
                    {priceCols.map((c) => {
                      const v = c.value(r);
                      return (
                        <span key={c.key} className="text-xs">
                          <span className="text-muted-foreground">{c.label} </span>
                          <span className={cn("tabular-nums", c.strong && "font-semibold")}>{v != null ? peso(v) : "—"}</span>
                        </span>
                      );
                    })}
                    {showWarranty && r.warranty && <span className="text-xs text-muted-foreground">{r.warranty}</span>}
                  </span>
                  {priceCols.map((c) => {
                    const v = c.value(r);
                    return (
                      <span key={c.key} className={cn("hidden text-right tabular-nums md:block", c.strong ? "font-semibold" : "text-muted-foreground")}>
                        {v != null ? peso(v) : "—"}
                      </span>
                    );
                  })}
                  {showWarranty && <span className="hidden truncate text-right text-xs text-muted-foreground md:block">{r.warranty || "—"}</span>}
                  {/* Top-right on phones, last column on wider screens. */}
                  <span className="absolute right-2 top-2 md:static md:flex md:justify-end">
                    {onPick ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggle(); }}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={open ? `Hide details of ${r.model}` : `Show details of ${r.model}`}
                        aria-expanded={open}
                      >
                        <Info className="h-4 w-4" />
                      </button>
                    ) : (
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
                    )}
                  </span>
                </div>
                {open && <PriceRowDetails r={r} priceCols={priceCols} onPick={onPick} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tags({ r }: { r: PricedRow }) {
  return (
    <>
      {r.tags?.includes("eol") && <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground" title="End of life: being phased out">EOL</span>}
      {r.tags?.includes("price_up") && <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" title="Price went up in this list">Price up</span>}
    </>
  );
}

/** Everything about one model, opened under its row. */
function PriceRowDetails({
  r,
  priceCols,
  onPick,
}: {
  r: PricedRow;
  priceCols: { key: string; label: string; value: (r: PricedRow) => number | null | undefined; strong?: boolean }[];
  onPick?: (row: PricedRow) => void;
}) {
  const { headline, parts } = useMemo(() => splitDescription(r.description || ""), [r.description]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${r.model}\n${r.description}`);
      toast.success("Copied model and description");
    } catch {
      toast.error("Couldn't copy. Select the text instead.");
    }
  };

  return (
    <div className="space-y-3 px-3 pb-3 pt-1 text-sm">
      {headline && <p className="font-medium">{headline}</p>}
      {parts.length > 0 && parts.every((p) => !p.label) && (
        // Hikvision's run of short specs: two columns, so the panel stays short.
        <ul className="grid list-disc gap-x-8 gap-y-1 pl-4 text-[13px] leading-relaxed text-foreground/90 marker:text-muted-foreground sm:grid-cols-2">
          {parts.map((p, i) => <li key={i}>{p.text}</li>)}
        </ul>
      )}
      {parts.some((p) => p.label) && (
        <dl className="space-y-1.5">
          {parts.map((p, i) => (
            <div key={i} className={cn(p.label && "grid gap-x-3 sm:grid-cols-[80px_minmax(0,1fr)]")}>
              {p.label && <dt className="text-xs font-medium text-muted-foreground">{p.label}</dt>}
              <dd className="text-[13px] leading-relaxed text-foreground/90">{p.text}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap items-end gap-x-5 gap-y-2 border-t pt-2.5">
        {priceCols.map((c) => {
          const v = c.value(r);
          return (
            <div key={c.key}>
              <p className="text-[11px] text-muted-foreground">{c.label}</p>
              <p className={cn("tabular-nums", c.strong && "font-semibold")}>{v != null ? peso(v) : "—"}</p>
            </div>
          );
        })}
        {r.warranty && (
          <div>
            <p className="text-[11px] text-muted-foreground">Warranty</p>
            <p>{r.warranty}</p>
          </div>
        )}
        <div>
          <p className="text-[11px] text-muted-foreground">Category</p>
          <p>{r.category}{r.group && <span className="text-muted-foreground"> · {r.group.name}</span>}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={copy}>
            <Copy className="mr-1 h-3.5 w-3.5" /> Copy
          </Button>
          {onPick && (
            <Button type="button" size="sm" className="h-8 text-xs" onClick={() => onPick(r)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add to quotation
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
