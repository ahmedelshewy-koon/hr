# PostgreSQL configuration

Koon HR uses PostgreSQL through a single secret connection string named
`DATABASE_URL`. Never commit the real value to source control.

For local development, create `.dev.vars` in the project root:

```dotenv
DATABASE_URL=postgresql://koon_hr:YOUR_PASSWORD@127.0.0.1:5544/koon_hr
```

Then apply the schema and data migrations before starting the app:

```powershell
$env:DATABASE_URL = "postgresql://koon_hr:YOUR_PASSWORD@127.0.0.1:5544/koon_hr"
npm run db:migrate
npm run dev -- --host 127.0.0.1
```

The hosted environment must receive the same `DATABASE_URL` key with a
network-accessible PostgreSQL endpoint. A localhost address cannot be used by
the deployed site.

To enable training evaluations and certificates without applying unrelated
pending migrations, run `node scripts/apply-learning-migrations.mjs` from the
project root. It applies only the additive training migrations 0025 and 0026 in
one transaction. These migrations are idempotent; the regular Drizzle migration
command can still process the complete journal later. This selective command
does not advance the migration journal past any earlier pending entry.

Employee religion and passport number are nullable fields added by migration
`0028_employee_personal_details.sql`. Apply this migration before deploying the
updated employee forms and API. It only adds columns and preserves existing
employee records. Passport numbers are stored as text to retain letters and
leading zeros. Nationality and work-location dropdowns retain existing values.
