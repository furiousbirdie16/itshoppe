import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Copy, Info, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ColumnVisibilityMenu, type ColumnDef } from "@/components/ColumnVisibility";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { priceLabel, sortByPrice, splitDescription, visiblePriceKeys, type SortDir } from "@/lib/price-list";
import { SPEC_LABELS, type SpecKey } from "@/lib/price-specs";
import { useAuth } from "@/contexts/AuthContext";
import {
  getCategoryTypes,
  getPriceListFacets,
  getPriceLists,
  isMultiPrice,
  searchPriceList,
  CATEGORY_TYPES_KEY,
  PRICE_LISTS_KEY,
  type CategoryType,
  type PriceList,
  type PriceListItem,
} from "@/lib/price-list-api";

export interface PricedRow extends PriceListItem {
  list: PriceList | undefined;
  /** The category's type ("Analog camera"), if one is set. */
  type: string | null;
  /**
   * The price a quotation line gets straight from the list: on a list like
   * TP-Link's, the price chosen under "Quote at" (SRP by default). Null on
   * an SDP list (Hikvision), where the quotation uses the customer's last
   * price instead.
   */
  price: number | null;
}

/** Lists and category types, shared by every price list screen. */
export function usePriceListData() {
  const lists = useQuery({ queryKey: PRICE_LISTS_KEY, queryFn: getPriceLists });
  const types = useQuery({ queryKey: CATEGORY_TYPES_KEY, queryFn: getCategoryTypes });
  return {
    lists: lists.data ?? [],
    types: types.data ?? [],
    isLoading: lists.isLoading,
  };
}

const sameBrand = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A category → type lookup for one brand. */
export function typeLookup(brand: string, types: CategoryType[]) {
  const m = new Map<string, string>();
  for (const t of types) if (sameBrand(t.brand, brand)) m.set(t.category.trim().toLowerCase(), t.type);
  return (category: string) => m.get(category.trim().toLowerCase()) ?? null;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Which columns are shown, remembered on this device for each brand. Keyed
 * by brand because Hikvision and TP-Link have different columns.
 */
function useShownColumns(storageKey: string, columns: ColumnDef[]) {
  const defaults = () => Object.fromEntries(columns.map((c) => [c.key, c.required || c.defaultVisible !== false]));
  const load = () => {
    const base = defaults();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Record<string, boolean> | null;
      if (saved) for (const c of columns) if (!c.required && typeof saved[c.key] === "boolean") base[c.key] = saved[c.key];
    } catch {
      /* private window or blocked storage: the defaults do */
    }
    return base;
  };
  const [visible, setVisible] = useState<Record<string, boolean>>(load);
  const keysSig = columns.map((c) => c.key).join(",");
  useEffect(() => setVisible(load()), [storageKey, keysSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (next: Record<string, boolean>) => {
    setVisible(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* not remembered, still applied */
    }
  };
  return {
    visible,
    isVisible: (k: string) => visible[k] !== false,
    toggle: (k: string) => save({ ...visible, [k]: visible[k] === false }),
    reset: () => {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      setVisible(defaults());
    },
  };
}

const ALL = "__all__";
const SPEC_COLS: SpecKey[] = ["mp", "shape", "place", "lens", "night", "channels", "extras"];

interface Col {
  key: string;
  label: string;
  /** A shorter heading for the table, where room is tight. */
  short?: string;
  /** Grid track on wider screens. */
  width: string;
  /** Price columns sort and line up right. */
  price?: (r: PricedRow) => number | null | undefined;
  /** Bold: the price a click adds. */
  strong?: boolean;
  cell?: (r: PricedRow) => ReactNode;
  /** Phones: show this value in the compact spec line. */
  specLine?: boolean;
}

/**
 * Search box, filters and the results. A one-price list (Hikvision) shows
 * SDP; a list with named prices (TP-Link) shows those, admins seeing all
 * four and staff only Bottom and SRP. Specs (MP, shape, indoor/outdoor…) are
 * columns and filters, and the Columns button chooses what is shown.
 * `onPick` makes each result clickable (the quotation picker).
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
  const { lists, types, isLoading } = usePriceListData();
  const active = useMemo(() => lists.filter((l) => l.is_active), [lists]);
  const [listId, setListId] = useState<string>("");
  const [category, setCategory] = useState<string>(ALL);
  const [type, setType] = useState<string>(ALL);
  const [spec, setSpec] = useState<Partial<Record<"mp" | "shape" | "place", string>>>({});
  const [query, setQuery] = useState("");
  const [quoteAt, setQuoteAt] = useState<string>("srp");
  const [openId, setOpenId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const q = useDebounced(query, 250);

  // Opens on the newest active list.
  useEffect(() => {
    if (!listId && active.length > 0) setListId(active[0].id);
  }, [active, listId]);
  // Another list has other categories, specs and price columns.
  useEffect(() => {
    setCategory(ALL);
    setType(ALL);
    setSpec({});
    setSort(null);
  }, [listId]);

  const list = lists.find((l) => l.id === listId);
  const brand = list?.brand ?? "";
  const multi = isMultiPrice(list);
  const priceKeys = useMemo(() => (multi ? visiblePriceKeys(list!.price_columns ?? [], isAdmin) : []), [multi, list, isAdmin]);
  // SRP unless this person can't see it or the list has none.
  useEffect(() => {
    if (priceKeys.length > 0 && !priceKeys.includes(quoteAt)) setQuoteAt(priceKeys.includes("srp") ? "srp" : priceKeys[priceKeys.length - 1]);
  }, [priceKeys, quoteAt]);

  const { data: facets } = useQuery({
    queryKey: ["price-list-facets", listId],
    queryFn: () => getPriceListFacets(listId),
    enabled: !!listId,
    staleTime: 5 * 60_000,
  });
  const categories = useMemo(() => facets?.categories ?? [], [facets]);
  const typeOf = useMemo(() => typeLookup(brand, types), [brand, types]);
  const typeNames = useMemo(() => [...new Set(categories.map(typeOf).filter((t): t is string => !!t))].sort(), [categories, typeOf]);
  const typeCategories = type === ALL ? null : categories.filter((c) => typeOf(c) === type);

  const sorting = sort != null;
  const { data: results = [], isFetching } = useQuery({
    queryKey: ["price-list-search", listId, category, typeCategories?.join("|") ?? null, spec, q, sorting],
    queryFn: () =>
      searchPriceList({
        priceListIds: [listId],
        query: q,
        category: category === ALL ? null : category,
        categories: typeCategories,
        specs: spec,
        limit: 100,
        all: sorting,
      }),
    enabled: !!listId,
    placeholderData: (prev) => prev,
  });

  const priced: PricedRow[] = useMemo(
    () => results.map((r) => ({
      ...r,
      list,
      type: typeOf(r.category),
      price: multi ? r.prices?.[quoteAt as keyof typeof r.prices] ?? null : null,
    })),
    [results, list, multi, quoteAt, typeOf],
  );

  // Every column this list can show, in order.
  const allCols: Col[] = useMemo(() => {
    const text = (v: string | null | undefined) => v || "—";
    const SHORT: Partial<Record<SpecKey, string>> = { place: "In/Out", night: "Night", channels: "Ch" };
    const specCol = (k: SpecKey, width: string): Col => ({
      key: k,
      label: SPEC_LABELS[k],
      short: SHORT[k],
      width,
      cell: (r) => text(r.specs?.[k]),
      specLine: true,
    });
    const prices: Col[] = multi
      ? priceKeys.map((k) => ({ key: k, label: priceLabel(k), width: "84px", price: (r) => r.prices?.[k as keyof typeof r.prices], strong: !!onPick && k === quoteAt }))
      : [{ key: "sdp", label: "SDP", width: "96px", price: (r) => r.sdp }];
    return [
      // The model never squeezes below a full model number's width.
      { key: "model", label: "Model", width: "minmax(150px,1.4fr)" },
      { key: "type", label: "Type", width: "minmax(0,0.9fr)", cell: (r) => text(r.type) },
      { key: "category", label: "Category", width: "minmax(0,1fr)", cell: (r) => r.category },
      specCol("mp", "44px"),
      specCol("shape", "68px"),
      specCol("place", "64px"),
      specCol("lens", "minmax(0,0.8fr)"),
      specCol("night", "minmax(0,1fr)"),
      specCol("channels", "36px"),
      specCol("extras", "minmax(0,1fr)"),
      { key: "description", label: "Description", width: "minmax(0,2fr)", cell: (r) => r.description || "—" },
      ...prices,
      ...(multi ? [{ key: "warranty", label: "Warranty", width: "68px", cell: (r: PricedRow) => r.warranty || "—" }] : []),
    ];
  }, [multi, priceKeys, onPick, quoteAt]);

  // Defaults: Hikvision reads by specs, TP-Link by its descriptions.
  const columnDefs: ColumnDef[] = useMemo(() => {
    const hiddenByDefault = multi
      ? new Set(["type", "lens", "night", "channels", "extras", "shape", "place", "mp"])
      : new Set(["category", "extras", "description"]);
    return allCols.map((c) => ({ key: c.key, label: c.label, required: c.key === "model" || !!c.price, defaultVisible: !hiddenByDefault.has(c.key) }));
  }, [allCols, multi]);
  const shown = useShownColumns(`priceList.columns.v1.${brand.toLowerCase() || "none"}`, columnDefs);
  // A column blank for every result (Channels on cameras, Type before any
  // are set) is left out, so the rest get the room.
  const filled = (c: Col) =>
    c.key === "model" || !!c.price || priced.some((r) => {
      const v = c.cell?.(r);
      return v != null && v !== "—" && v !== "";
    });
  const cols = allCols.filter((c) => shown.isVisible(c.key) && filled(c));
  const priceCols = allCols.filter((c) => c.price);

  if (!isLoading && active.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
        No price lists yet. An admin uploads one from the Price Lists page.
      </div>
    );
  }

  // Sorted over every match, then cut to the first 100 shown.
  const sortCol = sort ? priceCols.find((c) => c.key === sort.key) : undefined;
  const ordered = sortCol ? sortByPrice(priced, sortCol.price!, sort!.dir) : priced;
  const rows = ordered.slice(0, 100);
  const total = priced.length;
  const cycleSort = (key: string) =>
    setSort((cur) => (cur?.key !== key ? { key, dir: "asc" } : cur.dir === "asc" ? { key, dir: "desc" } : null));
  const grid = `${cols.map((c) => c.width).join(" ")} 28px`;
  const filtersOn = category !== ALL || type !== ALL || Object.values(spec).some(Boolean);

  const specFilter = (k: "mp" | "shape" | "place", label: string, values: string[] | undefined) =>
    values && values.length > 0 ? (
      <Select value={spec[k] ?? ALL} onValueChange={(v) => setSpec((s) => ({ ...s, [k]: v === ALL ? undefined : v }))}>
        <SelectTrigger className="h-9 w-[calc(50%-4px)] text-sm sm:w-36" aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{label}: any</SelectItem>
          {values.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
        </SelectContent>
      </Select>
    ) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search model or description, e.g. 7608NI or 2mp indoor dome"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Select value={listId} onValueChange={setListId}>
          <SelectTrigger className="h-9 w-full text-sm sm:w-56"><SelectValue placeholder="Price list" /></SelectTrigger>
          <SelectContent>
            {active.map((l) => <SelectItem key={l.id} value={l.id}>{l.brand} · {l.name}</SelectItem>)}
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

      <div className="flex flex-wrap items-center gap-2">
        {typeNames.length > 0 && (
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-9 w-[calc(50%-4px)] text-sm sm:w-44" aria-label="Type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {typeNames.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-[calc(50%-4px)] text-sm sm:w-52" aria-label="Category"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {(typeCategories ?? categories).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        {specFilter("mp", "MP", facets?.mp)}
        {specFilter("shape", "Shape", facets?.shape)}
        {specFilter("place", "Indoor/Outdoor", facets?.place)}
        {filtersOn && (
          <Button type="button" variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setCategory(ALL); setType(ALL); setSpec({}); }}>
            <X className="mr-1 h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
        <div className="ml-auto hidden md:block">
          <ColumnVisibilityMenu columns={columnDefs} visible={shown.visible} onToggle={shown.toggle} onReset={shown.reset} />
        </div>
      </div>

      {/* Phones have no column headings to click, so sorting is a menu. */}
      <Select
        value={sort ? `${sort.key}:${sort.dir}` : "best"}
        onValueChange={(v) => {
          if (v === "best") return setSort(null);
          const [key, dir] = v.split(":");
          setSort({ key, dir: dir as SortDir });
        }}
      >
        <SelectTrigger className="h-9 w-full text-sm md:hidden" aria-label="Sort"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="best">Sort: best match</SelectItem>
          {priceCols.flatMap((c) => [
            <SelectItem key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label}: low to high</SelectItem>,
            <SelectItem key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label}: high to low</SelectItem>,
          ])}
        </SelectContent>
      </Select>

      <p className="text-[11px] text-muted-foreground">
        {isFetching
          ? "Searching…"
          : sortCol && total > 100
            ? `The ${sort!.dir === "asc" ? "100 cheapest" : "100 dearest"} of ${total.toLocaleString()} matches by ${sortCol.label}.`
            : !sortCol && total === 100
              ? "First 100 matches. Type more or filter to narrow it down."
              : `${total.toLocaleString()} match${total === 1 ? "" : "es"}${sortCol ? `, ${sort!.dir === "asc" ? "cheapest" : "dearest"} first by ${sortCol.label}` : ""}`}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
          {isFetching ? "Searching…" : "No models match."}
        </div>
      ) : (
        <div className={cn("rounded-lg border bg-card", compact && "max-h-[55vh] overflow-y-auto")}>
          {/* Header only on wider screens; phones get stacked rows. */}
          <div className="hidden gap-3 border-b px-3 py-2 text-[11px] font-medium text-muted-foreground md:grid" style={{ gridTemplateColumns: grid }}>
            {cols.map((c) => {
              if (!c.price) return <span key={c.key} className="truncate" title={c.label}>{c.short ?? c.label}</span>;
              const on = sort?.key === c.key;
              const Icon = !on ? ArrowUpDown : sort!.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => cycleSort(c.key)}
                  className={cn("flex items-center justify-end gap-1 text-right hover:text-foreground", on && "text-foreground")}
                  title={!on ? `Sort by ${c.label}, low to high` : sort!.dir === "asc" ? `Sort by ${c.label}, high to low` : "Back to best match"}
                  aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {c.label}
                  <Icon className={cn("h-3 w-3 shrink-0", !on && "opacity-40")} aria-hidden="true" />
                </button>
              );
            })}
            <span />
          </div>
          {rows.map((r) => {
            const open = openId === r.id;
            const toggle = () => setOpenId(open ? null : r.id);
            // On the Price Lists page a click opens the details; in the
            // quotation picker a click adds the model and the ⓘ opens them.
            const activate = onPick ? () => onPick(r) : toggle;
            const specLine = cols.filter((c) => c.specLine).map((c) => r.specs?.[c.key as SpecKey]).filter(Boolean).join(" · ");
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
                  {cols.map((c) => {
                    if (c.key === "model") {
                      return (
                        // Wraps rather than cuts off: a model number half-shown is no use.
                        <span key={c.key} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="font-medium [overflow-wrap:anywhere]">{r.model}</span>
                          <Tags r={r} />
                        </span>
                      );
                    }
                    if (c.price) {
                      const v = c.price(r);
                      return (
                        <span key={c.key} className={cn("hidden text-right tabular-nums md:block", c.strong ? "font-semibold" : "text-muted-foreground")}>
                          {v != null ? peso(v) : "—"}
                        </span>
                      );
                    }
                    return (
                      <span
                        key={c.key}
                        // Two lines rather than "3.6/…": a cut-off spec can't be read.
                        className={cn("hidden break-words text-xs md:line-clamp-2 md:text-[13px]", c.key === "description" || c.key === "category" ? "text-muted-foreground" : "")}
                        title={typeof c.cell?.(r) === "string" ? (c.cell!(r) as string) : undefined}
                      >
                        {c.cell?.(r)}
                      </span>
                    );
                  })}
                  {/* Phones: specs on one line, then the description if shown, then prices. */}
                  {specLine && <span className="mt-0.5 block text-xs md:hidden">{specLine}</span>}
                  {shown.isVisible("description") && !open && (
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground md:hidden">{r.description || "—"}</span>
                  )}
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground md:hidden">
                    {[r.type, r.category].filter(Boolean).join(" · ")}
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 md:hidden">
                    {priceCols.map((c) => {
                      const v = c.price!(r);
                      return (
                        <span key={c.key} className="text-xs">
                          <span className="text-muted-foreground">{c.label} </span>
                          <span className={cn("tabular-nums", c.strong && "font-semibold")}>{v != null ? peso(v) : "—"}</span>
                        </span>
                      );
                    })}
                    {multi && r.warranty && <span className="text-xs text-muted-foreground">{r.warranty}</span>}
                  </span>
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
function PriceRowDetails({ r, priceCols, onPick }: { r: PricedRow; priceCols: Col[]; onPick?: (row: PricedRow) => void }) {
  const { headline, parts } = useMemo(() => splitDescription(r.description || ""), [r.description]);
  const specs = SPEC_COLS.filter((k) => r.specs?.[k]);
  const copy = async () => {
    try {
      const specText = specs.map((k) => `${SPEC_LABELS[k]}: ${r.specs[k]}`).join("\n");
      await navigator.clipboard.writeText([r.model, specText, r.description].filter(Boolean).join("\n"));
      toast.success("Copied model, specs and description");
    } catch {
      toast.error("Couldn't copy. Select the text instead.");
    }
  };

  return (
    <div className="space-y-3 px-3 pb-3 pt-1 text-sm">
      {specs.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1.5">
          {specs.map((k) => (
            <div key={k}>
              <dt className="text-[11px] text-muted-foreground">{SPEC_LABELS[k]}</dt>
              <dd className="font-medium">{r.specs[k]}</dd>
            </div>
          ))}
        </dl>
      )}
      {headline && <p className={cn(specs.length > 0 ? "text-[13px] text-foreground/90" : "font-medium")}>{headline}</p>}
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
          const v = c.price!(r);
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
          <p>{r.category}{r.type && <span className="text-muted-foreground"> · {r.type}</span>}</p>
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
