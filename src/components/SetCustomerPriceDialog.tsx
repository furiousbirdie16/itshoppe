import { useEffect, useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomerSearch } from "@/components/CustomerSearch";
import { ItemSearch } from "@/components/ItemSearch";
import { getCustomers, getItems, getItemsWithStock } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Optional preset to lock the customer */
  customerId?: string;
  /** Optional preset to lock the item */
  itemId?: string;
  variationId?: string | null;
  initialPrice?: number;
  editingId?: string | null;
}

export function SetCustomerPriceDialog({
  open,
  onOpenChange,
  customerId,
  itemId,
  variationId = null,
  initialPrice,
  editingId,
}: Props) {
  const qc = useQueryClient();
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  // Stock shown by ItemSearch must come from item_branch_stock, not items.quantity.
  const { data: items = [] } = useQuery({ queryKey: ["items-with-stock"], queryFn: () => getItemsWithStock() });

  const [cust, setCust] = useState(customerId || "");
  const [item, setItem] = useState(itemId || "");
  const [variation, setVariation] = useState<string | null>(variationId);
  const [price, setPrice] = useState(initialPrice != null ? String(initialPrice) : "");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setCust(customerId || "");
      setItem(itemId || "");
      setVariation(variationId);
      setPrice(initialPrice != null ? String(initialPrice) : "");
      setNotes("");
    }
  }, [open, customerId, itemId, variationId, initialPrice]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!cust) throw new Error("Select a customer");
      if (!item) throw new Error("Select a product");
      const p = parseFloat(price);
      if (Number.isNaN(p) || p < 0) throw new Error("Enter a valid price");

      const { data: { user } } = await supabase.auth.getUser();

      if (editingId) {
        const { error } = await (supabase as any)
          .from("customer_prices")
          .update({ fixed_price: p, notes })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        // Upsert by (customer, item, variation)
        let q = (supabase as any)
          .from("customer_prices")
          .select("id")
          .eq("customer_id", cust)
          .eq("item_id", item);
        q = variation ? q.eq("variation_id", variation) : q.is("variation_id", null);
        const { data: existing } = await q.maybeSingle();
        if (existing) {
          const { error } = await (supabase as any)
            .from("customer_prices")
            .update({ fixed_price: p, notes, created_by_email: user?.email ?? null })
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await (supabase as any).from("customer_prices").insert({
            customer_id: cust,
            item_id: item,
            variation_id: variation,
            fixed_price: p,
            notes,
            created_by_email: user?.email ?? null,
          });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer_prices"] });
      toast.success("Customer price saved");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">{editingId ? "Edit Customer Price" : "Set Customer Price"}</DialogTitle>
          <DialogDescription className="text-xs">
            Sets a fixed price for this customer + product. Auto-applies on quotations and invoices.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Customer</Label>
            <CustomerSearch customers={customers} value={cust} onChange={setCust} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Product</Label>
            <ItemSearch
              items={items}
              value={item}
              variationId={variation}
              onChange={(itemId, _it, _name, v) => {
                setItem(itemId || "");
                setVariation(v?.id ?? null);
              }}
              placeholder="Search product..."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Fixed Price (PHP)</Label>
            <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="h-9" placeholder="0.00" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="resize-none text-sm" />
          </div>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="rounded-lg h-9">
            Save Customer Price
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SetCustomerPriceDialog;
