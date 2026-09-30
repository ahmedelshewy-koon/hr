# تقرير تعديلات Sanad HR

**التاريخ:** 21 أغسطس 2026  
**النطاق:** استكمال HR Core والتقوية التقنية  
**الحالة:** التنفيذ البرمجي والتحقق المحلي مكتملان، والتحقق الحي من PostgreSQL/R2 معلّق بسبب تعذر اتصال قاعدة البيانات.

---

## 1. الملخص التنفيذي

تم تنفيذ حزمة استكمال واسعة لنظام Sanad HR مع الحفاظ على محركات الإجازات والحضور والاعتمادات الحالية وعدم إنشاء محركات مكررة.

أهم ما أُضيف اليوم:

- إدارة آمنة لمستندات الموظفين باستخدام Cloudflare R2.
- تبويب Documents داخل Employee Profile 360.
- لوحة HR تشغيلية مركزة على الإجراءات المطلوبة.
- إشعارات داخل النظام خاصة بكل مستخدم.
- تقارير تشغيلية وتصدير CSV.
- Pagination وLoad More لسجلات ملف الموظف.
- خدمة ترحيل أرصدة الإجازات بين السنوات.
- Scheduled attendance exception scan.
- حماية Origin/CSRF وRate Limiting.
- تطبيق مدة الجلسة وانتهاء كلمة المرور.
- خدمة Audit Retention.
- تحسين سلامة قاعدة البيانات والمفاتيح الخارجية.
- إصلاح توليد أكواد الموظفين والطلبات تحت التزامن.
- اختبارات جديدة تغطي الوظائف والتقوية الأمنية.

---

## 2. المستندات الآمنة وسجلات الموظفين

### البنية

تم اعتماد المسار التالي:

```text
Browser
  → Authorized Application API
  → Permission + Employee Scope + Category Rules
  → PostgreSQL Metadata
  → Private Cloudflare R2 Object
```

لا تُرجع الواجهة روابط R2 عامة، ولا يتم كشف `object_key` أو تفاصيل التخزين للمستخدم.

### الوظائف المنفذة

- رفع مستند جديد.
- عرض المستند من خلال route مصادق عليه.
- تنزيل المستند من خلال route مصادق عليه.
- استبدال المستند مع حفظ النسخة السابقة.
- أرشفة ناعمة بدل الحذف المباشر.
- الاحتفاظ بسجل metadata للنسخ السابقة.
- تدقيق عمليات الرفع والتنزيل والاستبدال والأرشفة.
- ربط المستند بالموظف والمستخدم الذي رفعه.
- دعم رقم المستند وتاريخ الإصدار والانتهاء.

### التحقق من الملفات

يتم التحقق في الخادم من:

- وجود جلسة مصادق عليها.
- صلاحية الوصول إلى الموظف.
- صلاحيات فئة المستند.
- عدم كون الملف فارغًا.
- الحد الأقصى لحجم الملف.
- MIME Type المسموح.
- توقيع الملف الفعلي Magic Bytes.
- تطابق امتداد الملف مع محتواه.
- تطبيع اسم الملف الأصلي.
- إنشاء R2 key عشوائي وآمن لا يعتمد على اسم الملف.

الأنواع المسموحة حاليًا:

- PDF
- PNG
- JPG/JPEG

### فئات المستندات

- Employment Contract
- National ID
- Passport
- Iqama / Work Permit
- Certificate
- Medical Certificate
- HR Letter
- Experience Certificate
- Other

كل فئة تدعم إعدادات مثل:

- طلب تاريخ انتهاء.
- كون المستند مطلوبًا.
- سماح الموظف بالعرض أو الرفع.
- سماح المدير بالعرض.
- أنواع الملفات المسموحة.
- أقصى حجم للملف.
- الدولة ونوع التوظيف عند الحاجة.

### حالات المستند المحسوبة

```text
valid
expiring_soon
expired
no_expiry
archived
```

الحالة مشتقة من تاريخ الانتهاء ولا تُخزن كقيمة قد تصبح قديمة.

---

## 3. Employee Profile 360

تمت إضافة تبويب:

```text
Documents / المستندات
```

ويعرض:

- نوع المستند.
- الاسم.
- تاريخ الرفع.
- تاريخ الانتهاء.
- الحالة.
- العرض والتنزيل.
- الرفع والاستبدال والأرشفة للمستخدم المخول.
- المستندات المطلوبة المفقودة.

كما أضيفت تنبيهات للملف الشخصي عن:

- المستندات المنتهية.
- المستندات التي ستنتهي خلال 30 يومًا.
- المستندات المطلوبة المفقودة.

### Pagination

تمت إضافة pagination محدودة وLoad More إلى:

- سجل الحضور.
- سجل الإجازات.
- الطلبات وتصحيحات الحضور.
- سجل النشاط.
- metadata الخاصة بنسخ المستندات.

الحد الافتراضي هو 25 سجلًا، مع حد أقصى 50 سجلًا للصفحة.

---

## 4. HR Dashboard / Action Center

تم إنشاء endpoint مركز:

```text
GET /api/dashboard
```

ولا يعتمد على تحميل كامل `/api/hr`.

### Needs Your Attention

يعرض العناصر الفعلية التالية عند وجودها:

- اعتمادات تحتاج إجراء المستخدم الحالي.
- استثناءات حضور مفتوحة.
- Missing checkout.
- مستندات منتهية.
- مستندات قاربت الانتهاء.
- مستندات مطلوبة مفقودة.
- حسابات تتطلب تغيير كلمة المرور.

### Today's Workforce

- الموظفون النشطون.
- حاضر اليوم.
- متأخر اليوم.
- يعمل عن بُعد.
- في إجازة معتمدة.
- مرشحو الغياب.
- Missing checkout.
- يحتاج مراجعة.

### أقسام أخرى

- ملخص الاعتمادات.
- سجلات الموظفين التي تحتاج متابعة.
- العطلة الرسمية القادمة.
- الإجازات القادمة.
- تواريخ انتهاء التوظيف.
- تواريخ انتهاء المستندات.

كل البيانات مشتقة من الجداول والمحركات الحالية دون إنشاء حسابات حضور أو إجازات بديلة.

---

## 5. الإشعارات داخل النظام

تم إنشاء نظام إشعارات داخلي خفيف دون بريد إلكتروني أو WhatsApp أو Push.

### الأحداث المدعومة

- طلب يحتاج اعتماد المدير.
- طلب يحتاج اعتماد HR.
- طلب تم اعتماده أو رفضه.
- تصحيح حضور يحتاج اعتماد المدير أو HR.
- تصحيح حضور تم اعتماده أو رفضه.
- مستند قارب الانتهاء.

### الواجهة

- عداد الإشعارات غير المقروءة.
- قائمة الإشعارات الأخيرة.
- تحديد إشعار كمقروء.
- تحديد جميع الإشعارات كمقروءة.
- فتح الوحدة المستهدفة.

### الأمان

- جميع الاستعلامات مقيدة بـ`user_id` الخاص بالجلسة.
- لا يمكن قراءة أو تعديل إشعارات مستخدم آخر.
- يوجد `dedupe_key` لمنع إنشاء الإشعار نفسه أكثر من مرة.

### APIs

```text
GET   /api/notifications
PATCH /api/notifications
```

---

## 6. التقارير والتصدير

تمت إضافة صفحة Reports & Exports وendpoint مركّز:

```text
GET /api/reports
```

### التقارير

1. Attendance Report
2. Leave Report
3. Employee Report
4. Documents Report
5. Approvals Report

### خصائص التصدير

- صيغة CSV متوافقة مع Excel.
- UTF-8 BOM لدعم العربية.
- حد أقصى 10,000 سجل لكل عملية تصدير.
- نطاق المدير مبني على الأقسام التابعة بشكل recursive.
- تقرير الموظفين لا يُرجع كلمات المرور أو البيانات البنكية أو الأسرار.
- تقرير المستندات لا يُرجع R2 keys.
- تقرير المستندات مقيد بـHR وSuper Admin.

---

## 7. Leave Year-End Rollover

تمت إضافة خدمة ترحيل أرصدة الإجازات:

```text
POST /api/operations/leave-rollover
```

مثال الطلب:

```json
{
  "fromYear": 2026
}
```

### السلوك

- تحديد الموظفين النشطين المؤهلين.
- اختيار السياسة المناسبة للدولة ونوع الإجازة.
- حساب الرصيد المتاح غير المستخدم.
- احترام `carry_forward`.
- تطبيق `max_carry_forward`.
- حساب تاريخ الانتهاء من `expiry_days`.
- إنشاء رصيد السنة الجديدة.
- منع تكرار الترحيل عند إعادة التشغيل.
- قفل العملية بـPostgreSQL advisory locks.
- تسجيل نتيجة كل ترحيل في Audit Logs.

لم يتم تعديل حساب أيام الإجازة أو مراحل الاعتماد أو منطق حجز واستهلاك الرصيد الحالي.

---

## 8. Scheduled Attendance Exception Scan

تمت إضافة خدمة reusable وجدولة Cloudflare Worker.

### السلوك

- استخدام آخر يوم عمل مكتمل حسب `Africa/Cairo`.
- معالجة الموظفين النشطين فقط.
- إعادة استخدام خدمة `recalculateAttendance` الحالية.
- احترام أيام العمل والعطلات والإجازات المعتمدة.
- عدم تكرار الاستثناء المفتوح لنفس الموظف والتاريخ والنوع.
- تسجيل عملية الفحص في Audit Logs.

لا يتم تعديل `attendance_logs` الخام.

---

## 9. التقوية الأمنية

### Origin / CSRF Protection

تمت إضافة فحص Origin للطلبات التي تغير الحالة:

- POST
- PATCH
- PUT
- DELETE

تُرفض الطلبات ذات المصدر المخالف أو `Sec-Fetch-Site` غير المسموح.

### Rate Limiting

تمت إضافة rate limiting مخزن في PostgreSQL إلى:

- تسجيل الدخول.
- تغيير كلمة المرور.
- عمليات `/api/hr` الحساسة.
- رفع وتنزيل واستبدال المستندات.
- تشغيل rollover.
- تشغيل audit retention.

يتم تخزين مفتاح bucket بصورة SHA-256 بدل تخزين عنوان المستخدم الخام.

### إعدادات الأمان

- `sessionMinutes` أصبح مطبقًا فعليًا بين 15 دقيقة و24 ساعة.
- `passwordExpiryDays` أصبح يفرض تغيير كلمة المرور عند انتهاء المدة.
- `auditRetentionDays` يستخدمه retention service.
- MFA غير منفذ في هذه المرحلة، ولذلك أزيل الإعداد المضلل من الواجهة وثُبت `mfaSupported=false`.

### Audit Retention

تمت إضافة:

```text
POST /api/operations/audit-retention
```

- متاح لـSuper Admin فقط.
- حد أدنى للاحتفاظ: 90 يومًا.
- لا يحذف الأحداث الحرجة المحددة.
- يسجل نتيجة عملية التنظيف نفسها.
- لا يعمل تلقائيًا عند فتح الصفحات.

---

## 10. سلامة قاعدة البيانات

تمت إضافة migration:

```text
drizzle-postgres/0013_hr_core_completion.sql
```

### الجداول الجديدة

- `document_categories`
- `document_versions`
- `notifications`
- `leave_rollovers`
- `security_rate_limits`

### أعمدة جديدة في documents

- `document_number`
- `issue_date`
- `status`
- `version`
- `replaced_document_id`
- `updated_at`
- `archived_at`

### الفهارس

- فهرس حالة وتاريخ انتهاء المستندات.
- unique index على R2 object key.
- فهارس الإشعارات حسب المستخدم والقراءة والتاريخ.
- unique dedupe index للإشعارات.
- فهرس rollovers حسب السنة والموظف.
- فهرس تنظيف rate limits.

### Foreign Keys

تم تجهيز مفاتيح خارجية للعلاقات ذات الأولوية، باستخدام:

- `RESTRICT` للعلاقات التي لا يجب حذفها تلقائيًا.
- `SET NULL` عند فصل المستخدم عن الموظف.
- عدم استخدام destructive cascade على بيانات الموظفين والمستندات والتاريخ التشغيلي.

بالنسبة للجداول القديمة، تفحص migration وجود orphan rows أولًا. إذا وجدت بيانات يتيمة، تتخطى القيد وتصدر PostgreSQL Notice بدل حذف البيانات أو كسرها تلقائيًا.

---

## 11. توليد الأكواد والتزامن

تم استبدال الاستراتيجية غير الآمنة:

```sql
MAX(id) + 1
```

باستخدام PostgreSQL sequence الخاصة بالجدول:

```sql
nextval(pg_get_serial_sequence(...))
```

مع الحفاظ على التنسيقات:

```text
EMP-00001
REQ-1001
```

ولم تتم إعادة كتابة الأكواد التاريخية.

---

## 12. تحسينات API والأداء

- عدم إضافة Documents أو Dashboard أو Notifications أو Reports إلى payload الخاص بـ`/api/hr`.
- استخدام endpoints مركزة لكل وحدة جديدة.
- إضافة limits وpagination للتاريخ.
- تحديد Audit queries.
- إضافة فهارس للاستعلامات الجديدة.
- استخدام استعلامات تجميعية بدل تحميل جداول الشركة بالكامل للـDashboard.
- الاحتفاظ بـ`ensureSeed()` idempotent ومحميًا بـ`seed_version`.
- عدم إضافة seed workloads جديدة إلى GET requests.

---

## 13. الواجهة وتجربة الاستخدام

- دعم العربية RTL والإنجليزية LTR للنصوص الجديدة.
- إضافة صفحة Reports.
- إضافة Dashboard تشغيلي.
- إضافة Notification dropdown حي.
- إضافة Documents tab وواجهات الرفع والاستبدال والأرشفة.
- إضافة حالات تحميل وتعطيل للأزرار أثناء العمليات.
- دعم شاشات الهاتف للمستندات والتقارير والـDashboard والإشعارات.
- استخدام labels وARIA للأزرار الحساسة والمدخلات الجديدة.

---

## 14. الملفات الجديدة

```text
SANAD_HR_CHANGES_2026-08-21.md
app/api/api-security.ts
app/api/dashboard/route.ts
app/api/documents/route.ts
app/api/documents/[id]/route.ts
app/api/notifications/route.ts
app/api/operations/audit-retention/route.ts
app/api/operations/leave-rollover/route.ts
app/api/reports/route.ts
app/attendance/scheduled-scan.ts
app/attendance/scheduled-scan-policy.ts
app/documents/document-policy.ts
app/leave/leave-rollover.ts
app/notifications/notification-service.ts
docs/HR_CORE_OPERATIONS.md
drizzle-postgres/0013_hr_core_completion.sql
tests/hr-core-completion.test.mjs
```

---

## 15. الملفات المعدلة ضمن هذا التنفيذ

```text
app/api/auth/route.ts
app/api/hr/route.ts
app/api/employees/[id]/route.ts
app/employee-drawer.tsx
app/employee-profile-360.tsx
app/employee-profile-360.css
app/globals.css
app/hr-app.tsx
app/portal-auth.ts
db/schema.ts
drizzle-postgres/meta/_journal.json
worker/index.ts
```

ملاحظة: كان المستودع يحتوي على تعديلات وملفات غير متتبعة قبل بدء هذه المرحلة، وتم الحفاظ عليها دون `reset` أو حذف.

---

## 16. الاختبارات المضافة

يغطي `tests/hr-core-completion.test.mjs`:

- اشتقاق حالات المستند.
- فحص توقيع PDF والصور.
- رفض الملف الفارغ والامتداد الخاطئ وMIME المخالف.
- توليد R2 key آمن وفريد.
- تطبيق فئات المستند حسب سياق الموظف.
- حساب carry forward.
- حساب آخر يوم عمل مكتمل حسب المنطقة الزمنية.
- صلاحيات المستندات وعدم كشف R2.
- حفظ نسخ المستندات والأرشفة الناعمة.
- عزل الإشعارات بين المستخدمين.
- منع تكرار الإشعارات.
- مصادر Dashboard الفعلية.
- حجب الحقول الحساسة من التقارير.
- حماية Origin وRate Limits.
- Pagination في Profile 360.
- سلامة migration.
- استخدام sequences بدل `MAX(id)+1`.

---

## 17. نتائج التحقق

### TypeScript

```text
npx tsc --noEmit
Result: PASS
```

### Build

```text
npm run build
Result: PASS
```

تم اكتشاف المسارات التالية في البناء:

```text
/api/approvals
/api/auth
/api/dashboard
/api/documents
/api/documents/:id
/api/employees/:id
/api/hr
/api/notifications
/api/operations/audit-retention
/api/operations/leave-rollover
/api/reports
```

### Tests

```text
npm test
Tests: 53
Passed: 53
Failed: 0
Result: PASS
```

### Git whitespace check

```text
git diff --check
Result: PASS
```

### Lint

```text
npm run lint
Result: FAIL — historical lint debt remains
```

الدين المتبقي محصور في:

| الملف | الأخطاء | التحذيرات |
|---|---:|---:|
| `app/employee-drawer.tsx` | 13 | 0 |
| `app/hr-app.tsx` | 117 | 3 |
| **الإجمالي** | **130** | **3** |

جميع الملفات الجديدة المضافة اليوم خالية من أخطاء lint.

تمت تجربة تحويل شامل للأنواع في الملفين القديمين، لكنه أدى إلى اتساع أخطاء TypeScript، ولذلك تم التراجع عنه للحفاظ على استقرار التطبيق وعدم تعطيل الوظائف الحالية أو تعطيل قواعد ESLint.

---

## 18. PostgreSQL والتحقق الحي

تم اختبار الاتصال الحالي بدون طباعة كلمة المرور:

```text
Host: 127.0.0.1
Port: 5545
Database: koon_hr
User: koon_hr_admin
Result: ECONNREFUSED
```

لذلك لم يتم:

- تطبيق migration `0013` على PostgreSQL.
- التحقق من هوية قاعدة فعلية.
- اختبار R2 الحقيقي.
- تنفيذ Login/Logout live workflow.
- تنفيذ Create Employee live workflow.
- تنفيذ Leave approval workflow حي.
- تنفيذ Attendance وCorrections workflow حي.
- اختبار Dashboard counters على بيانات PostgreSQL فعلية.
- اختبار Notifications recipients على بيانات حية.

لم يتم استخدام المنفذ `5544` أو تخمين credentials أو تطبيق migration على قاعدة غير معروفة.

### الخطوة المطلوبة لإكمال التحقق الإنتاجي

1. توفير `DATABASE_URL` صالح لقاعدة تطوير أو اختبار معروفة.
2. التحقق من `current_database()` و`current_user`.
3. أخذ backup.
4. تشغيل `npm run db:migrate`.
5. تشغيل التطبيق.
6. تنفيذ سيناريوهات E2E الحية للمصادقة والموظفين والإجازات والحضور والتصحيحات والاعتمادات والمستندات والإشعارات.

---

## 19. القيود المعروفة

- لا يمكن إعلان production readiness قبل نجاح PostgreSQL migrations والاختبارات الحية.
- دين ESLint التاريخي في `hr-app.tsx` و`employee-drawer.tsx` ما زال قائمًا.
- MFA غير منفذ ومعلن بوضوح كغير مدعوم.
- الإشعارات داخل النظام فقط؛ لا يوجد Email أو WhatsApp أو Push.
- CSV هو تنسيق التصدير الحالي؛ لم تتم إضافة مولد XLSX مستقل.
- بعض روابط Dashboard والإشعارات تفتح الوحدة المستهدفة، وليس دائمًا العنصر الداخلي المحدد مباشرة.
- الربط المباشر بملف الموظف من بعض صفوف Approvals وAttendance ما زال يحتاج تحسينًا إضافيًا للوصول المباشر إلى نفس Profile 360.

---

## 20. الأعمال المؤجلة عمدًا

لم تتم إضافة أو توسيع:

- Recruitment / ATS
- Performance Management
- Employee Assets
- Learning Management
- AI HR Assistant
- WhatsApp integration
- Email campaigns
- Full MFA
- Multi-company
- Multi-tenant SaaS
- Payroll redesign

---

## 21. تأكيد Payroll

```text
Payroll was not modified.
Payroll calculations were not modified.
Payroll schema was not modified.
Payroll APIs were not modified.
Payroll UI was not modified.
```

لم تتم إضافة تقارير Payroll، ولم تعتمد أي من وحدات Dashboard أو Documents أو Notifications أو Reports الجديدة على حسابات Payroll.

---

## 22. الحالة النهائية

```text
Local implementation: COMPLETE
TypeScript: PASS
Build: PASS
Tests: 53/53 PASS
git diff --check: PASS
Repository lint: 130 historical errors + 3 warnings
PostgreSQL runtime verification: BLOCKED — connection refused
R2 live verification: NOT RUN
Production readiness: NOT YET CLAIMED
```

