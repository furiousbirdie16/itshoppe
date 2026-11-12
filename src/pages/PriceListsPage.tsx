import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Archive, ArchiveRestore, FileSpreadsheet, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { PriceListSearch, usePriceListData } from "@/components/PriceListSearch";
import { keepSheets, priceLabel, readPriceListFile, sheetDefaults, type ParsedPriceList } from "@/lib/price-list";
import {
  deletePriceList,
  getPriceListFacets,
  savePriceList,
  setCategoryTypes,
  setPriceListActive,
  CATEGORY_TYPES_KEY,
  PRICE_LISTS_KEY,
  STARTER_TYPES,
  type PriceList,
} from "@/lib/price-list-api";
import { typeLookup } from "@/components/PriceListSearch";

const sameBrand = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export default function PriceListsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [tab, setTab] = useState("search");
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Price Lists</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Supplier price lists for quoting models you don't stock. Kept apart from inventory.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" className="h-9 rounded-lg" onClick={() => setUploadOpen(true)}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload price list
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          {isAdmin && <TabsTrigger value="lists">Uploads</TabsTrigger>}
        </TabsList>
        <TabsContent value="search" className="mt-4">
          <PriceListSearch />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CategoriesPanel canEdit={isAdmin} />
        </TabsContent>
        {isAdmin && (
          <TabsContent value="lists" className="mt-4">
            <UploadsPanel />
          </TabsContent>
        )}
      </Tabs>

      {isAdmin && (
        <UploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onSaved={(untyped) => {
            if (untyped > 0) {
              setTab("categories");
              toast.info(`${untyped} categor${untyped === 1 ? "y has" : "ies have"} no type yet. Set them here to filter by type.`);
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

function UploadDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: (unsorted: number) => void }) {
  const qc = useQueryClient();
  const { lists, types } = usePriceListData();
  const brands = useMemo(() => [...new Set(lists.map((l) => l.brand))], [lists]);
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedPriceList | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ saved: number; total: number } | null>(null);
  // Replacing is the usual case: a new month's file supersedes the last one.
  const [replace, setReplace] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setBrand(brands[0] ?? "Hikvision");
    setName("");
    setFileName("");
    setParsed(null);
    setProgress(null);
    setReplace(true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // The lists a replace would archive: this brand's active ones.
  const current = useMemo(() => lists.filter((l) => l.is_active && sameBrand(l.brand, brand)), [lists, brand]);

  // Sheets you untick are left out. The brand's last upload decides which
  // start unticked, and sheets it never had are flagged as new.
  const previous = useMemo(() => lists.find((l) => sameBrand(l.brand, brand)) ?? null, [lists, brand]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [isNew, setIsNew] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!parsed) return;
    const d = sheetDefaults(parsed.sheets.map((x) => x.name), previous);
    setExcluded(d.excluded);
    setIsNew(d.isNew);
    // Keyed on the list's id: a background refetch hands back a new object
    // for the same list, and must not undo the ticks you have changed.
  }, [parsed, previous?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const kept = useMemo(() => (parsed ? keepSheets(parsed, excluded) : null), [parsed, excluded]);
  const toggleSheet = (sheet: string, keep: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (keep) next.delete(sheet);
      else next.add(sheet);
      return next;
    });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setParsed(null);
    try {
      const buf = await file.arrayBuffer();
      // Let the "Reading…" state paint before the parse blocks the page.
      await new Promise((r) => setTimeout(r, 30));
      const result = readPriceListFile(buf);
      setParsed(result);
      setFileName(file.name);
      // A file named for a brand you already have ("SEPT 21-HIKVISION PL",
      // "TP-Link Pricelist") sets the brand, so a Hikvision file can't
      // replace the TP-Link list because the box still said TP-Link.
      const bare = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
      const named = brands.find((b) => bare(b) && bare(file.name).includes(bare(b)));
      if (named) setBrand(named);
      if (!name) setName(file.name.replace(/\.xlsx?$/i, "").trim());
    } catch (e) {
      toast.error(`Couldn't read that file. ${e instanceof Error ? e.message : ""}`.trim());
    } finally {
      setReading(false);
    }
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!parsed || !kept) throw new Error("Choose a file first");
      if (kept.rows.length === 0) throw new Error("Tick at least one sheet to keep");
      if (!brand.trim()) throw new Error("Enter the brand");
      if (!name.trim()) throw new Error("Enter a name for this list");
      // Taken before saving, so the new list is never among them.
      const toArchive = replace ? current : [];
      const list = await savePriceList(
        {
          brand,
          name,
          fileName,
          rows: kept.rows,
          priceColumns: kept.priceColumns,
          sheets: kept.sheets.map((x) => x.name),
          skippedSheets: parsed.sheets.map((x) => x.name).filter((n) => excluded.has(n)),
        },
        (saved, total) => setProgress({ saved, total }),
      );
      // Only once the new list is fully saved: a failed upload leaves the
      // old one in use.
      let archiveFailed = false;
      for (const old of toArchive) {
        try {
          await setPriceListActive(old.id, false);
        } catch {
          archiveFailed = true;
        }
      }
      return { list, archived: toArchive, archiveFailed, saved: kept };
    },
    onSuccess: ({ archived, archiveFailed, saved }) => {
      qc.invalidateQueries({ queryKey: PRICE_LISTS_KEY });
      qc.invalidateQueries({ queryKey: ["price-list-search"] });
      qc.invalidateQueries({ queryKey: ["price-list-facets"] });
      const typeOf = typeLookup(brand, types);
      const untyped = saved.categories.filter((c) => !typeOf(c)).length;
      toast.success(
        `Saved ${saved.rows.length.toLocaleString()} models` +
          (archived.length > 0 ? `. Archived ${archived.map((l) => `"${l.name}"`).join(", ")}.` : ""),
      );
      if (archiveFailed) toast.error("The old list couldn't be archived. Archive it from the Uploads tab.");
      onOpenChange(false);
      onSaved(untyped);
    },
    onError: (e: Error) => {
      setProgress(null);
      toast.error(e.message || "Couldn't save the price list");
    },
  });

  const saving = saveMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload price list</DialogTitle>
          <DialogDescription>Choose which sheets to keep. Nothing is added to inventory.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Brand</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} list="price-list-brands" disabled={saving} />
              <datalist id="price-list-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hikvision – Sept 21" disabled={saving} />
            </div>
          </div>

          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
          <Button variant="outline" className="w-full justify-start" onClick={() => fileRef.current?.click()} disabled={saving || reading}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            {reading ? "Reading the file…" : fileName || "Choose Excel file"}
          </Button>

          {parsed && kept && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Models kept" value={kept.rows.length.toLocaleString()} />
                <Stat label="Categories" value={String(kept.categories.length)} />
                <Stat label="Sheets kept" value={`${kept.sheets.length} of ${parsed.sheets.length}`} />
              </div>
              {parsed.sheets.length > 1 && (
                <div className="rounded-md border">
                  <div className="flex items-center justify-between border-b px-3 py-1.5">
                    <span className="text-xs font-medium">Sheets</span>
                    <span className="flex gap-3 text-xs">
                      <button type="button" className="text-primary hover:underline disabled:opacity-50" onClick={() => setExcluded(new Set())} disabled={saving}>Select all</button>
                      <button type="button" className="text-primary hover:underline disabled:opacity-50" onClick={() => setExcluded(new Set(parsed.sheets.map((x) => x.name)))} disabled={saving}>Select none</button>
                    </span>
                  </div>
                  <div className="max-h-56 overflow-y-auto py-1">
                    {parsed.sheets.map((sh) => (
                      <label key={sh.name} className="flex cursor-pointer items-center gap-2.5 px-3 py-1 hover:bg-muted/50">
                        <Checkbox checked={!excluded.has(sh.name)} onCheckedChange={(v) => toggleSheet(sh.name, !!v)} disabled={saving} />
                        <span className="min-w-0 flex-1 truncate text-sm">{sh.name}</span>
                        {isNew.has(sh.name) && <span className="rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">New</span>}
                        <span className="text-xs tabular-nums text-muted-foreground">{sh.rows.length}</span>
                      </label>
                    ))}
                  </div>
                  {previous && ((previous.sheets?.length ?? 0) > 0 || (previous.skipped_sheets?.length ?? 0) > 0) && (
                    <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">Ticked the same as your last {previous.brand} upload.</p>
                  )}
                </div>
              )}
              {parsed.priceColumns.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Prices found: <span className="font-medium text-foreground">{parsed.priceColumns.map(priceLabel).join(" · ")}</span>. No markup groups needed.
                </p>
              )}
              {parsed.skipped.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />
                  Skipped, no prices: {parsed.skipped.map((s) => s.sheet).join(", ")}
                </div>
              )}
              {parsed.rows.length === 0 && (
                <p className="text-xs text-destructive">No priced models were found. Check that the file has Model and SDP columns.</p>
              )}
            </div>
          )}

          {parsed && current.length > 0 && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5">
              <Checkbox checked={replace} onCheckedChange={(v) => setReplace(!!v)} disabled={saving} className="mt-0.5" />
              <span className="min-w-0 text-sm">
                Replace the current {brand.trim()} list
                <span className="block text-xs text-muted-foreground">
                  {replace
                    ? <>Archives {current.map((l) => `"${l.name}" (uploaded ${format(new Date(l.created_at), "MMM d")})`).join(", ")} once this one is saved. It stays under Uploads for comparing prices.</>
                    : <>Both lists stay in use. You'll pick which one to search.</>}
                </span>
              </span>
            </label>
          )}

          {progress && (
            <div className="space-y-1">
              <Progress value={(progress.saved / Math.max(progress.total, 1)) * 100} />
              <p className="text-[11px] text-muted-foreground">Saving {progress.saved.toLocaleString()} of {progress.total.toLocaleString()}…</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saving || !kept || kept.rows.length === 0}>
            {saving ? "Saving…" : "Save price list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

function UploadsPanel() {
  const qc = useQueryClient();
  const { lists, isLoading } = usePriceListData();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: PRICE_LISTS_KEY });
    qc.invalidateQueries({ queryKey: ["price-list-search"] });
  };
  const activeMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setPriceListActive(id, active),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message || "Couldn't update the list"),
  });
  const deleteMut = useMutation({
    mutationFn: (l: PriceList) => deletePriceList(l),
    onSuccess: () => { refresh(); toast.success("Price list deleted"); },
    onError: (e: Error) => toast.error(e.message || "Couldn't delete the list"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (lists.length === 0) return <p className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">No price lists uploaded yet.</p>;

  return (
    <div className="divide-y rounded-lg border bg-card">
      {lists.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {l.name}
              {!l.is_active && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">Archived</span>}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {l.brand} · {l.row_count.toLocaleString()} models · uploaded {format(new Date(l.created_at), "MMM d, yyyy")}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => activeMut.mutate({ id: l.id, active: !l.is_active })}>
            {l.is_active ? <><Archive className="mr-1 h-3.5 w-3.5" /> Archive</> : <><ArchiveRestore className="mr-1 h-3.5 w-3.5" /> Restore</>}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Delete price list"
            onClick={() => {
              if (confirm(`Delete "${l.name}" and its ${l.row_count.toLocaleString()} models? This can't be undone. Quotations already made keep their lines.`)) deleteMut.mutate(l);
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories: a type for each, set in bulk
// ---------------------------------------------------------------------------

const NO_TYPE = "__none__";
const NEW_TYPE = "__new__";

function CategoriesPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { lists, types } = usePriceListData();
  const brands = useMemo(() => [...new Set(lists.map((l) => l.brand.trim()))], [lists]);
  const [brand, setBrand] = useState("");
  useEffect(() => {
    if (!brand && brands.length > 0) setBrand(brands[0]);
  }, [brands, brand]);

  // Categories come from the brand's newest list.
  const latest = lists.find((l) => sameBrand(l.brand, brand) && l.is_active) ?? lists.find((l) => sameBrand(l.brand, brand));
  const { data: facets } = useQuery({
    queryKey: ["price-list-facets", latest?.id],
    queryFn: () => getPriceListFacets(latest!.id),
    enabled: !!latest,
    staleTime: 5 * 60_000,
  });
  const categories = facets?.categories ?? [];
  const typeOf = useMemo(() => typeLookup(brand, types), [brand, types]);
  // Your types first, then the starter ones you haven't used yet.
  const typeNames = useMemo(() => {
    const used = [...new Set(types.map((t) => t.type))].sort();
    return [...used, ...STARTER_TYPES.filter((t) => !used.some((u) => u.toLowerCase() === t.toLowerCase()))];
  }, [types]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [brand]);
  const [newTypeFor, setNewTypeFor] = useState<string[] | null>(null);
  const [newType, setNewType] = useState("");

  const setMut = useMutation({
    mutationFn: ({ cats, type }: { cats: string[]; type: string | null }) => setCategoryTypes(brand, cats, type),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: CATEGORY_TYPES_KEY });
      setSelected(new Set());
      toast.success(v.type ? `${v.cats.length} categor${v.cats.length === 1 ? "y" : "ies"} set to ${v.type}` : "Type cleared");
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't set the type"),
  });
  const apply = (cats: string[], value: string) => {
    if (value === NEW_TYPE) {
      setNewTypeFor(cats);
      setNewType("");
      return;
    }
    setMut.mutate({ cats, type: value === NO_TYPE ? null : value });
  };

  if (brands.length === 0) {
    return <p className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">Upload a price list first, then give its categories a type here.</p>;
  }

  const untyped = categories.filter((c) => !typeOf(c)).length;
  const toggle = (c: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(c); else n.delete(c); return n; });
  const typeOptions = (
    <>
      <SelectItem value={NO_TYPE}>No type</SelectItem>
      {typeNames.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
      <SelectItem value={NEW_TYPE}>New type…</SelectItem>
    </>
  );

  return (
    <div className="space-y-4">
      {brands.length > 1 && (
        <Select value={brand} onValueChange={setBrand}>
          <SelectTrigger className="h-9 w-56 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
        </Select>
      )}

      <p className="text-xs text-muted-foreground">
        Give each category a type, e.g. colorVu, colorVu Hybrid and Two-way Audio as <span className="font-medium text-foreground">Analog camera</span>.
        The Type filter on the Search tab then shows only those. Types are kept by category name, so next month's upload keeps them.
      </p>

      {untyped > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />
          {untyped} of {categories.length} categor{categories.length === 1 ? "y has" : "ies have"} no type yet.
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <p className="mr-auto text-sm font-medium">
            Categories · {brand} {latest && <span className="font-normal text-muted-foreground">· from {latest.name}</span>}
          </p>
          {canEdit && (
            <>
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSelected(new Set(categories))}>Select all</button>
              {selected.size > 0 && (
                <>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSelected(new Set())}>Clear</button>
                  <span className="text-xs text-muted-foreground">{selected.size} selected →</span>
                  <Select value="" onValueChange={(v) => apply([...selected], v)}>
                    <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Set type…" /></SelectTrigger>
                    <SelectContent>{typeOptions}</SelectContent>
                  </Select>
                </>
              )}
            </>
          )}
        </div>
        <div className="divide-y">
          {categories.map((c) => {
            const t = typeOf(c);
            return (
              <div key={c} className="flex items-center gap-3 px-3 py-1.5">
                {canEdit && <Checkbox checked={selected.has(c)} onCheckedChange={(v) => toggle(c, !!v)} aria-label={`Select ${c}`} />}
                <span className="min-w-0 flex-1 truncate text-sm">{c}</span>
                {canEdit ? (
                  <Select value={t ?? NO_TYPE} onValueChange={(v) => apply([c], v)}>
                    <SelectTrigger className={cn("h-8 w-44 text-xs sm:w-52", !t && "text-muted-foreground")}><SelectValue /></SelectTrigger>
                    <SelectContent>{typeOptions}</SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground">{t ?? "—"}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={newTypeFor != null} onOpenChange={(o) => !o && setNewTypeFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New type</DialogTitle>
            <DialogDescription>For {newTypeFor?.length ?? 0} categor{newTypeFor?.length === 1 ? "y" : "ies"}.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="PTZ camera" onKeyDown={(e) => { if (e.key === "Enter" && newType.trim() && newTypeFor) { setMut.mutate({ cats: newTypeFor, type: newType.trim() }); setNewTypeFor(null); } }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTypeFor(null)}>Cancel</Button>
            <Button disabled={!newType.trim()} onClick={() => { if (newTypeFor) setMut.mutate({ cats: newTypeFor, type: newType.trim() }); setNewTypeFor(null); }}>Set type</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
