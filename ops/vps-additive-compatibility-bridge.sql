-- SANA HR custom VPS lineage: additive compatibility bridge only.
-- NOT A REPLACEMENT for missing historical Drizzle migrations.
-- Intentionally preserves drizzle.__drizzle_migrations (33 records).
-- Apply only after verified off-production restore and approval.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.attendance_ingest_sources (
    id serial PRIMARY KEY,
    name text NOT NULL,
    key_hash text NOT NULL,
    key_hint text NOT NULL,
    enabled integer NOT NULL DEFAULT 1,
    last_seen_at timestamptz,
    last_ip text,
    last_error text,
    created_by_user_id integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_ingest_sources_key_hash
    ON public.attendance_ingest_sources USING btree (key_hash);
ALTER TABLE public.attendance_devices
    ADD COLUMN IF NOT EXISTS source_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_devices_source
    ON public.attendance_devices USING btree (source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id serial PRIMARY KEY,
    code text NOT NULL,
    name_ar text NOT NULL,
    name_en text NOT NULL,
    description_ar text,
    description_en text,
    features_ar text,
    features_en text,
    price double precision,
    currency text NOT NULL DEFAULT 'SAR',
    duration_months integer NOT NULL DEFAULT 1,
    max_employees integer,
    is_featured integer NOT NULL DEFAULT 0,
    show_on_landing integer NOT NULL DEFAULT 1,
    sort_order integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_code
    ON public.subscription_plans USING btree (upper(code));
CREATE TABLE IF NOT EXISTS public.integrations (
    id serial PRIMARY KEY,
    name text NOT NULL,
    base_url text NOT NULL DEFAULT '',
    auth_type text NOT NULL DEFAULT 'none',
    auth_config text,
    default_headers text,
    variables text,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.integration_requests (
    id serial PRIMARY KEY,
    integration_id integer NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
    name text NOT NULL,
    method text NOT NULL DEFAULT 'GET',
    path text NOT NULL DEFAULT '',
    params text,
    headers text,
    body_type text NOT NULL DEFAULT 'none',
    body text,
    path_vars text,
    description text,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_requests_integration
    ON public.integration_requests USING btree (integration_id);

DO $
DECLARE
    missing text;
BEGIN
    SELECT string_agg(name, ', ') INTO missing
    FROM (
        SELECT 'attendance_ingest_sources' name WHERE to_regclass('public.attendance_ingest_sources') IS NULL
        UNION ALL SELECT 'subscription_plans' WHERE to_regclass('public.subscription_plans') IS NULL
        UNION ALL SELECT 'integrations' WHERE to_regclass('public.integrations') IS NULL
        UNION ALL SELECT 'integration_requests' WHERE to_regclass('public.integration_requests') IS NULL
        UNION ALL SELECT 'attendance_devices.source_id' WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='attendance_devices' AND column_name='source_id'
        )
    ) t;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'Missing post-bridge HR schema objects: %', missing;
    END IF;
END $$;
COMMIT;
