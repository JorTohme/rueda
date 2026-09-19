ALTER TABLE financial_movements
  ADD COLUMN IF NOT EXISTS application_slug TEXT,
  ADD COLUMN IF NOT EXISTS trip_count INTEGER,
  ADD COLUMN IF NOT EXISTS recipient TEXT;

ALTER TABLE financial_movements
  DROP CONSTRAINT IF EXISTS financial_movements_trip_count_check,
  ADD CONSTRAINT financial_movements_trip_count_check CHECK (trip_count IS NULL OR trip_count >= 0),
  DROP CONSTRAINT IF EXISTS financial_movements_recipient_check,
  ADD CONSTRAINT financial_movements_recipient_check CHECK (recipient IS NULL OR recipient IN ('owner', 'driver'));
