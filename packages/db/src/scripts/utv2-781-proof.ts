import fs from 'node:fs';

const report1 = JSON.parse(
  fs.readFileSync('docs/06_status/proof/UTV2-781/replay-report-1x.json', 'utf-8'),
);

const report2 = JSON.parse(
  fs.readFileSync('docs/06_status/proof/UTV2-781/replay-report-2x.json', 'utf-8'),
);

if (report1.verdict !== 'pass') {
  throw new Error('1x replay proof failed');
}

if (report2.verdict !== 'pass') {
  throw new Error('2x replay proof failed');
}

console.log('UTV2-781 proof verified');
