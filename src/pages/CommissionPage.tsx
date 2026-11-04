import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronRight, Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import InvoiceDetailsDialog from "@/components/InvoiceDetailsDialog";
import { useAuth } from "@/contexts/AuthContext";
import { peso } from "@/lib/currency";
import { docNo } from "@/lib/doc-number";
import { CODE_LABELS, PROBLEM_LABELS, agentMonthStats, monthKey, productBreakdown, round2, summarizeByCode, type CommissionCode } from "@/lib/commission";
import {
  addCommissionAdjustment, closeCommissionMonth, deleteCommissionAdjustment, getCommissionAdjustments,
  getCommissionAgents, getCommissionClosing, getMyCommissionAgent, getCommissionLines, getUnassignedInvoices, reopenCommissionMonth,
  type CommissionLine,
} from "@/lib/commission-api";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
const fmtRate = (r: number) => `${r}%`;
const qtyFmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Lines with something to look at, grouped by what is wrong. */
function groupProblems(lines: CommissionLine[]) {
  const groups = new Map<string, CommissionLine[]>();
  for (const l of lines) for (const p of l.problems) {
    const list = groups.get(p) ?? [];
    list.push(l);
    groups.set(p, list);
  }
  return groups;
}

export default function CommissionPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(monthKey(new Date()));
  const [agentId, setAgentId] = useState("");
  const [openCode, setOpenCode] = useState<CommissionCode | "uncounted" | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [adjLabel, setAdjLabel] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjKind, setAdjKind] = useState<"deduct" | "add">("deduct");
  const [confirm, setConfirm] = useState<"close" | "reopen" | null>(null);
  const [busy, setBusy] = useState(false);

  const { role, user } = useAuth();
  const isAdmin = role === "admin";

  // An admin picks any agent who earns commission. Anyone else sees only the
  // agent their login is tied to (the database refuses anyone else's).
  const { data: agents = [] } = useQuery({ queryKey: ["commission-agents"], queryFn: getCommissionAgents, enabled: isAdmin });
  const { data: me, isPending: mePending } = useQuery({
    queryKey: ["my-commission-agent", user?.id],
    queryFn: () => getMyCommissionAgent(user!.id),
    enabled: !isAdmin && !!user,
  });
  const earners = useMemo(() => agents.filter((a) => a.earns_commission), [agents]);
  useEffect(() => {
    if (isAdmin && !agentId && earners.length) setAgentId(earners[0].id);
    if (!isAdmin && me && agentId !== me.id) setAgentId(me.id);
  }, [isAdmin, earners, agentId, me]);
  const agent = isAdmin ? agents.find((a) => a.id === agentId) : me ?? undefined;

  const enabled = !!agentId;
  const { data: liveLines = [], isPending: linesPending, error: linesError } = useQuery({
    queryKey: ["commission-lines", agentId, month],
    queryFn: () => getCommissionLines(agentId, month),
    enabled,
  });
  const { data: adjustments = [] } = useQuery({
    queryKey: ["commission-adjustments", agentId, month],
    queryFn: () => getCommissionAdjustments(agentId, month),
    enabled,
  });
  const { data: closing } = useQuery({
    queryKey: ["commission-closing", agentId, month],
    queryFn: () => getCommissionClosing(agentId, month),
    enabled,
  });
  const { data: unassigned = [] } = useQuery({
    queryKey: ["commission-unassigned", month],
    queryFn: () => getUnassignedInvoices(month),
    enabled: isAdmin,
  });

  // A closed month shows what was saved, not today's figures.
  const lines = closing ? closing.lines : liveLines;
  const adjLines = closing ? closing.adjustment_lines : adjustments;
  const summary = useMemo(() => summarizeByCode(lines), [lines]);
  const adjTotal = round2(adjLines.reduce((t, a) => t + a.amount, 0));
  const total = round2(summary.commission + adjTotal);
  const problems = useMemo(() => groupProblems(lines), [lines]);
  const stats = useMemo(() => agentMonthStats(lines), [lines]);
  const invoiceCount = stats.orders;
  const products = useMemo(() => productBreakdown(lines), [lines]);

  // Closed, but the invoices no longer say the same: worth knowing before paying.
  const liveSummary = useMemo(() => summarizeByCode(liveLines), [liveLines]);
  const drifted = !!closing && !linesPending && Math.abs(liveSummary.commission - closing.commission) >= 0.005;

  const shownLines = openCode === "uncounted"
    ? lines.filter((l) => !l.code || l.rate == null)
    : openCode ? lines.filter((l) => l.code === openCode) : [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["commission-lines", agentId, month] });
    qc.invalidateQueries({ queryKey: ["commission-adjustments", agentId, month] });
    qc.invalidateQueries({ queryKey: ["commission-closing", agentId, month] });
  };

  const addAdjustment = async () => {
    const n = Number(adjAmount);
    if (!adjLabel.trim()) { toast.error("Say what it is for, e.g. Jason ticket 2x"); return; }
    if (!Number.isFinite(n) || n <= 0) { toast.error("Enter an amount above zero"); return; }
    try {
      await addCommissionAdjustment(agentId, month, adjLabel, adjKind === "deduct" ? -n : n);
      setAdjLabel(""); setAdjAmount("");
      refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not add it");
    }
  };

  const removeAdjustment = async (id: string) => {
    try { await deleteCommissionAdjustment(id); refresh(); }
    catch (e: any) { toast.error(e?.message || "Could not remove it"); }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === "close") {
        await closeCommissionMonth(agentId, month);
        toast.success(`${monthLabel(month)} closed for ${agent?.name}`);
      } else {
        await reopenCommissionMonth(agentId, month);
        toast.success(`${monthLabel(month)} reopened. It is worked out from the invoices again.`);
      }
      refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not do that");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const problemCount = [...problems.values()].reduce((t, l) => t + l.length, 0) + unassigned.length;
  const avgOrder = stats.orders ? stats.sales / stats.orders : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Commission</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin ? "Worked out from the invoices each agent was paid for in the month." : "Your sales and commission, from the invoices paid in the month."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Month</Label>
            <Input
              type="month"
              value={month.slice(0, 7)}
              onChange={(e) => { if (e.target.value) { setMonth(`${e.target.value}-01`); setOpenCode(null); } }}
              className="h-9 w-40"
            />
          </div>
          {isAdmin && <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Agent</Label>
            <Select value={agentId} onValueChange={(v) => { setAgentId(v); setOpenCode(null); }}>
              <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Pick an agent" /></SelectTrigger>
              <SelectContent>
                {earners.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>}
        </div>
      </div>

      {!isAdmin && !mePending && !me ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Your login is not tied to a sales agent yet. Ask an admin to set it in Settings, under Agent commission.
        </div>
      ) : isAdmin && earners.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No agent earns commission yet. Turn it on for them in Settings, under Agent commission.
        </div>
      ) : !agent ? null : (
        <>
          {linesError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              Could not work out the commission: {(linesError as any)?.message}
            </div>
          )}

          {/* Status */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              {closing ? <Lock className="h-4 w-4 text-emerald-600" /> : <LockOpen className="h-4 w-4 text-muted-foreground" />}
              {closing ? (
                <span>
                  <span className="font-medium">Closed</span> on {new Date(closing.closed_at).toLocaleDateString("en-PH", { dateStyle: "medium" })}
                  {isAdmin && closing.closed_by_email ? ` by ${closing.closed_by_email}` : ""}. These are the saved figures.
                </span>
              ) : (
                <span><span className="font-medium">Open.</span> Changes as invoices are paid, edited or reverted.</span>
              )}
            </div>
            {!isAdmin ? null : closing ? (
              <Button variant="outline" size="sm" className="h-8" onClick={() => setConfirm("reopen")}>Reopen month</Button>
            ) : (
              <Button size="sm" className="h-8" onClick={() => setConfirm("close")} disabled={linesPending || !!linesError}>
                <Lock className="h-3.5 w-3.5 mr-1.5" /> Close month
              </Button>
            )}
          </div>

          {isAdmin && drifted && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                The invoices have changed since this month was closed. They now come to {peso(liveSummary.commission)} commission,
                against {peso(closing!.commission)} saved. Reopen the month to count it again.
              </span>
            </div>
          )}

          {/* The month at a glance */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Customers", value: String(stats.customers), note: stats.walkInOrders ? `+ ${stats.walkInOrders} walk-in order${stats.walkInOrders === 1 ? "" : "s"}` : undefined },
              { label: "Orders", value: String(stats.orders), note: "Paid invoices" },
              { label: "Sales", value: peso(stats.sales), note: stats.orders ? `${peso(avgOrder)} per order` : undefined },
              { label: "Commission", value: peso(total), note: adjTotal ? `${peso(summary.commission)} before deductions` : undefined },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border bg-card px-4 py-3">
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{c.value}</div>
                {c.note && <div className="mt-0.5 text-[11px] text-muted-foreground">{c.note}</div>}
              </div>
            ))}
          </div>

          <div className={isAdmin ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" : "grid gap-6"}>
            {/* Summary, like the sheet's Commission tab */}
            <div className="rounded-lg border bg-card">
              <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
                <h2 className="text-sm font-semibold">{agent.name} · {monthLabel(month)}</h2>
                <span className="text-xs text-muted-foreground">{invoiceCount} paid invoice{invoiceCount === 1 ? "" : "s"}</span>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Code</TableHead>
                      <TableHead className="text-xs text-right">Sales</TableHead>
                      <TableHead className="text-xs text-right">Rate</TableHead>
                      <TableHead className="text-xs text-right">Commission</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linesPending && !closing ? (
                      <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">Working it out…</TableCell></TableRow>
                    ) : summary.codes.length === 0 && summary.uncounted === 0 ? (
                      <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No paid sales for {agent.name} in {monthLabel(month)}.</TableCell></TableRow>
                    ) : (
                      <>
                        {summary.codes.map((c) => (
                          <TableRow key={c.code} className="cursor-pointer" onClick={() => setOpenCode(openCode === c.code ? null : c.code)}>
                            <TableCell className="text-sm">
                              <span className="inline-flex items-center gap-1.5">
                                {openCode === c.code ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                <span className="font-semibold w-8">{c.code}</span>
                                <span className="text-xs text-muted-foreground">{CODE_LABELS[c.code]} · {c.lineCount} line{c.lineCount === 1 ? "" : "s"}</span>
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{peso(c.sales)}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{c.rates.map(fmtRate).join(" / ")}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums font-medium">{peso(c.commission)}</TableCell>
                          </TableRow>
                        ))}
                        {summary.uncounted > 0 && (
                          <TableRow className="cursor-pointer text-amber-700 dark:text-amber-400" onClick={() => setOpenCode(openCode === "uncounted" ? null : "uncounted")}>
                            <TableCell className="text-sm">
                              <span className="inline-flex items-center gap-1.5">
                                {openCode === "uncounted" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                <AlertTriangle className="h-3.5 w-3.5" /> Not counted
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{peso(summary.uncounted)}</TableCell>
                            <TableCell className="text-right text-sm">—</TableCell>
                            <TableCell className="text-right text-sm">—</TableCell>
                          </TableRow>
                        )}
                      </>
                    )}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="text-sm font-medium">Total</TableCell>
                      <TableCell className="text-right text-sm tabular-nums font-medium">{peso(summary.sales)}</TableCell>
                      <TableCell />
                      <TableCell className="text-right text-sm tabular-nums font-semibold">{peso(summary.commission)}</TableCell>
                    </TableRow>
                    {adjLines.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={3} className="text-sm text-muted-foreground">{a.label}</TableCell>
                        <TableCell className={`text-right text-sm tabular-nums ${a.amount < 0 ? "text-destructive" : ""}`}>{a.amount < 0 ? "−" : "+"}{peso(Math.abs(a.amount))}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={3} className="text-sm font-semibold">This month's commission</TableCell>
                      <TableCell className="text-right text-base tabular-nums font-semibold">{peso(total)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </div>

            {/* Deductions and warnings: admins only. Agents see their
                deductions in the summary's footer. */}
            {isAdmin && <div className="space-y-6">
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <h2 className="text-sm font-semibold">Deductions and additions</h2>
                {!closing && adjustments.length > 0 && (
                  <ul className="divide-y rounded-md border">
                    {adjustments.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate">{a.label}</span>
                        <span className={`tabular-nums ${a.amount < 0 ? "text-destructive" : ""}`}>{a.amount < 0 ? "−" : "+"}{peso(Math.abs(a.amount))}</span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeAdjustment(a.id)} aria-label={`Remove ${a.label}`}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {closing ? (
                  <p className="text-xs text-muted-foreground">The month is closed. Reopen it to change these.</p>
                ) : (
                  <div className="space-y-2">
                    <Input value={adjLabel} onChange={(e) => setAdjLabel(e.target.value)} placeholder="What for, e.g. Jason ticket 2x" className="h-9" />
                    <div className="flex gap-2">
                      <Select value={adjKind} onValueChange={(v) => setAdjKind(v as "deduct" | "add")}>
                        <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="deduct">Deduct</SelectItem>
                          <SelectItem value="add">Add</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input type="number" min={0} value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="Amount" className="h-9 min-w-0 flex-1" onKeyDown={(e) => { if (e.key === "Enter") addAdjustment(); }} />
                      <Button size="sm" variant="outline" className="h-9" onClick={addAdjustment}><Plus className="h-4 w-4" /></Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border bg-card p-4 space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  {problemCount > 0 && <AlertTriangle className="h-4 w-4 text-amber-600" />}
                  Needs a look {problemCount > 0 && <span className="text-xs font-normal text-muted-foreground">({problemCount})</span>}
                </h2>
                {problemCount === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing. Every line has a code, and every payment went where it should.</p>
                ) : (
                  <div className="space-y-3">
                    {[...problems.entries()].map(([p, list]) => (
                      <div key={p} className="space-y-1">
                        <p className="text-xs font-medium">{PROBLEM_LABELS[p] ?? p}</p>
                        <ul className="space-y-0.5">
                          {dedupeByInvoiceWhen(p, list).slice(0, 12).map((l) => (
                            <li key={`${p}-${l.line_id}`} className="flex gap-2 text-xs text-muted-foreground">
                              <button type="button" className="tabular-nums text-primary hover:underline" onClick={() => setInvoiceId(l.invoice_id)}>{docNo(l.invoice_number)}</button>
                              <span className="min-w-0 flex-1 truncate">
                                {p === "other_petty_cash" || p === "no_account" ? (l.payment_account || l.payment_method || "—") : (l.item_name || "—")}
                              </span>
                              {p !== "other_petty_cash" && p !== "no_account" && <span className="tabular-nums">{peso(l.sales)}</span>}
                            </li>
                          ))}
                          {dedupeByInvoiceWhen(p, list).length > 12 && (
                            <li className="text-xs text-muted-foreground">and {dedupeByInvoiceWhen(p, list).length - 12} more</li>
                          )}
                        </ul>
                      </div>
                    ))}
                    {unassigned.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">Paid this month with no agent, or an agent nobody is called</p>
                        <p className="text-[11px] text-muted-foreground">Counted for no one. If one is {agent.name}'s, set the agent on the invoice.</p>
                        <ul className="space-y-0.5">
                          {unassigned.slice(0, 12).map((u) => (
                            <li key={u.invoice_id} className="flex gap-2 text-xs text-muted-foreground">
                              <button type="button" className="tabular-nums text-primary hover:underline" onClick={() => setInvoiceId(u.invoice_id)}>{docNo(u.invoice_number)}</button>
                              <span className="min-w-0 flex-1 truncate">{u.sales_agent ? `"${u.sales_agent}"` : "No agent"} · {u.customer || "—"}</span>
                              <span className="tabular-nums">{peso(u.total_amount)}</span>
                            </li>
                          ))}
                          {unassigned.length > 12 && <li className="text-xs text-muted-foreground">and {unassigned.length - 12} more</li>}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>}
          </div>

          {/* The lines behind a code */}
          {openCode && (
            <div className="rounded-lg border bg-card">
              <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
                <h2 className="text-sm font-semibold">
                  {openCode === "uncounted" ? "Not counted" : `${openCode} · ${CODE_LABELS[openCode]}`}
                </h2>
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpenCode(null)}>Close</button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Paid</TableHead>
                      <TableHead className="text-xs">Invoice</TableHead>
                      <TableHead className="text-xs">Customer</TableHead>
                      <TableHead className="text-xs">Item</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="text-xs text-right">Price</TableHead>
                      <TableHead className="text-xs text-right">DP</TableHead>
                      <TableHead className="text-xs text-right">Sales</TableHead>
                      <TableHead className="text-xs text-right">Commission</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownLines.map((l) => (
                      <TableRow key={l.line_id}>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums">{l.paid_on}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          <button type="button" className="tabular-nums text-primary hover:underline" onClick={() => setInvoiceId(l.invoice_id)}>{docNo(l.invoice_number)}</button>
                        </TableCell>
                        <TableCell className="max-w-[10rem] truncate text-xs">{l.customer || "—"}</TableCell>
                        <TableCell className="max-w-[16rem] text-xs">
                          <div className="truncate">{l.item_name || "—"}</div>
                          {l.category && <div className="truncate text-[10px] text-muted-foreground">{l.category}</div>}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{qtyFmt(l.quantity)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{peso(l.unit_price)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{l.dp != null ? peso(l.dp) : "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{peso(l.sales)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{l.code && l.rate != null ? peso(l.commission) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Every product sold this month, without opening each code */}
          {products.length > 0 && (
            <div className="rounded-lg border bg-card">
              <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Products sold</h2>
                <span className="text-xs text-muted-foreground">{products.length} product{products.length === 1 ? "" : "s"}</span>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Product</TableHead>
                      <TableHead className="text-xs">Code</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="text-xs text-right">Orders</TableHead>
                      <TableHead className="text-xs text-right">Sales</TableHead>
                      <TableHead className="text-xs text-right">Commission</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="max-w-[20rem] text-sm"><div className="truncate">{r.name}</div></TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {r.codes.join(", ")}
                          {r.uncounted && <span className="text-amber-700 dark:text-amber-400">{r.codes.length ? ", " : ""}not counted</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{qtyFmt(r.quantity)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{r.orders}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{peso(r.sales)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{peso(r.commission)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm font-medium">Total</TableCell>
                      <TableCell className="text-right text-sm tabular-nums font-medium">{peso(stats.sales)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums font-medium">{peso(summary.commission)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </div>
          )}
        </>
      )}

      <InvoiceDetailsDialog invoiceId={invoiceId} open={!!invoiceId} onOpenChange={(o) => { if (!o) setInvoiceId(null); }} />

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "close" ? `Close ${monthLabel(month)} for ${agent?.name}?` : `Reopen ${monthLabel(month)} for ${agent?.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "close"
                ? `This saves ${peso(total)} as this month's commission. Editing an invoice or a DP later will not change it.${problemCount > 0 ? ` There ${problemCount === 1 ? "is 1 thing" : `are ${problemCount} things`} still flagged under Needs a look.` : ""}`
                : "The saved figures are removed, and the month is worked out from the invoices again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); runConfirm(); }}>
              {confirm === "close" ? "Close month" : "Reopen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Payment problems are about the invoice, not each of its lines: one row each. */
function dedupeByInvoiceWhen(problem: string, list: CommissionLine[]) {
  if (problem !== "other_petty_cash" && problem !== "no_account") return list;
  const seen = new Set<string>();
  return list.filter((l) => (seen.has(l.invoice_id) ? false : (seen.add(l.invoice_id), true)));
}
