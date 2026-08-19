-- Vehicle colour.
--
-- The driver app's onboarding form has asked for the vehicle's colour since it
-- was written, and the admin driver page renders a "Colour" row, but there was
-- no column behind either of them. Nullable because every existing row predates
-- the field and there is no sane value to backfill.
ALTER TABLE "Vehicle" ADD COLUMN "colour" TEXT;
