// Pure, dependency-free helpers for the status dashboard.
// generate.mjs fetches data via `gh api graphql` and feeds it to these.

// The five design libraries in dependency order. `order` is the tie-broken
// rank; `epic` points at the live GSA epic (null = no epic filed yet). The
// Angular parent sub-issue number is where the per-major upgrade chain hangs.
export const LIBRARIES = [
  {
    repo: 'sam-styles',
    order: 0,
    epic: { owner: 'GSA', number: 732 },
    angularParentNumber: null, // SCSS only — Angular N/A per ADR-0002
    metrics: {
      // Deliberately null, not unconfigured: sam-styles measures
      // component/story smoke coverage (`scripts/coverage-report.mjs
      // --threshold=90`), a different metric from line coverage, and commits
      // no result file. Reported as "not published" until it does.
      coverage: null,
      lint: { kind: 'stylelint-baseline', path: 'stylelint-baseline.json' }, // GSA/sam-styles#823, landed via #824
      a11y: true, // playwright.a11y.config.mjs — WCAG 2.1 AA gate
    },
  },
  {
    repo: 'ngx-uswds-icons',
    order: 1,
    epic: { owner: 'GSA', number: 26 },
    angularParentNumber: 32,
    // Curated fallback: the GSA repo has no description set and we lack admin
    // to set it. Used only when the live GitHub description is null.
    fallbackDescription: 'USWDS icons packaged as Angular components.',
    metrics: {
      // No coverage-floor.json yet; the committed badge SVG carries the real
      // measured number in its aria-label. Parsed rather than dropped so the
      // grid keeps a number here; a follow-up asks the repo to commit a floor.
      coverage: { kind: 'badge', path: '.github/badges/coverage.svg' },
      lint: true, // eslint runs in CI (ci.yml) but commits no debt baseline — GSA/ngx-uswds-icons#124
      a11y: false, // Playwright smoke test only, no axe/WCAG gate
    },
  },
  {
    repo: 'ngx-uswds',
    order: 2,
    epic: { owner: 'GSA', number: 184 },
    angularParentNumber: 194,
    metrics: {
      coverage: { kind: 'floor', path: 'coverage-floor.json' },
      lint: true, // ng lint runs in CI (ci.yaml) but commits no debt baseline — GSA/ngx-uswds#296
      a11y: true, // playwright.a11y.config.ts — WCAG 2.1 AA gate
    },
  },
  {
    repo: 'sam-ui-elements',
    order: 3,
    epic: { owner: 'GSA', number: 562 },
    // Unlike the other epics, sam-ui-elements has no single Angular parent that
    // rolls up a per-major chain; the migration is spread across three direct
    // sub-issues (ngx-formly 6→7 gate, 19→20, 20→21). List them so the Angular
    // track counts those issues and the Pipeline track excludes them.
    angularParentNumber: null,
    angularIssueNumbers: [573, 574, 575],
    // The @angular/core pin lives in the test-app, not the repo root — this
    // library's root package.json declares only Angular tooling. Point the
    // version lookup at the nested manifest.
    packageJsonPath: 'test-app/package.json',
    metrics: {
      coverage: { kind: 'floor', path: 'coverage-floor.json' },
      // The only repo with a committed lint debt baseline. Warnings only —
      // check-lint-baseline.mjs fails on ANY error, so errors are 0 by
      // construction on the default branch. Ratchets down only.
      lint: { kind: 'eslint-baseline', path: 'eslint-baseline.json' },
      a11y: false, // no axe/WCAG gate yet
    },
  },
  {
    repo: 'sam-design-system',
    order: 4,
    epic: null,
    angularParentNumber: null,
    // Curated fallback (see ngx-uswds-icons note above).
    fallbackDescription:
      'SAM Design System — the unified Angular component library.',
    // Not yet instrumented: CircleCI, no committed metrics, no upgrade epic,
    // and nothing shipped on the default branch since 2025-01. Kept in the
    // grid as an all-"not published" row because that staleness is itself the
    // finding — dropping the row would hide it.
    metrics: { coverage: null, lint: null, a11y: false },
  },
];

/** Column order of the four ratchet metrics in a coverage-floor.json. */
export const COVERAGE_METRICS = ['statements', 'branches', 'functions', 'lines'];

/** Return libraries sorted into dependency order. */
export function orderLibraries(libraries) {
  return [...libraries].sort((a, b) => a.order - b.order);
}

/**
 * Split an epic's direct sub-issues into two tracks:
 *  - Angular: either the per-major parent sub-issue rolled up over ITS
 *    children (`angularParentNumber`), or a flat set of direct sub-issues
 *    named by `angularIssueNumbers` (used when the migration isn't a single
 *    roll-up parent, e.g. sam-ui-elements #573/#574/#575).
 *  - Pipeline: every other direct sub-issue.
 *
 * @param {{ angularParentNumber?: number, angularIssueNumbers?: number[], subIssues: Array }} epic
 * @returns {{ pipeline: {closed:number,total:number}, angular: {closed:number,total:number}|null }}
 */
export function classifyTracks(epic) {
  const direct = epic.subIssues ?? [];

  // A flat list of direct sub-issue numbers that make up the Angular track
  // (used when the migration isn't a single roll-up parent — e.g.
  // sam-ui-elements splits it across #573/#574/#575).
  const angularNumbers = new Set(epic.angularIssueNumbers ?? []);

  const parent = epic.angularParentNumber
    ? direct.find((i) => i.number === epic.angularParentNumber)
    : undefined;

  const pipelineIssues = direct.filter(
    (i) => i.number !== epic.angularParentNumber && !angularNumbers.has(i.number),
  );

  let angular = null;
  if (parent) {
    // Per-major parent rolled up over its own children.
    angular = rollup(parent.subIssues ?? []);
  } else if (angularNumbers.size > 0) {
    // Flat set of direct sub-issues counted as the Angular track.
    angular = rollup(direct.filter((i) => angularNumbers.has(i.number)));
  }

  return {
    pipeline: rollup(pipelineIssues),
    angular,
  };
}

function rollup(issues) {
  return {
    closed: issues.filter((i) => i.state === 'CLOSED').length,
    total: issues.length,
  };
}

/**
 * Extract the major Angular version from a repo's root package.json text.
 * Checks `dependencies` → `devDependencies` → `peerDependencies` for
 * `@angular/core` (the root app pins the build/dev version; publishable
 * sub-packages only declare a peer range). Returns the leading major integer
 * of the first range found, or null when Angular isn't present / unparseable.
 *
 * @param {string|null|undefined} packageJsonText
 * @returns {number|null}
 */
export function angularMajor(packageJsonText) {
  if (!packageJsonText) return null;
  let pkg;
  try {
    pkg = JSON.parse(packageJsonText);
  } catch {
    return null;
  }
  const range =
    pkg?.dependencies?.['@angular/core'] ??
    pkg?.devDependencies?.['@angular/core'] ??
    pkg?.peerDependencies?.['@angular/core'];
  if (!range) return null;
  // First integer in the range: `^17.3.1` → 17, `>=17.0.0 <18.0.0` → 17.
  const match = String(range).match(/\d+/);
  return match ? Number(match[0]) : null;
}

// ── Quality metrics ────────────────────────────────────────────────────────
//
// Every metric cell resolves to exactly one of three states, and keeping them
// distinct is the whole point of this grid:
//
//   'value'         — a real number/answer we can report
//   'not-published' — the library declared `null`, i.e. a human verified there
//                     is no committed source. NEVER rendered as 0: a missing
//                     number shown as "0%" in a monthly report misrepresents a
//                     repo that does run the check.
//   'missing'       — a source WAS declared but could not be read or parsed.
//                     Rendered as a visible warning and surfaced to the run
//                     summary, so config rot can't hide behind
//                     "not published".

/**
 * Resolve the coverage cell from the declared source plus the raw blob text
 * fetched for it (`lib.coverageSource`, null when the blob doesn't exist).
 *
 * We report the CI-ENFORCED FLOOR, not measured actuals: the floor is what the
 * ratchet guarantees can't regress, and it's readable from a committed file
 * with no cross-repo Actions credential. `lines` is the headline because every
 * badge in this org is lines-derived; the other three ride along as secondary
 * text so nobody can claim we cherry-picked the flattering metric.
 */
export function resolveCoverage(lib) {
  const decl = lib.metrics?.coverage ?? null;
  if (decl === null) return { state: 'not-published' };

  const text = lib.coverageSource;
  if (text == null) {
    return { state: 'missing', reason: `coverage source ${decl.path} not found` };
  }

  if (decl.kind === 'floor') {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { state: 'missing', reason: `coverage source ${decl.path} is not valid JSON` };
    }
    if (typeof parsed?.lines !== 'number') {
      return { state: 'missing', reason: `coverage source ${decl.path} has no numeric "lines"` };
    }
    const breakdown = COVERAGE_METRICS.filter(
      (m) => m !== 'lines' && typeof parsed[m] === 'number',
    ).map((m) => `${m} ${parsed[m]}%`);
    return { state: 'value', kind: 'floor', lines: parsed.lines, breakdown };
  }

  if (decl.kind === 'badge') {
    // The badge SVG is generated, so this parse is the brittle part of the
    // whole design. A test pins the format; if `coverage-badges` ever changes
    // its template this fails loudly as 'missing' rather than silently
    // degrading to "not published" and quietly dropping a number.
    const match = String(text).match(/aria-label="coverage:\s*([\d.]+)%"/);
    if (!match) {
      return { state: 'missing', reason: `coverage badge ${decl.path} has no parseable aria-label` };
    }
    return { state: 'value', kind: 'actual', lines: Number(match[1]), breakdown: [] };
  }

  return { state: 'missing', reason: `unknown coverage kind "${decl.kind}"` };
}

/**
 * Resolve the lint cell. The baseline counts WARNINGS only — the upstream gate
 * (`check-lint-baseline.mjs`) fails on any ESLint error, so errors are 0 by
 * construction on a green default branch. Per-workspace counts are summed so
 * the row stays comparable with the others; the split is a library-internal
 * detail that belongs in its epic, not a five-repo comparison table.
 *
 * `metrics.lint` can be:
 *   - a declared source ({kind, path})        → a real warning count
 *   - `true`  (lint runs, no committed count)  → 'enforced' — not published,
 *     but distinct from a repo running no lint at all
 *   - `false` / `null` (no lint check exists)  → 'not-published'
 *
 * This keeps "we don't measure this" (enforced) distinct from "there is
 * nothing to measure" (not-published) — see sub-issues filed against
 * sam-styles, ngx-uswds, and ngx-uswds-icons to close the `enforced` gap by
 * committing a real baseline.
 */
export function resolveLint(lib) {
  const decl = lib.metrics?.lint ?? null;
  if (decl === true) return { state: 'enforced' };
  if (decl === null || decl === false) return { state: 'not-published' };

  const text = lib.lintSource;
  if (text == null) {
    return { state: 'missing', reason: `lint source ${decl.path} not found` };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'missing', reason: `lint source ${decl.path} is not valid JSON` };
  }

  const counts = Object.values(parsed).filter((v) => typeof v === 'number');
  if (counts.length === 0) {
    return { state: 'missing', reason: `lint source ${decl.path} has no numeric workspace counts` };
  }
  return {
    state: 'value',
    warnings: counts.reduce((a, b) => a + b, 0),
  };
}

/** Resolve the a11y cell. Boolean and declared — derived from each repo's
 *  playwright a11y config plus its `test:a11y` script during config review. */
export function resolveA11y(lib) {
  return lib.metrics?.a11y === true
    ? { state: 'value', enforced: true }
    : { state: 'value', enforced: false };
}

/** All resolved cells for one library, plus its last-shipped-commit date. */
export function resolveMetrics(lib) {
  return {
    repo: lib.repo,
    coverage: resolveCoverage(lib),
    lint: resolveLint(lib),
    a11y: resolveA11y(lib),
    lastCommit: lib.lastCommitDate ?? null,
  };
}

/**
 * Every 'missing' cell across all libraries, as human-readable warnings.
 * generate.mjs writes these to stderr and $GITHUB_STEP_SUMMARY but still exits
 * 0: a broken metric source must not fail the daily build, because the epic
 * cards (and the stakeholder's link) are still perfectly good.
 */
export function collectMetricWarnings(libraries) {
  const warnings = [];
  for (const lib of orderLibraries(libraries)) {
    for (const cell of [resolveCoverage(lib), resolveLint(lib)]) {
      if (cell.state === 'missing') warnings.push(`${lib.repo}: ${cell.reason}`);
    }
  }
  return warnings;
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

function pct({ closed, total }) {
  return total === 0 ? 0 : Math.round((closed / total) * 100);
}

/** Render one track (Pipeline or Angular) as a labelled rollup bar. */
function renderBar(label, roll) {
  const p = pct(roll);
  return `
      <div class="track">
        <span class="track-label">${esc(label)}</span>
        <div class="bar" role="progressbar" aria-valuenow="${roll.closed}" aria-valuemin="0" aria-valuemax="${roll.total}">
          <div class="bar-fill" style="width:${p}%"></div>
        </div>
        <span class="count">${roll.closed} / ${roll.total}</span>
      </div>`;
}

/**
 * Optional description line. Prefers the live GitHub description, falling back
 * to a curated `fallbackDescription` for repos with none set. Omitted entirely
 * when neither is available.
 */
function renderDescription(lib) {
  const text = lib.description || lib.fallbackDescription;
  return text
    ? `
      <p class="description">${esc(text)}</p>`
    : '';
}

/**
 * Angular version badge. SCSS-only libraries (no Angular track at all) show
 * nothing; a known major renders "Angular N"; an unresolved version renders
 * "Angular unknown" so the gap is visible rather than silently dropped.
 *
 * A library is Angular-tracked if it has either a per-major roll-up parent
 * (`angularParentNumber`) or a flat set of Angular sub-issues
 * (`angularIssueNumbers`, e.g. sam-ui-elements).
 */
function renderAngularVersion(lib) {
  const angularTracked =
    lib.angularParentNumber != null ||
    (lib.angularIssueNumbers?.length ?? 0) > 0;
  if (!angularTracked) return '';
  const label =
    typeof lib.angularVersion === 'number'
      ? `Angular ${lib.angularVersion}`
      : 'Angular unknown';
  const cls =
    typeof lib.angularVersion === 'number' ? 'ng-version' : 'ng-version unknown';
  return `
      <span class="${cls}">${esc(label)}</span>`;
}

/** Render one library card: two tracks when started, else "not started". */
export function renderLibrary(lib) {
  if (!lib.epic) {
    return `
    <section class="library not-started">
      <h2>${esc(lib.repo)}</h2>${renderDescription(lib)}
      <p class="status">not started — no epic yet</p>
    </section>`;
  }

  const { pipeline, angular } = classifyTracks(lib);
  const epicUrl = `https://github.com/${lib.epic.owner}/${lib.repo}/issues/${lib.epic.number}`;
  const angularBar =
    angular === null
      ? `
      <div class="track">
        <span class="track-label">Angular migration</span>
        <span class="na">N/A (SCSS)</span>
      </div>`
      : renderBar('Angular migration', angular);

  return `
    <section class="library">
      <h2><a href="${esc(epicUrl)}">${esc(lib.repo)}</a>${renderAngularVersion(lib)}</h2>${renderDescription(lib)}${renderBar('Pipeline', pipeline)}${angularBar}
    </section>`;
}

/** Format an ISO timestamp as a bare YYYY-MM-DD date, or a dash when absent. */
function isoDate(iso) {
  return typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : '—';
}

/** A cell's headline text plus optional secondary line, as table-cell HTML. */
function renderCell(headline, secondary, cls = '') {
  const second = secondary
    ? `\n          <span class="cell-detail">${esc(secondary)}</span>`
    : '';
  return `<td${cls ? ` class="${cls}"` : ''}>${esc(headline)}${second}</td>`;
}

function renderCoverageCell(cell) {
  if (cell.state === 'not-published') {
    return renderCell('not published', null, 'unpublished');
  }
  if (cell.state === 'missing') {
    return renderCell('⚠ source missing', null, 'broken');
  }
  const label = cell.kind === 'floor' ? `${cell.lines}% floor` : `${cell.lines}% actual`;
  return renderCell(label, cell.breakdown.length ? cell.breakdown.join(' · ') : null);
}

function renderLintCell(cell) {
  if (cell.state === 'enforced') {
    return renderCell('lint enforced', 'no debt baseline published');
  }
  if (cell.state === 'not-published') {
    return renderCell('not published', null, 'unpublished');
  }
  if (cell.state === 'missing') {
    return renderCell('⚠ source missing', null, 'broken');
  }
  return renderCell(
    `${cell.warnings.toLocaleString('en-US')} baseline warnings`,
    '0 errors',
  );
}

function renderA11yCell(cell) {
  return cell.enforced
    ? renderCell('WCAG 2.1 AA enforced', null)
    : renderCell('not enforced', null, 'unpublished');
}

/** One table row per library. */
function renderMetricsRow(lib) {
  const m = resolveMetrics(lib);
  return `      <tr>
        <th scope="row">${esc(m.repo)}</th>
        ${renderCoverageCell(m.coverage)}
        ${renderLintCell(m.lint)}
        ${renderA11yCell(m.a11y)}
        <td>${esc(isoDate(m.lastCommit))}</td>
      </tr>`;
}

/**
 * The cross-repo quality grid. Deliberately a real <table> with a <caption>
 * and scoped headers, not a CSS-grid div soup — it would be embarrassing to
 * ship an inaccessible accessibility report. The "as of" date lives in the
 * caption so it travels with a copy-paste into a monthly report rather than
 * being lost when only the table is copied.
 */
export function renderMetricsTable(libraries, generated) {
  const rows = orderLibraries(libraries).map(renderMetricsRow).join('\n');
  return `  <h2 id="metrics">Quality metrics</h2>
  <table class="metrics">
    <caption>Public <code>GSA/*</code> design libraries — quality snapshot as of ${esc(isoDate(generated))}.</caption>
    <thead>
      <tr>
        <th scope="col">Library</th>
        <th scope="col">Coverage (lines)</th>
        <th scope="col">Lint debt</th>
        <th scope="col">Accessibility gate</th>
        <th scope="col">Last release-branch commit</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <dl class="legend">
    <dt>floor</dt>
    <dd>The coverage percentage CI enforces as a ratchet; measured coverage is at or above it and cannot regress below it.</dd>
    <dt>actual</dt>
    <dd>The measured coverage percentage published by the repository.</dd>
    <dt>not published</dt>
    <dd>The repository does not commit a machine-readable result for this metric. It does not mean the check is absent — see the linked epic for what CI actually runs.</dd>
    <dt>lint enforced</dt>
    <dd>The repository runs a lint check in CI, but does not yet commit a machine-readable debt count. See the linked epic for a tracking issue.</dd>
    <dt>baseline warnings</dt>
    <dd>Recorded ESLint warning debt. The baseline is a ratchet that can only decrease, so a falling number across months is the progress signal. Any lint <em>error</em> fails CI outright, so errors are zero on a green branch.</dd>
    <dt>⚠ source missing</dt>
    <dd>A metric source was expected here but could not be read — a dashboard configuration problem, not a repository one.</dd>
  </dl>`;
}

/** Assemble the full self-contained HTML page. */
export function renderPage(libraries) {
  const generated = new Date().toISOString();
  const cards = orderLibraries(libraries).map(renderLibrary).join('\n');
  const metrics = renderMetricsTable(libraries, generated);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SAM design-library Angular upgrade — status</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { margin-bottom: 0.25rem; }
    .meta { color: #666; font-size: 0.85rem; margin-bottom: 2rem; }
    .library { border: 1px solid #ccc; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
    .library.not-started { opacity: 0.65; }
    .library h2 { margin: 0 0 0.5rem; font-size: 1.1rem; display: flex; align-items: baseline; gap: 0.75rem; }
    .description { margin: 0 0 0.75rem; color: #555; font-size: 0.9rem; }
    .ng-version { font-size: 0.75rem; font-weight: 600; color: #2e7d32; border: 1px solid #2e7d32; border-radius: 999px; padding: 0.1rem 0.5rem; white-space: nowrap; }
    .ng-version.unknown { color: #888; border-color: #bbb; font-weight: 500; }
    .track { display: grid; grid-template-columns: 10rem 1fr 4rem; align-items: center; gap: 0.75rem; margin: 0.4rem 0; }
    .track-label { font-weight: 600; }
    .bar { background: #e0e0e0; border-radius: 4px; height: 0.75rem; overflow: hidden; }
    .bar-fill { background: #2e7d32; height: 100%; }
    .count { text-align: right; font-variant-numeric: tabular-nums; }
    .na { color: #888; font-style: italic; }
    .status { margin: 0; }
    h2#metrics { margin: 2.5rem 0 0.5rem; font-size: 1.1rem; }
    table.metrics { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    table.metrics caption { caption-side: top; text-align: left; color: #555; font-size: 0.85rem; margin-bottom: 0.5rem; }
    table.metrics th, table.metrics td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid #ddd; vertical-align: top; }
    table.metrics thead th { border-bottom: 2px solid #999; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.02em; }
    table.metrics th[scope='row'] { font-family: ui-monospace, monospace; font-weight: 600; }
    .cell-detail { display: block; color: #666; font-size: 0.78rem; margin-top: 0.15rem; }
    td.unpublished { color: #777; font-style: italic; }
    td.broken { color: #b3261e; font-weight: 600; }
    .legend { font-size: 0.8rem; color: #555; margin-top: 1rem; }
    .legend dt { font-weight: 600; margin-top: 0.5rem; }
    .legend dd { margin: 0.1rem 0 0 1rem; }
  </style>
</head>
<body>
  <h1>SAM design-library Angular upgrade</h1>
  <p class="meta">Public <code>GSA/*</code> epics, in dependency order. Generated ${esc(generated)}.</p>
${cards}
${metrics}
</body>
</html>
`;
}
