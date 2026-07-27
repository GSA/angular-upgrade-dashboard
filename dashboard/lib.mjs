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
  },
  { repo: 'ngx-uswds', order: 2, epic: null, angularParentNumber: null },
  { repo: 'sam-ui-elements', order: 3, epic: null, angularParentNumber: null },
  { repo: 'sam-design-system', order: 4, epic: null, angularParentNumber: null },
];

/** Return libraries sorted into dependency order. */
export function orderLibraries(libraries) {
  return [...libraries].sort((a, b) => a.order - b.order);
}

/**
 * Split an epic's direct sub-issues into two tracks:
 *  - Angular: the per-major parent sub-issue rolled up over ITS children.
 *  - Pipeline: every other direct sub-issue.
 *
 * @param {{ angularParentNumber?: number, subIssues: Array }} epic
 * @returns {{ pipeline: {closed:number,total:number}, angular: {closed:number,total:number}|null }}
 */
export function classifyTracks(epic) {
  const direct = epic.subIssues ?? [];
  const parent = epic.angularParentNumber
    ? direct.find((i) => i.number === epic.angularParentNumber)
    : undefined;

  const pipelineIssues = direct.filter(
    (i) => i.number !== epic.angularParentNumber,
  );

  return {
    pipeline: rollup(pipelineIssues),
    angular: parent ? rollup(parent.subIssues ?? []) : null,
  };
}

function rollup(issues) {
  return {
    closed: issues.filter((i) => i.state === 'CLOSED').length,
    total: issues.length,
  };
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

/** Render one library card: two tracks when started, else "not started". */
export function renderLibrary(lib) {
  if (!lib.epic) {
    return `
    <section class="library not-started">
      <h2>${esc(lib.repo)}</h2>
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
      <h2><a href="${esc(epicUrl)}">${esc(lib.repo)}</a></h2>${renderBar('Pipeline', pipeline)}${angularBar}
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
    .library h2 { margin: 0 0 0.75rem; font-size: 1.1rem; }
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
