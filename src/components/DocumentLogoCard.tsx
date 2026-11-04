import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearDocumentLogo, getDocumentLogo, saveDocumentLogo } from "@/lib/document-logo";

/** Settings card for the logo printed on invoices, quotations and POs. */
export function DocumentLogoCard() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { data: logo, isLoading } = useQuery({ queryKey: ["document-logo"], queryFn: getDocumentLogo });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await saveDocumentLogo(file);
      await queryClient.invalidateQueries({ queryKey: ["document-logo"] });
      toast.success("Logo updated — new documents will print with it");
    } catch (e: any) {
      toast.error(e?.message || "Could not save the logo");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await clearDocumentLogo();
      await queryClient.invalidateQueries({ queryKey: ["document-logo"] });
      toast.success("Back to the built-in logo");
    } catch (e: any) {
      toast.error(e?.message || "Could not remove the logo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Document logo</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Printed at the top of invoices, quotations and purchase orders. PNG with a
        transparent background looks best; wide logos are fine.
      </p>

      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed bg-white p-3">
        {isLoading ? (
          <span className="text-xs text-muted-foreground">Loading…</span>
        ) : logo ? (
          <img src={logo.dataUrl} alt="Current document logo" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">Using the built-in logo</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <div className="flex gap-2">
        <Button size="sm" className="h-8 flex-1 text-xs" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload className="mr-1.5 h-3 w-3" />
          {logo ? "Replace logo" : "Upload logo"}
        </Button>
        {logo && (
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={reset} title="Go back to the built-in logo">
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
