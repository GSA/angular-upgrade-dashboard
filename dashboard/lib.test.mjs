import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyTracks, orderLibraries, LIBRARIES, renderLibrary, renderPage } from './lib.mjs';

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
test('sam-styles renders Angular as N/A (SCSS)', () => {
  const html = renderLibrary({
    repo: 'sam-styles',
    angularParentNumber: null,
    epic: { owner: 'GSA', number: 732 },
    subIssues: [{ number: 739, state: 'CLOSED' }],
  });
  assert.match(html, /N\/A\s*\(SCSS\)/);
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
