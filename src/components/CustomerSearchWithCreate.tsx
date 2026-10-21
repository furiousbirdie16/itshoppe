import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CustomerSearch } from "@/components/CustomerSearch";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createCustomer } from "@/lib/api";
import type { Customer } from "@/types/database";
import { emptyAddress, type AddressValue } from "@/components/AddressSelector";
import { CustomerFormFields, buildCustomerPayload, emptyCustomerForm, type CustomerFormValue } from "@/components/CustomerFormFields";

interface Props {
  customers: Customer[];
  value: string;
  onChange: (id: string) => void;
}

export function CustomerSearchWithCreate({ customers, value, onChange }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CustomerFormValue>(emptyCustomerForm());
  const [address, setAddress] = useState<AddressValue>(emptyAddress());

  const reset = () => {
    setForm(emptyCustomerForm());
    setAddress(emptyAddress());
  };

  const createMut = useMutation({
    mutationFn: (data: Partial<Customer>) => createCustomer(data),
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer created");
      if (created?.id) onChange(created.id);
      setOpen(false);
      reset();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSubmit = () => {
    // An individual has no company name; the contact person stands in for it,
    // as it does on the Customers page.
    if (!(form.name.trim() || form.contact_person.trim())) { toast.error("Enter a company name or a contact person"); return; }
    createMut.mutate(buildCustomerPayload(form, address));
  };

  return (
    <div className="flex gap-1.5">
      <div className="flex-1">
        <CustomerSearch customers={customers} value={value} onChange={onChange} />
      </div>
      <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setOpen(true)} title="New customer">
        <Plus className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">New Customer</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            {/* The same fields as the Customers page, from the same component.
                Mid-invoice is where duplicates get made, so the warning here
                offers the existing customer rather than only warning. */}
            <CustomerFormFields
              form={form}
              setForm={setForm}
              address={address}
              setAddress={setAddress}
              customers={customers}
              onUseExisting={(c) => { onChange(c.id); setOpen(false); reset(); }}
            />
            <Button onClick={handleSubmit} disabled={createMut.isPending} className="mt-2 rounded-lg h-9">
              {createMut.isPending ? "Creating..." : "Create Customer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
