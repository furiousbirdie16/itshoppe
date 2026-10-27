/**
 * Reading a sheet of payables — mostly post-dated checks — for bulk upload.
 *
 * Columns (any order, matched by name): Payee, Amount, Check Number, Check
 * Date, Check Bank, Paid From, Date Written, Category, Notes. A row with a
 * check number is a check; without one it is a bill. Everything goes in
 * unpaid; checks are marked paid or cleared as they clear.
 */

export type Cell = string | number | boolean | Date | null | undefined;

export interface PayableUploadRow {
  payee: string;
  amount: number;
  is_check: boolean;
  check_number: string;
  check_bank: string;
  due_date: string | null;
  date_written: string | null;
  cash_account_id: string | null;
  /** The account as written in the sheet, for showing. */
  account_label: string;
  category: string;
  notes: string;
  valid: boolean;
  error?: string;
  /** Already entered (here or earlier in the sheet): left out, not an error. */
  duplicate?: boolean;
}

const norm = (v: Cell) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const COLUMNS = {
  payee: ["payee", "pay to", "payee name", "supplier"],
  amount: ["amount", "check amount"],
  checkNumber: ["check number", "check no", "check", "cheque number", "cheque no"],
  dueDate: ["check date", "due date", "date due", "pdc date"],
  bank: ["check bank", "bank"],
  account: ["paid from", "account", "paid from account", "bank account"],
  written: ["date written", "written", "date issued"],
  category: ["category"],
  notes: ["notes", "remarks", "memo"],
} as const;
type Key = keyof typeof COLUMNS;

export const TEMPLATE_HEADERS = ["Payee", "Amount", "Check Number", "Check Date", "Check Bank", "Paid From", "Date Written", "Category", "Notes"];

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO, M/D/YYYY (Excel's US default) or an Excel serial → "YYYY-MM-DD"; null if blank or unreadable. */
export function sheetDate(v: Cell): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "number" && v > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`;
  const us = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (us) {
    let y = +us[3];
    if (y < 100) y += 2000;
    const m = +us[1], d = +us[2];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad(m)}-${pad(d)}`;
  }
  const t = new Date(s);
  return isNaN(t.getTime()) ? null : `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

const money = (v: Cell) => {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/** How a check is told apart from another: its number, at its bank or account. */
export const checkKey = (number: string, bankOrAccount: string) => `${norm(number)}|${norm(bankOrAccount)}`;

export function parsePayablesSheet(
  sheet: Cell[][],
  accounts: { id: string; name: string }[],
  /** Checks already entered, as checkKey(number, bank) and checkKey(number, account id). */
  existingChecks: Set<string>,
): PayableUploadRow[] | null {
  const headerAt = sheet.findIndex((r) => r.map(norm).some((c) => COLUMNS.payee.includes(c as never)) && r.map(norm).some((c) => COLUMNS.amount.includes(c as never)));
  if (headerAt < 0) return null;
  const names = sheet[headerAt].map(norm);
  const ix = {} as Record<Key, number>;
  for (const k of Object.keys(COLUMNS) as Key[]) ix[k] = names.findIndex((n) => (COLUMNS[k] as readonly string[]).includes(n));
  const get = (row: Cell[], k: Key) => (ix[k] >= 0 ? row[ix[k]] : "");
  const text = (row: Cell[], k: Key) => String(get(row, k) ?? "").trim();
  const accountByName = new Map(accounts.map((a) => [norm(a.name), a]));

  const seen = new Set<string>();
  const out: PayableUploadRow[] = [];
  for (const row of sheet.slice(headerAt + 1)) {
    if (!row.some((c) => String(c ?? "").trim())) continue;
    const payee = text(row, "payee");
    const amount = money(get(row, "amount"));
    const checkNumber = text(row, "checkNumber");
    const bank = text(row, "bank");
    const accountLabel = text(row, "account");
    const account = accountLabel ? accountByName.get(norm(accountLabel)) ?? null : null;
    const dueRaw = get(row, "dueDate");
    const due = sheetDate(dueRaw);
    const writtenRaw = get(row, "written");
    const written = sheetDate(writtenRaw);

    let error: string | undefined;
    if (!payee) error = "No payee";
    else if (!Number.isFinite(amount) || amount <= 0) error = "Amount must be more than 0";
    else if (accountLabel && !account) error = `No account named "${accountLabel}"`;
    else if (String(dueRaw ?? "").trim() && !due) error = "Check date not readable";
    else if (String(writtenRaw ?? "").trim() && !written) error = "Date written not readable";

    const isCheck = !!checkNumber;
    let duplicate = false;
    if (!error && isCheck) {
      const keys = [checkKey(checkNumber, bank), ...(account ? [checkKey(checkNumber, account.id)] : [])];
      if (keys.some((k) => existingChecks.has(k) || seen.has(k))) {
        duplicate = true;
        error = "Check already entered";
      }
      keys.forEach((k) => seen.add(k));
    }

    out.push({
      payee,
      amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
      is_check: isCheck,
      check_number: checkNumber,
      check_bank: isCheck ? bank : "",
      due_date: due,
      date_written: isCheck ? written : null,
      cash_account_id: account?.id ?? null,
      account_label: account?.name ?? accountLabel,
      category: text(row, "category"),
      notes: text(row, "notes"),
      valid: !error,
      error,
      duplicate,
    });
  }
  return out;
}
