import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_CHAT_ID = "1144566282";

const CURRENCY_SYMBOLS: Record<string, string> = {
  PHP: "₱", RMB: "¥", CNY: "¥", USD: "$", HKD: "HK$", EUR: "€",
};

function money(amount: number, currency = "PHP") {
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  return `${symbol}${Number(amount || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function esc(text: string) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ error: "TELEGRAM_BOT_TOKEN is not set" }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const { data: { user: caller } } = await admin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const recordedBy = (caller.email || "").split("@")[0] || "someone";

    /** Current balance of an account, in its own currency. */
    const balanceOf = async (account: any) => {
      const { data: rows } = await admin
        .from("cash_transactions")
        .select("direction, amount")
        .eq("account_id", account.id);
      return ((rows as any[]) || []).reduce(
        (sum, r) => sum + (r.direction === "in" ? Number(r.amount || 0) : -Number(r.amount || 0)),
        Number(account.opening_balance || 0),
      );
    };

    const { transaction_id, transfer_group_id, edited } = await req.json();
    let message = "";

    if (transaction_id && edited) {
      // An edit: what the line was and what it is now, from the record the
      // database keeps of every change.
      const { data: txn } = await admin
        .from("cash_transactions")
        .select("direction, amount, category, payee, cash_accounts(id, name, currency, opening_balance)")
        .eq("id", transaction_id)
        .maybeSingle();
      if (!txn) return json({ error: "Transaction not found" }, 404);
      const { data: lastEdit } = await admin
        .from("cash_transaction_edits")
        .select("changes, edited_at")
        .eq("transaction_id", transaction_id)
        .order("edited_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const changes = ((lastEdit as any)?.changes || {}) as Record<string, { from: unknown; to: unknown }>;
      // Saved without changing anything that matters: nothing to announce.
      if (!lastEdit || Object.keys(changes).length === 0) return json({ ok: true, skipped: "no change" });

      const account = (txn as any).cash_accounts;
      const currency = account?.currency || "PHP";
      const labels: Record<string, string> = {
        amount: "Amount", direction: "In / out", account_id: "Account", txn_date: "Date",
        category: "Category", payee: "Payee", reference: "Reference", notes: "Notes", fx_rate: "Rate",
      };
      const accountIds = [changes.account_id?.from, changes.account_id?.to].filter(Boolean) as string[];
      const { data: accts } = accountIds.length
        ? await admin.from("cash_accounts").select("id, name").in("id", accountIds)
        : { data: [] as any[] };
      const nameOf = new Map(((accts as any[]) || []).map((a) => [a.id, a.name]));
      const show = (field: string, v: unknown) => {
        if (v === null || v === undefined || v === "") return "—";
        if (field === "amount") return money(Number(v), currency);
        if (field === "account_id") return esc(nameOf.get(String(v)) || "another account");
        return esc(String(v));
      };
      const lines = Object.entries(changes).map(([f, { from, to }]) =>
        `${labels[f] || f}: <s>${show(f, from)}</s> → <b>${show(f, to)}</b>`,
      );
      const detail = [(txn as any).category, (txn as any).payee].filter(Boolean).join(" · ");

      message =
        `✏️ <b>Cash line edited</b>\n` +
        `${esc(account?.name || "—")}${detail ? ` · ${esc(detail)}` : ""}\n` +
        lines.join("\n") + "\n" +
        `${esc(account?.name || "")} balance: <b>${money(await balanceOf(account), currency)}</b>\n` +
        `<i>Edited by ${esc(recordedBy)}</i>`;
    } else if (transfer_group_id) {
      const { data: legs } = await admin
        .from("cash_transactions")
        .select("direction, amount, notes, cash_accounts(id, name, currency, opening_balance)")
        .eq("transfer_group_id", transfer_group_id);

      const out = ((legs as any[]) || []).find((l) => l.direction === "out");
      const inn = ((legs as any[]) || []).find((l) => l.direction === "in");
      if (!out || !inn) return json({ error: "Transfer legs not found" }, 404);

      const fromAcc = out.cash_accounts;
      const toAcc = inn.cash_accounts;
      const fromCur = fromAcc?.currency || "PHP";
      const toCur = toAcc?.currency || "PHP";

      // Cross-currency exchanges move different amounts on each side.
      const amountLine =
        fromCur === toCur && Number(out.amount) === Number(inn.amount)
          ? `<b>${money(Number(out.amount), fromCur)}</b>`
          : `<b>${money(Number(out.amount), fromCur)}</b> → <b>${money(Number(inn.amount), toCur)}</b>`;

      message =
        `🔁 <b>Transfer</b>\n` +
        `${esc(fromAcc?.name || "—")} → ${esc(toAcc?.name || "—")}\n` +
        `${amountLine}\n` +
        `${esc(fromAcc?.name || "")} balance: <b>${money(await balanceOf(fromAcc), fromCur)}</b>\n` +
        `${esc(toAcc?.name || "")} balance: <b>${money(await balanceOf(toAcc), toCur)}</b>\n` +
        `<i>Recorded by ${esc(recordedBy)}</i>`;
    } else if (transaction_id) {
      const { data: txn } = await admin
        .from("cash_transactions")
        .select("direction, amount, category, payee, notes, source_invoice_id, transfer_group_id, cash_accounts(id, name, currency, opening_balance)")
        .eq("id", transaction_id)
        .maybeSingle();
      if (!txn) return json({ error: "Transaction not found" }, 404);

      // Invoice payments and transfers are announced by their own notifications;
      // reporting them here as well would double up.
      if ((txn as any).source_invoice_id || (txn as any).transfer_group_id) {
        return json({ ok: true, skipped: "covered by another notification" });
      }

      const account = (txn as any).cash_accounts;
      const currency = account?.currency || "PHP";
      const isIn = (txn as any).direction === "in";
      const detail = [(txn as any).category, (txn as any).payee].filter(Boolean).join(" · ");

      message =
        `${isIn ? "💵 <b>Cash in</b>" : "💸 <b>Cash out</b>"}\n` +
        `${esc(account?.name || "—")} ${isIn ? "+" : "−"}<b>${money(Number((txn as any).amount), currency)}</b>\n` +
        (detail ? `${esc(detail)}\n` : "") +
        `${esc(account?.name || "")} balance: <b>${money(await balanceOf(account), currency)}</b>\n` +
        `<i>Recorded by ${esc(recordedBy)}</i>`;
    } else {
      return json({ error: "transaction_id or transfer_group_id is required" }, 400);
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("Telegram rejected the message:", detail);
      return json({ error: "Telegram send failed", detail }, 502);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("notify-cash failed:", e);
    return json({ error: String(e) }, 500);
  }
});
