import test from "node:test";
import assert from "node:assert/strict";
import { filterSortTimesheetRows } from "../app/timesheet/grid.ts";

test("Timesheet search and two-column sorting use the same grid order as export",()=>{
  const rows=[
    {id:1,work_date:"2026-10-01",employee_name:"Ali",employee_code:"A1",department_name:"Sales",late_minutes:20},
    {id:2,work_date:"2026-10-02",employee_name:"Sara",employee_code:"S2",department_name:"Sales",late_minutes:10},
    {id:3,work_date:"2026-10-03",employee_name:"Omar",employee_code:"O3",department_name:"Ops",late_minutes:10},
  ];
  assert.deepEqual(filterSortTimesheetRows(rows,{search:"sales",first:"late_minutes",second:"employee_name"}).map(row=>row.id),[2,1]);
  assert.deepEqual(filterSortTimesheetRows(rows,{search:"sales",first:"late_minutes",second:"employee_name",descending:true}).map(row=>row.id),[1,2]);
  assert.deepEqual(filterSortTimesheetRows(rows,{search:"O3",first:"work_date"}).map(row=>row.id),[3]);
  assert.equal(rows[0].id,1);
});
