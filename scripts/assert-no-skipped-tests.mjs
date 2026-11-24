// Fails when a Jest run skipped a suite or a test. In CI every database/Redis spec
// is supposed to run; a skipped one means its environment variable went missing
// and the check would be silently green.
//
// usage: node scripts/assert-no-skipped-tests.mjs jest-results.json
import { readFileSync } from 'node:fs';

// Skips that are on purpose, each with where it really runs:
const EXPECTED_SKIPS = [
  // Needs the real tax calculator: runs in the "Validate Docker and Compose" job.
  { file: /\.rtc-integration\.spec\.ts$/ },
  // Opt-in benchmark (PACKAGE_BENCH_COUNT), not a test.
  { name: /\bbench: / },
];

const file = process.argv[2];
if (!file) {
  console.error('usage: assert-no-skipped-tests.mjs <jest-results.json>');
  process.exit(2);
}
const results = JSON.parse(readFileSync(file, 'utf8'));
const isExpected = (suiteName, testName) =>
  EXPECTED_SKIPS.some(
    (rule) =>
      (rule.file?.test(suiteName) ?? true) &&
      (rule.name?.test(testName) ?? true),
  );
const skipped = [];
for (const suite of results.testResults) {
  for (const test of suite.assertionResults) {
    if (
      ['pending', 'todo', 'skipped'].includes(test.status) &&
      !isExpected(suite.name, test.fullName)
    )
      skipped.push(`${suite.name} :: ${test.fullName}`);
  }
}
if (skipped.length > 0) {
  console.error(`${skipped.length} test(s) were skipped:`);
  for (const line of skipped) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`No unexpected skips (${results.numPassedTests} tests passed).`);
