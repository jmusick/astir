// Writes latest.json, the file the app's updater reads from the newest GitHub Release (D38).
// Run by .github/workflows/release.yml after `npm run app:build`:
//
//   node scripts/updater-manifest.mjs <tag> <repo> <installer.exe> <out.json>
//
// The installer's .sig (made with the updater's private key) must sit beside it. Notes come from
// the version's CHANGELOG.md section, which is written for people who use Astir.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

export function changelogNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return '';
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## ['));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

export function manifest({ tag, repo, installer, signature, notes, now = new Date() }) {
  const version = tag.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`Not a version tag: ${tag}`);
  return {
    version,
    notes,
    pub_date: now.toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: signature.trim(),
        url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(basename(installer))}`,
      },
    },
  };
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const [tag, repo, installer, out] = process.argv.slice(2);
  if (!tag || !repo || !installer || !out) {
    console.error('Usage: node scripts/updater-manifest.mjs <tag> <repo> <installer.exe> <out.json>');
    process.exit(2);
  }
  const notes = changelogNotes(readFileSync('CHANGELOG.md', 'utf8'), tag.replace(/^v/, ''));
  const data = manifest({ tag, repo, installer, signature: readFileSync(`${installer}.sig`, 'utf8'), notes });
  writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Wrote ${out} for ${data.version}`);
}
