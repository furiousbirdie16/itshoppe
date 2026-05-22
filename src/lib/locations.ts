import { supabase } from "@/integrations/supabase/client";

export interface CountryRow { code: string; name: string }
export interface RegionRow { name: string }
export interface CityRow { name: string }
export interface BarangayRow { name: string }

export const getCountries = async (): Promise<CountryRow[]> => {
  const { data, error } = await supabase
    .from("locations_country")
    .select("code, name")
    .order("name");
  if (error) throw error;
  return (data || []) as CountryRow[];
};

export const getRegions = async (countryCode: string): Promise<RegionRow[]> => {
  if (!countryCode) return [];
  const { data, error } = await supabase
    .from("locations_region")
    .select("name")
    .eq("country_code", countryCode)
    .order("name");
  if (error) throw error;
  return (data || []) as RegionRow[];
};

export const getCities = async (countryCode: string, regionName: string): Promise<CityRow[]> => {
  if (!countryCode || !regionName) return [];
  const { data, error } = await supabase
    .from("locations_city")
    .select("name")
    .eq("country_code", countryCode)
    .eq("region_name", regionName)
    .order("name");
  if (error) throw error;
  return (data || []) as CityRow[];
};

export const getBarangays = async (
  countryCode: string,
  regionName: string,
  cityName: string,
): Promise<BarangayRow[]> => {
  if (!countryCode || !regionName || !cityName) return [];
  const { data, error } = await supabase
    .from("locations_barangay")
    .select("name")
    .eq("country_code", countryCode)
    .eq("region_name", regionName)
    .eq("city_name", cityName)
    .order("name");
  if (error) throw error;
  return (data || []) as BarangayRow[];
};

/** Build a one-line location label for chips/lists. */
export function formatLocationChip(c: {
  country?: string | null;
  province_state?: string | null;
  city_municipality?: string | null;
}): string {
  const parts = [c.city_municipality, c.province_state].filter(Boolean) as string[];
  if (parts.length > 0) return parts.join(", ");
  return c.country || "";
}
