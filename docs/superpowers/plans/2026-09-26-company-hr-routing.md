# Companies, employee HR assignment and missing-data export

Goal: Settings-managed companies and HR accounts, employee dropdowns, direct-manager then assigned-HR request approval, and Excel export of missing required employee data.

Implementation scope approved in the conversation; execute in the current checkout preserving existing changes.

- [ ] Add nullable employee company/HR references and settings catalogs through an additive PostgreSQL migration; preserve all current records without inventing assignments.
- [ ] Add permission-checked catalog management, validated employee writes, dropdowns in create/edit profiles and profile read views.
- [ ] Reject requests with missing or inactive HR. Enforce the assigned HR in server-side actions, lists and notifications across employee request flows. Preserve direct-manager checks and prevent self approval.
- [ ] Add an Excel report listing only employees with missing required data, respecting report permissions and scope/filter choices.
- [ ] Verify migration preservation, company/HR validation, request routing and rejection, report content, TypeScript and relevant UI behavior.

Interfaces: companies(id,name,status); hr_responsibles(user_id,status); employees.company_id and employees.hr_user_id (user identity, not employee identity). Existing work-location fields remain unchanged. Catalog deactivation does not erase assignments; inactive HR is invalid for new requests.

No production publishing or unrelated payroll changes. Existing employee assignments remain empty until the administrator selects them.
