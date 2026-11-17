import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditFailures } from '../scripts/audit.mjs';

const now = new Date('2026-11-17T20:00:00Z');
function fixture() {
  return {
    report: { auditReportVersion: 2, vulnerabilities: {
      picomatch: { severity: 'high', isDirect: false, nodes: ['node_modules/picomatch'],
        via: [{ url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf', severity: 'high' }] },
      tinyglobby: { severity: 'high', via: ['picomatch'] },
      vite: { severity: 'high', via: ['picomatch', 'tinyglobby'] },
    } },
    lock: { packages: { 'node_modules/picomatch': { version: '4.0.7', dev: true } } },
  };
}

test('allows the exact dev-only advisory and its indirect findings before expiry', () => {
  const { report, lock } = fixture();
  assert.deepEqual(auditFailures(report, lock, now), []);
});

test('blocks another advisory even on the same package', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.picomatch.via.push({ url: 'https://github.com/advisories/GHSA-other', severity: 'high' });
  assert.deepEqual(auditFailures(report, lock, now), ['picomatch', 'tinyglobby', 'vite']);
});

test('blocks the advisory if picomatch enters runtime dependencies or changes version', () => {
  const { report, lock } = fixture();
  lock.packages['node_modules/picomatch'].dev = false;
  assert.equal(auditFailures(report, lock, now).length, 3);
  lock.packages['node_modules/picomatch'] = { version: '4.0.6', dev: true };
  assert.equal(auditFailures(report, lock, now).length, 3);
});

test('checks every installed copy of picomatch', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.picomatch.nodes.push('node_modules/other/node_modules/picomatch');
  assert.equal(auditFailures(report, lock, now).length, 3);
});

test('expires on December 1 and still accepts a clean audit afterwards', () => {
  const { report, lock } = fixture();
  const expiry = new Date('2026-12-01T00:00:00Z');
  assert.equal(auditFailures(report, lock, expiry).length, 3);
  assert.deepEqual(auditFailures({ auditReportVersion: 2, vulnerabilities: {} }, lock, expiry), []);
});

test('keeps critical advisories blocking', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.picomatch.severity = 'critical';
  assert.equal(auditFailures(report, lock, now).length, 3);
});

test('fails closed on audit errors, unexpected formats and unresolved dependencies', () => {
  const { report, lock } = fixture();
  for (const invalid of [{ error: { message: 'registry down' } }, {}, { auditReportVersion: 2, vulnerabilities: [] }]) {
    assert.throws(() => auditFailures(invalid, lock, now));
  }
  report.vulnerabilities.vite.via = ['missing'];
  assert.throws(() => auditFailures(report, lock, now), /Invalid audit entry/);
  report.vulnerabilities.vite.via = ['vite'];
  assert.throws(() => auditFailures(report, lock, now), /Circular audit entry/);
});
