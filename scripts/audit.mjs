// Run with `npm run audit`. Keep high/critical advisories blocking, with one temporary exception.
// GHSA-fc5q-39xc-vjpf has no patched release as of 2026-11-17. Picomatch 4.0.7 is used only by
// development tools with repository-owned globs, never by the shipped UI or Worker. Revisit by
// 2026-12-01; the exception expires then and never applies if picomatch becomes a runtime dependency.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADVISORY = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const EXPIRES = Date.parse('2026-12-01T00:00:00Z');

export function auditFailures(report, lock, now = new Date()) {
  if (report?.error || report?.auditReportVersion !== 2 || !report.vulnerabilities
    || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)) {
    throw new Error('npm audit did not return a valid vulnerability report.');
  }
  const entries = report.vulnerabilities;
  function permitted(name, visiting = new Set()) {
    const entry = entries[name];
    if (!entry || !['info', 'low', 'moderate', 'high', 'critical'].includes(entry.severity)
      || !Array.isArray(entry.via)) throw new Error(`Invalid audit entry: ${name}`);
    if (['info', 'low', 'moderate'].includes(entry.severity)) return true;
    if (entry.severity === 'critical' || !entry.via.length) return false;
    if (visiting.has(name)) throw new Error(`Circular audit entry: ${name}`);
    const path = new Set(visiting).add(name);
    return entry.via.every((cause) => {
      // npm also reports each package affected indirectly; follow it to the actual advisory.
      if (typeof cause === 'string') return permitted(cause, path);
      return name === 'picomatch' && cause?.url === ADVISORY && cause.severity === 'high'
        && now.getTime() < EXPIRES && entry.isDirect === false
        && Array.isArray(entry.nodes) && entry.nodes.length > 0
        && entry.nodes.every((node) => lock.packages?.[node]?.dev === true
          && lock.packages[node].version === '4.0.7');
    });
  }
  return Object.keys(entries).filter((name) => !permitted(name));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.env.npm_execpath) throw new Error('Run this check with npm run audit.');
    const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.signal || ![0, 1].includes(result.status)) throw new Error('npm audit failed to complete.');
    const report = JSON.parse(result.stdout);
    const failures = auditFailures(report, JSON.parse(readFileSync('package-lock.json', 'utf8')));
    if (failures.length) throw new Error(`Blocking dependency advisories: ${failures.join(', ')}. Run npm audit for details.`);
    if (Object.keys(report.vulnerabilities).length) {
      console.log(`Temporary dev-only exception: ${ADVISORY} (expires 2026-12-01).`);
    }
    console.log('Dependency audit passed: no unexcepted high or critical advisories.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
