-- Warranty tracking, phase 1: which unit went out on which invoice.
--
-- A customer who buys the same model three times over three months and returns
-- one of them cannot be told which. Inventory is quantities — an item is a row
-- holding a number — so three identical units are indistinguishable by design,
-- and there is nothing to hang a warranty date on.
--
-- Serials are captured at the SALE, not at receiving. The only question ever
-- asked is "which invoice did this unit leave on", so that is the only fact
-- worth storing; receiving, stock counts and dispatch are left alone. Phase 1
-- records and looks up. The camera, the paid-or-shipped check and the release
-- flow come later.

-- ---------------------------------------------------------------------------
-- Which products ask for a serial, and for how long they are covered.
-- ---------------------------------------------------------------------------
ALTER TABLE public.items
  -- Off by default: a box of cable ties should never prompt for anything.
  ADD COLUMN IF NOT EXISTS track_serials BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warranty_months INTEGER NOT NULL DEFAULT 0
    CHECK (warranty_months >= 0);

-- ---------------------------------------------------------------------------
-- One row per unit sold.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sold_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Exactly as read off the label. A POE box carries several codes (MAC,
  -- serial, model) and staff may not always pick the same one, so whatever was
  -- captured is what we match on later — no parsing, no normalising away the
  -- difference between two codes that are genuinely different.
  serial TEXT NOT NULL CHECK (btrim(serial) <> ''),
  item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  invoice_item_id UUID REFERENCES public.invoice_items(id) ON DELETE SET NULL,
  -- The collection date, not the payment date: a customer who pays on the 1st
  -- and collects on the 10th is covered from the 10th. Null until the invoice
  -- ships, which is why an invoice left sitting at "paid" has to stay visible.
  warranty_starts_at DATE,
  -- Copied from the item at the moment of sale. Editing a product's warranty
  -- next year must not rewrite what was promised last year.
  warranty_months INTEGER NOT NULL DEFAULT 0 CHECK (warranty_months >= 0),
  -- active  = currently owned by that invoice
  -- released = came back; the serial is free to be sold again
  -- replaced = swapped out under a warranty claim
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released', 'replaced')),
  scanned_by_email TEXT NOT NULL DEFAULT '',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A serial may have ONE ACTIVE OWNER AT A TIME — not one appearance ever.
-- A plain unique constraint would block legitimate resale: a customer returns
-- an unopened unit, it goes back on the shelf and is sold to someone else.
-- Releasing the old row frees the serial and keeps it as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sold_units_active_serial
  ON public.sold_units(serial) WHERE status = 'active';

-- The claim lookup: scan a serial, find the sale.
CREATE INDEX IF NOT EXISTS idx_sold_units_serial ON public.sold_units(serial);
-- "What is still outstanding on this invoice" on every invoice view.
CREATE INDEX IF NOT EXISTS idx_sold_units_invoice ON public.sold_units(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sold_units_invoice_item ON public.sold_units(invoice_item_id);

-- ---------------------------------------------------------------------------
-- Who did what to a serial.
-- ---------------------------------------------------------------------------
-- Any staff member may release a returned unit, but releasing rewrites who owns
-- a warranty — the least trustworthy operation here — so every assignment,
-- release and replacement is recorded with a name against it.
CREATE TABLE IF NOT EXISTS public.serial_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sold_unit_id UUID REFERENCES public.sold_units(id) ON DELETE CASCADE,
  serial TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('assigned', 'released', 'replaced')),
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_serial_events_serial ON public.serial_events(serial, created_at DESC);

-- ---------------------------------------------------------------------------
-- Access. Anyone signed in sells and looks up; only admins delete.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sold_units TO authenticated;
GRANT ALL ON public.sold_units TO service_role;
ALTER TABLE public.sold_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view sold units"
  ON public.sold_units FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can record sold units"
  ON public.sold_units FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
-- Releases are a counter action, not an admin one: the unit is in the customer's
-- hand and the queue is waiting. The event log is what makes that safe.
CREATE POLICY "Authenticated can update sold units"
  ON public.sold_units FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can delete sold units"
  ON public.sold_units FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT, INSERT ON public.serial_events TO authenticated;
GRANT ALL ON public.serial_events TO service_role;
ALTER TABLE public.serial_events ENABLE ROW LEVEL SECURITY;

-- Append-only by design: an audit trail staff can edit is not one.
CREATE POLICY "Authenticated can view serial events"
  ON public.serial_events FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can write serial events"
  ON public.serial_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
