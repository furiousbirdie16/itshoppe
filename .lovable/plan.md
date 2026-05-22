## Structured Customer Location System

Add cascading address fields (Country → Province → City → District → Barangay) plus optional Full Address, with PH-first data and international fallback.

### 1. Database (migration)

Add columns to `customers`:
- `country` (text, default 'Philippines')
- `province_state` (text)
- `city_municipality` (text)
- `district_area` (text)
- `barangay_village` (text)
- `full_address` (text) — manual override / extra detail
- `postal_code` (text)
- `latitude` (numeric)
- `longitude` (numeric)

Keep existing `address` field as legacy / display fallback. Add indexes on country, province_state, city_municipality for filter performance.

Reference tables (lightweight, seeded for PH; free-text for other countries):
- `locations_country` (code, name)
- `locations_region` (country_code, name) — for PH provinces/regions
- `locations_city` (region_name, country_code, name)
- `locations_barangay` (city_name, region_name, name) — optional, only where curated

Seed PH with ~17 regions, top ~50 major cities, and a handful of well-known barangays. For unknown values, the form falls back to free-text input ("Add custom…"). Admin-only override allowed; all users may type custom values (per request: "Make available for all users").

### 2. Reusable component

`src/components/AddressSelector.tsx`:
- Five searchable comboboxes (using existing `FilterCombobox` pattern + Command).
- Cascading: changing a higher level clears lower levels.
- Each combobox supports "Add custom…" free-text entry.
- Country defaults to Philippines; switching country hides PH cascade and shows generic text inputs for province/city.
- Includes `Full Address` textarea + `Postal Code` input.
- Province and City rendered larger / emphasized.
- Mobile-friendly: stacked layout under `sm:`, two-column above.
- Caches reference data via React Query (`staleTime: Infinity`).

### 3. Customer form integration

Update `CustomersPage.tsx` dialog:
- Replace single `address` textarea with `<AddressSelector />`.
- Persist all structured fields on create/update.
- Show a small location chip in the table: `City, Province` (or country if non-PH).

### 4. Filtering on Customers page

Add filter comboboxes for Country, Province, City. Reuse `FilterCombobox`. Options derived from current customer dataset (only show values that exist), matching existing agent filter pattern.

### 5. Geographic analytics (admin only)

In `DashboardAnalytics.tsx` add two cards:
- **Customers per Province** (bar chart, top 10)
- **Customers per City** (bar chart, top 10)
- **Sales by Location** (table: city, # customers, total sales) using existing invoice aggregation.

Gated to admin via existing `useAdmin` check.

### 6. Export

Add "Export Locations" button on Customers page that downloads CSV with all structured fields. Use existing `ExportButton` pattern.

### 7. API layer

`src/lib/api.ts` additions:
- `getCountries()`, `getRegions(country)`, `getCities(country, region)`, `getBarangays(city, region)` — cached.
- `getCustomersByLocation()` aggregator for analytics.

### Technical notes

- All location reference tables: public SELECT, admin-only write. Custom typed values are stored directly on the customer record (no write to reference tables required from non-admins).
- Validation: if structured fields are partially filled, that's fine. Full Address is always optional. No hard province↔city validation enforced server-side beyond the seeded reference (since users can type custom).
- Existing `address` column kept; populated from `full_address` on save for backward compatibility with current views/PDF.

### Out of scope (not requested explicitly)

- Geocoding / map picker for lat/lng (columns added but left null; future enhancement).
- SMS/shipping rate integrations.
