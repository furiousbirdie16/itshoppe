import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMarginTarget, setMarginTarget } from "@/lib/landed-cost-api";

/** Settings card for the margin below which admins are warned. */
export function MarginTargetCard() {
  const queryClient = useQueryClient();
  const { data: target } = useQuery({ queryKey: ["margin-target"], queryFn: getMarginTarget });
  const [value, setValue] = useState("");
  useEffect(() => { if (target !== undefined) setValue(String(target)); }, [target]);

  const save = async () => {
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct < 0 || pct >= 100) { toast.error("Enter a percentage from 0 to 99"); return; }
    try {
      await setMarginTarget(pct);
      await queryClient.invalidateQueries({ queryKey: ["margin-target"] });
      toast.success("Margin target saved");
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    }
  };

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Percent className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Margin warning</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Items whose margin falls below this are flagged for admins — in Inventory and when reviewing landed costs.
        Margin is (selling price − cost) ÷ selling price.
      </p>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Warn below (%)</Label>
        <Input type="number" min={0} max={99} step="0.5" value={value} onChange={(e) => setValue(e.target.value)} className="h-9" />
      </div>
      <Button size="sm" className="w-full h-8 text-xs" onClick={save}>
        <Save className="h-3 w-3 mr-1.5" /> Save
      </Button>
    </div>
  );
}
