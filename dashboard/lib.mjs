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
  },
  {
    repo: 'ngx-uswds-icons',
    order: 1,
    epic: { owner: 'GSA', number: 26 },
    angularParentNumber: 32,
    // Curated fallback: the GSA repo has no description set and we lack admin
    // to set it. Used only when the live GitHub description is null.
    fallbackDescription: 'USWDS icons packaged as Angular components.',
  },
  {
    repo: 'ngx-uswds',
    order: 2,
    epic: { owner: 'GSA', number: 184 },
    angularParentNumber: 194,
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
  },
  {
    repo: 'sam-design-system',
    order: 4,
    epic: null,
    angularParentNumber: null,
    // Curated fallback (see ngx-uswds-icons note above).
    fallbackDescription:
      'SAM Design System — the unified Angular component library.',
  },
];

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
 * Angular version badge. SCSS-only libraries (no Angular parent) show nothing;
 * a known major renders "Angular N"; an unresolved version renders "Angular
 * unknown" so the gap is visible rather than silently dropped.
 */
function renderAngularVersion(lib) {
  if (lib.angularParentNumber === null) return '';
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

/** Assemble the full self-contained HTML page. */
export function renderPage(libraries) {
  const generated = new Date().toISOString();
  const cards = orderLibraries(libraries).map(renderLibrary).join('\n');
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
  </style>
</head>
<body>
  <h1>SAM design-library Angular upgrade</h1>
  <p class="meta">Public <code>GSA/*</code> epics, in dependency order. Generated ${esc(generated)}.</p>
${cards}
</body>
</html>
`;
}
