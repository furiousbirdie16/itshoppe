import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { findDuplicateCustomers } from "@/lib/duplicate-customers";
import type { Customer } from "@/types/database";

interface Props {
  /** The name as it stands in the form — company name, or contact person. */
  name: string;
  customers: Customer[];
  /** The customer being edited, which is not its own duplicate. */
  excludeId?: string;
  /** Pick an existing customer instead of adding another. Omitted where the
   *  form has nothing to switch to. */
  onUse?: (customer: Customer) => void;
}

/**
 * Warns while a customer name is being typed that one like it already exists.
 *
 * A notice rather than a block: two businesses really can share a name, so the
 * person typing decides. Saving is still allowed.
 */
export function DuplicateCustomerWarning({ name, customers, excludeId, onUse }: Props) {
  const matches = useMemo(
    () => findDuplicateCustomers(name, customers, excludeId).slice(0, 4),
    [name, customers, excludeId]
  );

  if (matches.length === 0) return null;

  const exact = matches.some((m) => m.kind === "same");

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {exact ? "This customer already exists" : "A similar customer already exists"}
      </p>
      <ul className="mt-1.5 space-y-1">
        {matches.map(({ customer, kind }) => (
          <li key={customer.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 text-amber-900 dark:text-amber-200">
              <span className="font-medium">{customer.name}</span>
              {customer.contact_person ? ` · ${customer.contact_person}` : ""}
              {customer.phone ? ` · ${customer.phone}` : ""}
              {kind === "similar" ? <span className="text-amber-700/70 dark:text-amber-400/70"> (similar)</span> : null}
            </span>
            {onUse && (
              <button
                type="button"
                onClick={() => onUse(customer)}
                className="shrink-0 font-medium text-amber-900 underline hover:no-underline dark:text-amber-200"
              >
                Use this one
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400/80">
        Saving anyway will create a second record. Two customers can share a name —
        duplicates can be merged later from the Customers page.
      </p>
    </div>
  );
}
