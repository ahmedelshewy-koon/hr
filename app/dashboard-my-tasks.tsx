"use client";
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CalendarDays, Check, CheckCheck, CheckSquare, Circle, Clock3, ExternalLink, Flag, Folder, RefreshCw, Sparkles } from 'lucide-react';
import './dashboard-my-tasks.css';

export type Task = { id: string; title: string; status: 'todo' | 'in_progress' | 'done'; priority: 'low' | 'medium' | 'high' | 'urgent'; dueDate: string | null; projectName: string | null };
type TaskData<T> = { tasks: T[]; taskAppUrl: string };

// Polls a TASK bridge endpoint every 30 seconds and when the page regains focus.
export function useTaskBridge<T extends Task>(url: string) {
  const [data, setData] = useState<TaskData<T> | null>(null);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const retry = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    let active = true;
    let pending = false;
    const controller = new AbortController();
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Task request failed');
        const payload: TaskData<T> = await response.json();
        if (active) { setData(payload); setFailed(false); }
      } catch {
        if (active) { setData(null); setFailed(true); }
      } finally { pending = false; }
    };
    void load();
    const update = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { active = false; controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [url, refresh]);
  return { data, failed, retry };
}

export function DashboardMyTasks({ rtl }: { rtl: boolean }) {
  const { data, failed, retry } = useTaskBridge<Task>('/api/task/my-tasks');
  const [filter, setFilter] = useState<'all' | Task['status']>('all');
  const statuses = rtl ? { todo: 'لم تبدأ', in_progress: 'قيد التنفيذ', done: 'مكتملة' } : { todo: 'To do', in_progress: 'In progress', done: 'Done' };
  const priorities = rtl ? { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' } : { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const tasks = data?.tasks ?? [];
  const completed = tasks.filter(task => task.status === 'done').length;
  const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
  const filtered = tasks.filter(task => filter === 'all' || task.status === filter);
  const formatNumber = (value: number) => new Intl.NumberFormat(rtl ? 'ar-EG' : 'en-GB').format(value);
  return <section className="panel dashboard-my-tasks" dir={rtl ? 'rtl' : 'ltr'} aria-label={rtl ? 'مهامي' : 'My tasks'}>
    <div className="my-tasks-header">
      <div className="my-tasks-heading"><span className="my-tasks-heading-icon"><CheckSquare size={24} aria-hidden="true"/></span><div><span className="my-tasks-eyebrow">{rtl ? 'خطوة أقرب للإنجاز' : 'A step closer to done'}</span><h2>{rtl ? 'مهامي' : 'My tasks'}{data && <span className="my-tasks-count">{formatNumber(tasks.length)}</span>}</h2><p>{rtl ? 'رتّب أولوياتك، وخلّي إنجازك واضح.' : 'Your priorities, with progress in sight.'}</p></div></div>
      {data && <a className="my-tasks-open" href={`${data.taskAppUrl}/?page=my-tasks`} target="_blank" rel="noopener noreferrer">{rtl ? 'عرض كل المهام' : 'View all tasks'}<ExternalLink size={15}/></a>}
    </div>
    {data && tasks.length > 0 && <>
      <div className="my-tasks-overview">
        <div className="my-tasks-progress-label"><span className="my-tasks-progress-icon"><Sparkles size={19} aria-hidden="true"/></span><div><strong>{rtl ? 'كل مهمة بتفرق' : 'Every task counts'}</strong><span>{rtl ? `${formatNumber(completed)} من ${formatNumber(tasks.length)} مهام مكتملة` : `${completed} of ${tasks.length} tasks completed`}</span></div></div>
        <div className="my-tasks-progress"><div><span>{rtl ? 'نسبة الإنجاز' : 'Completion'}</span><strong>{formatNumber(progress)}{rtl ? '٪' : '%'}</strong></div><progress value={completed} max={tasks.length} aria-label={rtl ? 'نسبة إنجاز المهام' : 'Task completion'}/></div>
      </div>
      <div className="my-tasks-toolbar"><div className="my-tasks-filters" role="group" aria-label={rtl ? 'تصفية المهام حسب الحالة' : 'Filter tasks by status'}>{(['all', 'in_progress', 'todo', 'done'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? (rtl ? 'الكل' : 'All') : statuses[value]}<span>{formatNumber(value === 'all' ? tasks.length : tasks.filter(task => task.status === value).length)}</span></button>)}</div><span className="my-tasks-result-count" aria-live="polite">{rtl ? `عرض ${formatNumber(Math.min(filtered.length, 6))} من ${formatNumber(filtered.length)}` : `Showing ${Math.min(filtered.length, 6)} of ${filtered.length}`}</span></div>
    </>}
    {failed ? <div className="my-tasks-message" role="status"><p>{rtl ? 'تعذّر تحميل المهام. حاول مرة أخرى.' : 'Unable to load tasks. Please try again.'}</p><button type="button" className="outline" onClick={retry}><RefreshCw size={15}/>{rtl ? 'إعادة المحاولة' : 'Retry'}</button></div>
      : !data ? <div className="my-tasks-loading" role="status"><span>{rtl ? 'جارٍ تحميل المهام…' : 'Loading tasks…'}</span><div aria-hidden="true">{[0, 1, 2].map(value => <div className="my-task-skeleton" key={value}/>)}</div></div>
      : !tasks.length ? <div className="my-tasks-message"><CheckCheck size={30} aria-hidden="true"/><h3>{rtl ? 'مساحة لإنجاز جديد' : 'Room for a fresh start'}</h3><p>{rtl ? 'لا توجد مهام مسندة إليك حاليًا.' : 'No tasks assigned to you yet.'}</p></div>
      : !filtered.length ? <div className="my-tasks-message" role="status"><CheckSquare size={28} aria-hidden="true"/><h3>{rtl ? 'لا توجد مهام بهذه الحالة' : 'No tasks with this status'}</h3><p>{rtl ? 'اختَر حالة أخرى لاستعراض مهامك.' : 'Choose another filter to explore your tasks.'}</p><button type="button" onClick={() => setFilter('all')}>{rtl ? 'عرض الكل' : 'Show all'}</button></div>
      : <ul className="my-tasks-list">{filtered.slice(0, 6).map(task => {
        const overdue = !!task.dueDate && task.dueDate < today && task.status !== 'done';
        const StatusIcon = task.status === 'done' ? Check : task.status === 'in_progress' ? Clock3 : Circle;
        return <li key={task.id} className={`my-task-card ${overdue ? 'is-overdue' : ''}`}><a className="my-task-link" href={`${data.taskAppUrl}/?page=my-tasks&task=${encodeURIComponent(task.id)}`} target="_blank" rel="noopener noreferrer">
          <div className="my-task-topline"><span className={`my-task-priority ${task.priority}`}><Flag size={12} aria-hidden="true"/>{rtl ? `أولوية ${priorities[task.priority]}` : `${priorities[task.priority]} priority`}</span><ArrowUpRight className="my-task-arrow" size={18} aria-hidden="true"/></div>
          <h3>{task.title}</h3><span className="my-task-project"><Folder size={14} aria-hidden="true"/>{task.projectName || (rtl ? 'مهمة شخصية' : 'Personal task')}</span>
          <div className="my-task-footer"><span className={`my-task-status ${task.status}`}><StatusIcon size={13} aria-hidden="true"/>{statuses[task.status]}</span><span className={`my-task-date ${overdue ? 'my-task-overdue' : ''}`}><CalendarDays size={14} aria-hidden="true"/><time dateTime={task.dueDate || undefined}>{task.dueDate ? new Intl.DateTimeFormat(rtl ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${task.dueDate}T12:00:00`)) : (rtl ? 'بدون موعد' : 'No due date')}</time>{overdue && <small>{rtl ? 'متأخرة' : 'Overdue'}</small>}</span></div>
        </a></li>;
      })}</ul>}
  </section>;
}
