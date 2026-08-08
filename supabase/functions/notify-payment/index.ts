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

/** Telegram's HTML parse mode only needs these three escaped. */
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

    // Any signed-in user may mark an invoice paid, so authentication is enough —
    // but it must not be open to the public.
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const { data: { user: caller } } = await admin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const { invoice_id } = await req.json();
    if (!invoice_id) return json({ error: "invoice_id is required" }, 400);

    const { data: invoice } = await admin
      .from("invoices")
      .select("invoice_number, total_amount, payment_method, customers(name)")
      .eq("id", invoice_id)
      .maybeSingle();
    if (!invoice) return json({ error: "Invoice not found" }, 404);

    // The auto-posted ledger row tells us which account received the money.
    // Credit Card and Others post nothing, so there is simply no balance to show.
    const { data: txn } = await admin
      .from("cash_transactions")
      .select("amount, cash_accounts(name, currency, opening_balance, id)")
      .eq("source_invoice_id", invoice_id)
      .maybeSingle();

    const account = (txn as any)?.cash_accounts || null;
    let balanceLine = "";
    if (account) {
      const { data: rows } = await admin
        .from("cash_transactions")
        .select("direction, amount")
        .eq("account_id", account.id);
      const balance = ((rows as any[]) || []).reduce(
        (sum, r) => sum + (r.direction === "in" ? Number(r.amount || 0) : -Number(r.amount || 0)),
        Number(account.opening_balance || 0),
      );
      balanceLine = `\n${esc(account.name)} balance: <b>${money(balance, account.currency || "PHP")}</b>`;
    }

    const customer = (invoice as any).customers?.name || "Walk-in";
    const method = (invoice as any).payment_method || "—";
    const recordedBy = (caller.email || "").split("@")[0] || "someone";

    const message =
      `💰 <b>Payment received</b>\n` +
      `${esc(customer)} — ${esc((invoice as any).invoice_number || "")}\n` +
      `<b>${money(Number((invoice as any).total_amount || 0))}</b> via ${esc(method)}` +
      balanceLine +
      `\n<i>Recorded by ${esc(recordedBy)}</i>`;

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
    console.error("notify-payment failed:", e);
    return json({ error: String(e) }, 500);
  }
});
