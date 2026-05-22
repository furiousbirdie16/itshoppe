
-- 1. Customer location columns
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'Philippines',
  ADD COLUMN IF NOT EXISTS province_state text,
  ADD COLUMN IF NOT EXISTS city_municipality text,
  ADD COLUMN IF NOT EXISTS district_area text,
  ADD COLUMN IF NOT EXISTS barangay_village text,
  ADD COLUMN IF NOT EXISTS full_address text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric;

CREATE INDEX IF NOT EXISTS idx_customers_country ON public.customers(country);
CREATE INDEX IF NOT EXISTS idx_customers_province ON public.customers(province_state);
CREATE INDEX IF NOT EXISTS idx_customers_city ON public.customers(city_municipality);

-- 2. Reference tables
CREATE TABLE IF NOT EXISTS public.locations_country (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.locations_region (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, name)
);

CREATE TABLE IF NOT EXISTS public.locations_city (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  region_name text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, region_name, name)
);

CREATE TABLE IF NOT EXISTS public.locations_barangay (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL DEFAULT 'PH',
  region_name text NOT NULL,
  city_name text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, region_name, city_name, name)
);

CREATE INDEX IF NOT EXISTS idx_locations_region_country ON public.locations_region(country_code);
CREATE INDEX IF NOT EXISTS idx_locations_city_region ON public.locations_city(country_code, region_name);
CREATE INDEX IF NOT EXISTS idx_locations_barangay_city ON public.locations_barangay(country_code, region_name, city_name);

ALTER TABLE public.locations_country ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations_region ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations_city ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations_barangay ENABLE ROW LEVEL SECURITY;

-- Policies: anyone authenticated reads; only admins write
DO $$ BEGIN
  CREATE POLICY "Auth view countries" ON public.locations_country FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admin manage countries" ON public.locations_country FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auth view regions" ON public.locations_region FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admin manage regions" ON public.locations_region FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auth view cities" ON public.locations_city FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admin manage cities" ON public.locations_city FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auth view barangays" ON public.locations_barangay FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admin manage barangays" ON public.locations_barangay FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Seed countries
INSERT INTO public.locations_country (code, name) VALUES
  ('PH','Philippines'),('US','United States'),('CN','China'),('JP','Japan'),
  ('SG','Singapore'),('MY','Malaysia'),('TH','Thailand'),('VN','Vietnam'),
  ('ID','Indonesia'),('HK','Hong Kong'),('TW','Taiwan'),('KR','South Korea'),
  ('AU','Australia'),('CA','Canada'),('GB','United Kingdom'),('AE','United Arab Emirates')
ON CONFLICT (code) DO NOTHING;

-- 4. Seed Philippine regions/provinces
INSERT INTO public.locations_region (country_code, name) VALUES
  ('PH','Metro Manila'),
  ('PH','Abra'),('PH','Agusan del Norte'),('PH','Agusan del Sur'),('PH','Aklan'),
  ('PH','Albay'),('PH','Antique'),('PH','Apayao'),('PH','Aurora'),('PH','Basilan'),
  ('PH','Bataan'),('PH','Batanes'),('PH','Batangas'),('PH','Benguet'),('PH','Biliran'),
  ('PH','Bohol'),('PH','Bukidnon'),('PH','Bulacan'),('PH','Cagayan'),('PH','Camarines Norte'),
  ('PH','Camarines Sur'),('PH','Camiguin'),('PH','Capiz'),('PH','Catanduanes'),('PH','Cavite'),
  ('PH','Cebu'),('PH','Cotabato'),('PH','Davao de Oro'),('PH','Davao del Norte'),('PH','Davao del Sur'),
  ('PH','Davao Occidental'),('PH','Davao Oriental'),('PH','Dinagat Islands'),('PH','Eastern Samar'),
  ('PH','Guimaras'),('PH','Ifugao'),('PH','Ilocos Norte'),('PH','Ilocos Sur'),('PH','Iloilo'),
  ('PH','Isabela'),('PH','Kalinga'),('PH','La Union'),('PH','Laguna'),('PH','Lanao del Norte'),
  ('PH','Lanao del Sur'),('PH','Leyte'),('PH','Maguindanao'),('PH','Marinduque'),('PH','Masbate'),
  ('PH','Misamis Occidental'),('PH','Misamis Oriental'),('PH','Mountain Province'),
  ('PH','Negros Occidental'),('PH','Negros Oriental'),('PH','Northern Samar'),('PH','Nueva Ecija'),
  ('PH','Nueva Vizcaya'),('PH','Occidental Mindoro'),('PH','Oriental Mindoro'),('PH','Palawan'),
  ('PH','Pampanga'),('PH','Pangasinan'),('PH','Quezon'),('PH','Quirino'),('PH','Rizal'),
  ('PH','Romblon'),('PH','Samar'),('PH','Sarangani'),('PH','Siquijor'),('PH','Sorsogon'),
  ('PH','South Cotabato'),('PH','Southern Leyte'),('PH','Sultan Kudarat'),('PH','Sulu'),
  ('PH','Surigao del Norte'),('PH','Surigao del Sur'),('PH','Tarlac'),('PH','Tawi-Tawi'),
  ('PH','Zambales'),('PH','Zamboanga del Norte'),('PH','Zamboanga del Sur'),('PH','Zamboanga Sibugay')
ON CONFLICT DO NOTHING;

-- 5. Seed major cities (subset)
INSERT INTO public.locations_city (country_code, region_name, name) VALUES
  -- Metro Manila
  ('PH','Metro Manila','Manila'),('PH','Metro Manila','Quezon City'),('PH','Metro Manila','Makati'),
  ('PH','Metro Manila','Pasig'),('PH','Metro Manila','Taguig'),('PH','Metro Manila','Pasay'),
  ('PH','Metro Manila','Mandaluyong'),('PH','Metro Manila','Marikina'),('PH','Metro Manila','Parañaque'),
  ('PH','Metro Manila','Las Piñas'),('PH','Metro Manila','Muntinlupa'),('PH','Metro Manila','Caloocan'),
  ('PH','Metro Manila','Malabon'),('PH','Metro Manila','Navotas'),('PH','Metro Manila','Valenzuela'),
  ('PH','Metro Manila','San Juan'),('PH','Metro Manila','Pateros'),
  -- Cebu
  ('PH','Cebu','Cebu City'),('PH','Cebu','Mandaue'),('PH','Cebu','Lapu-Lapu'),('PH','Cebu','Talisay'),
  ('PH','Cebu','Toledo'),('PH','Cebu','Danao'),('PH','Cebu','Carcar'),
  -- Davao
  ('PH','Davao del Sur','Davao City'),('PH','Davao del Sur','Digos'),
  -- Cavite
  ('PH','Cavite','Bacoor'),('PH','Cavite','Imus'),('PH','Cavite','Dasmariñas'),('PH','Cavite','General Trias'),
  ('PH','Cavite','Tagaytay'),('PH','Cavite','Cavite City'),('PH','Cavite','Trece Martires'),
  -- Laguna
  ('PH','Laguna','Calamba'),('PH','Laguna','Santa Rosa'),('PH','Laguna','Biñan'),('PH','Laguna','San Pedro'),
  ('PH','Laguna','Cabuyao'),('PH','Laguna','San Pablo'),
  -- Bulacan
  ('PH','Bulacan','Malolos'),('PH','Bulacan','Meycauayan'),('PH','Bulacan','San Jose del Monte'),
  -- Pampanga
  ('PH','Pampanga','San Fernando'),('PH','Pampanga','Angeles'),('PH','Pampanga','Mabalacat'),
  -- Rizal
  ('PH','Rizal','Antipolo'),('PH','Rizal','Cainta'),('PH','Rizal','Taytay'),
  -- Batangas
  ('PH','Batangas','Batangas City'),('PH','Batangas','Lipa'),('PH','Batangas','Tanauan'),('PH','Batangas','Santo Tomas'),
  -- Iloilo
  ('PH','Iloilo','Iloilo City'),('PH','Iloilo','Passi'),
  -- Negros Occidental
  ('PH','Negros Occidental','Bacolod'),('PH','Negros Occidental','Silay'),('PH','Negros Occidental','Talisay'),
  -- Cagayan / Misamis Oriental
  ('PH','Misamis Oriental','Cagayan de Oro'),('PH','Misamis Oriental','El Salvador'),
  -- Pangasinan
  ('PH','Pangasinan','Dagupan'),('PH','Pangasinan','San Carlos'),('PH','Pangasinan','Urdaneta'),
  -- Baguio / Benguet
  ('PH','Benguet','Baguio'),('PH','Benguet','La Trinidad'),
  -- Zamboanga
  ('PH','Zamboanga del Sur','Zamboanga City'),('PH','Zamboanga del Sur','Pagadian')
ON CONFLICT DO NOTHING;

-- 6. Seed sample barangays (Manila / Quezon City / Makati / Cebu City)
INSERT INTO public.locations_barangay (country_code, region_name, city_name, name) VALUES
  ('PH','Metro Manila','Manila','Tondo'),('PH','Metro Manila','Manila','Binondo'),
  ('PH','Metro Manila','Manila','Sampaloc'),('PH','Metro Manila','Manila','Ermita'),
  ('PH','Metro Manila','Manila','Malate'),('PH','Metro Manila','Manila','Quiapo'),
  ('PH','Metro Manila','Manila','Santa Cruz'),('PH','Metro Manila','Manila','Paco'),
  ('PH','Metro Manila','Manila','Pandacan'),('PH','Metro Manila','Manila','Intramuros'),
  ('PH','Metro Manila','Quezon City','Diliman'),('PH','Metro Manila','Quezon City','Cubao'),
  ('PH','Metro Manila','Quezon City','Novaliches'),('PH','Metro Manila','Quezon City','Commonwealth'),
  ('PH','Metro Manila','Quezon City','Fairview'),('PH','Metro Manila','Quezon City','Batasan Hills'),
  ('PH','Metro Manila','Makati','Poblacion'),('PH','Metro Manila','Makati','Bel-Air'),
  ('PH','Metro Manila','Makati','San Lorenzo'),('PH','Metro Manila','Makati','Salcedo Village'),
  ('PH','Metro Manila','Makati','Legaspi Village'),('PH','Metro Manila','Makati','Forbes Park'),
  ('PH','Cebu','Cebu City','Lahug'),('PH','Cebu','Cebu City','Mabolo'),
  ('PH','Cebu','Cebu City','Banilad'),('PH','Cebu','Cebu City','Talamban')
ON CONFLICT DO NOTHING;
