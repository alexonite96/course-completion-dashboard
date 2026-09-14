import { mkdirSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const hireHeaders = ['Hire Date', 'JS Date', 'First & Last Name', 'Department', 'EE#', 'Role', 'Hiring Manager ', 'Country', 'Time Zone', 'VP Level'];
const planHeaders = ['Title', 'Category', 'Audience', 'Department', 'Region'];

const today = new Date();
const daysAgo = (n) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const hires = [
  [daysAgo(20), daysAgo(20), 'Jane Cooper', 'Services', '900001', 'Services Consultant', 'Maria Rivera', 'Mexico', 'MEX', 'Paul Thompson'],
  [daysAgo(20), daysAgo(20), 'Kevin Adebayo', 'Support', '900002', 'Payroll Specialist III', 'Kevin Tan', 'India', 'IST', 'Ed Ciszewski'],
  [daysAgo(3), daysAgo(3), 'Sofia Marin', 'Services', '900003', 'Services Consultant Sr', 'Maria Rivera', 'Mexico', 'MEX', 'Paul Thompson'],
  [daysAgo(45), daysAgo(45), 'Old Hire Example', 'Support', '900004', 'Application Developer', 'Kevin Tan', 'USA', 'EST', 'Ed Ciszewski'],
];

const plans = [
  ['Jump Start - Week 1', 'Week 1', 'All', 'GCO', 'All'],
  ['Jump Start - Services Consultants Core & GL', 'Week 2+', 'Services Consultants & GL Consultants', 'Services', 'All'],
  ['Jump Start - Managed Payroll Specialist', 'Week 2+', 'Managed Payroll Specialist', 'Support - Managed', 'All'],
];

const masterWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(masterWb, XLSX.utils.aoa_to_sheet([hireHeaders, ...hires]), 'Jump Start');
XLSX.utils.book_append_sheet(masterWb, XLSX.utils.aoa_to_sheet([planHeaders, ...plans]), 'JS LPs');

const reportMetadata = ['MyDayforce | Learning Plan Completion Report | Dayforce sample'];
const reportHeaders = [
  'Preferred Name', 'Employee Last Name', 'Business Email', 'Job Assignment Name', 'Learning Plan',
  'Learning Plan Enrollment Date', 'Course', 'Course Enrollment Start', 'Course Enrolment Completion',
  'Course Score', 'Manager', 'Second Level Manager', 'Primary Address Country', 'Department Name',
  'Location Name', 'Course Duration', 'Learning Plan Completion Date',
];

const reportRows = [
  // Jane Cooper: Week 1 complete, Week 2 complete -> On Track
  ['Jane', 'Cooper', 'jane.cooper@dayforce.com', 'Services Consultant', 'Jump Start - Week 1', daysAgo(20), 'Intro', daysAgo(20), daysAgo(18), '', 'Maria Rivera', '', 'Mexico', 'Implementation', 'Loc', 900, daysAgo(18)],
  ['Jane', 'Cooper', 'jane.cooper@dayforce.com', 'Services Consultant', 'Jump Start - Services Consultants Core & GL', daysAgo(18), 'Core Skills', daysAgo(18), daysAgo(12), '', 'Maria Rivera', '', 'Mexico', 'Implementation', 'Loc', 900, daysAgo(12)],
  // Kevin Adebayo: Week 1 complete, Week 2 overdue (JS date 20 days ago, Week 2 deadline was 6 days ago)
  ['Kevin', 'Adebayo', 'kevin.adebayo@dayforce.com', 'Payroll Specialist III', 'Jump Start - Week 1', daysAgo(20), 'Intro', daysAgo(20), daysAgo(18), '', 'Kevin Tan', '', 'India', 'Support', 'Loc', 900, daysAgo(18)],
  ['Kevin', 'Adebayo', 'kevin.adebayo@dayforce.com', 'Payroll Specialist III', 'Jump Start - Managed Payroll Specialist', daysAgo(18), 'Payroll Basics', daysAgo(18), '', '', 'Kevin Tan', '', 'India', 'Support', 'Loc', 900, ''],
  // Sofia Marin: nothing started yet (JS date 3 days ago, within deadline)
  // Old Hire Example: intentionally absent from the report (unmatched, "No training data found")
];

const reportWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(reportWb, XLSX.utils.aoa_to_sheet([reportMetadata, reportHeaders, ...reportRows]), 'Sheet1');

mkdirSync('sample-data', { recursive: true });
writeFileSync('sample-data/onboarding-master.xlsx', XLSX.write(masterWb, { type: 'buffer', bookType: 'xlsx' }));
writeFileSync('sample-data/onboarding-completion-report.xlsx', XLSX.write(reportWb, { type: 'buffer', bookType: 'xlsx' }));
console.log('Wrote sample-data/onboarding-master.xlsx and sample-data/onboarding-completion-report.xlsx');
