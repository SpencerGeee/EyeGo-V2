-- Driver compliance documents, with expiry dates.
--
-- `Driver.documentReview` is a JSON blob holding a status per document and
-- nothing else: it can say a licence was verified, not when that licence
-- expires, and it has no entry for insurance or roadworthiness at all. A driver
-- approved in January with a certificate expiring in March therefore stayed
-- approved indefinitely, and the platform had no way to know it was dispatching
-- riders into an uninsured car.
--
-- This table is ADDITIVE. The existing licence and Ghana-card review path is
-- untouched and keeps using the blob; these rows carry the dates and the
-- document types that had nowhere to live.

CREATE TABLE "DriverDocument" (
  "id"              TEXT NOT NULL,
  "driverId"        TEXT NOT NULL,
  "type"            TEXT NOT NULL,
  "url"             TEXT,
  "number"          TEXT,
  "issuedAt"        TIMESTAMP(3),
  "expiresAt"       TIMESTAMP(3),
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "reviewedById"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DriverDocument_pkey" PRIMARY KEY ("id")
);

-- One row per document type per driver: re-uploading replaces rather than
-- accumulating, so "this driver's current insurance" is always a single row.
CREATE UNIQUE INDEX "DriverDocument_driverId_type_key"
  ON "DriverDocument" ("driverId", "type");

-- The nightly expiry sweep scans by date across every driver.
CREATE INDEX "DriverDocument_expiresAt_idx" ON "DriverDocument" ("expiresAt");

-- Cascade: a deleted driver's paperwork has no meaning and must not outlive
-- them, least of all under a data-protection request.
ALTER TABLE "DriverDocument"
  ADD CONSTRAINT "DriverDocument_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
