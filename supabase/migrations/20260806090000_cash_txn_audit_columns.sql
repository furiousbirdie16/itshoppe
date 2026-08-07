-- Track who recorded and who last edited each cash transaction. The email is
-- denormalised (same approach as activity_logs) because profiles RLS only lets a
-- user read their own row, so a join would show blanks for everyone else.
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS created_by_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_email TEXT NOT NULL DEFAULT '';
