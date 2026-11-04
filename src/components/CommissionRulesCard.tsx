import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { getCashAccounts } from "@/lib/api";
import { ALL_CODES, CATEGORY_CODES, CODE_LABELS, categoryKey, monthKey, type CommissionCode } from "@/lib/commission";
import {
  addCommissionCategory, deleteCommissionCategory, getCommissionAgents, getCommissionCategories,
  getCommissionRates, getLoginOptions, rateOn, setCommissionRate, updateCommissionAgent,
} from "@/lib/commission-api";

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Settings card: commission rates, the categories that fix a code, and who earns it. */
export function CommissionRulesCard() {
  const qc = useQueryClient();
  const { data: rates = [] } = useQuery({ queryKey: ["commission-rates"], queryFn: getCommissionRates });
  const { data: categories = [] } = useQuery({ queryKey: ["commission-categories"], queryFn: getCommissionCategories });
  const { data: agents = [] } = useQuery({ queryKey: ["commission-agents"], queryFn: getCommissionAgents });
  const { data: logins = [] } = useQuery({ queryKey: ["admin-users"], queryFn: getLoginOptions });
  const { data: accounts = [] } = useQuery({ queryKey: ["cash-accounts"], queryFn: getCashAccounts });
  // Every category in use, so a code is given to one that exists, spelled as it is.
  const { data: itemCategories = [] } = useQuery({
    queryKey: ["item-categories"],
    queryFn: async () => {
      const rows = await fetchAllRows<{ category: string | null }>(() =>
        (supabase as any).from("items").select("category").not("category", "is", null).order("id"));
      const seen = new Map<string, string>();
      rows.forEach((r) => { const c = (r.category || "").trim(); if (c && !seen.has(categoryKey(c))) seen.set(categoryKey(c), c); });
      return [...seen.values()].sort((a, b) => a.localeCompare(b));
    },
  });

  const today = todayKey();
  const [rateEdits, setRateEdits] = useState<Partial<Record<CommissionCode, string>>>({});
  const [rateFrom, setRateFrom] = useState(monthKey(new Date()));
  const [newCategory, setNewCategory] = useState("");
  const [newCode, setNewCode] = useState<CommissionCode>("B");

  const pettyCash = useMemo(() => (accounts as any[]).filter((a) => a.account_type === "petty_cash"), [accounts]);
  const taken = useMemo(() => new Set(categories.map((c) => categoryKey(c.category))), [categories]);

  const refresh = (key: string) => qc.invalidateQueries({ queryKey: [key] });

  const saveRates = async () => {
    const changed = Object.entries(rateEdits).filter(([code, v]) => {
      const cur = rateOn(rates, code as CommissionCode, rateFrom);
      return v !== undefined && v.trim() !== "" && Number(v) !== cur?.rate;
    });
    if (!changed.length) { toast.info("No rate changed"); return; }
    for (const [, v] of changed) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) { toast.error("A rate is a percentage from 0 to 100"); return; }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rateFrom)) { toast.error("Pick the day the new rates start"); return; }
    try {
      for (const [code, v] of changed) await setCommissionRate(code as CommissionCode, Number(v), rateFrom);
      setRateEdits({});
      await refresh("commission-rates");
      toast.success(`New rates from ${rateFrom}. Earlier sales keep the old rates.`);
    } catch (e: any) {
      toast.error(e?.message || "Could not save the rates");
    }
  };

  const addCategory = async () => {
    const c = newCategory.trim();
    if (!c) return;
    if (taken.has(categoryKey(c))) { toast.error(`"${c}" already has a code`); return; }
    try {
      await addCommissionCategory(c, newCode);
      setNewCategory("");
      await refresh("commission-categories");
      const used = itemCategories.some((x) => categoryKey(x) === categoryKey(c));
      if (used) toast.success(`${c} now counts as ${newCode}`);
      else toast.warning(`${c} counts as ${newCode}, but no item has this category yet`);
    } catch (e: any) {
      toast.error(e?.message || "Could not add the category");
    }
  };

  const removeCategory = async (id: string) => {
    try { await deleteCommissionCategory(id); await refresh("commission-categories"); }
    catch (e: any) { toast.error(e?.message || "Could not remove the category"); }
  };

  const setAgent = async (id: string, patch: Parameters<typeof updateCommissionAgent>[1]) => {
    try {
      await updateCommissionAgent(id, patch);
      await refresh("commission-agents");
      qc.invalidateQueries({ queryKey: ["sales_agents"] });
    } catch (e: any) {
      toast.error(e?.message || "Could not save the agent");
    }
  };

  return (
    <div className="rounded-lg border bg-card p-5 space-y-6 md:col-span-2">
      <div className="flex items-center gap-2">
        <BadgePercent className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Agent commission</h3>
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        An item's category decides first (B, O, TP). Every other item is coded by its price against the dealer price:
        below DP2 (DP − 5%) is BD2, below DP is BD1, DP or above is N. A sale counts in the month it was paid.
      </p>

      {/* Rates */}
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rates</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {ALL_CODES.map((code) => {
            const cur = rateOn(rates, code, today);
            const upcoming = rates.filter((r) => r.code === code && r.effective_from > today)
              .sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1))[0];
            return (
              <div key={code} className="rounded-md border p-2.5 space-y-1.5">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-sm font-semibold">{code}</span>
                  <span className="truncate text-[10px] text-muted-foreground" title={CODE_LABELS[code]}>{CODE_LABELS[code]}</span>
                </div>
                <div className="relative">
                  <Input
                    type="number" min={0} max={100} step="0.1"
                    value={rateEdits[code] ?? (cur ? String(cur.rate) : "")}
                    onChange={(e) => setRateEdits((p) => ({ ...p, [code]: e.target.value }))}
                    className="h-8 pr-6 text-sm tabular-nums"
                    placeholder="—"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {cur ? (cur.effective_from <= "2000-01-01" ? "From the start" : `Since ${cur.effective_from}`) : "No rate"}
                  {upcoming ? ` · ${upcoming.rate}% from ${upcoming.effective_from}` : ""}
                </p>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Changed rates start on</Label>
            <Input type="date" value={rateFrom} onChange={(e) => setRateFrom(e.target.value)} className="h-8 w-44 text-sm" />
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={saveRates} disabled={!Object.keys(rateEdits).length}>
            <Save className="h-3 w-3 mr-1.5" /> Save rates
          </Button>
          <p className="basis-full text-[11px] text-muted-foreground">Sales paid before that day keep the rate they had.</p>
        </div>
      </section>

      {/* Categories */}
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Categories that set the code</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          {CATEGORY_CODES.map((code) => {
            const list = categories.filter((c) => c.code === code);
            return (
              <div key={code} className="rounded-md border p-2.5 space-y-2">
                <div className="text-sm"><span className="font-semibold">{code}</span> <span className="text-xs text-muted-foreground">{CODE_LABELS[code]}</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {list.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                  {list.map((c) => {
                    const used = itemCategories.some((x) => categoryKey(x) === categoryKey(c.category));
                    return (
                      <span key={c.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${used ? "" : "border-amber-500/60 text-amber-700 dark:text-amber-400"}`} title={used ? undefined : "No item has this category yet"}>
                        {c.category}
                        <button type="button" onClick={() => removeCategory(c.id)} className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${c.category}`}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1 min-w-0 flex-1 sm:flex-none sm:w-56">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} list="commission-cat-list" className="h-8 text-sm" placeholder="Pick or type a category" />
            <datalist id="commission-cat-list">
              {itemCategories.filter((c) => !taken.has(categoryKey(c))).map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Counts as</Label>
            <Select value={newCode} onValueChange={(v) => setNewCode(v as CommissionCode)}>
              <SelectTrigger className="h-8 w-24 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORY_CODES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={addCategory} disabled={!newCategory.trim()}>
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
          <p className="basis-full text-[11px] text-muted-foreground">Matched to the item's Category ignoring capitals and spaces at the ends.</p>
        </div>
      </section>

      {/* Agents */}
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sales agents</h4>
        {agents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sales agents yet. They are added from the invoice form.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {agents.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={a.earns_commission} onCheckedChange={(v) => setAgent(a.id, { earns_commission: v })} />
                  Earns commission
                </label>
                <Select
                  value={a.petty_cash_account_id ?? "none"}
                  onValueChange={(v) => setAgent(a.id, { petty_cash_account_id: v === "none" ? null : v })}
                >
                  <SelectTrigger className="h-8 w-full text-xs sm:w-52"><SelectValue placeholder="Own petty cash" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No petty cash of their own</SelectItem>
                    {pettyCash.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={a.user_id ?? "none"}
                  onValueChange={(v) => setAgent(a.id, { user_id: v === "none" ? null : v })}
                >
                  <SelectTrigger className="h-8 w-full text-xs sm:w-56"><SelectValue placeholder="Their login" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No login</SelectItem>
                    {logins
                      .filter((l) => l.id === a.user_id || !agents.some((x) => x.user_id === l.id))
                      .map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.display_name && l.display_name !== l.email ? `${l.display_name} · ${l.email}` : l.email}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          An agent's petty cash is picked first when their invoice is marked paid, and the Commission page flags cash paid into anyone else's.
          With their login set, an agent can open the Commission page and see their own sales and commission, and no one else's.
        </p>
      </section>
    </div>
  );
}
