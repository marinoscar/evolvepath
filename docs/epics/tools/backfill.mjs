// Back-fills GitHub issue numbers into docs/epics/*.md and README, and generates ROADMAP.md.
// Inputs: scratchpad/issues/E0N.json (from parse-epics.mjs) + scratchpad/issues/E0N.map.json ({"E01": 21, "E01-01": 22, ...}).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [,, issuesDir, epicsDir, repoRoot, repoSlug = 'marinoscar/evolvepath'] = process.argv;
const maps = {};
for (const f of readdirSync(issuesDir).filter(f => /^E\d\d\.map\.json$/.test(f))) Object.assign(maps, JSON.parse(readFileSync(join(issuesDir, f), 'utf8')));
const epics = readdirSync(issuesDir).filter(f => /^E\d\d\.json$/.test(f)).sort().map(f => JSON.parse(readFileSync(join(issuesDir, f), 'utf8')));
const num = id => maps[id];
const ref = id => (num(id) ? `#${num(id)}` : id);
const url = id => `https://github.com/${repoSlug}/issues/${num(id)}`;
const missing = [];
// 1) back-fill spec files: replace E0N-MM and standalone E0N tokens that have numbers
for (const e of epics) {
  const p = join(epicsDir, e.file);
  let t = readFileSync(p, 'utf8');
  // Scope lines: "- [ ] E01-01 title" -> "- [ ] #22 title (E01-01)"
  t = t.replace(/^- \[ \] (E\d\d-\d\d) (.+)$/gm, (m, id, title) => num(id) ? `- [ ] #${num(id)} ${title} (${id})` : (missing.push(id), m));
  // headings: "### E01-01 `title`" -> "### E01-01 `title` — #22"
  t = t.replace(/^### (E\d\d-\d\d) `([^`]+)`(?: — #\d+)?$/gm, (m, id, title) => num(id) ? `### ${id} \`${title}\` — #${num(id)}` : m);
  // H1: add epic issue link line after epic-meta
  if (num(e.id) && !t.includes('<!-- epic-issue:')) t = t.replace(/(<!-- epic-meta:[^>]*-->)/, `$1\n<!-- epic-issue: #${num(e.id)} -->\n\n> GitHub epic: [#${num(e.id)}](${url(e.id)})`);
  // inline references in prose: "E01-02" -> "E01-02 (#23)" only where not already followed by " (#" and not in headings/scope
  t = t.replace(/\b(E\d\d-\d\d)\b(?! \(#)(?!` — #)/g, (m, id, off) => {
    const lineStart = t.lastIndexOf('\n', off) + 1; const line = t.slice(lineStart, t.indexOf('\n', off));
    if (/^(### |- \[ \] )/.test(line)) return m;
    return num(id) ? `${id} (#${num(id)})` : m;
  });
  writeFileSync(p, t);
}
// 2) README table GitHub column
const readme = join(epicsDir, 'README.md');
if (existsSync(readme)) {
  let r = readFileSync(readme, 'utf8');
  for (const e of epics) if (num(e.id)) r = r.replace(new RegExp(`(\\|\\s*${e.id}\\s*\\|[^\\n]*?)_pending_`), `$1[#${num(e.id)}](${url(e.id)})`);
  writeFileSync(readme, r);
}
// 3) ROADMAP.md
const phases = { 1: 'Phase 1 — Foundation', 2: 'Phase 2 — Core loop', 3: 'Phase 3 — Domains', 4: 'Phase 4 — Adaptation' };
const rows = epics.map(e => `| ${e.id} | [${e.title}](docs/epics/${e.file}) | ${num(e.id) ? `[#${num(e.id)}](${url(e.id)})` : '_pending_'} | Not started | 0 / ${e.children.length} | ${phases[e.phase] ?? e.phase} |`).join('\n');
const checklists = epics.map(e => `### ${e.id} — ${e.title}\n\nEpic: ${num(e.id) ? `[#${num(e.id)}](${url(e.id)})` : '_pending_'} · Spec: [docs/epics/${e.file}](docs/epics/${e.file}) · Verify: see "Manual end-to-end verification" in the spec.\n\n${e.children.map(c => `- [ ] ${num(c.id) ? `[#${num(c.id)}](${url(c.id)})` : c.id} ${c.title}`).join('\n')}`).join('\n\n');
const roadmap = `# EvolvePath Roadmap

> **Become who you want to be — one action at a time.**

This is the single tracking document for all product work. It sits beside [VISION.md](VISION.md) and [PRD.md](PRD.md); the executable detail for every epic and child issue lives in [docs/epics/](docs/epics/README.md) and on GitHub.

## The product loop we are building

Aspiration → Outcome → Plan → Routine → Commitment → Action → Evidence → Reflection → Adaptation → Consistency → Change. The product owns the plan (deterministic state); the AI owns the coaching (probabilistic intelligence). Every epic below adds a testable slice of that loop.

**Delivery principle:** each epic is testable end to end — database + API + UI — from a clean clone, using the fake OpenAI server so no epic's verification spends money. Each epic's last child adds the Playwright e2e spec that proves it.

## Epics

| # | Epic | GitHub | Status | Done / total | Phase |
|---|------|--------|--------|--------------|-------|
${rows}

Status values: Not started · In progress · Done. "Done / total" mirrors the GitHub sub-issue progress bar on the epic; update it when children close.

## Dependency graph

\`\`\`mermaid
graph LR
  E01[E01 AI config & BYOK] --> E02[E02 Shell & domain model]
  E02 --> E03[E03 Media attachments]
  E03 --> E04[E04 Onboarding]
  E04 --> E05[E05 Today & start flow]
  E05 --> E06[E06 AI coach & memory]
  E03 --> E06
  E06 --> E07[E07 Work]
  E06 --> E08[E08 Family]
  E06 --> E09[E09 Health & workouts]
  E03 --> E09
  E07 --> E10[E10 Weekly review]
  E08 --> E10
  E09 --> E10
  E10 --> E11[E11 Momentum & recovery]
  E11 --> E12[E12 Coaching notifications]
\`\`\`

Phases: **1 Foundation** (E01–E03) · **2 Core loop** (E04–E06) · **3 Domains** (E07–E09, parallelizable) · **4 Adaptation** (E10–E12).

## Per-epic checklists

${checklists}

## Deferred / out of scope (PRD §100, §112, §113)

Wearables (Oura, WHOOP, Garmin, Apple Health), continuous glucose, calendar integration, home-screen widgets, voice coaching, accountability partners and social feeds, public leaderboards, calorie or restaurant food databases, email/Slack clients, enterprise task management, couples therapy, biometric recovery scoring, financial goals, coach marketplace, additional life domains, XP/avatar economies, monetization. Do not re-litigate these inside an epic; open a new epic if the PRD changes.

## Maintenance rule

- When a child issue closes, tick it here **and** in the epic's Scope list on GitHub in the same PR that closes it, and bump the epic's "Done / total".
- When every child of an epic is closed, set the epic's Status to **Done** and close the epic issue.
- GitHub's sub-issue progress bar is the live counter; this file is the human-readable snapshot committed with the code. If they disagree, GitHub wins and this file gets fixed.
- New work is filed as a child of an existing epic or as a new epic spec under \`docs/epics/\` first (see [docs/epics/README.md](docs/epics/README.md)), then created on GitHub.
`;
writeFileSync(join(repoRoot, 'ROADMAP.md'), roadmap);
console.log(`back-filled ${epics.length} epics; ROADMAP.md written; unresolved ids: ${[...new Set(missing)].join(', ') || 'none'}`);
