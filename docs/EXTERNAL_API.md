# External API: employees and departments

Read-only endpoints for other systems (CRM, task app, reporting). They use an API key, not a user session, and
return work information only: no salary, identity number, bank details or personal contact data.

## Getting a key

The Super Admin opens **Integrations**, then **API keys for other systems → Create key**, and names the system
(for example CRM). The key is shown once: copy it and give it to that system. HR keeps only a hash of it (in
`system_settings`, `external_api_clients`), so a lost key cannot be shown again; create a new one and revoke the
old one. The list shows each key's last four characters and when it was last used. **Revoke** stops a system at
once.

## Calling the API

Send the key in `x-api-key` (or `Authorization: Bearer <key>`):

```bash
curl -H "x-api-key: hrx_..." "https://hr.example.com/api/external/employees?status=active&page_size=200"
```

Limits: 120 requests per minute per key. Answers are JSON; errors are `{ "error": "..." }` with status 400
(bad filter), 401 (missing or wrong key) or 429 (too many requests).

### GET /api/external/employees

| Parameter | Meaning |
| --- | --- |
| `page`, `page_size` | Paging; `page_size` defaults to 100, at most 500 |
| `status` | Comma-separated: `active`, `on_leave`, `probation`, `notice_period`, `suspended`, `terminated`. Default: all (deleted employees are never returned) |
| `department_id` | Employees of a department, including its sections and teams |
| `company_id` | Employees of one company |
| `updated_since` | ISO date or date-time; only employees changed since then (for incremental sync) |

```json
{
  "data": [
    {
      "id": 12,
      "employee_code": "E12",
      "name_en": "Sara Ali",
      "name_ar": "سارة علي",
      "work_email": "sara@example.com",
      "work_phone": null,
      "employment_status": "active",
      "employment_type": "full_time",
      "start_date": "2025-03-01",
      "work_country": "Egypt",
      "company": { "id": 1, "code": "KS", "name_en": "…", "name_ar": "…" },
      "branch": { "id": 2, "name_en": "Cairo", "name_ar": "القاهرة" },
      "department": { "id": 7, "name_en": "Software", "name_ar": "برمجة" },
      "section_id": null,
      "team_id": null,
      "job_title": { "id": 4, "name_en": "Developer", "name_ar": "مطور برامج" },
      "manager": { "id": 3, "employee_code": "E3", "name_en": "…", "name_ar": "…" },
      "updated_at": "2026-10-20T09:15:00.000Z"
    }
  ],
  "page": 1,
  "page_size": 100,
  "total": 43,
  "has_more": false
}
```

`manager` is the direct manager, or the unit's manager when none is set (the rule approvals use). References that
are not set are `null`.

### GET /api/external/departments

| Parameter | Meaning |
| --- | --- |
| `page`, `page_size` | Paging, as above |
| `company_id` | Units of one company |

Each item: `id`, `name_en`, `name_ar`, `unit_type` (`company`, `department`, `section`, `team`), `parent_id`,
`status`, `company`, `manager`, `active_employees` (active, probation and notice period, including sections and
teams below it) and `updated_at`. Build the tree with `parent_id`.
