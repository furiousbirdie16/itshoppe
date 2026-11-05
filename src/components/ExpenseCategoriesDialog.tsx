import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, Merge, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { categoryKey, categorySource, type CategorySource, type ExpenseCategory } from "@/lib/expenses";
import {
  createExpenseCategory, updateExpenseCategory, renameExpenseCategory, mergeExpenseCategories,
  deleteExpenseCategory, getExpenseCategoryUsage,
} from "@/lib/expenses-api";

type Filter = "all" | CategorySource | "unused";

const FILTERS: { v: Filter; l: string }[] = [
  { v: "all", l: "All" },
  { v: "typed", l: "Typed before" },
  { v: "added", l: "Added" },
  { v: "standard", l: "Standard" },
  { v: "unused", l: "Unused" },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: ExpenseCategory[];
  onChanged: () => void;
}

/**
 * The category list, with the tools to clean up the names typed in before
 * there was a list: tick several and merge them into one, delete one nothing
 * uses, and see how many entries each one holds.
 */
export function ExpenseCategoriesDialog({ open, onOpenChange, categories, onChanged }: Props) {
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // Categories being merged, and where to.
  const [merging, setMerging] = useState<ExpenseCategory[] | null>(null);
  const [mergeInto, setMergeInto] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: usage = {}, refetch: refetchUsage } = useQuery({
    queryKey: ["expense-category-usage"],
    queryFn: getExpenseCategoryUsage,
    enabled: open,
  });
  const entriesOf = (c: ExpenseCategory) => usage[categoryKey(c.name)] || 0;

  const changed = () => { onChanged(); void refetchUsage(); };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); changed(); toast.success(ok); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
    finally { setBusy(false); }
  };

  const sorted = useMemo(
    () => [...categories].sort((a, b) =>
      Number(b.is_expense) - Number(a.is_expense) || a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [categories],
  );
  const counts: Record<Filter, number> = {
    all: sorted.length,
    typed: sorted.filter((c) => categorySource(c) === "typed").length,
    added: sorted.filter((c) => categorySource(c) === "added").length,
    standard: sorted.filter((c) => categorySource(c) === "standard").length,
    unused: sorted.filter((c) => entriesOf(c) === 0).length,
  };
  const q = search.trim().toLowerCase();
  const visible = sorted.filter((c) =>
    (filter === "all" || (filter === "unused" ? entriesOf(c) === 0 : categorySource(c) === filter))
    && (!q || c.name.toLowerCase().includes(q)));

  const picked = sorted.filter((c) => selected.has(c.id));
  const allVisiblePicked = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllVisible = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allVisiblePicked) visible.forEach((c) => next.delete(c.id));
    else visible.forEach((c) => next.add(c.id));
    return next;
  });

  const startMerge = (list: ExpenseCategory[]) => { setMerging(list); setMergeInto(""); };

  const doMerge = async () => {
    if (!merging || !mergeInto) return;
    const into = sorted.find((c) => c.id === mergeInto);
    const ok = await run(
      () => mergeExpenseCategories(merging.map((c) => c.id), mergeInto),
      `${merging.length} categor${merging.length === 1 ? "y" : "ies"} merged into ${into?.name}`,
    );
    if (ok) {
      setSelected((prev) => { const next = new Set(prev); merging.forEach((c) => next.delete(c.id)); return next; });
      setMerging(null);
    }
  };

  const remove = async (c: ExpenseCategory) => {
    // Something still filed under it: moving those entries is a merge.
    if (entriesOf(c) > 0) { startMerge([c]); return; }
    if (!window.confirm(`Delete "${c.name}"? Nothing uses it.`)) return;
    await run(() => deleteExpenseCategory(c.id), `Deleted ${c.name}`);
    setSelected((prev) => { const next = new Set(prev); next.delete(c.id); return next; });
  };

  const deleteUnusedPicked = async () => {
    const unused = picked.filter((c) => entriesOf(c) === 0);
    if (!unused.length) return;
    if (!window.confirm(`Delete ${unused.length} unused categor${unused.length === 1 ? "y" : "ies"}?`)) return;
    await run(async () => { for (const c of unused) await deleteExpenseCategory(c.id); }, `Deleted ${unused.length}`);
    setSelected((prev) => { const next = new Set(prev); unused.forEach((c) => next.delete(c.id)); return next; });
  };

  const hidePicked = () =>
    run(async () => { for (const c of picked) if (c.is_active) await updateExpenseCategory(c.id, { is_active: false }); }, "Hidden from the dropdown");

  const mergeEntries = merging?.reduce((s, c) => s + entriesOf(c), 0) || 0;
  const pickedUnused = picked.filter((c) => entriesOf(c) === 0).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSelected(new Set()); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader><DialogTitle className="text-base">Categories</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Money out under a category marked <span className="font-medium text-foreground">Expense</span> counts on the Expenses page.
          Merging moves every bank, cash and payable entry to the category you pick and removes the old name.
        </p>

        <div className="flex gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category" className="h-9" />
          <Button className="h-9 shrink-0" disabled={!newName.trim() || busy} onClick={() => run(async () => { await createExpenseCategory(newName, true); setNewName(""); }, "Category added")}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="h-8 pl-8 text-sm" />
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.v}
                type="button"
                onClick={() => setFilter(f.v)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px]",
                  filter === f.v ? "border-primary bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.l} <span className="tabular-nums">{counts[f.v]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* What to do with the ticked ones. */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 min-h-[44px]">
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={allVisiblePicked} onCheckedChange={toggleAllVisible} aria-label="Tick all shown" />
            {picked.length ? `${picked.length} ticked` : "Tick categories to merge, hide or delete them together"}
          </label>
          {picked.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-1">
              <Button size="sm" className="h-7 text-xs" onClick={() => startMerge(picked)} disabled={busy}>
                <Merge className="h-3.5 w-3.5 mr-1" /> Merge into…
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={hidePicked} disabled={busy}>
                <EyeOff className="h-3.5 w-3.5 mr-1" /> Hide
              </Button>
              {pickedUnused > 0 && (
                <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={deleteUnusedPicked} disabled={busy}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete {pickedUnused} unused
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y rounded-lg border min-h-[200px]">
          {visible.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nothing matches.</p>}
          {visible.map((c) => {
            const n = entriesOf(c);
            return (
              <div key={c.id} className={cn("flex items-center gap-2 px-3 py-1.5", !c.is_active && "opacity-60", selected.has(c.id) && "bg-primary/5")}>
                <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} aria-label={`Tick ${c.name}`} />
                <div className="min-w-0 flex-1">
                  {renaming?.id === c.id ? (
                    <Input
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void run(() => renameExpenseCategory(c.id, renaming.name), "Renamed").then(() => setRenaming(null));
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={() => setRenaming(null)}
                      className="h-7"
                    />
                  ) : (
                    <>
                      <p className="text-sm truncate">{c.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {n ? `${n} entr${n === 1 ? "y" : "ies"}` : "unused"}
                        {categorySource(c) === "typed" ? " · typed before" : categorySource(c) === "added" ? " · added" : ""}
                      </p>
                    </>
                  )}
                </div>
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Switch checked={c.is_expense} onCheckedChange={(v) => run(() => updateExpenseCategory(c.id, { is_expense: v }), v ? `${c.name} counts as an expense` : `${c.name} no longer counts`)} />
                  Expense
                </label>
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Switch checked={c.is_active} onCheckedChange={(v) => run(() => updateExpenseCategory(c.id, { is_active: v }), v ? "Shown in the dropdown" : "Hidden from the dropdown")} />
                  Shown
                </label>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Rename" onClick={() => setRenaming({ id: c.id, name: c.name })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" title={n ? "Merge into another category" : "Delete"} onClick={() => remove(c)}>
                  {n ? <Merge className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            );
          })}
        </div>

        <Dialog open={!!merging} onOpenChange={(o) => !o && setMerging(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base">
                Merge {merging?.length === 1 ? merging[0].name : `${merging?.length} categories`}
              </DialogTitle>
            </DialogHeader>
            {merging && merging.length > 1 && (
              <p className="text-xs text-muted-foreground line-clamp-4">{merging.map((c) => c.name).join(", ")}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {mergeEntries
                ? `${mergeEntries} entr${mergeEntries === 1 ? "y moves" : "ies move"} to the category you pick`
                : "Nothing is filed under these"}
              , and {merging?.length === 1 ? "the old name is" : "these names are"} removed.
            </p>
            <Select value={mergeInto} onValueChange={setMergeInto}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Merge into…" /></SelectTrigger>
              <SelectContent>
                {sorted.filter((c) => !merging?.some((m) => m.id === c.id)).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}{c.is_expense ? "" : " (not an expense)"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMerging(null)}>Cancel</Button>
              <Button disabled={!mergeInto || busy} onClick={doMerge}>{busy ? "Merging…" : "Merge"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
