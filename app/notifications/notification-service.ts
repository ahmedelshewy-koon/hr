import type { PostgresDatabase } from "../../db/postgres";

export async function createNotification(db:PostgresDatabase,input:{userId:number;type:string;titleKey:string;messageKey?:string;entityType?:string;entityId?:string|number;targetPath?:string;dedupeKey:string}){
  await db.prepare("INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING").bind(input.userId,input.type,input.titleKey,input.messageKey||null,input.entityType||null,input.entityId==null?null:String(input.entityId),input.targetPath||null,input.dedupeKey).run();
}

export async function syncOperationalNotifications(db:PostgresDatabase){
  await db.prepare(`INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at)
    SELECT u.id,'approval','request_needs_manager_approval','request_waiting','request',q.id::text,'approvals',concat('request:',q.id,':pending_manager')::text,q.updated_at
    FROM requests q JOIN employees e ON e.id=q.employee_id JOIN users u ON u.employee_id=e.manager_id AND u.status='active'
    WHERE q.status='pending_manager' ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`).run();
  await db.prepare(`INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at)
    SELECT u.id,'approval','request_needs_hr_approval','request_waiting','request',q.id::text,'approvals',concat('request:',q.id,':pending_hr')::text,q.updated_at
    FROM requests q JOIN users u ON u.status='active' JOIN roles r ON r.id=u.role_id AND r.name IN ('Super Admin','HR Manager')
    WHERE q.status='pending_hr' ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`).run();
  await db.prepare(`INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at)
    SELECT u.id,'request_result',CASE WHEN q.status IN ('hr_approved','approved') THEN 'request_approved' ELSE 'request_rejected' END,q.status,'request',q.id::text,'portal',concat('request:',q.id,':',q.status)::text,q.updated_at
    FROM requests q JOIN users u ON u.employee_id=q.employee_id AND u.status='active'
    WHERE q.status IN ('hr_approved','approved','manager_rejected','hr_rejected','rejected') ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`).run();
  await db.prepare(`INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at)
    SELECT u.id,'attendance_approval',CASE WHEN c.current_stage='manager' THEN 'correction_needs_manager_approval' ELSE 'correction_needs_hr_approval' END,c.status,'attendance_correction',c.id::text,'approvals',concat('correction:',c.id,':',c.status)::text,c.updated_at
    FROM attendance_corrections c JOIN employees e ON e.id=c.employee_id JOIN users u ON u.status='active' LEFT JOIN roles r ON r.id=u.role_id
    WHERE (c.status='pending_manager' AND u.employee_id=e.manager_id) OR (c.status='pending_hr' AND r.name IN ('Super Admin','HR Manager'))
    ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`).run();
  await db.prepare(`INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at)
    SELECT u.id,'attendance_result',CASE WHEN c.status='resolved' THEN 'correction_approved' ELSE 'correction_rejected' END,c.status,'attendance_correction',c.id::text,'portal',concat('correction:',c.id,':',c.status)::text,c.updated_at
    FROM attendance_corrections c JOIN users u ON u.employee_id=c.employee_id AND u.status='active' WHERE c.status IN ('resolved','rejected_manager','rejected_hr')
    ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`).run();
  await db.prepare(`INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at)
    SELECT u.id,'document','document_expiring_soon',d.expiry_date,'document',d.id::text,concat('employees?employee=',d.employee_id),concat('document:',d.id,':expiry:',d.expiry_date)::text,CURRENT_TIMESTAMP
    FROM documents d JOIN document_categories c ON c.code=d.category AND c.employee_can_view=1 JOIN users u ON u.employee_id=d.employee_id AND u.status='active'
    WHERE d.status='active' AND d.expiry_date BETWEEN CURRENT_DATE::text AND (CURRENT_DATE+30)::text
    ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`).run();
  await db.prepare(`INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at)
    SELECT u.id,'performance','performance_review_overdue',c.end_date,'performance_review',r.id::text,'performance',concat('performance:',r.id,':overdue')::text,CURRENT_TIMESTAMP
    FROM performance_reviews r JOIN performance_cycles c ON c.id=r.cycle_id JOIN users u ON u.employee_id=r.employee_id AND u.status='active'
    WHERE r.status!='completed' AND c.end_date<CURRENT_DATE::text ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`).run();
  await db.prepare(`INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at)
    SELECT t.owner_user_id,'lifecycle','lifecycle_task_overdue',t.due_date,'lifecycle_task',t.id::text,'lifecycle',concat('lifecycle-task:',t.id,':overdue')::text,CURRENT_TIMESTAMP
    FROM lifecycle_tasks t JOIN employee_lifecycles l ON l.id=t.lifecycle_id
    WHERE t.owner_user_id IS NOT NULL AND t.status!='completed' AND l.status='in_progress' AND t.due_date<CURRENT_DATE::text
    ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`).run();
  await db.prepare(`INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at)
    SELECT u.id,'learning','training_overdue',x.due_date,'training_enrollment',x.id::text,'learning',concat('training:',x.id,':overdue')::text,CURRENT_TIMESTAMP
    FROM training_enrollments x JOIN users u ON u.employee_id=x.employee_id AND u.status='active'
    WHERE x.status IN ('assigned','in_progress') AND x.due_date<CURRENT_DATE::text
    ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`).run();
  await db.prepare(`INSERT INTO notifications (user_id,type,title_key,message_key,entity_type,entity_id,target_path,dedupe_key,created_at)
    SELECT u.id,'learning','certification_expiring',x.certificate_expiry,'training_enrollment',x.id::text,'learning',concat('training:',x.id,':expiry:',x.certificate_expiry)::text,CURRENT_TIMESTAMP
    FROM training_enrollments x JOIN users u ON u.employee_id=x.employee_id AND u.status='active'
    WHERE x.status='completed' AND x.certificate_expiry BETWEEN CURRENT_DATE::text AND (CURRENT_DATE+30)::text
    ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`).run();
}
