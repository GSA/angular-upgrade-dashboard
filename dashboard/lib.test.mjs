import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyTracks, orderLibraries, LIBRARIES, angularMajor, renderLibrary, renderPage } from './lib.mjs';

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

// When the version can't be resolved (e.g. sam-ui-elements) the badge reads
// "Angular unknown" rather than being dropped silently.
test('an unresolved Angular version renders "Angular unknown"', () => {
  const html = renderLibrary({
    repo: 'sam-ui-elements',
    angularParentNumber: 42,
    epic: { owner: 'GSA', number: 1 },
    description: null,
    angularVersion: null,
    subIssues: [{ number: 42, state: 'OPEN', subIssues: [] }],
  });
  assert.match(html, /Angular unknown/);
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
  const html = renderLibrary({ repo: 'ngx-uswds', epic: null });
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
