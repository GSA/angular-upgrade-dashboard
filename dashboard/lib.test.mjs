import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyTracks,
  orderLibraries,
  LIBRARIES,
  angularMajor,
  renderLibrary,
  renderPage,
  resolveCoverage,
  resolveLint,
  resolveA11y,
  collectMetricWarnings,
  renderMetricsTable,
} from './lib.mjs';

// The Angular track is the per-major parent sub-issue rolled up over ITS
// children — not a flat count of all sub-issues. For ngx-uswds-icons the
// parent is #32 with four OPEN children (#33-36), so Angular = 0/4.
test('Angular track reflects the per-major parent children, not a flat count', () => {
  const epic = {
    angularParentNumber: 32,
    subIssues: [
      { number: 27, state: 'CLOSED', subIssues: [] },
      { number: 31, state: 'OPEN', subIssues: [] },
      {
        number: 32,
        state: 'OPEN',
        subIssues: [
          { number: 33, state: 'OPEN' },
          { number: 34, state: 'OPEN' },
          { number: 35, state: 'OPEN' },
          { number: 36, state: 'OPEN' },
        ],
      },
    ],
  };

  const { angular } = classifyTracks(epic);
  assert.deepEqual(angular, { closed: 0, total: 4 });
});

// The Pipeline track is every OTHER direct sub-issue of the epic (i.e. not the
// Angular parent). For ngx-uswds-icons that is 8 direct sub-issues with 6
// closed; sam-styles has no Angular parent, so all 9 direct sub-issues are
// pipeline (8 closed).
test('Pipeline track counts every direct sub-issue except the Angular parent', () => {
  const iconsEpic = {
    angularParentNumber: 32,
    subIssues: [
      { number: 27, state: 'CLOSED' },
      { number: 28, state: 'CLOSED' },
      { number: 29, state: 'CLOSED' },
      { number: 30, state: 'CLOSED' },
      { number: 31, state: 'OPEN' },
      { number: 40, state: 'CLOSED' },
      { number: 46, state: 'CLOSED' },
      { number: 48, state: 'OPEN' },
      { number: 32, state: 'OPEN', subIssues: [] },
    ],
  };
  assert.deepEqual(classifyTracks(iconsEpic).pipeline, { closed: 6, total: 8 });

  const stylesEpic = {
    subIssues: [
      { number: 739, state: 'CLOSED' },
      { number: 733, state: 'CLOSED' },
      { number: 735, state: 'CLOSED' },
      { number: 736, state: 'CLOSED' },
      { number: 734, state: 'CLOSED' },
      { number: 748, state: 'CLOSED' },
      { number: 737, state: 'OPEN' },
      { number: 740, state: 'CLOSED' },
      { number: 750, state: 'CLOSED' },
    ],
  };
  const styles = classifyTracks(stylesEpic);
  assert.deepEqual(styles.pipeline, { closed: 8, total: 9 });
  assert.equal(styles.angular, null);
});

// Libraries render in dependency order:
// sam-styles -> ngx-uswds-icons -> ngx-uswds / sam-ui-elements -> sam-design-system
test('libraries render in dependency order', () => {
  const order = orderLibraries(LIBRARIES).map((l) => l.repo);
  assert.deepEqual(order, [
    'sam-styles',
    'ngx-uswds-icons',
    'ngx-uswds',
    'sam-ui-elements',
    'sam-design-system',
  ]);
});

// sam-ui-elements has no single Angular roll-up parent; the migration is a flat
// set of direct sub-issues (#573/#574/#575). The Angular track counts those and
// the Pipeline track counts every OTHER direct sub-issue. Epic #562 has 14
// direct sub-issues, so Pipeline = 11 and Angular = 3.
test('classifyTracks counts a flat angularIssueNumbers set as the Angular track', () => {
  const epic = {
    angularParentNumber: null,
    angularIssueNumbers: [573, 574, 575],
    subIssues: [
      { number: 563, state: 'OPEN' },
      { number: 564, state: 'OPEN' },
      { number: 565, state: 'OPEN' },
      { number: 566, state: 'OPEN' },
      { number: 567, state: 'OPEN' },
      { number: 568, state: 'OPEN' },
      { number: 569, state: 'OPEN' },
      { number: 570, state: 'OPEN' },
      { number: 571, state: 'OPEN' },
      { number: 572, state: 'OPEN' },
      { number: 573, state: 'CLOSED' },
      { number: 574, state: 'OPEN' },
      { number: 575, state: 'OPEN' },
      { number: 576, state: 'OPEN' },
    ],
  };
  const { pipeline, angular } = classifyTracks(epic);
  assert.deepEqual(pipeline, { closed: 0, total: 11 });
  assert.deepEqual(angular, { closed: 1, total: 3 });
});

// A started repo shows two track rollups. ngx-uswds-icons: Pipeline 6/8 and
// Angular 0/4, each as a rollup bar/badge.
test('a started repo renders Pipeline and Angular rollup badges', () => {
  const html = renderLibrary({
    repo: 'ngx-uswds-icons',
    angularParentNumber: 32,
    epic: { owner: 'GSA', number: 26 },
    subIssues: [
      { number: 27, state: 'CLOSED' },
      { number: 28, state: 'CLOSED' },
      { number: 29, state: 'CLOSED' },
      { number: 30, state: 'CLOSED' },
      { number: 31, state: 'OPEN' },
      { number: 40, state: 'CLOSED' },
      { number: 46, state: 'CLOSED' },
      { number: 48, state: 'OPEN' },
      { number: 32, state: 'OPEN', subIssues: [
        { number: 33, state: 'OPEN' },
        { number: 34, state: 'OPEN' },
        { number: 35, state: 'OPEN' },
        { number: 36, state: 'OPEN' },
      ] },
    ],
  });
  assert.match(html, /Pipeline/);
  assert.match(html, /Angular/);
  assert.match(html, /6\s*\/\s*8/);
  assert.match(html, /0\s*\/\s*4/);
  assert.match(html, /role="progressbar"|class="bar"/);
});

// sam-styles is SCSS-only: its Angular track shows N/A (SCSS), not a rollup.
test('sam-styles renders Angular as N/A (SCSS)', () => {  const html = renderLibrary({
    repo: 'sam-styles',
    angularParentNumber: null,
    epic: { owner: 'GSA', number: 732 },
    subIssues: [{ number: 739, state: 'CLOSED' }],
  });
  assert.match(html, /N\/A\s*\(SCSS\)/);
});

// angularMajor reads @angular/core from dependencies first, then dev, then
// peer, and returns just the leading major integer of the range.
test('angularMajor extracts the major version across dependency sections', () => {
  assert.equal(
    angularMajor(JSON.stringify({ dependencies: { '@angular/core': '^17.3.1' } })),
    17,
  );
  assert.equal(
    angularMajor(JSON.stringify({ devDependencies: { '@angular/core': '~19.2.20' } })),
    19,
  );
  // peer ranges like the publishable sub-packages use are still resolved.
  assert.equal(
    angularMajor(JSON.stringify({ peerDependencies: { '@angular/core': '>=17.0.0 <18.0.0' } })),
    17,
  );
  // dependencies wins over peer when both are present.
  assert.equal(
    angularMajor(
      JSON.stringify({
        dependencies: { '@angular/core': '^19.0.0' },
        peerDependencies: { '@angular/core': '>=17.0.0 <18.0.0' },
      }),
    ),
    19,
  );
});

// angularMajor returns null for absent, empty, or unparseable input rather
// than throwing — the card then renders "Angular unknown".
test('angularMajor returns null when Angular is absent or input is bad', () => {
  assert.equal(angularMajor(null), null);
  assert.equal(angularMajor(''), null);
  assert.equal(angularMajor('{ not json'), null);
  assert.equal(angularMajor(JSON.stringify({ dependencies: { rxjs: '^7.0.0' } })), null);
});

// A started card shows the repo description and an "Angular N" badge when the
// version resolved.
test('a started card renders description and Angular version badge', () => {
  const html = renderLibrary({
    repo: 'ngx-uswds-icons',
    angularParentNumber: 32,
    epic: { owner: 'GSA', number: 26 },
    description: 'USWDS icons for Angular',
    angularVersion: 17,
    subIssues: [{ number: 32, state: 'OPEN', subIssues: [] }],
  });
  assert.match(html, /USWDS icons for Angular/);
  assert.match(html, /Angular 17/);
});

// When the version can't be resolved the badge reads "Angular unknown" rather
// than being dropped silently.
test('an unresolved Angular version renders "Angular unknown"', () => {
  const html = renderLibrary({
    repo: 'ngx-uswds',
    angularParentNumber: 42,
    epic: { owner: 'GSA', number: 1 },
    description: null,
    angularVersion: null,
    subIssues: [{ number: 42, state: 'OPEN', subIssues: [] }],
  });
  assert.match(html, /Angular unknown/);
});

// sam-ui-elements is Angular-tracked via a flat set of sub-issues
// (angularIssueNumbers), not a roll-up parent. Its version badge must still
// render — the pin lives in test-app/package.json, resolved by generate.mjs.
test('a flat-set Angular library (angularIssueNumbers) renders its version badge', () => {
  const html = renderLibrary({
    repo: 'sam-ui-elements',
    angularParentNumber: null,
    angularIssueNumbers: [573, 574, 575],
    epic: { owner: 'GSA', number: 562 },
    description: null,
    angularVersion: 19,
    subIssues: [
      { number: 573, state: 'CLOSED' },
      { number: 574, state: 'OPEN' },
      { number: 575, state: 'OPEN' },
    ],
  });
  assert.match(html, /Angular 19/);
});

// SCSS-only libraries (no Angular parent) show no version badge at all.
test('a SCSS-only library shows no Angular version badge', () => {
  const html = renderLibrary({
    repo: 'sam-styles',
    angularParentNumber: null,
    epic: { owner: 'GSA', number: 732 },
    description: 'SAM Styles',
    angularVersion: null,
    subIssues: [{ number: 739, state: 'CLOSED' }],
  });
  assert.doesNotMatch(html, /Angular \d|Angular unknown/);
});

// The live GitHub description wins over the curated fallback when present.
test('renderDescription prefers the live description over the fallback', () => {
  const html = renderLibrary({
    repo: 'ngx-uswds-icons',
    angularParentNumber: 32,
    epic: { owner: 'GSA', number: 26 },
    description: 'Live description from GitHub',
    fallbackDescription: 'Curated fallback',
    angularVersion: 17,
    subIssues: [{ number: 32, state: 'OPEN', subIssues: [] }],
  });
  assert.match(html, /Live description from GitHub/);
  assert.doesNotMatch(html, /Curated fallback/);
});

// When the repo has no live description, the curated fallback is shown.
test('renderDescription falls back to the curated description when live is null', () => {
  const html = renderLibrary({
    repo: 'ngx-uswds-icons',
    angularParentNumber: 32,
    epic: { owner: 'GSA', number: 26 },
    description: null,
    fallbackDescription: 'USWDS icons packaged as Angular components.',
    angularVersion: 17,
    subIssues: [{ number: 32, state: 'OPEN', subIssues: [] }],
  });
  assert.match(html, /USWDS icons packaged as Angular components\./);
});

// Libraries with no epic filed render as "not started".
test('an unstarted repo renders "not started"', () => {
  const html = renderLibrary({ repo: 'sam-design-system', epic: null });
  assert.match(html, /not started/i);
  assert.doesNotMatch(html, /role="progressbar"/);
});

// The full page assembles all five libraries in order with started + unstarted.
test('renderPage emits all five libraries in dependency order', () => {
  const libs = orderLibraries(LIBRARIES).map((lib) => ({
    ...lib,
    subIssues: lib.epic ? [] : undefined,
  }));
  const page = renderPage(libs);
  // Match the exact heading label (>text<) so the two similarly named
  // libraries (`ngx-uswds-icons` vs `ngx-uswds`) can't alias each other:
  // `>ngx-uswds<` never matches inside `>ngx-uswds-icons<`.
  const positions = [
    'sam-styles',
    'ngx-uswds-icons',
    'ngx-uswds',
    'sam-ui-elements',
    'sam-design-system',
  ].map((r) => page.indexOf(`>${r}<`));
  assert.ok(positions.every((p) => p !== -1), 'all libraries present');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(page, /<!doctype html>/i);
});

// ── Quality metrics grid ────────────────────────────────────────────────────

// The three cell states must stay distinguishable. This is the core invariant
// of the grid: "verified absent" and "we failed to read it" are different
// facts, and neither may ever render as 0.
test('a declared coverage floor resolves to a value with a lines headline', () => {
  const cell = resolveCoverage({
    metrics: { coverage: { kind: 'floor', path: 'coverage-floor.json' } },
    coverageSource: JSON.stringify({
      statements: 88.73,
      branches: 78.65,
      functions: 85.9,
      lines: 88.72,
    }),
  });
  assert.equal(cell.state, 'value');
  assert.equal(cell.kind, 'floor');
  assert.equal(cell.lines, 88.72);
  // lines is the headline, so it must not be repeated in the secondary text.
  assert.deepEqual(cell.breakdown, [
    'statements 88.73%',
    'branches 78.65%',
    'functions 85.9%',
  ]);
});

test('a null coverage declaration resolves to not-published, never zero', () => {
  const cell = resolveCoverage({ metrics: { coverage: null } });
  assert.equal(cell.state, 'not-published');
  assert.equal(cell.lines, undefined);
});

// A declared-but-unreadable source must be loud. If this degraded to
// 'not-published' a config typo would read as "this repo has no coverage" and
// nobody would notice for a month.
test('a declared coverage source that is absent resolves to missing, not not-published', () => {
  const cell = resolveCoverage({
    metrics: { coverage: { kind: 'floor', path: 'coverage-floor.json' } },
    coverageSource: null,
  });
  assert.equal(cell.state, 'missing');
  assert.match(cell.reason, /coverage-floor\.json not found/);
});

test('a malformed coverage floor resolves to missing', () => {
  const bad = resolveCoverage({
    metrics: { coverage: { kind: 'floor', path: 'coverage-floor.json' } },
    coverageSource: 'not json{',
  });
  assert.equal(bad.state, 'missing');

  const noLines = resolveCoverage({
    metrics: { coverage: { kind: 'floor', path: 'coverage-floor.json' } },
    coverageSource: JSON.stringify({ statements: 90 }),
  });
  assert.equal(noLines.state, 'missing');
  assert.match(noLines.reason, /no numeric "lines"/);
});

// The badge parse is the most brittle read in the design (generated SVG), so
// pin the exact format we depend on from `coverage-badges`.
test('a coverage badge SVG yields the measured actual percentage', () => {
  const cell = resolveCoverage({
    metrics: { coverage: { kind: 'badge', path: '.github/badges/coverage.svg' } },
    coverageSource:
      '<svg width="103.3" role="img" aria-label="coverage: 100%">\n<title>coverage: 100%</title></svg>',
  });
  assert.equal(cell.state, 'value');
  assert.equal(cell.kind, 'actual');
  assert.equal(cell.lines, 100);
});

test('a coverage badge whose label format changed resolves to missing', () => {
  const cell = resolveCoverage({
    metrics: { coverage: { kind: 'badge', path: '.github/badges/coverage.svg' } },
    coverageSource: '<svg aria-label="cov 100 pct"></svg>',
  });
  assert.equal(cell.state, 'missing');
});

// Per-workspace warning counts are summed so the row stays comparable with the
// other libraries; sam-ui-elements is {root: 1619, test-app: 4} = 1623.
test('lint baseline sums per-workspace warning counts', () => {
  const cell = resolveLint({
    metrics: { lint: { kind: 'eslint-baseline', path: 'eslint-baseline.json' } },
    lintSource: JSON.stringify({ root: 1619, 'test-app': 4 }),
  });
  assert.equal(cell.state, 'value');
  assert.equal(cell.warnings, 1623);
});

test('a null lint declaration resolves to not-published', () => {
  assert.equal(resolveLint({ metrics: { lint: null } }).state, 'not-published');
});

test('a11y resolves from the declared boolean', () => {
  assert.equal(resolveA11y({ metrics: { a11y: true } }).enforced, true);
  assert.equal(resolveA11y({ metrics: { a11y: false } }).enforced, false);
  assert.equal(resolveA11y({ metrics: {} }).enforced, false);
});

// Warnings must be collected for the run summary, but only for genuinely
// broken sources — an intentional null is not a warning.
test('collectMetricWarnings reports broken sources but not intentional nulls', () => {
  const warnings = collectMetricWarnings([
    { repo: 'clean', order: 0, metrics: { coverage: null, lint: null, a11y: true } },
    {
      repo: 'broken',
      order: 1,
      metrics: {
        coverage: { kind: 'floor', path: 'coverage-floor.json' },
        lint: { kind: 'eslint-baseline', path: 'eslint-baseline.json' },
        a11y: false,
      },
      coverageSource: null,
      lintSource: null,
    },
  ]);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => w.startsWith('broken:')));
});

// The grid is an accessibility report, so its own markup has to be correct:
// a real table with a caption and scoped headers, not a div grid.
test('the metrics table uses accessible table semantics with a dated caption', () => {
  const html = renderMetricsTable(
    [{ repo: 'demo', order: 0, metrics: { coverage: null, lint: null, a11y: true } }],
    '2026-09-08T12:00:00.000Z',
  );
  assert.match(html, /<h2 id="metrics">Quality metrics<\/h2>/);
  assert.match(html, /<caption>.*as of 2026-09-08\.<\/caption>/);
  assert.match(html, /<th scope="col">Coverage \(lines\)<\/th>/);
  assert.match(html, /<th scope="col">Last release-branch commit<\/th>/);
  assert.match(html, /<th scope="row">demo<\/th>/);
  // No CSS-grid div soup standing in for a table.
  assert.doesNotMatch(html, /role="table"/);
});

test('the metrics table renders each cell state distinctly', () => {
  const html = renderMetricsTable(
    [
      {
        repo: 'floored',
        order: 0,
        metrics: { coverage: { kind: 'floor', path: 'coverage-floor.json' }, lint: null, a11y: true },
        coverageSource: JSON.stringify({ statements: 94, branches: 91, functions: 90, lines: 94 }),
        lastCommitDate: '2026-09-04T18:57:04Z',
      },
      {
        repo: 'absent',
        order: 1,
        metrics: { coverage: null, lint: null, a11y: false },
        lastCommitDate: '2025-01-31T14:46:13Z',
      },
      {
        repo: 'rotten',
        order: 2,
        metrics: { coverage: { kind: 'floor', path: 'coverage-floor.json' }, lint: null, a11y: false },
        coverageSource: null,
      },
    ],
    '2026-09-08T12:00:00.000Z',
  );
  assert.match(html, /94% floor/);
  assert.match(html, /statements 94% · branches 91% · functions 90%/);
  assert.match(html, /WCAG 2\.1 AA enforced/);
  assert.match(html, /not enforced/);
  assert.match(html, /not published/);
  assert.match(html, /⚠ source missing/);
  // Last release-branch commit renders as a bare date, and staleness shows.
  assert.match(html, /<td>2026-09-04<\/td>/);
  assert.match(html, /<td>2025-01-31<\/td>/);
  // The cardinal rule: a missing metric is never reported as 0%.
  assert.doesNotMatch(html, /\b0%/);
});

test('renderPage includes the metrics table and its legend', () => {
  const html = renderPage([
    { repo: 'solo', order: 0, epic: null, metrics: { coverage: null, lint: null, a11y: false } },
  ]);
  assert.match(html, /id="metrics"/);
  assert.match(html, /<dt>not published<\/dt>/);
  assert.match(html, /ratchet that can only decrease/);
});

// Every real library must declare its metric sources explicitly — an
// undeclared `metrics` key would silently render as three not-published cells.
test('every library declares an explicit metrics block', () => {
  for (const lib of LIBRARIES) {
    assert.ok(lib.metrics, `${lib.repo} is missing a metrics declaration`);
    assert.ok('coverage' in lib.metrics, `${lib.repo} must declare coverage (or null)`);
    assert.ok('lint' in lib.metrics, `${lib.repo} must declare lint (or null)`);
    assert.equal(typeof lib.metrics.a11y, 'boolean', `${lib.repo} must declare a11y`);
  }
});
