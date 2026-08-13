import { useId, useMemo } from "react";
import { Input } from "@/components/ui/input";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Previously entered values. Blanks and case-duplicates are dropped. */
  options: string[];
  placeholder?: string;
  className?: string;
}

/**
 * A free-text field that also offers what has been typed here before.
 *
 * Built on a native `<datalist>` rather than a styled dropdown: typing a new
 * value has to stay the primary action — these fields are open vocabularies, and
 * a picker that fights free text would make the first entry of any new category
 * harder than it is today. The native control also behaves properly with the
 * on-screen keyboard on a phone, which a custom popover has to reimplement.
 */
export function SuggestInput({ value, onChange, options, placeholder, className }: Props) {
  const listId = useId();

  const suggestions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const raw of options) {
      const trimmed = (raw || "").trim();
      if (!trimmed) continue;
      // Keep the first spelling seen, so "Fuel" and "fuel" do not both appear.
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) seen.set(key, trimmed);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [options]);

  return (
    <>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={suggestions.length ? listId : undefined}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}
