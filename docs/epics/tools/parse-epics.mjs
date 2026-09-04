// Parses docs/epics/E*.md (strict format) into JSON: { id, title, slug, phase, epicBody, children:[{id,title,body}] }
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2] || '/home/user/evolvepath/docs/epics';
const out = process.argv[3] || '.';
const files = readdirSync(dir).filter(f => /^E\d\d-.*\.md$/.test(f)).sort();
const problems = [];
for (const f of files) {
  const text = readFileSync(join(dir, f), 'utf8');
  const m = text.match(/^# (E\d\d) — (.+)$/m);
  if (!m) { problems.push(`${f}: missing H1 '# E0N — Title'`); continue; }
  const [, id, title] = m;
  const meta = text.match(/<!-- epic-meta: slug=([a-z0-9-]+) phase=(\d) -->/);
  if (!meta) problems.push(`${f}: missing epic-meta comment`);
  const epicStart = text.indexOf('\n## Epic');
  const childStart = text.indexOf('\n## Child issues');
  if (epicStart < 0 || childStart < 0) { problems.push(`${f}: missing '## Epic' or '## Child issues'`); continue; }
  const epicBody = text.slice(epicStart + '\n## Epic'.length, childStart).trim();
  const childText = text.slice(childStart + '\n## Child issues'.length);
  const parts = childText.split(/\n---\n/).map(s => s.trim()).filter(Boolean);
  const children = [];
  for (const p of parts) {
    const h = p.match(/^### (E\d\d-\d\d) `([^`]+)`(?: — #\d+)?\s*\n/);
    if (!h) { problems.push(`${f}: child block without '### E0N-MM \`title\`' heading: ${p.slice(0, 60).replace(/\n/g, ' ')}`); continue; }
    const body = p.slice(h[0].length).trim();
    if (/^## /m.test(body)) problems.push(`${f} ${h[1]}: H2 heading inside child body`);
    for (const sec of ['#### Problem statement', '#### Proposed solution', '#### Acceptance criteria', '#### Definition of done', '#### Manual test script', '#### Out of scope', '#### Notes for the implementing agent'])
      if (!body.includes(sec)) problems.push(`${f} ${h[1]}: missing section '${sec}'`);
    children.push({ id: h[1], title: h[2], body });
  }
  // Scope list check
  const scope = [...epicBody.matchAll(/^- \[[ x]\] (?:#\d+ .+? \((E\d\d-\d\d)\)|(E\d\d-\d\d) .+)$/gm)].map(x => x[1] || x[2]);
  const childIds = children.map(c => c.id);
  if (JSON.stringify(scope) !== JSON.stringify(childIds)) problems.push(`${f}: Scope list ${scope.join(',')} != children ${childIds.join(',')}`);
  const json = { id, title, slug: meta?.[1], phase: meta ? Number(meta[2]) : null, file: f, epicBody, children };
  writeFileSync(join(out, `${id}.json`), JSON.stringify(json, null, 2));
  console.log(`${id} ${title}: ${children.length} children, epic body ${epicBody.length} chars, slug=${json.slug} phase=${json.phase}`);
}
if (problems.length) { console.log('\nPROBLEMS:'); for (const p of problems) console.log(' - ' + p); process.exitCode = 1; } else console.log('\nOK: no format problems');
