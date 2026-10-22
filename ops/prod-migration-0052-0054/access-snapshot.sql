-- Access state captured right after apply (HR stopped) and compared by `postdeploy` after the new release has started:
-- every role permission, every user's role and status, and the runtime seed marker. A difference means something
-- changed access in between (an administrator's edit, or an application-startup path) and must be explained.
-- Read-only. Tab-separated, one fact per line, stable order.
SELECT 'PERM', r.name, p.module, p.action, p.allowed FROM permissions p JOIN roles r ON r.id = p.role_id ORDER BY r.name, p.module, p.action;
SELECT 'ROLE', r.id, r.name FROM roles r ORDER BY r.id;
SELECT 'USER', u.id, coalesce(r.name, '?'), u.status FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.id;
SELECT 'SEED', coalesce((SELECT value_json FROM system_settings WHERE setting_key = 'seed_version'), '(absent)');
