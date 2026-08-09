-- Stop receiving a PO from overwriting an item's cost.
--
-- Receiving fired handle_po_item_received / handle_overseas_po_item_received,
-- which set items.cost_price to the PO's unit cost (times the exchange rate for
-- overseas) and wrote a cost-history entry tagged 'po_received'. That silently
-- replaced manually entered costs, and it recorded the supplier price alone —
-- freight, customs and delivery were never included, so the figure it wrote was
-- not the true landed cost anyway.
--
-- Costs are now maintained by hand via set_item_cost_manual (the Cost History
-- dialog), or by apply_overseas_po_cargo_adjustment when freight is allocated.
--
-- Only the triggers are dropped. Both functions are left in place, so restoring
-- the old behaviour is just a matter of recreating the triggers:
--
--   CREATE TRIGGER trg_po_item_cost_update
--     AFTER UPDATE OF received_quantity ON public.purchase_order_items
--     FOR EACH ROW EXECUTE FUNCTION public.handle_po_item_received();
--
--   CREATE TRIGGER trg_overseas_po_item_cost_update
--     AFTER UPDATE OF received_quantity ON public.overseas_purchase_order_items
--     FOR EACH ROW EXECUTE FUNCTION public.handle_overseas_po_item_received();

DROP TRIGGER IF EXISTS trg_po_item_cost_update ON public.purchase_order_items;
DROP TRIGGER IF EXISTS trg_overseas_po_item_cost_update ON public.overseas_purchase_order_items;
