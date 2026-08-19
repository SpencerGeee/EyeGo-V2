-- WHO A TRIP REPORT IS ABOUT.
--
-- `TripReport` named only the trip, so on a shared van "report passenger" was a
-- report about the vehicle: the driver could not say which seat, and nothing
-- downstream could attach the report to a rider's standing. Reported as "it
-- just assumes it's one person".
--
-- Both columns are additive and NULLABLE, so this is safe to apply to a live
-- database: every existing row keeps meaning exactly what it meant (a
-- trip-level report), and every read path treats NULL as "no subject".
ALTER TABLE "TripReport" ADD COLUMN "bookingId" TEXT;
ALTER TABLE "TripReport" ADD COLUMN "reportedUserId" TEXT;

-- `standing.service` counts a rider's upheld reports on every fare quote, so
-- this lookup is on the hot pricing path and must not be a sequential scan.
CREATE INDEX "TripReport_reportedUserId_idx" ON "TripReport"("reportedUserId");
