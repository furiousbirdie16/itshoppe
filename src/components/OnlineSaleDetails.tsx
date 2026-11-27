import { peso } from "@/lib/currency";

interface Props {
  sale: any;
  /** What the marketplace should pay out for this line, as the page works it out. */
  expected?: number | null;
}

const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** The fields of a one-item online order that have no column in the list. */
export function OnlineSaleDetails({ sale: s, expected }: Props) {
  const fields: { label: string; value: React.ReactNode }[] = [
    { label: "Posted price", value: peso(Number(s.posted_price || 0)) },
    { label: "Deal price", value: Number(s.deal_price || 0) > 0 ? peso(Number(s.deal_price)) : "—" },
    { label: "Marketplace fee", value: s.marketplace_fee_pct != null ? `${Number(s.marketplace_fee_pct)}%` : "—" },
    ...(expected != null ? [{ label: "Expected payout", value: peso(expected) }] : []),
    { label: "Amount paid", value: s.payment_status === "paid" ? peso(Number(s.amount_paid || 0)) : "—" },
    { label: "Paid on", value: fmtDateTime(s.paid_at) },
    { label: "Recorded", value: fmtDateTime(s.created_at) },
  ];
  return (
    <div className="space-y-2 px-1 py-2">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border bg-background px-3 py-2 text-xs sm:grid-cols-4">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{f.label}</dt>
            <dd className="truncate font-medium tabular-nums">{f.value}</dd>
          </div>
        ))}
      </dl>
      <p className="px-1 text-xs">
        <span className="text-muted-foreground">Notes: </span>
        {s.notes ? <span className="whitespace-pre-wrap">{s.notes}</span> : <span className="text-muted-foreground">none</span>}
      </p>
    </div>
  );
}
