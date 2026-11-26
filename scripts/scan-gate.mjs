import fs from 'node:fs';

const reportPath = process.argv[2];
const max = Number(process.env.SCAN_MAX);
const image = process.env.APP_IMAGE || '';

if (!reportPath || !Number.isFinite(max)) {
  console.error('usage: SCAN_MAX=<n> APP_IMAGE=<image> node scan-gate.mjs report.json');
  process.exit(2);
}

const doc = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
let found = 0;
for (const result of doc.Results || []) {
  for (const vuln of result.Vulnerabilities || []) {
    if (vuln.Severity === 'CRITICAL' || vuln.Severity === 'HIGH') found += 1;
  }
}

const gate = found <= max ? 'pass' : 'fail';
console.log(`image=${image}`);
console.log('severity=CRITICAL,HIGH');
console.log(`found=${found}`);
console.log(`max-allowed=${max}`);
console.log(`gate=${gate}`);
process.exit(gate === 'pass' ? 0 : 1);
