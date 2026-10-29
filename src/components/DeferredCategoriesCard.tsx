import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDeferredPayableCategories, setDeferredPayableCategories } from "@/lib/landed-cost-api";

/** Settings card: payable categories counted only from the month they are due. */
export function DeferredCategoriesCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["deferred-payable-categories"], queryFn: getDeferredPayableCategories });
  const [value, setValue] = useState("");
  useEffect(() => { if (data) setValue(data.join(", ")); }, [data]);

  const save = async () => {
    const list = [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))];
    try {
      await setDeferredPayableCategories(list);
      await queryClient.invalidateQueries({ queryKey: ["deferred-payable-categories"] });
      toast.success(list.length ? `Counted when due: ${list.join(", ")}` : "Every payable now counts in full");
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    }
  };

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Payables counted when due</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Payables in these categories (as written in their Category) count toward Net Asset Value only once due by the end
        of the month, and against spendable cash only once due within 30 days — for costs like rent, owed month by month.
        Every other payable, supplier checks included, counts in full.
      </p>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Categories, separated by commas</Label>
        <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-9" placeholder="Rent, Salaries" />
      </div>
      <Button size="sm" className="w-full h-8 text-xs" onClick={save}>
        <Save className="h-3 w-3 mr-1.5" /> Save
      </Button>
    </div>
  );
}
