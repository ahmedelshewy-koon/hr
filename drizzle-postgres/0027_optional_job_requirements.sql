-- Basic job creation does not require structured matching criteria. When
-- criteria are supplied, their weights must still total 100 percent.
CREATE OR REPLACE FUNCTION enforce_open_job_requirement_weights() RETURNS trigger AS $$
DECLARE
  total_weight double precision;
  requirement_count bigint;
BEGIN
  IF NEW.status='open' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.requirements_version IS DISTINCT FROM NEW.requirements_version) THEN
    SELECT COUNT(*), COALESCE(SUM(weight),0)
      INTO requirement_count, total_weight
      FROM job_requirements
      WHERE job_id=NEW.id AND active=1 AND version=NEW.requirements_version;
    IF requirement_count > 0 AND abs(total_weight-100.0)>0.001 THEN
      RAISE EXCEPTION 'Open job requirement weights must total 100%% (current total: %)',total_weight USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
