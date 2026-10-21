import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddressSelector, emptyAddress, type AddressValue } from "@/components/AddressSelector";
import { TagsInput, normalizeTag, tagKey } from "@/components/TagsInput";
import { SuggestInput } from "@/components/SuggestInput";
import { DuplicateCustomerWarning } from "@/components/DuplicateCustomerWarning";
import { ResellerSelect } from "@/components/ResellerSelect";
import { CLASSIFICATIONS, type ClassificationValue } from "@/lib/followUps";
import type { Customer } from "@/types/database";

export interface CustomerFormValue {
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  channel: string;
  classification: ClassificationValue;
  tags: string[];
  reseller_id: string | null;
}

export const emptyCustomerForm = (): CustomerFormValue => ({
  name: "", contact_person: "", email: "", phone: "", channel: "", classification: "retail", tags: [], reseller_id: null,
});

export { emptyAddress };

export function customerToForm(c: Customer): CustomerFormValue {
  return {
    name: c.name,
    contact_person: c.contact_person,
    email: c.email,
    phone: c.phone,
    channel: c.channel || "",
    classification: (c.classification as ClassificationValue) || "retail",
    tags: Array.isArray(c.tags) ? c.tags : [],
    reseller_id: c.reseller_id ?? null,
  };
}

/**
 * What gets saved, from the form. Shared so the Customers page and the
 * quick-add on an invoice save a customer the same way.
 */
export function buildCustomerPayload(
  form: CustomerFormValue,
  address: AddressValue,
  /** The reseller the customer had before this edit, if any. */
  previousResellerId?: string | null,
): Partial<Customer> {
  const composedLegacy = [address.full_address, address.barangay_village, address.district_area, address.city_municipality, address.province_state, address.country, address.postal_code]
    .filter(Boolean).join(", ");
  // Dedupe tags by key while preserving user-entered casing
  const seen = new Set<string>();
  const cleanTags: string[] = [];
  for (const t of form.tags) {
    const c = normalizeTag(t);
    const k = tagKey(c);
    if (!c || seen.has(k)) continue;
    seen.add(k);
    cleanTags.push(c);
  }
  // An individual customer has no company name, so the contact person becomes
  // the name every other screen already prints — invoices included.
  const name = form.name.trim() || form.contact_person.trim();
  const payload: Partial<Customer> = {
    ...form,
    name,
    tags: cleanTags,
    // A reseller is the source, never the one sourced.
    reseller_id: form.classification === "reseller" ? null : form.reseller_id,
    country: address.country || null,
    province_state: address.province_state || null,
    city_municipality: address.city_municipality || null,
    district_area: address.district_area || null,
    barangay_village: address.barangay_village || null,
    full_address: address.full_address || null,
    postal_code: address.postal_code || null,
    address: composedLegacy,
  };
  // Left out when there is nothing to say, so saving a customer keeps working
  // on a database that has not had the reseller column added yet.
  if (!payload.reseller_id && !previousResellerId) delete payload.reseller_id;
  return payload;
}

interface Props {
  form: CustomerFormValue;
  setForm: (f: CustomerFormValue) => void;
  address: AddressValue;
  setAddress: (a: AddressValue) => void;
  customers: Customer[];
  /** The customer being edited, so it is not flagged as its own duplicate. */
  editingId?: string | null;
  /** Offered on the duplicate warning: use the existing customer instead. */
  onUseExisting?: (c: Customer) => void;
}

/**
 * The customer fields, in one place. The Customers page and the quick-add on
 * an invoice used to keep a copy each, and the copies drifted apart.
 */
export function CustomerFormFields({ form, setForm, address, setAddress, customers, editingId, onUseExisting }: Props) {
  const channelOptions = useMemo(() => customers.map((c) => c.channel || ""), [customers]);

  const tagOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) {
      const tags = Array.isArray(c.tags) ? c.tags : [];
      for (const t of tags) {
        const clean = normalizeTag(t);
        if (!clean) continue;
        const k = tagKey(clean);
        if (!map.has(k)) map.set(k, clean);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
  }, [customers]);

  const resellers = useMemo(
    () => customers
      .filter((c) => c.classification === "reseller")
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [customers],
  );

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Company Name</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9" placeholder="Leave blank for an individual" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Contact Person</Label>
        <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="h-9" />
        <p className="text-[10px] text-muted-foreground">Used as the customer's name when there is no company name.</p>
      </div>
      {/* Whichever of the two becomes the customer's name is the one to
          check, the same way the save does it. */}
      <DuplicateCustomerWarning
        name={form.name.trim() || form.contact_person.trim()}
        customers={customers}
        excludeId={editingId ?? undefined}
        onUse={onUseExisting}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Contact Number</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Email</Label>
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-9" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Channel</Label>
          <SuggestInput
            value={form.channel}
            onChange={(channel) => setForm({ ...form, channel })}
            options={channelOptions}
            placeholder="e.g. Viber, Messenger, Walk-in"
            className="h-9"
          />
        </div>
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
      </div>

      {form.classification !== "reseller" && (
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Came through reseller</Label>
          <ResellerSelect
            value={form.reseller_id}
            onChange={(reseller_id) => setForm({ ...form, reseller_id })}
            resellers={resellers}
            excludeId={editingId}
          />
          {resellers.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              No resellers yet. To add one, set a customer's Classification to Reseller.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Address</Label>
        <AddressSelector value={address} onChange={setAddress} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Tags</Label>
        <TagsInput
          value={form.tags}
          onChange={(tags) => setForm({ ...form, tags })}
          suggestions={tagOptions}
          placeholder="Add tag (e.g. VIP, Cat6)"
        />
        <p className="text-[10px] text-muted-foreground">Tags are reusable across customers. Case and extra spaces are normalized automatically.</p>
      </div>
    </>
  );
}
