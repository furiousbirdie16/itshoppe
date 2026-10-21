import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__direct";

interface Props {
  value: string | null | undefined;
  onChange: (resellerId: string | null) => void;
  resellers: { id: string; name: string }[];
  /** A customer cannot have come through themselves. */
  excludeId?: string | null;
  className?: string;
  /** Put "Reseller:" in front of each option, for where there is no label. */
  labelled?: boolean;
}

/** Pick the reseller a customer or sale came through, or none for direct. */
export function ResellerSelect({ value, onChange, resellers, excludeId, className, labelled }: Props) {
  const options = resellers.filter((r) => r.id !== excludeId);
  const pre = labelled ? "Reseller: " : "";
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger className={className ?? "h-9"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{pre}{labelled ? "none" : "None"} — direct (sales agent)</SelectItem>
        {options.map((r) => (
          <SelectItem key={r.id} value={r.id}>{pre}{r.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
