# Recovered VPS migration lineage (evidence)

Production's `drizzle.__drizzle_migrations` rows #32 and #33 were written by two migrations that were generated on
the VPS and never committed to this repository. The VPS administrator recovered them (Stage 1 review of `30ee91e`):

| Ledger row | created_at | Recovered migration |
|---|---|---|
| #32 | 1791298824926 (2026-10-06T15:00:24.926Z) | `0031_vps_current_schema` |
| #33 | 1791372110232 (2026-10-07T11:21:50.232Z) | `0032_vps_attendance_device_country` |

**Status: files not yet committed.** Place here, byte for byte as recovered (do not re-save, re-indent or convert
line endings; `.gitattributes` keeps git from changing them):

- `0031_vps_current_schema.sql`
- `0032_vps_attendance_device_country.sql`
- `meta/_journal.json` (the original VPS journal containing both entries)
- `SOURCE.txt`: where each file was found on the VPS (path, mtime, owner) and its `sha256sum` as computed there.

`lineage.mjs` hashes these files itself (sha256 of the exact bytes, as Drizzle does) and accepts ledger rows #32/#33
only when the journal timestamp and the computed hash both equal the production row AND the reviewed attestation in
`../../ledger-attestations.json` references the file. Until the files are here, preflight reports
`LINEAGE=UNVERIFIED` ("recovered evidence file missing").
