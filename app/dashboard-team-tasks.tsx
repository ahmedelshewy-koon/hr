"use client";
import { ArrowUpRight, CalendarDays, Check, CheckCheck, Circle, Clock3, ExternalLink, Folder, RefreshCw, UserRound, UsersRound } from 'lucide-react';
import { useTaskBridge, type Task } from './dashboard-my-tasks';

type TeamTask = Task & { assignees: string[] };

// Manager view: open tasks of reporting employees, nearest due date first (ordered by TASK).
export function DashboardTeamTasks({ rtl }: { rtl: boolean }) {
  const { data, failed, retry } = useTaskBridge<TeamTask>('/api/task/team-tasks');
  const statuses = rtl ? { todo: 'لم تبدأ', in_progress: 'قيد التنفيذ', done: 'مكتملة' } : { todo: 'To do', in_progress: 'In progress', done: 'Done' };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const tasks = data?.tasks ?? [];
  const formatNumber = (value: number) => new Intl.NumberFormat(rtl ? 'ar-EG' : 'en-GB').format(value);
  const dueLabel = (dueDate: string | null) => {
    if (!dueDate) return { tone: 'none', text: rtl ? 'بدون موعد' : 'No due date' };
    const days = Math.round((Date.parse(`${dueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
    if (days < 0) return { tone: 'overdue', text: rtl ? `متأخرة ${formatNumber(-days)} يوم` : `${-days}d overdue` };
    if (days === 0) return { tone: 'today', text: rtl ? 'مستحقة اليوم' : 'Due today' };
    if (days === 1) return { tone: 'soon', text: rtl ? 'مستحقة غدًا' : 'Due tomorrow' };
    return { tone: days <= 7 ? 'soon' : 'later', text: rtl ? `خلال ${formatNumber(days)} يوم` : `In ${days} days` };
  };
  return <section className="panel dashboard-my-tasks dashboard-team-tasks" dir={rtl ? 'rtl' : 'ltr'} aria-label={rtl ? 'أقرب مهام فريقي' : 'Upcoming team tasks'}>
    <div className="my-tasks-header">
      <div className="my-tasks-heading"><span className="my-tasks-heading-icon"><UsersRound size={24} aria-hidden="true"/></span><div><span className="my-tasks-eyebrow">{rtl ? 'متابعة فريقي' : 'Team follow-up'}</span><h2>{rtl ? 'أقرب مهام فريقي' : 'Upcoming team tasks'}{data && <span className="my-tasks-count">{formatNumber(tasks.length)}</span>}</h2><p>{rtl ? 'المهام المفتوحة للموظفين التابعين لك، الأقرب موعدًا أولًا.' : 'Open tasks of the people reporting to you, nearest due date first.'}</p></div></div>
      {data && <a className="my-tasks-open" href={`${data.taskAppUrl}/?page=team`} target="_blank" rel="noopener noreferrer">{rtl ? 'عرض مهام الفريق' : 'View team tasks'}<ExternalLink size={15}/></a>}
    </div>
    {failed ? <div className="my-tasks-message" role="status"><p>{rtl ? 'تعذّر تحميل مهام الفريق. حاول مرة أخرى.' : 'Unable to load team tasks. Please try again.'}</p><button type="button" className="outline" onClick={retry}><RefreshCw size={15}/>{rtl ? 'إعادة المحاولة' : 'Retry'}</button></div>
      : !data ? <div className="my-tasks-loading" role="status"><span>{rtl ? 'جارٍ تحميل مهام الفريق…' : 'Loading team tasks…'}</span><div aria-hidden="true">{[0, 1, 2].map(value => <div className="my-task-skeleton" key={value}/>)}</div></div>
      : !tasks.length ? <div className="my-tasks-message"><CheckCheck size={30} aria-hidden="true"/><h3>{rtl ? 'فريقك على المسار' : 'Your team is all clear'}</h3><p>{rtl ? 'لا توجد مهام مفتوحة للموظفين التابعين لك حاليًا.' : 'No open tasks for the people reporting to you.'}</p></div>
      : <ul className="my-tasks-list">{tasks.slice(0, 6).map(task => {
        const due = dueLabel(task.dueDate);
        const StatusIcon = task.status === 'done' ? Check : task.status === 'in_progress' ? Clock3 : Circle;
        return <li key={task.id} className={`my-task-card ${due.tone === 'overdue' ? 'is-overdue' : ''}`}><a className="my-task-link" href={`${data.taskAppUrl}/?page=team&task=${encodeURIComponent(task.id)}`} target="_blank" rel="noopener noreferrer">
          <div className="my-task-topline"><span className={`team-task-due ${due.tone}`}><CalendarDays size={12} aria-hidden="true"/>{due.text}</span><ArrowUpRight className="my-task-arrow" size={18} aria-hidden="true"/></div>
          <h3>{task.title}</h3>
          <span className="team-task-assignee"><UserRound size={14} aria-hidden="true"/>{task.assignees.join(rtl ? '، ' : ', ')}</span>
          <span className="my-task-project"><Folder size={14} aria-hidden="true"/>{task.projectName || (rtl ? 'مهمة شخصية' : 'Personal task')}</span>
          <div className="my-task-footer"><span className={`my-task-status ${task.status}`}><StatusIcon size={13} aria-hidden="true"/>{statuses[task.status]}</span>{task.dueDate && <span className={`my-task-date ${due.tone === 'overdue' ? 'my-task-overdue' : ''}`}><time dateTime={task.dueDate}>{new Intl.DateTimeFormat(rtl ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${task.dueDate}T12:00:00`))}</time></span>}</div>
        </a></li>;
      })}</ul>}
  </section>;
}
