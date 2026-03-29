import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDocumentSequences, updateDocumentSequence } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Save } from "lucide-react";
import { toast } from "sonner";

const LABELS: Record<string, string> = {
  purchase_order: "Purchase Order",
  quotation: "Quotation",
  invoice: "Invoice",
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: sequences = [] } = useQuery({ queryKey: ["document_sequences"], queryFn: getDocumentSequences });
  const [edits, setEdits] = useState<Record<string, { prefix: string; next_number: string }>>({});

  useEffect(() => {
    if (sequences.length) {
      const map: typeof edits = {};
      sequences.forEach((s) => {
        map[s.id] = { prefix: s.prefix, next_number: String(s.next_number) };
      });
      setEdits(map);
    }
  }, [sequences]);

  const handleSave = async (id: string) => {
    const e = edits[id];
    if (!e) return;
    const num = parseInt(e.next_number);
    if (isNaN(num) || num < 1) {
      toast.error("Next number must be at least 1");
      return;
    }
    try {
      await updateDocumentSequence(id, { prefix: e.prefix.trim(), next_number: num });
      queryClient.invalidateQueries({ queryKey: ["document_sequences"] });
      toast.success(`${LABELS[id]} sequence updated`);
    } catch {
      toast.error("Failed to update");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure document numbering sequences</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-3">
        {Object.keys(LABELS).map((id) => {
          const e = edits[id];
          if (!e) return null;
          const preview = `${e.prefix}-${String(parseInt(e.next_number) || 1).padStart(5, "0")}`;
          return (
            <div key={id} className="rounded-xl border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">{LABELS[id]}</h3>
              </div>

              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Prefix</Label>
                  <Input
                    value={e.prefix}
                    onChange={(ev) => setEdits((p) => ({ ...p, [id]: { ...p[id], prefix: ev.target.value } }))}
                    className="h-9 mt-1"
                    placeholder="e.g. INV"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Next Number</Label>
                  <Input
                    type="number"
                    min={1}
                    value={e.next_number}
                    onChange={(ev) => setEdits((p) => ({ ...p, [id]: { ...p[id], next_number: ev.target.value } }))}
                    className="h-9 mt-1"
                  />
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Preview: <span className="font-mono font-medium text-foreground">{preview}</span>
              </div>

              <Button size="sm" className="w-full h-8 text-xs" onClick={() => handleSave(id)}>
                <Save className="h-3 w-3 mr-1.5" />
                Save
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
