-- Terms/privacy acceptance, and the app-review account flag.
--
-- Both stores expect a privacy policy link; a dispute or the Data Protection
-- Commission expects the record of WHICH version was accepted and WHEN. All
-- four columns are nullable: every account that already exists predates this,
-- and a null is treated exactly like an out-of-date version — re-prompt.
--
-- `isReviewer` defaults false and is set from the admin console on the two
-- seeded store-review accounts. See §2.6 of the production-readiness plan for
-- why an app-review account exists at all: Apple reviews from Cupertino, where
-- there are no EyeGo drivers, and "no drivers available" reads to a reviewer as
-- core functionality that does not work.

ALTER TABLE "User"
  ADD COLUMN "acceptedTermsVersion"   TEXT,
  ADD COLUMN "acceptedTermsAt"        TIMESTAMP(3),
  ADD COLUMN "acceptedPrivacyVersion" TEXT,
  ADD COLUMN "acceptedPrivacyAt"      TIMESTAMP(3),
  ADD COLUMN "isReviewer"             BOOLEAN NOT NULL DEFAULT false;

-- No index on isReviewer, deliberately. The flag is always read off a User row
-- that has already been loaded by id — nothing ever scans for reviewers. A
-- partial index would also be invisible to the Prisma schema, so every later
-- `migrate dev` would report it as drift and offer to reset the database.

-- The same four columns on Driver.
--
-- A Driver is not a User row: it carries its own phone and name and has no
-- userId, so a driver accepting the terms in the driver app has nowhere on User
-- to record it. Recording driver consent against a User would also be wrong on
-- the merits — they are separate legal relationships, and a person who is both
-- a rider and a driver accepts two different documents.
ALTER TABLE "Driver"
  ADD COLUMN "acceptedTermsVersion"   TEXT,
  ADD COLUMN "acceptedTermsAt"        TIMESTAMP(3),
  ADD COLUMN "acceptedPrivacyVersion" TEXT,
  ADD COLUMN "acceptedPrivacyAt"      TIMESTAMP(3);
