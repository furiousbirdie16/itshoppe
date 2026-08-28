-- Record when a shipment reached the consolidator's warehouse in China.
--
-- shipment_tracking already carries ship_date, estimated_arrival and
-- actual_arrival, but none of those is the same thing: goods sit at the China
-- warehouse after the supplier delivers them and before anything is shipped
-- out, and that wait is what you watch when chasing a late order.

ALTER TABLE public.shipment_tracking
  ADD COLUMN IF NOT EXISTS warehouse_received_date DATE;

COMMENT ON COLUMN public.shipment_tracking.warehouse_received_date IS
  'Date the goods were received at the China warehouse, before onward shipping.';
