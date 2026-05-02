import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CustomerSearch } from "@/components/CustomerSearch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createCustomer } from "@/lib/api";
import type { Customer } from "@/types/database";

interface Props {
  customers: Customer[];
  value: string;
  onChange: (id: string) => void;
}

export function CustomerSearchWithCreate({ customers, value, onChange }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", contact_person: "", email: "", phone: "", address: "" });

  const createMut = useMutation({
    mutationFn: (data: Partial<Customer>) => createCustomer(data),
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer created");
      if (created?.id) onChange(created.id);
      setOpen(false);
      setForm({ name: "", contact_person: "", email: "", phone: "", address: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="flex gap-1.5">
      <div className="flex-1">
        <CustomerSearch customers={customers} value={value} onChange={onChange} />
      </div>
      <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setOpen(true)} title="New customer">
        <Plus className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-lg">New Customer</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Contact Person</Label>
                <Input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Phone</Label>
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Email</Label>
              <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Address</Label>
              <Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="resize-none" rows={2} />
            </div>
            <Button
              onClick={() => {
                if (!form.name.trim()) { toast.error("Name is required"); return; }
                createMut.mutate(form);
              }}
              disabled={createMut.isPending}
              className="mt-2 rounded-lg h-9"
            >
              {createMut.isPending ? "Creating..." : "Create Customer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
