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
