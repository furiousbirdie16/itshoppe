import { supabase } from "@/integrations/supabase/client";

/** Phone, email and TIN printed under the company address on quotations and invoices. */
export interface CompanyContact {
  phone: string;
  email: string;
  tin: string;
}

const KEY = "company_contact";
export const emptyCompanyContact: CompanyContact = { phone: "", email: "", tin: "" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settings = () => (supabase as any).from("app_settings");

/** The saved details, or blanks — a blank line is simply not printed. */
export async function getCompanyContact(): Promise<CompanyContact> {
  const { data, error } = await settings().select("value").eq("key", KEY).maybeSingle();
  if (error || !data?.value) return emptyCompanyContact;
  return { ...emptyCompanyContact, ...data.value };
}

export async function saveCompanyContact(contact: CompanyContact): Promise<void> {
  const value: CompanyContact = {
    phone: contact.phone.trim(),
    email: contact.email.trim(),
    tin: contact.tin.trim(),
  };
  const { error } = await settings().upsert({ key: KEY, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}
