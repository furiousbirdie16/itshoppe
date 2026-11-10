import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Archive, ArchiveRestore, FileSpreadsheet, Plus, Trash2, Upload } from "lucide-react";
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
import { PriceListSearch, usePriceListData } from "@/components/PriceListSearch";
import { describeMarkup, priceLabel, readPriceListFile, type MarkupType, type ParsedPriceList, type PriceGroup } from "@/lib/price-list";
import {
  assignCategories,
  deletePriceGroup,
  deletePriceList,
  ensureDefaultGroup,
  getPriceListCategories,
  isMultiPrice,
  savePriceGroup,
  savePriceList,
  setPriceListActive,
  PRICE_GROUP_CATEGORIES_KEY,
  PRICE_GROUPS_KEY,
  PRICE_LISTS_KEY,
  type PriceList,
} from "@/lib/price-list-api";

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
          <TabsTrigger value="groups">Price groups</TabsTrigger>
          {isAdmin && <TabsTrigger value="lists">Uploads</TabsTrigger>}
        </TabsList>
        <TabsContent value="search" className="mt-4">
          <PriceListSearch />
        </TabsContent>
        <TabsContent value="groups" className="mt-4">
          <PriceGroupsPanel canEdit={isAdmin} />
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
          onSaved={(unsorted) => {
            if (unsorted > 0) {
              setTab("groups");
              toast.info(`${unsorted} categor${unsorted === 1 ? "y is" : "ies are"} not in a price group yet. They use "Everything else" until you sort them.`);
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
  const { lists, links } = usePriceListData();
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
      if (!name) setName(file.name.replace(/\.xlsx?$/i, "").trim());
    } catch (e) {
      toast.error(`Couldn't read that file. ${e instanceof Error ? e.message : ""}`.trim());
    } finally {
      setReading(false);
    }
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error("Choose a file first");
      if (!brand.trim()) throw new Error("Enter the brand");
      if (!name.trim()) throw new Error("Enter a name for this list");
      // Taken before saving, so the new list is never among them.
      const toArchive = replace ? current : [];
      const list = await savePriceList(
        { brand, name, fileName, rows: parsed.rows, priceColumns: parsed.priceColumns },
        (saved, total) => setProgress({ saved, total }),
      );
      // Markup groups are for one-price SDP lists; a list with its own
      // selling prices (TP-Link's SRP) needs none.
      if (parsed.priceColumns.length === 0) await ensureDefaultGroup(brand);
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
      return { list, archived: toArchive, archiveFailed };
    },
    onSuccess: ({ archived, archiveFailed }) => {
      qc.invalidateQueries({ queryKey: PRICE_LISTS_KEY });
      qc.invalidateQueries({ queryKey: PRICE_GROUPS_KEY });
      qc.invalidateQueries({ queryKey: ["price-list-search"] });
      const sorted = new Set(links.filter((l) => sameBrand(l.brand, brand)).map((l) => l.category.trim().toLowerCase()));
      const unsorted = parsed?.priceColumns.length
        ? 0
        : (parsed?.categories ?? []).filter((c) => !sorted.has(c.trim().toLowerCase())).length;
      toast.success(
        `Saved ${parsed?.rows.length.toLocaleString()} models` +
          (archived.length > 0 ? `. Archived ${archived.map((l) => `"${l.name}"`).join(", ")}.` : ""),
      );
      if (archiveFailed) toast.error("The old list couldn't be archived. Archive it from the Uploads tab.");
      onOpenChange(false);
      onSaved(unsorted);
    },
    onError: (e: Error) => {
      setProgress(null);
      toast.error(e.message || "Couldn't save the price list");
    },
  });

  const saving = saveMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload price list</DialogTitle>
          <DialogDescription>Each sheet of the Excel file becomes a category. Nothing is added to inventory.</DialogDescription>
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

          {parsed && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Models found" value={parsed.rows.length.toLocaleString()} />
                <Stat label="Categories" value={String(parsed.categories.length)} />
                <Stat label="Sheets skipped" value={String(parsed.skipped.length)} />
              </div>
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
          <Button onClick={() => saveMut.mutate()} disabled={saving || !parsed || parsed.rows.length === 0}>
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
// Price groups
// ---------------------------------------------------------------------------

const DEFAULT = "__default__";

function PriceGroupsPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { lists: allLists, groups, links } = usePriceListData();
  // Only one-price SDP lists are priced through markup groups.
  const lists = useMemo(() => allLists.filter((l) => !isMultiPrice(l)), [allLists]);
  const brands = useMemo(() => [...new Set(lists.map((l) => l.brand.trim()))], [lists]);
  const [brand, setBrand] = useState("");
  useEffect(() => {
    if (!brand && brands.length > 0) setBrand(brands[0]);
  }, [brands, brand]);

  // Sheets come from the brand's newest list.
  const latest = lists.find((l) => sameBrand(l.brand, brand) && l.is_active) ?? lists.find((l) => sameBrand(l.brand, brand));
  const { data: categories = [] } = useQuery({
    queryKey: ["price-list-categories", latest?.id],
    queryFn: () => getPriceListCategories(latest!.id),
    enabled: !!latest,
    staleTime: 5 * 60_000,
  });

  const brandGroups = useMemo(
    () => groups.filter((g) => sameBrand(g.brand, brand)).sort((a, b) => Number(a.is_default) - Number(b.is_default) || a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [groups, brand],
  );
  const groupOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of links) if (sameBrand(l.brand, brand)) m.set(l.category.trim().toLowerCase(), l.group_id);
    return (c: string) => m.get(c.trim().toLowerCase()) ?? null;
  }, [links, brand]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: PRICE_GROUPS_KEY });
    qc.invalidateQueries({ queryKey: PRICE_GROUP_CATEGORIES_KEY });
  };

  const [editing, setEditing] = useState<Partial<PriceGroup> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [brand]);

  const assignMut = useMutation({
    mutationFn: ({ cats, groupId }: { cats: string[]; groupId: string | null }) => assignCategories(brand, cats, groupId),
    onSuccess: () => { refresh(); setSelected(new Set()); },
    onError: (e: Error) => toast.error(e.message || "Couldn't move the categories"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePriceGroup(id),
    onSuccess: () => { refresh(); toast.success("Group deleted. Its categories use \"Everything else\" now."); },
    onError: (e: Error) => toast.error(e.message || "Couldn't delete the group"),
  });

  if (brands.length === 0) {
    return <p className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">Upload a price list first, then sort its categories into price groups here.</p>;
  }

  const unsorted = categories.filter((c) => !groupOf(c));
  const fallback = brandGroups.find((g) => g.is_default);
  const toggle = (c: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(c); else n.delete(c); return n; });

  return (
    <div className="space-y-4">
      {brands.length > 1 && (
        <Select value={brand} onValueChange={setBrand}>
          <SelectTrigger className="h-9 w-56 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
        </Select>
      )}

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Price groups · {brand}</p>
          {canEdit && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setEditing({ brand, markup_type: "amount", markup_value: 0, name: "" })}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add group
            </Button>
          )}
        </div>
        <div className="divide-y">
          {brandGroups.map((g) => {
            const count = g.is_default ? unsorted.length : categories.filter((c) => groupOf(c) === g.id).length;
            return (
              <div key={g.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{g.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {g.is_default ? `Any category not in another group · ${count} now` : `${count} categor${count === 1 ? "y" : "ies"}`}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{describeMarkup(g.markup_type, Number(g.markup_value))}</span>
                {canEdit && (
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setEditing(g)}>Edit</Button>
                    {!g.is_default && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete ${g.name}`} onClick={() => { if (confirm(`Delete "${g.name}"? Its categories will use "Everything else".`)) deleteMut.mutate(g.id); }}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Prices round up to the next ₱10. Changing a markup reprices every model in the group straight away; quotations already saved keep their prices.</p>
      </div>

      {unsorted.length > 0 && fallback && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />
          {unsorted.length} categor{unsorted.length === 1 ? "y is" : "ies are"} not in a group and use {describeMarkup(fallback.markup_type, Number(fallback.markup_value))}.
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <p className="mr-auto text-sm font-medium">Categories {latest && <span className="font-normal text-muted-foreground">· from {latest.name}</span>}</p>
          {canEdit && selected.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">{selected.size} selected → </span>
              <Select onValueChange={(v) => assignMut.mutate({ cats: [...selected], groupId: v === DEFAULT ? null : v })}>
                <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Put in group…" /></SelectTrigger>
                <SelectContent>
                  {brandGroups.map((g) => <SelectItem key={g.id} value={g.is_default ? DEFAULT : g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
        <div className="divide-y">
          {categories.map((c) => {
            const gid = groupOf(c);
            return (
              <div key={c} className="flex items-center gap-3 px-3 py-1.5">
                {canEdit && <Checkbox checked={selected.has(c)} onCheckedChange={(v) => toggle(c, !!v)} aria-label={`Select ${c}`} />}
                <span className="min-w-0 flex-1 truncate text-sm">{c}</span>
                {canEdit ? (
                  <Select value={gid ?? DEFAULT} onValueChange={(v) => assignMut.mutate({ cats: [c], groupId: v === DEFAULT ? null : v })}>
                    <SelectTrigger className="h-8 w-44 text-xs sm:w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {brandGroups.map((g) => <SelectItem key={g.id} value={g.is_default ? DEFAULT : g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground">{brandGroups.find((g) => g.id === gid)?.name ?? fallback?.name ?? "—"}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {editing && <GroupDialog group={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function GroupDialog({ group, onClose, onSaved }: { group: Partial<PriceGroup>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group.name ?? "");
  const [type, setType] = useState<MarkupType>(group.markup_type ?? "amount");
  const [value, setValue] = useState(String(group.markup_value ?? ""));
  const mut = useMutation({
    mutationFn: () => {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0) throw new Error("Enter a markup of 0 or more");
      return savePriceGroup({ id: group.id, brand: group.brand!, name, markup_type: type, markup_value: v });
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message || "Couldn't save the group"),
  });
  const example = Number(value) >= 0 ? describeMarkup(type, Number(value) || 0) : "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{group.id ? "Edit price group" : "Add price group"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CCTV cameras" disabled={group.is_default} autoFocus={!group.id} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Markup</Label>
              <Select value={type} onValueChange={(v) => setType(v as MarkupType)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount">Fixed amount (₱)</SelectItem>
                  <SelectItem value="percent">Percent (%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{type === "percent" ? "Percent" : "Amount"}</Label>
              <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} className="numeric-field" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Selling price = {example}, rounded up to the next ₱10.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>{mut.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
