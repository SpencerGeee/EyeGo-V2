-- Approval never set Vehicle.isVerified, and the matcher dispatches only to verified
-- vehicles: every admin-approved driver was online but never offered a ride.
-- Approval now verifies the active vehicle; this backfills drivers approved before.
UPDATE "Vehicle" v
   SET "isVerified" = true
  FROM "Driver" d
 WHERE v."driverId" = d."id"
   AND d."status" = 'ACTIVE'
   AND v."isActive" = true
   AND v."isVerified" = false;
