-- B4: a recurring schedule names the driver who runs it.
ALTER TABLE "PulseSchedule" ADD COLUMN "driverId" TEXT;
ALTER TABLE "PulseSchedule" ADD CONSTRAINT "PulseSchedule_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
