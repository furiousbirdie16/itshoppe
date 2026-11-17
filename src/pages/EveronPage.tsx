import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Send, Trash2, Pencil, HandCoins, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { getCashAccounts, createCashTransaction, deleteCashTransaction } from "@/lib/api";
import { isForeign } from "@/lib/fx";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { CashTransaction } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateField } from "@/components/DateField";
import { StatCard } from "@/components/StatCard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Recorded by the Everon link when an Everon invoice is marked paid. */
export const EVERON_PAYMENT = "Everon payment";
/** Money sent to Everon. Any outflow with this category counts, wherever it was recorded. */
export const EVERON_REMITTANCE = "Remittance to Everon";

/** remitted_by, on an Everon payment: the remittance that sent it to Everon. */
type Row = CashTransaction & { cash_accounts?: { name: string }; remitted_by?: string | null };

const getEveronLedger = () =>
  fetchAllRows<Row>(() =>
    db.from("cash_transactions")
      .select("*, cash_accounts(name)")
      .in("category", [EVERON_PAYMENT, EVERON_REMITTANCE])
      .order("txn_date", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id"),
  );

const getOpeningOwed = async (): Promise<number> => {
  const { data } = await db.from("app_settings").select("value").eq("key", "everon_opening_owed").maybeSingle();
  return Number(data?.value?.amount || 0);
};

const isPayment = (t: Row) => t.direction === "in" && t.category === EVERON_PAYMENT;
const isRemittance = (t: Row) => t.direction === "out" && t.category === EVERON_REMITTANCE;
const formatDate = (d: string) => format(new Date(`${d}T00:00:00`), "MMM d, yyyy");

/**
 * Everon's customers pay into IT Shoppe's accounts, so IT Shoppe owes Everon
 * the full amount until it is sent over. This page is that running tab: what
 * came in, what was remitted, and what is still owed. The same figure is kept
 * as one payable (by the database), so the Dashboard counts it as owed.
 */
export default function EveronPage() {
  const qc = useQueryClient();
  const { data: ledger = [], isLoading } = useQuery({ queryKey: ["everon", "ledger"], queryFn: getEveronLedger });
  const { data: opening = 0 } = useQuery({ queryKey: ["everon", "opening"], queryFn: getOpeningOwed });
  const { data: accounts = [] } = useQuery({ queryKey: ["cash-accounts"], queryFn: getCashAccounts });
  const payFrom = useMemo(
    // Banks first: remittances usually go out by transfer.
    () => accounts
      .filter((a) => a.is_active && (a.account_type === "bank" || a.account_type === "petty_cash") && !isForeign(a))
      .sort((a, b) => (a.account_type === "bank" ? 0 : 1) - (b.account_type === "bank" ? 0 : 1)),
    [accounts],
  );

  const rows = useMemo(() => ledger.filter((t) => isPayment(t) || isRemittance(t)), [ledger]);
  const { owed, paidIn, remitted, withBalance } = useMemo(() => {
    let bal = opening;
    let inSum = 0;
    let outSum = 0;
    const out = rows.map((t) => {
      const amt = Number(t.amount || 0);
      if (isPayment(t)) { bal += amt; inSum += amt; } else { bal -= amt; outSum += amt; }
      return { t, balance: Math.round(bal * 100) / 100 };
    });
    return { owed: Math.round(bal * 100) / 100, paidIn: inSum, remitted: outSum, withBalance: out.reverse() };
  }, [rows, opening]);

  // Payments not yet sent to Everon, oldest first, and what each remittance covered.
  const unremitted = useMemo(() => rows.filter((t) => isPayment(t) && !t.remitted_by), [rows]);
  const byId = useMemo(() => new Map(rows.map((t) => [t.id, t])), [rows]);
  const covered = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const t of rows) if (isPayment(t) && t.remitted_by) m.set(t.remitted_by, [...(m.get(t.remitted_by) || []), t]);
    return m;
  }, [rows]);
  const sumOf = (ids: Set<string>) =>
    Math.round(unremitted.filter((t) => ids.has(t.id)).reduce((s, t) => s + Number(t.amount || 0), 0) * 100) / 100;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["everon"] });
    qc.invalidateQueries({ queryKey: ["cash-transactions"] });
    qc.invalidateQueries({ queryKey: ["cash-accounts"] });
    qc.invalidateQueries({ queryKey: ["payables"] });
  };

  // Remit
  const [remitOpen, setRemitOpen] = useState(false);
  const [form, setForm] = useState({ account_id: "", amount: "", txn_date: "", reference: "", notes: "", ids: new Set<string>() });
  const setIds = (ids: Set<string>) => setForm((f) => ({ ...f, ids, amount: ids.size ? String(sumOf(ids)) : f.amount }));
  const toggleId = (id: string) => {
    const next = new Set(form.ids);
    if (next.has(id)) next.delete(id); else next.add(id);
    setIds(next);
  };
  const openRemit = (only?: string) => {
    const ids = new Set(only ? [only] : unremitted.map((t) => t.id));
    setForm({
      account_id: payFrom[0]?.id || "",
      ids,
      amount: ids.size ? String(sumOf(ids)) : owed > 0 ? String(owed) : "",
      txn_date: format(new Date(), "yyyy-MM-dd"),
      reference: "",
      notes: "",
    });
    setRemitOpen(true);
  };
  const remitMut = useMutation({
    mutationFn: async () => {
      const amount = Math.round(Number(form.amount) * 100) / 100;
      if (!form.account_id) throw new Error("Pick the account it was paid from");
      if (!(amount > 0)) throw new Error("Enter an amount more than 0");
      const ids = [...form.ids];
      const created = await createCashTransaction({
        account_id: form.account_id,
        txn_date: form.txn_date || format(new Date(), "yyyy-MM-dd"),
        direction: "out",
        amount,
        fx_rate: null,
        category: EVERON_REMITTANCE,
        payee: "Everon",
        reference: form.reference.trim(),
        notes: form.notes.trim(),
      });
      if (ids.length) {
        const { error } = await db.from("cash_transactions")
          .update({ remitted_by: created.id })
          .in("id", ids)
          .is("remitted_by", null);
        if (error) throw new Error(`Remittance saved, but the invoices could not be ticked off: ${error.message}`);
      }
    },
    onSuccess: () => { invalidate(); setRemitOpen(false); toast.success("Remittance recorded"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCashTransaction(id),
    onSuccess: () => { invalidate(); toast.success("Remittance deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Starting balance: owed before the link went live.
  const [openingOpen, setOpeningOpen] = useState(false);
  const [openingVal, setOpeningVal] = useState("");
  const openingMut = useMutation({
    mutationFn: async () => {
      const n = Number(openingVal || 0);
      if (!Number.isFinite(n)) throw new Error("Enter a number");
      const { error } = await db.rpc("everon_set_opening_owed", { p_amount: n });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setOpeningOpen(false); toast.success("Starting balance saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Everon</h1>
          <p className="page-description">Everon payments received into IT Shoppe accounts, and what has been sent back</p>
        </div>
        <div className="toolbar-actions">
          <Button onClick={() => openRemit()} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Send className="h-4 w-4 mr-1.5" /> Remit to Everon
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Owed to Everon"
          value={peso(owed)}
          icon={HandCoins}
          tone={owed > 0 ? "liability" : undefined}
          description={owed < 0 ? "Remitted more than received" : "Counted on the Dashboard as owed"}
        />
        <StatCard title="Received for Everon" value={peso(paidIn)} icon={ArrowDownLeft} description="Everon invoices paid" />
        <StatCard title="Remitted" value={peso(remitted)} icon={ArrowUpRight} description="Sent to Everon" />
        <StatCard
          title="Starting balance"
          value={peso(opening)}
          icon={Pencil}
          description="Owed before the link · click to change"
          onClick={() => { setOpeningVal(opening ? String(opening) : ""); setOpeningOpen(true); }}
        />
      </div>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">What</TableHead>
              <TableHead className="text-xs">Account</TableHead>
              <TableHead className="text-xs text-right">In</TableHead>
              <TableHead className="text-xs text-right">Remitted</TableHead>
              <TableHead className="text-xs text-right">Owed after</TableHead>
              <TableHead className="text-xs">Remitted?</TableHead>
              <TableHead className="text-xs w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : withBalance.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">No Everon payments or remittances yet</TableCell></TableRow>
            ) : withBalance.map(({ t, balance }) => {
              const pay = isPayment(t);
              return (
                <TableRow key={t.id} className="hover:bg-muted/30">
                  <TableCell className="text-sm whitespace-nowrap">{formatDate(t.txn_date)}</TableCell>
                  <TableCell className="text-sm">
                    {pay ? (
                      <>
                        <span className="font-medium">{t.reference || "Everon payment"}</span>
                        {t.payee && <span className="ml-2 text-xs text-muted-foreground">{t.payee}</span>}
                      </>
                    ) : (
                      <>
                        <span className="font-medium">Remittance</span>
                        {(t.reference || t.notes) && <span className="ml-2 text-xs text-muted-foreground">{[t.reference, t.notes].filter(Boolean).join(" · ")}</span>}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.cash_accounts?.name || "—"}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums text-success">{pay ? peso(Number(t.amount)) : ""}</TableCell>
                  <TableCell className="text-sm text-right tabular-nums">{pay ? "" : peso(Number(t.amount))}</TableCell>
                  <TableCell className={cn("text-sm text-right tabular-nums font-medium", balance < 0 && "text-destructive")}>{peso(balance)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {pay ? (
                      t.remitted_by ? (
                        <span className="text-success">Yes · {byId.get(t.remitted_by) ? formatDate(byId.get(t.remitted_by)!.txn_date) : ""}</span>
                      ) : (
                        <button type="button" className="text-warning underline underline-offset-2" onClick={() => openRemit(t.id)}>Not yet · remit</button>
                      )
                    ) : (
                      <span className="text-muted-foreground">
                        {covered.get(t.id)?.length
                          ? `Covers ${covered.get(t.id)!.map((c) => (c.reference || "").replace(/^Everon\s+/, "") || "invoice").join(", ")}`
                          : "No invoices ticked"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!pay && (
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 rounded-md" title="Delete remittance"
                        onClick={() => { if (confirm(`Delete this ${peso(Number(t.amount))} remittance? The money goes back into ${t.cash_accounts?.name || "the account"}${covered.get(t.id)?.length ? ` and its ${covered.get(t.id)!.length} invoice(s) go back to not remitted` : ""}.`)) deleteMut.mutate(t.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Everon payments appear here when an invoice is marked paid in Everon, and leave when it is unmarked. Any money out recorded with the category "{EVERON_REMITTANCE}", on the Bank or Cash page too, counts as a remittance.
      </p>

      <Dialog open={remitOpen} onOpenChange={setRemitOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Remit to Everon</DialogTitle></DialogHeader>
          {/* min-w-0: the dialog is a grid, and without it a long invoice line
              widens the whole dialog past the screen instead of shortening. */}
          <div className="space-y-3 min-w-0">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Invoices this covers</Label>
                {unremitted.length > 0 && (
                  <button
                    type="button"
                    className="text-xs text-primary underline underline-offset-2"
                    onClick={() => setIds(form.ids.size === unremitted.length ? new Set() : new Set(unremitted.map((t) => t.id)))}
                  >
                    {form.ids.size === unremitted.length ? "Untick all" : "Tick all"}
                  </button>
                )}
              </div>
              {unremitted.length === 0 ? (
                <p className="text-xs text-muted-foreground">Every Everon payment has been remitted already.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
                  {unremitted.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 px-2.5 py-2 text-sm cursor-pointer hover:bg-muted/40">
                      <Checkbox checked={form.ids.has(t.id)} onCheckedChange={() => toggleId(t.id)} />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-medium">{(t.reference || "Everon payment").replace(/^Everon\s+/, "")}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[t.payee, formatDate(t.txn_date)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-sm">{peso(Number(t.amount))}</span>
                    </label>
                  ))}
                </div>
              )}
              {form.ids.size > 0 && (
                <p className="text-xs text-muted-foreground">{form.ids.size} ticked · {peso(sumOf(form.ids))}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Paid from</Label>
              <Select value={form.account_id} onValueChange={(v) => setForm((f) => ({ ...f, account_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
                <SelectContent>
                  {payFrom.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" inputMode="decimal" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <DateField value={form.txn_date} onChange={(v) => setForm((f) => ({ ...f, txn_date: v }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reference <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={form.reference} placeholder="Transfer no." onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <p className="text-xs text-muted-foreground">
              Owed now {peso(owed)}. This records money out of the account and lowers what is owed by the same.
              {form.ids.size > 0 && Math.abs(Number(form.amount || 0) - sumOf(form.ids)) > 0.004 && (
                <span className="block text-warning mt-1">The amount differs from the ticked invoices ({peso(sumOf(form.ids))}).</span>
              )}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemitOpen(false)}>Cancel</Button>
            <Button onClick={() => remitMut.mutate()} disabled={remitMut.isPending}>Record remittance</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openingOpen} onOpenChange={setOpeningOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Starting balance</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">What IT Shoppe already owed Everon before the link started recording payments. Leave 0 if everything before was already settled.</p>
            <Input type="number" inputMode="decimal" step="0.01" value={openingVal} onChange={(e) => setOpeningVal(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpeningOpen(false)}>Cancel</Button>
            <Button onClick={() => openingMut.mutate()} disabled={openingMut.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
