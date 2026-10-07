-- "Notify me": a rider asks to hear when a shared trip to a destination opens.
CREATE TABLE "TripAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "destName" TEXT NOT NULL,
    "destLat" DOUBLE PRECISION NOT NULL,
    "destLng" DOUBLE PRECISION NOT NULL,
    "originLat" DOUBLE PRECISION,
    "originLng" DOUBLE PRECISION,
    "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "tripId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TripAlert_userId_idx" ON "TripAlert"("userId");
CREATE INDEX "TripAlert_expiresAt_idx" ON "TripAlert"("expiresAt");

ALTER TABLE "TripAlert" ADD CONSTRAINT "TripAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
