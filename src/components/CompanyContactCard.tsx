import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emptyCompanyContact, getCompanyContact, saveCompanyContact, type CompanyContact } from "@/lib/company-contact";

/** Settings card for the phone, email and TIN in the quotation and invoice header. */
export function CompanyContactCard() {
  const queryClient = useQueryClient();
  const { data: saved, isLoading } = useQuery({ queryKey: ["company-contact"], queryFn: getCompanyContact });
  const [form, setForm] = useState<CompanyContact>(emptyCompanyContact);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (saved) setForm(saved);
  }, [saved]);

  const save = async () => {
    setBusy(true);
    try {
      await saveCompanyContact(form);
      await queryClient.invalidateQueries({ queryKey: ["company-contact"] });
      toast.success("Saved — new quotations and invoices will print these");
    } catch (e: any) {
      toast.error(e?.message || "Could not save the details");
    } finally {
      setBusy(false);
    }
  };

  const fields: { key: keyof CompanyContact; label: string; placeholder: string; type?: string }[] = [
    { key: "phone", label: "Phone", placeholder: "e.g. 0917 123 4567", type: "tel" },
    { key: "email", label: "Email", placeholder: "e.g. sales@itshoppe.ph", type: "email" },
    { key: "tin", label: "TIN", placeholder: "e.g. 123-456-789-000" },
  ];

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Document contact details</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Printed under the company address on quotations and invoices. Leave a field blank to keep it off.
      </p>

      <div className="space-y-3">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`company-${f.key}`} className="text-xs font-medium">{f.label}</Label>
            <Input
              id={`company-${f.key}`}
              type={f.type || "text"}
              value={form[f.key]}
              placeholder={f.placeholder}
              disabled={isLoading}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              className="h-9"
            />
          </div>
        ))}
      </div>

      <Button size="sm" className="w-full h-8 text-xs" disabled={busy || isLoading} onClick={save}>
        <Save className="h-3 w-3 mr-1.5" />
        Save
      </Button>
    </div>
  );
}
