-- Country a biometric device belongs to; NULL keeps the old behaviour (device user codes match employees of every country).
ALTER TABLE "attendance_devices" ADD COLUMN IF NOT EXISTS "country" text;
