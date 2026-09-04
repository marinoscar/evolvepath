// Generates per-issue updated bodies (with real #N references) for GitHub issue_write update.
// Inputs: scratchpad/issues/E0N.json + E0N.map.json. Output: scratchpad/issues/updates/<number>.md and index.json
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [,, issuesDir, branch = 'claude/app-epics-ai-config-eoy5mt'] = process.argv;
const out = join(issuesDir, 'updates'); mkdirSync(out, { recursive: true });
const maps = {};
for (const f of readdirSync(issuesDir).filter(f => /^E\d\d\.map\.json$/.test(f))) Object.assign(maps, JSON.parse(readFileSync(join(issuesDir, f), 'utf8')));
const epics = readdirSync(issuesDir).filter(f => /^E\d\d\.json$/.test(f)).sort().map(f => JSON.parse(readFileSync(join(issuesDir, f), 'utf8')));
const num = id => maps[id];
const index = []; const unresolved = new Set();
const refInline = (text) => text.replace(/\b(E\d\d-\d\d)\b(?! \(#)/g, (m, id) => num(id) ? `${id} (#${num(id)})` : (unresolved.add(id), m));
for (const e of epics) {
  if (!num(e.id)) { unresolved.add(e.id); continue; }
  // epic body
  let body = e.epicBody
    .replace(/^- \[ \] (E\d\d-\d\d) (.+)$/gm, (m, id, title) => num(id) ? `- [ ] #${num(id)} ${title}` : (unresolved.add(id), m));
  body = refInline(body);
  body = `_Spec: [docs/epics/${e.file}](https://github.com/marinoscar/evolvepath/blob/${branch}/docs/epics/${e.file}) · Phase ${e.phase} · Tracking: [ROADMAP.md](https://github.com/marinoscar/evolvepath/blob/${branch}/ROADMAP.md)_\n\n` + body;
  writeFileSync(join(out, `${num(e.id)}.md`), body);
  index.push({ number: num(e.id), id: e.id, title: `Epic: ${e.title}`, file: `${num(e.id)}.md` });
  for (const c of e.children) {
    if (!num(c.id)) { unresolved.add(c.id); continue; }
    let b = c.body.replace(/\*\*Part of epic:\*\* E\d\d/, `**Part of epic:** #${num(e.id)} (${e.id})`);
    // Blocked by list in header: "**Blocked by:** E01-02, E01-03" -> "#22, #23"
    b = b.replace(/(\*\*Blocked by:\*\*)([^·\n]*)/, (m, k, list) => k + list.replace(/\b(E\d\d-\d\d)\b/g, (mm, id) => num(id) ? `#${num(id)}` : (unresolved.add(id), mm)));
    b = refInline(b);
    writeFileSync(join(out, `${num(c.id)}.md`), b);
    index.push({ number: num(c.id), id: c.id, title: c.title, file: `${num(c.id)}.md` });
  }
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2));
console.log(`wrote ${index.length} update bodies; unresolved ids: ${[...unresolved].join(', ') || 'none'}`);
