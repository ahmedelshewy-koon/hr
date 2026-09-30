import { BriefcaseBusiness, CalendarDays, Check, Clock3, Coins, FileText, UsersRound } from "lucide-react";

const modules = [
  { name: "الموظفون", position: "employees", Icon: UsersRound },
  { name: "الحضور", position: "attendance", Icon: Clock3 },
  { name: "الإجازات", position: "leave", Icon: CalendarDays },
  { name: "الرواتب", position: "payroll", Icon: Coins },
  { name: "التوظيف", position: "recruitment", Icon: BriefcaseBusiness },
  { name: "التقارير", position: "reports", Icon: FileText },
] as const;

/** Decorative connections sit behind semantic, readable module labels. */
export function OrgScene() {
  return (
    <div className="login-ecosystem" role="group" aria-label="منظومة الموارد البشرية المتكاملة">
      <svg className="login-connections" viewBox="0 0 640 640" fill="none" aria-hidden="true">
        <circle className="login-orbit" cx="320" cy="320" r="218" />
        <circle className="login-orbit login-orbit-inner" cx="320" cy="320" r="116" />
        {[[320, 204], [320, 436], [204, 320], [436, 320], [102, 320], [538, 320]].map(([cx, cy]) => (
          <circle className="login-node" key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" />
        ))}
      </svg>
      <div className="login-team" aria-hidden="true">
        <UsersRound size={64} strokeWidth={1.5} />
        <span className="login-team-check"><Check size={21} strokeWidth={3} /></span>
      </div>
      <ul className="login-modules">
        {modules.map(({ name, position, Icon }) => (
          <li className={`login-module login-module-${position}`} key={position}>
            <span className="login-module-icon"><Icon size={25} strokeWidth={1.7} aria-hidden="true" /></span>
            <span>{name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
