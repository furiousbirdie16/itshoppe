-- Add warehouse and store stock columns to items
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS warehouse_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS store_quantity integer NOT NULL DEFAULT 0;

-- Migrate: put existing quantity into warehouse_quantity (one-time)
UPDATE public.items
SET warehouse_quantity = quantity, store_quantity = 0
WHERE warehouse_quantity = 0 AND store_quantity = 0 AND quantity > 0;

-- Trigger to keep quantity = warehouse_quantity + store_quantity automatically
CREATE OR REPLACE FUNCTION public.sync_item_total_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.quantity := COALESCE(NEW.warehouse_quantity, 0) + COALESCE(NEW.store_quantity, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS items_sync_total_quantity ON public.items;
CREATE TRIGGER items_sync_total_quantity
BEFORE INSERT OR UPDATE OF warehouse_quantity, store_quantity ON public.items
FOR EACH ROW
EXECUTE FUNCTION public.sync_item_total_quantity();

-- Extend movement_type enum to include transfers (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'transfer_w2s' AND enumtypid = 'public.movement_type'::regtype) THEN
    ALTER TYPE public.movement_type ADD VALUE 'transfer_w2s';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'transfer_s2w' AND enumtypid = 'public.movement_type'::regtype) THEN
    ALTER TYPE public.movement_type ADD VALUE 'transfer_s2w';
  END IF;
END $$;