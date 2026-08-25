-- Candidate applications and their configured stages are authoritative in ATS v2.
-- The legacy candidates.stage column remains as a compatibility projection, so its
-- old hardcoded check must not reject job-specific or newly configured stage keys.
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_stage;
