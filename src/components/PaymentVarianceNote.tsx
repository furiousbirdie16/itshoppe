import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { setPaymentVarianceNote } from "@/lib/api";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  invoiceId: string;
  total: number;
  received: number;
  note: string;
  onSaved: () => void;
}

/**
 * The gap between what was invoiced and what arrived, and what it was for.
 *
 * The figure alone raises a question nobody can answer a week later, so the
 * note sits beside it and stays editable: the money often comes in before
 * anyone knows what the extra was settling.
 */
export function PaymentVarianceNote({ invoiceId, total, received, note, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);

  // A different invoice, or someone else's edit, should be what is shown.
  useEffect(() => { setDraft(note); setEditing(false); }, [note, invoiceId]);

  const saveMut = useMutation({
    mutationFn: () => setPaymentVarianceNote(invoiceId, draft),
    onSuccess: () => { setEditing(false); onSaved(); toast.success("Note saved"); },
    onError: (e: any) => toast.error(e.message || "Could not save the note"),
  });

  const diff = received - total;
  if (Math.abs(diff) <= 0.005) return null;
  const over = diff > 0;

  return (
    <div className={`mt-2 rounded-md border px-3 py-2 ${over ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" : "border-sky-300 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30"}`}>
      <p className={`text-xs font-medium ${over ? "text-amber-900 dark:text-amber-200" : "text-sky-900 dark:text-sky-200"}`}>
        {peso(Math.abs(diff))} {over ? "over" : "short"}
        <span className="font-normal">
          {" "}— invoiced {peso(total)}, received {peso(received)}
        </span>
      </p>

      {editing ? (
        <div className="mt-1.5 flex gap-1.5">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); saveMut.mutate(); }
              if (e.key === "Escape") { setDraft(note); setEditing(false); }
            }}
            placeholder={over ? "What is the excess for?" : "Why is it short?"}
            className="h-8 text-xs"
          />
          <Button size="icon" className="h-8 w-8 shrink-0" onClick={() => saveMut.mutate()} disabled={saveMut.isPending} title="Save">
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => { setDraft(note); setEditing(false); }} title="Cancel">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-1 flex w-full items-start gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          <Pencil className="mt-0.5 h-3 w-3 shrink-0" />
          <span className={note ? "" : "italic"}>
            {note || "No reason recorded — add one"}
          </span>
        </button>
      )}
    </div>
  );
}
