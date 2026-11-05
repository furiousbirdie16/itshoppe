/**
 * The add/edit boxes on the Bank and Cash pages.
 *
 * Each keeps what is being typed in its own state. Held in the ledger instead,
 * every keystroke redrew the whole transaction list behind the box, which on a
 * long ledger made letters appear late. The form body sits inside
 * DialogContent, which unmounts on close, so it starts fresh from `initial`
 * each time the box opens.
 */
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateField } from "@/components/DateField";
import { CategorySelect } from "@/components/CategorySelect";
import { peso } from "@/lib/currency";
import { BASE_CURRENCY, isForeign } from "@/lib/fx";
import type { CashAccount, CashAccountType, CashTransaction } from "@/types/database";
import type { TxnForm, AccountForm } from "@/lib/cash-ledger-forms";

const today = () => format(new Date(), "yyyy-MM-dd");

type AccountLite = Pick<CashAccount, "id" | "name" | "currency"> & Partial<CashAccount>;

// ---------------------------------------------------------------------------
// New / edit transaction
// ---------------------------------------------------------------------------


interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: boolean;
  initial: TxnForm;
  accounts: CashAccount[];
  accountById: Record<string, CashAccount>;
  pending: boolean;
  onSubmit: (data: Partial<CashTransaction>) => void;
}

export function TransactionDialog(props: TransactionDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-lg">{props.editing ? "Edit Transaction" : "New Transaction"}</DialogTitle></DialogHeader>
        <TransactionForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm({ editing, initial, accounts, accountById, pending, onSubmit, onOpenChange }: TransactionDialogProps) {
  const [form, setForm] = useState<TxnForm>(initial);
  const formAccount = accountById[form.account_id];
  const formIsForeign = formAccount ? isForeign(formAccount) : false;

  const handleSubmit = () => {
    if (!form.account_id) { toast.error("Select an account"); return; }
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { toast.error("Enter an amount greater than zero"); return; }
    const needsRate = formIsForeign && form.direction === "in";
    const rate = Number(form.fx_rate);
    if (needsRate && (!rate || rate <= 0)) {
      toast.error(`Enter the PHP rate paid per 1 ${formAccount?.currency}`);
      return;
    }
    onSubmit({
      account_id: form.account_id,
      txn_date: form.txn_date,
      direction: form.direction,
      amount,
      fx_rate: needsRate ? rate : null,
      category: form.category.trim(),
      payee: form.payee.trim(),
      reference: form.reference.trim(),
      notes: form.notes,
    });
  };

  return (
    <>
      <div className="grid gap-4 pt-2">
        {accounts.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Account *</Label>
            <Select value={form.account_id} onValueChange={(v) => setForm((f) => ({ ...f, account_id: v }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Type *</Label>
            <Select value={form.direction} onValueChange={(v) => setForm((f) => ({ ...f, direction: v as "in" | "out" }))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Inflow (money in)</SelectItem>
                <SelectItem value="out">Outflow (money out)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Amount *{formIsForeign && ` (${formAccount?.currency})`}
            </Label>
            <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="h-9" />
          </div>
        </div>
        {formIsForeign && form.direction === "in" && (
          <div className="space-y-1.5 rounded-lg border p-3">
            <Label className="text-xs font-medium">PHP per 1 {formAccount?.currency} *</Label>
            <Input type="number" step="0.0001" min="0" value={form.fx_rate} onChange={(e) => setForm((f) => ({ ...f, fx_rate: e.target.value }))} className="h-9" placeholder="e.g. 9.05" />
            <p className="text-[11px] text-muted-foreground">
              {Number(form.amount) > 0 && Number(form.fx_rate) > 0
                ? `Costs ${peso(Number(form.amount) * Number(form.fx_rate))}. `
                : ""}
              Outflows are valued automatically at the running average.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Date *</Label>
            <DateField value={form.txn_date} onChange={(v) => setForm((f) => ({ ...f, txn_date: v }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Category</Label>
            <CategorySelect expensesOnly placeholder="No category" value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Payee / Source</Label>
            <Input value={form.payee} onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Reference</Label>
            <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} className="h-9" placeholder="OR / slip no." />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Notes</Label>
          <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="resize-none" rows={2} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={pending} className="rounded-lg h-9">
          {editing ? "Save Changes" : "Add Transaction"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Transfer between accounts
// ---------------------------------------------------------------------------

export interface TransferPayload {
  from_account_id: string;
  to_account_id: string;
  amount: number;
  amount_to: number;
  fx_rate: number | null;
  txn_date: string;
  notes: string;
}

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: AccountLite[];
  accountById: Record<string, CashAccount>;
  pending: boolean;
  onSubmit: (data: TransferPayload) => void;
}

export function TransferDialog(props: TransferDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-lg">Transfer Between Accounts</DialogTitle></DialogHeader>
        <TransferForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function TransferForm({ targets, accountById, pending, onSubmit, onOpenChange }: TransferDialogProps) {
  const [transfer, setTransfer] = useState({ from_account_id: "", to_account_id: "", amount: "", amount_to: "", txn_date: today(), notes: "" });
  const targetById: Record<string, AccountLite> = Object.fromEntries(targets.map((a) => [a.id, a]));
  const transferFrom: AccountLite | undefined = accountById[transfer.from_account_id] || targetById[transfer.from_account_id];
  const transferTo: AccountLite | undefined = accountById[transfer.to_account_id] || targetById[transfer.to_account_id];
  const transferCurrenciesDiffer =
    !!transferFrom && !!transferTo &&
    (transferFrom.currency || BASE_CURRENCY) !== (transferTo.currency || BASE_CURRENCY);

  const handleTransfer = () => {
    const amount = Number(transfer.amount);
    if (!transfer.from_account_id || !transfer.to_account_id) { toast.error("Pick both accounts"); return; }
    if (transfer.from_account_id === transfer.to_account_id) { toast.error("Pick two different accounts"); return; }
    // Without it the ledger shows money moving with no explanation, which is
    // the thing this pair of rows is least able to reconstruct later.
    if (!transfer.notes.trim()) { toast.error("Say what the transfer is for"); return; }
    if (!amount || amount <= 0) { toast.error("Enter an amount greater than zero"); return; }

    if (!transferCurrenciesDiffer) {
      onSubmit({ ...transfer, amount, amount_to: amount, fx_rate: null });
      return;
    }
    // An exchange: both sides differ, and the implied rate is what was really paid.
    const amountTo = Number(transfer.amount_to);
    if (!amountTo || amountTo <= 0) { toast.error(`Enter the ${transferTo?.currency} amount received`); return; }
    const toIsForeign = isForeign(transferTo as CashAccount);
    onSubmit({
      ...transfer,
      amount,
      amount_to: amountTo,
      // Rate only means anything when the destination is the foreign side.
      fx_rate: toIsForeign ? amount / amountTo : null,
    });
  };

  return (
    <>
      <div className="grid gap-4 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">From *</Label>
            <Select value={transfer.from_account_id} onValueChange={(v) => setTransfer((t) => ({ ...t, from_account_id: v }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Account" /></SelectTrigger>
              <SelectContent>
                {targets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">To *</Label>
            <Select value={transfer.to_account_id} onValueChange={(v) => setTransfer((t) => ({ ...t, to_account_id: v }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Account" /></SelectTrigger>
              <SelectContent>
                {targets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Amount Sent *{transferFrom ? ` (${transferFrom.currency || BASE_CURRENCY})` : ""}
            </Label>
            <Input type="number" step="0.01" min="0" value={transfer.amount} onChange={(e) => setTransfer((t) => ({ ...t, amount: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Date *</Label>
            <DateField value={transfer.txn_date} onChange={(v) => setTransfer((t) => ({ ...t, txn_date: v }))} />
          </div>
        </div>
        {transferCurrenciesDiffer && (
          <div className="space-y-1.5 rounded-lg border p-3">
            <Label className="text-xs font-medium">
              Amount Received * ({transferTo?.currency})
            </Label>
            <Input type="number" step="0.01" min="0" value={transfer.amount_to} onChange={(e) => setTransfer((t) => ({ ...t, amount_to: e.target.value }))} className="h-9" />
            <p className="text-[11px] text-muted-foreground">
              {Number(transfer.amount) > 0 && Number(transfer.amount_to) > 0
                ? `Rate: ${(Number(transfer.amount) / Number(transfer.amount_to)).toFixed(4)} ${transferFrom?.currency || BASE_CURRENCY} per 1 ${transferTo?.currency}`
                : "An exchange — enter what actually landed in the destination."}
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Reason *</Label>
          <Textarea
            value={transfer.notes}
            onChange={(e) => setTransfer((t) => ({ ...t, notes: e.target.value }))}
            className="resize-none"
            rows={2}
            placeholder="e.g. Fund payroll, top up for supplier payment"
          />
          <p className="text-[11px] text-muted-foreground">
            Shown on both sides of the transfer in the ledger.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={handleTransfer} disabled={pending} className="rounded-lg h-9">Record Transfer</Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// New / edit account
// ---------------------------------------------------------------------------


interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: boolean;
  initial: AccountForm;
  accountType: CashAccountType;
  pending: boolean;
  onSubmit: (form: AccountForm) => void;
}

export function AccountDialog(props: AccountDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-lg">{props.editing ? "Edit Account" : "New Account"}</DialogTitle></DialogHeader>
        <AccountFormBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function AccountFormBody({ editing, initial, accountType, pending, onSubmit, onOpenChange }: AccountDialogProps) {
  const [accountForm, setAccountForm] = useState<AccountForm>(initial);
  const set = (patch: Partial<AccountForm>) => setAccountForm((f) => ({ ...f, ...patch }));

  const handleSubmit = () => {
    if (!accountForm.name.trim()) { toast.error("Account name is required"); return; }
    onSubmit(accountForm);
  };

  return (
    <>
      <div className="grid gap-4 pt-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Account Name *</Label>
          <Input value={accountForm.name} onChange={(e) => set({ name: e.target.value })} className="h-9" placeholder={accountType === "bank" ? "e.g. GCash, BDO, Metrobank" : "e.g. Petty Cash, Geraldine Cash"} />
          <p className="text-[11px] text-muted-foreground">This name appears as a payment option when marking invoices paid.</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Currency</Label>
          <Input
            value={accountForm.currency}
            onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
            className="h-9"
            placeholder="PHP"
            disabled={editing}
          />
          <p className="text-[11px] text-muted-foreground">
            {editing
              ? "Currency cannot be changed once the account has history."
              : "Use PHP unless this holds a foreign currency, e.g. RMB. Foreign accounts are valued in PHP at a weighted-average rate."}
          </p>
        </div>
        <div className={accountType === "bank" ? "grid grid-cols-2 gap-3" : ""}>
          {accountType === "bank" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Account Number</Label>
              <Input value={accountForm.account_number} onChange={(e) => set({ account_number: e.target.value })} className="h-9" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Opening Balance</Label>
            <Input type="number" step="0.01" value={accountForm.opening_balance} onChange={(e) => set({ opening_balance: e.target.value })} className="h-9" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Notes</Label>
          <Textarea value={accountForm.notes} onChange={(e) => set({ notes: e.target.value })} className="resize-none" rows={2} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={pending} className="rounded-lg h-9">
          {editing ? "Save Changes" : "Add Account"}
        </Button>
      </DialogFooter>
    </>
  );
}
