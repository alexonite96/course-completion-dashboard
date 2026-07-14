import { mkdirSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const managers = ['Maria Rivera', 'Kevin Tan', 'Jide Okafor', 'Sara Lopez'];
const rows = [[
  'Employee First Name', 'Employee Last Name', 'Business Email', 'Job Assignment',
  'Course Title', 'Course Start Date', 'Course Completion Date', 'Manager',
]];
for (let i = 1; i <= 40; i += 1) {
  const completed = i % 3 !== 0; // ~2/3 completed
  rows.push([
    `First${i}`, `Last${i}`, `user${i}@example.com`,
    i % 7 === 0 ? 'Team Lead' : 'Specialist',
    'Safety 101', '2026-06-01', completed ? '2026-06-20' : '',
    managers[i % managers.length],
  ]);
}
// One row that the parser must skip (no email)
rows.push(['NoEmail', 'Person', '', 'Specialist', 'Safety 101', '2026-06-01', '', 'Maria Rivera']);

const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Export');
mkdirSync('sample-data', { recursive: true });
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
writeFileSync('sample-data/sample-course.xlsx', buf);
console.log('Wrote sample-data/sample-course.xlsx (40 valid rows + 1 skippable)');
