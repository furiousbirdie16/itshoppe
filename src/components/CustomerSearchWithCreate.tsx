import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CustomerSearch } from "@/components/CustomerSearch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createCustomer } from "@/lib/api";
import type { Customer } from "@/types/database";
import { AddressSelector, emptyAddress, type AddressValue } from "@/components/AddressSelector";
import { CLASSIFICATIONS, type ClassificationValue } from "@/lib/followUps";
import { TagsInput, normalizeTag, tagKey } from "@/components/TagsInput";

interface Props {
  customers: Customer[];
  value: string;
  onChange: (id: string) => void;
}

export function CustomerSearchWithCreate({ customers, value, onChange }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; contact_person: string; email: string; phone: string; classification: ClassificationValue; tags: string[] }>({
    name: "", contact_person: "", email: "", phone: "", classification: "retail", tags: [],
  });
  const [address, setAddress] = useState<AddressValue>(emptyAddress());

  const tagSuggestions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) {
      const tags = Array.isArray((c as any).tags) ? ((c as any).tags as string[]) : [];
      for (const t of tags) {
        const clean = normalizeTag(t);
        if (!clean) continue;
        const k = tagKey(clean);
        if (!map.has(k)) map.set(k, clean);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [customers]);

  const reset = () => {
    setForm({ name: "", contact_person: "", email: "", phone: "", classification: "retail", tags: [] });
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
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    const composedLegacy = [address.full_address, address.barangay_village, address.district_area, address.city_municipality, address.province_state, address.country, address.postal_code]
      .filter(Boolean).join(", ");
    const seen = new Set<string>();
    const cleanTags: string[] = [];
    for (const t of form.tags) {
      const c = normalizeTag(t);
      const k = tagKey(c);
      if (!c || seen.has(k)) continue;
      seen.add(k);
      cleanTags.push(c);
    }
    createMut.mutate({
      ...form,
      tags: cleanTags,
      country: address.country || null,
      province_state: address.province_state || null,
      city_municipality: address.city_municipality || null,
      district_area: address.district_area || null,
      barangay_village: address.barangay_village || null,
      full_address: address.full_address || null,
      postal_code: address.postal_code || null,
      address: composedLegacy,
    });
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
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Classification</Label>
                <Select value={form.classification} onValueChange={(v) => setForm({ ...form, classification: v as ClassificationValue })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CLASSIFICATIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Tags</Label>
                <TagsInput value={form.tags} onChange={(tags) => setForm({ ...form, tags })} suggestions={tagSuggestions} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Address</Label>
              <AddressSelector value={address} onChange={setAddress} />
            </div>
            <Button onClick={handleSubmit} disabled={createMut.isPending} className="mt-2 rounded-lg h-9">
              {createMut.isPending ? "Creating..." : "Create Customer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
