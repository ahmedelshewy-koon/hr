# Training evaluations and certificates

In Learning & Development, choose **Evaluate** beside an assigned or in-progress
training record. The dialog scores knowledge (25%), practical skills (30%), final
assessment (20%), attendance (15%), and participation (10%). Each criterion needs
a score from 0 to 100; the weighted pass mark is 60%. Review the instructor name
and duration in hours, including for older programs missing these details.

Passing records open **Certificate approvals**. The employee's department manager
(or direct manager when appropriate) and an HR Manager approve from their own
accounts. Two different employees must approve; the learner cannot approve their
own certificate. A Super Admin can cover HR approval, or department approval when
no active manager is configured, subject to the same separation rule. Approvers
need an active employee profile and learning edit permission.

After both approvals, the certificate opens in Arabic or English with company,
employee, instructor, program, duration, dates, result, unique number, and dated
approvals. **Print / Save PDF** uses an A4 landscape layout. The certificate is an
internal company training certificate from **Koon software solo**. Its snapshot
is retained so subsequent program or employee edits do not change an issued copy.

Validation:

```powershell
node --test tests/learning-evaluation.test.mjs tests/learning-rules.test.mjs tests/migration-baseline.test.mjs
node tests/runtime-learning-certificates.mjs
```

The runtime check requires the local development server and `.dev.vars`. It
creates isolated test records and cleans up those records in `finally`.
