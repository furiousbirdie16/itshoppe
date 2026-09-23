import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_CHAT_ID = "1144566282";

/** Beyond this the message becomes a wall of text, so the rest is summarised. */
const MAX_LINES = 15;

function esc(text: string) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const { data: { user: caller } } = await admin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const ids: string[] = Array.isArray(body?.movement_ids)
      ? body.movement_ids.filter(Boolean)
      : body?.movement_id ? [body.movement_id] : [];
    if (ids.length === 0) return json({ error: "movement_ids is required" }, 400);

    const { data: moves } = await admin
      .from("inventory_movements")
      .select("id, type, quantity, unit, location, notes, balance_before, balance_after, user_email, branch_id, items(name, sku), branches(branch_code)")
      .in("id", ids.slice(0, 500))
      .in("type", ["adjust_missing", "adjust_surplus"]);

    const rows = (moves as any[]) || [];
    // Nothing to say: the ids were not adjustments, or were already removed.
    if (rows.length === 0) return json({ ok: true, skipped: "no adjustments found" });

    const who = (rows[0]?.user_email || caller.email || "").split("@")[0] || "someone";

    const lineFor = (m: any) => {
      const delta = m.type === "adjust_surplus" ? Number(m.quantity) : -Number(m.quantity);
      const name = m.items?.name || "Item";
      const sku = m.items?.sku ? ` (${m.items.sku})` : "";
      const where = m.location === "warehouse" ? "Warehouse" : m.location === "store" ? "Store" : "";
      const branch = m.branches?.branch_code ? ` · ${m.branches.branch_code}` : "";
      const balances =
        m.balance_before != null && m.balance_after != null
          ? `${m.balance_before} → ${m.balance_after}`
          : `${signed(delta)}`;
      return `• <b>${esc(name)}</b>${esc(sku)} — ${esc(where)} ${balances} (<b>${signed(delta)}</b> ${esc(m.unit || "pcs")})${esc(branch)}`;
    };

    const net = rows.reduce(
      (s, m: any) => s + (m.type === "adjust_surplus" ? Number(m.quantity) : -Number(m.quantity)),
      0,
    );

    let message: string;
    if (rows.length === 1) {
      const m: any = rows[0];
      message =
        `📦 <b>Stock adjusted</b>\n` +
        `${lineFor(m).replace(/^• /, "")}\n` +
        (m.notes ? `<i>${esc(m.notes)}</i>\n` : "") +
        `<i>Adjusted by ${esc(who)}</i>`;
    } else {
      const shown = rows.slice(0, MAX_LINES).map(lineFor).join("\n");
      const rest = rows.length - MAX_LINES;
      message =
        `📦 <b>Stock adjusted — ${rows.length} entries</b>\n` +
        `${shown}\n` +
        (rest > 0 ? `<i>…and ${rest} more</i>\n` : "") +
        `Net change: <b>${signed(net)}</b>\n` +
        `<i>Adjusted by ${esc(who)}</i>`;
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

    return json({ ok: true, notified: rows.length });
  } catch (e) {
    console.error("notify-inventory failed:", e);
    return json({ error: String(e) }, 500);
  }
});
