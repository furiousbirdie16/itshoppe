import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Check, ChevronsUpDown, MapPin, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCountries, getRegions, getCities, getBarangays } from "@/lib/locations";

export interface AddressValue {
  country: string;
  province_state: string;
  city_municipality: string;
  district_area: string;
  barangay_village: string;
  full_address: string;
  postal_code: string;
}

export const emptyAddress = (): AddressValue => ({
  country: "Philippines",
  province_state: "",
  city_municipality: "",
  district_area: "",
  barangay_village: "",
  full_address: "",
  postal_code: "",
});

interface ComboProps {
  value: string;
  onChange: (v: string) => void;
  options: { name: string }[];
  placeholder: string;
  searchPlaceholder?: string;
  emphasize?: boolean;
  disabled?: boolean;
  allowCustom?: boolean;
}

function LocationCombo({ value, onChange, options, placeholder, searchPlaceholder = "Search...", emphasize, disabled, allowCustom = true }: ComboProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const matches = useMemo(() => {
    const exists = options.some((o) => o.name.toLowerCase() === value.toLowerCase());
    return { exists };
  }, [options, value]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn("w-full justify-between font-normal", emphasize ? "h-10 text-sm" : "h-9 text-sm", !value && "text-muted-foreground")}
        >
          <span className="truncate text-left">
            {value || placeholder}
            {value && !matches.exists && allowCustom && (
              <span className="ml-1.5 text-[10px] text-muted-foreground">(custom)</span>
            )}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={true}>
          <CommandInput placeholder={searchPlaceholder} className="h-9" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              {allowCustom && search.trim() ? (
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                  onClick={() => { onChange(search.trim()); setOpen(false); }}
                >
                  <Plus className="h-3.5 w-3.5" /> Use "{search.trim()}"
                </button>
              ) : (
                <span className="px-3 py-2 text-xs text-muted-foreground">No matches</span>
              )}
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.name}
                  value={o.name}
                  onSelect={() => { onChange(o.name); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === o.name ? "opacity-100" : "opacity-0")} />
                  {o.name}
                </CommandItem>
              ))}
              {allowCustom && search.trim() && !options.some((o) => o.name.toLowerCase() === search.trim().toLowerCase()) && (
                <CommandItem
                  value={`__custom__ ${search}`}
                  onSelect={() => { onChange(search.trim()); setOpen(false); }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Use "{search.trim()}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface Props {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
}

export function AddressSelector({ value, onChange }: Props) {
  const { data: countries = [] } = useQuery({
    queryKey: ["loc_countries"],
    queryFn: getCountries,
    staleTime: Infinity,
  });

  const countryCode = useMemo(() => {
    return countries.find((c) => c.name === value.country)?.code || "";
  }, [countries, value.country]);

  const { data: regions = [] } = useQuery({
    queryKey: ["loc_regions", countryCode],
    queryFn: () => getRegions(countryCode),
    enabled: !!countryCode,
    staleTime: Infinity,
  });

  const { data: cities = [] } = useQuery({
    queryKey: ["loc_cities", countryCode, value.province_state],
    queryFn: () => getCities(countryCode, value.province_state),
    enabled: !!countryCode && !!value.province_state,
    staleTime: Infinity,
  });

  const { data: barangays = [] } = useQuery({
    queryKey: ["loc_brgy", countryCode, value.province_state, value.city_municipality],
    queryFn: () => getBarangays(countryCode, value.province_state, value.city_municipality),
    enabled: !!countryCode && !!value.province_state && !!value.city_municipality,
    staleTime: Infinity,
  });

  const set = (patch: Partial<AddressValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3 rounded-lg border bg-card/30 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MapPin className="h-3.5 w-3.5" /> Address
      </div>

      {/* Country */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Country</Label>
        <LocationCombo
          value={value.country}
          onChange={(v) => set({ country: v, province_state: "", city_municipality: "", district_area: "", barangay_village: "" })}
          options={countries.map((c) => ({ name: c.name }))}
          placeholder="Select country"
          searchPlaceholder="Search countries..."
        />
      </div>

      {/* Province + City (emphasized, side by side on sm+) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-foreground">Province / State / Region *</Label>
          <LocationCombo
            value={value.province_state}
            onChange={(v) => set({ province_state: v, city_municipality: "", district_area: "", barangay_village: "" })}
            options={regions.map((r) => ({ name: r.name }))}
            placeholder="Select province"
            searchPlaceholder="Search or type..."
            emphasize
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-foreground">City / Municipality *</Label>
          <LocationCombo
            value={value.city_municipality}
            onChange={(v) => set({ city_municipality: v, district_area: "", barangay_village: "" })}
            options={cities.map((c) => ({ name: c.name }))}
            placeholder={value.province_state ? "Select city" : "Pick province first"}
            searchPlaceholder="Search or type..."
            emphasize
            disabled={!value.province_state}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">District / Area</Label>
          <LocationCombo
            value={value.district_area}
            onChange={(v) => set({ district_area: v })}
            options={[]}
            placeholder="Type district (optional)"
            searchPlaceholder="Type district..."
            disabled={!value.city_municipality}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Barangay / Village</Label>
          <LocationCombo
            value={value.barangay_village}
            onChange={(v) => set({ barangay_village: v })}
            options={barangays.map((b) => ({ name: b.name }))}
            placeholder={value.city_municipality ? "Select or type barangay" : "Pick city first"}
            searchPlaceholder="Search or type..."
            disabled={!value.city_municipality}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2 space-y-1.5">
          <Label className="text-xs font-medium">Full Address (street, building, unit)</Label>
          <Textarea
            value={value.full_address}
            onChange={(e) => set({ full_address: e.target.value })}
            rows={2}
            className="resize-none text-sm"
            placeholder="e.g. 123 Rizal St., Bldg A, Unit 4F"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Postal Code</Label>
          <Input
            value={value.postal_code}
            onChange={(e) => set({ postal_code: e.target.value })}
            className="h-9"
            placeholder="e.g. 1000"
          />
        </div>
      </div>
    </div>
  );
}
