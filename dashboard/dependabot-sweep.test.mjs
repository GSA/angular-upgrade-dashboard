import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  versionToMajor,
  diffPackageJson,
  diffLockfile,
  classifyChecks,
  classifyPR,
  isAngularPackage,
  parseArgs,
  formatTables,
  sweep,
} from './dependabot-sweep.mjs';

const source = 'package.json';
const bump = (name, from, to, file = source) => ({ name, from, to, source: file });
const sorted = (bumps) => [...bumps].sort((a, b) =>
  `${a.name}:${a.to}`.localeCompare(`${b.name}:${b.to}`));
const lock = (packages) => ({ name: 'fixture', lockfileVersion: 3, packages });
const run = (name, conclusion, status = 'COMPLETED') => ({
  __typename: 'CheckRun', name, status, conclusion,
});
const context = (name, state) => ({ __typename: 'StatusContext', context: name, state });

// Use semver's minimum satisfying version, not the first number in the text
// or the highest major allowed by a range.
test('versionToMajor parses exact versions and semver ranges', () => {
  for (const [spec, expected] of [
    ['22.1.3', 22], ['v22.1.3', 22], ['^22.1.3', 22], ['~22.1.3', 22],
    ['>=21.0.0 <23.0.0', 21], ['>21.9.0', 21], ['>21', 22],
    ['^22.0.0 || ^21.0.0', 21], ['22.x', 22], ['22.*', 22],
    ['22', 22], ['21.0.0 - 22.9.0', 21], ['*', 0],
    ['22.0.0-next.1', 22],
  ]) {
    assert.equal(versionToMajor('@angular/core', spec), expected, spec);
  }
});

test('versionToMajor maps architect release numbering to Angular majors', () => {
  for (const [spec, expected] of [
    ['0.2102.3', 21], ['^0.2102.0', 21], ['0.2201.3', 22], ['~0.2200.0', 22],
  ]) {
    assert.equal(versionToMajor('@angular-devkit/architect', spec), expected, spec);
  }
  assert.equal(versionToMajor('@angular-devkit/build-webpack', '0.2202.5'), 22);
  assert.equal(versionToMajor('@angular-devkit/architect-cli', '0.2102.x'), 21);
  assert.equal(versionToMajor('@angular/core', '0.2102.3'), 0);
});

test('versionToMajor rejects unknown or unparseable specifications', () => {
  for (const spec of [null, undefined, 'latest', 'next', 'workspace:*',
    'file:../angular', 'git+https://example.com/angular.git', 'not-semver', '>=23 <22']) {
    assert.equal(versionToMajor('@angular/core', spec), null, String(spec));
  }
});

test('manifest comparisons detect above-cap bumps in all dependency sections', () => {
  const base = {
    dependencies: { '@angular/core': '^21.0.0' },
    devDependencies: { '@angular-devkit/build-angular': '~21.0.0' },
    peerDependencies: { '@angular/common': '>=21.0.0 <22.0.0' },
  };
  const head = {
    dependencies: { '@angular/core': '^22.1.3' },
    devDependencies: { '@angular-devkit/build-angular': '~22.1.3' },
    peerDependencies: { '@angular/common': '^22.0.0' },
  };
  assert.deepEqual(sorted(diffPackageJson(base, head, source)), sorted([
    bump('@angular/core', '^21.0.0', '^22.1.3'),
    bump('@angular-devkit/build-angular', '~21.0.0', '~22.1.3'),
    bump('@angular/common', '>=21.0.0 <22.0.0', '^22.0.0'),
  ]));
});

test('manifest additions use null from and respect a configurable cap', () => {
  const head = { dependencies: { '@angular/core': '^22.0.0' } };
  assert.deepEqual(diffPackageJson({}, head, source), [bump('@angular/core', null, '^22.0.0')]);
  assert.deepEqual(diffPackageJson({}, head, source, 22), []);
  assert.deepEqual(diffPackageJson({}, { dependencies: { '@angular/core': '^21.0.0' } }, source, 20),
    [bump('@angular/core', null, '^21.0.0')]);
});

test('manifest comparisons report only new above-cap majors', () => {
  const base = { dependencies: {
    '@angular/core': '^22.0.0', '@angular/common': '^21.0.0', '@angular/forms': '^23.0.0',
  } };
  const head = { dependencies: {
    '@angular/core': '^22.1.3', '@angular/common': '^21.2.0', '@angular/forms': '^23.1.0',
    lodash: '^99.0.0',
  } };
  assert.deepEqual(diffPackageJson(base, head, source), []);
  assert.deepEqual(diffPackageJson(head, {}, source), []);
});

test('manifest comparisons still detect a new major when the base already exceeds the cap', () => {
  assert.deepEqual(diffPackageJson(
    { dependencies: { '@angular/core': '^22.0.0' } },
    { dependencies: { '@angular/core': '^23.0.0' } }, source,
  ), [bump('@angular/core', '^22.0.0', '^23.0.0')]);
});

test('manifest comparisons use range minimum and ignore unparseable target specs', () => {
  assert.deepEqual(diffPackageJson({}, { dependencies: {
    '@angular/core': '^21.0.0 || ^22.0.0',
    '@angular/common': '>=21.0.0 <23.0.0',
    '@angular/forms': 'workspace:*',
  } }, source), []);
});

test('manifest architect bumps use Angular major rather than semver major zero', () => {
  assert.deepEqual(diffPackageJson(
    { devDependencies: { '@angular-devkit/architect': '0.2102.0' } },
    { devDependencies: { '@angular-devkit/architect': '0.2201.3' } }, source,
  ), [bump('@angular-devkit/architect', '0.2102.0', '0.2201.3')]);
});

// ngx-uswds#286: core@22.1.3 was already present at a nested location.
// Hoisting it is not a newly introduced above-cap (name, major) pair.
const ngxUswds286 = {
  base: lock({
    '': { name: 'ngx-uswds' },
    'node_modules/@angular-devkit/build-angular/node_modules/@angular-devkit/core': { version: '22.1.3' },
  }),
  head: lock({
    '': { name: 'ngx-uswds' },
    'node_modules/@angular-devkit/core': { version: '22.1.3' },
  }),
};

test('ngx-uswds#286 moved @angular-devkit/core@22.1.3 is not a bump', () => {
  assert.deepEqual(diffLockfile(ngxUswds286.base, ngxUswds286.head, 'package-lock.json'), []);
});

test('lockfile 21 to 22 at the same location is a bump', () => {
  assert.deepEqual(diffLockfile(
    lock({ 'node_modules/@angular-devkit/core': { version: '21.2.0' } }),
    lock({ 'node_modules/@angular-devkit/core': { version: '22.1.3' } }),
    'package-lock.json',
  ), [bump('@angular-devkit/core', '21.2.0', '22.1.3', 'package-lock.json')]);
});

test('lockfiles infer nested scoped names and report newly added pairs only once', () => {
  const head = lock({
    '': { name: 'fixture', version: '99.0.0' },
    'node_modules/parent/node_modules/@angular/core': { version: '22.1.3' },
    'node_modules/@scope/parent/node_modules/@angular/core': { version: '22.1.3' },
    'node_modules/@angular-devkit/architect': { version: '0.2201.3' },
    'node_modules/lodash': { version: '99.0.0' },
  });
  assert.deepEqual(sorted(diffLockfile(lock({}), head, 'nested/package-lock.json')), sorted([
    bump('@angular/core', null, '22.1.3', 'nested/package-lock.json'),
    bump('@angular-devkit/architect', null, '0.2201.3', 'nested/package-lock.json'),
  ]));
});

test('lockfile top-level bump is reported despite a pre-existing nested major', () => {
  const base = lock({
    'node_modules/a/node_modules/@angular/core': { version: '22.0.0' },
    'node_modules/@angular/core': { version: '21.0.0' },
  });
  const head = lock({
    'node_modules/@angular/core': { version: '22.1.3' },
    'node_modules/a/node_modules/@angular/core': { version: '22.0.0' },
  });
  assert.deepEqual(diffLockfile(base, head, 'package-lock.json'),
    [bump('@angular/core', '21.0.0', '22.1.3', 'package-lock.json')]);
  assert.deepEqual(diffLockfile(head, lock({}), 'package-lock.json'), []);
});

test('lockfile same-key bumps cannot be suppressed by a disappearing nested entry', () => {
  const base = lock({
    'node_modules/@angular/core': { version: '21.0.0' },
    'node_modules/a/node_modules/@angular/core': { version: '22.0.0' },
  });
  const head = lock({ 'node_modules/@angular/core': { version: '22.1.3' } });
  assert.deepEqual(diffLockfile(base, head, 'package-lock.json'),
    [bump('@angular/core', '21.0.0', '22.1.3', 'package-lock.json')]);
});

test('lockfile additions are not moves when the original key keeps the same major', () => {
  const base = lock({ 'node_modules/a/node_modules/@angular/core': { version: '22.0.0' } });
  const head = lock({ ...base.packages,
    'node_modules/@angular/core': { version: '22.1.3' },
    'node_modules/b/node_modules/@angular/core': { version: '23.0.0' },
  });
  const result = diffLockfile(base, head, 'package-lock.json');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, '@angular/core');
  assert.equal(result[0].to, '22.1.3');
});

test('lockfile comparisons respect cap and ignore invalid or below-cap versions', () => {
  const head = lock({
    'node_modules/@angular/core': { version: '22.1.3' },
    'node_modules/@angular/common': { version: '21.2.0' },
    'node_modules/@angular/forms': { version: 'unknown' },
  });
  assert.deepEqual(diffLockfile(lock({}), head, 'package-lock.json', 22), []);
});

test('successful, neutral, and skipped checks are candidates', () => {
  assert.deepEqual(classifyChecks([
    run('unit', 'SUCCESS'), run('optional', 'NEUTRAL'), run('skip', 'SKIPPED'),
    context('legacy', 'SUCCESS'),
  ]), { bucket: 'candidate', failingChecks: [] });
});

test('missing, queued, in-progress, and pending checks are pending', () => {
  for (const checks of [[], [run('unit', null, 'QUEUED')],
    [run('unit', null, 'IN_PROGRESS')], [context('legacy', 'PENDING')],
    [run('unit', 'SUCCESS'), run('build', null, 'IN_PROGRESS')]]) {
    assert.deepEqual(classifyChecks(checks), { bucket: 'pending', failingChecks: [] });
  }
});

test('every failure conclusion and failing legacy state is red', () => {
  for (const conclusion of ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT',
    'ACTION_REQUIRED', 'STARTUP_FAILURE']) {
    const result = classifyChecks([run('unit', conclusion)]);
    assert.equal(result.bucket, 'red', conclusion);
    assert.equal(result.failingChecks.length, 1, conclusion);
  }
  for (const state of ['FAILURE', 'ERROR']) {
    const result = classifyChecks([context('legacy', state)]);
    assert.equal(result.bucket, 'red', state);
    assert.equal(result.failingChecks.length, 1, state);
  }
});

test('red takes precedence over pending and includes only failing checks', () => {
  const result = classifyChecks([
    run('pass', 'SUCCESS'), run('queued', null, 'QUEUED'),
    run('fail', 'FAILURE'), context('legacy-error', 'ERROR'),
  ]);
  assert.equal(result.bucket, 'red');
  assert.deepEqual(result.failingChecks, ['fail', 'legacy-error']);
});

const pr = {
  repo: 'GSA/ngx-uswds', number: 286, title: 'Bump Angular dependencies',
  url: 'https://github.com/GSA/ngx-uswds/pull/286', baseRefName: 'main',
  mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED',
  statusCheckRollup: [run('unit', 'SUCCESS')],
};

test('classifyPR returns the complete JSON record and defaults angularBumps to empty', () => {
  assert.deepEqual(classifyPR(pr), {
    repo: pr.repo, number: pr.number, title: pr.title, url: pr.url,
    baseRefName: pr.baseRefName, mergeable: pr.mergeable, mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision,
    bucket: 'candidate', failingChecks: [], angularBumps: [],
  });
});

test('classifyPR preserves bump provenance and check classification', () => {
  const angularBumps = [bump('@angular/core', '^21.0.0', '^22.0.0')];
  const statusCheckRollup = [run('unit', 'FAILURE'), context('legacy', 'PENDING')];
  const result = classifyPR({ ...pr, statusCheckRollup }, angularBumps);
  assert.deepEqual(result, {
    repo: pr.repo, number: pr.number, title: pr.title, url: pr.url,
    baseRefName: pr.baseRefName, mergeable: pr.mergeable, mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision,
    ...classifyChecks(statusCheckRollup), angularBumps,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('classifyPR with no check runs is pending, not a candidate', () => {
  assert.equal(classifyPR({ ...pr, statusCheckRollup: [] }).bucket, 'pending');
});

test('green PRs with new above-cap majors are angular-blocked', () => {
  const angularBumps = [bump('@angular/core', '^21.0.0', '^22.0.0')];
  const result = classifyPR(pr, angularBumps);
  assert.equal(result.bucket, 'angular-blocked');
  assert.deepEqual(result.angularBumps, angularBumps);
});

test('watched names include every Angular namespace and standalone tool', () => {
  for (const name of ['@angular/core', '@angular-devkit/core', '@angular-eslint/eslint-plugin',
    'angular-eslint', '@schematics/angular', 'ng-packagr', '@ngtools/webpack']) assert.equal(isAngularPackage(name), true);
  for (const name of ['angular', '@angularish/core', 'angular-eslint-extra', '@schematics/other',
    'ng-packagr-extra', 'rxjs']) assert.equal(isAngularPackage(name), false);
});

test('CLI options retain the exact defaults and configurable ceiling', () => {
  assert.deepEqual(parseArgs([]), { json: false, maxAngular: 21 });
  assert.deepEqual(parseArgs(['--json', '--max-angular', '22']), { json: true, maxAngular: 22 });
  assert.deepEqual(parseArgs(['--max-angular', '20', '--json']), { json: true, maxAngular: 20 });
  for (const args of [['--max-angular'], ['--max-angular', '-1'], ['--max-angular', '21.5'],
    ['--wat'], ['--max-angular', '9007199254740992']]) assert.equal(parseArgs(args), null);
});

test('human output includes all four tables, diagnostic details, and escapes titles', () => {
  const blocked = classifyPR({ ...pr, title: 'Bump | Angular\nnow' },
    [bump('@angular/core', '^21.0.0', '^22.0.0')]);
  const red = classifyPR({ ...pr, statusCheckRollup: [run('unit', 'FAILURE')] });
  const text = formatTables([blocked, red]);
  for (const bucket of ['candidate', 'angular-blocked', 'pending', 'red']) assert.ok(text.includes(`## ${bucket}`));
  assert.ok(text.includes('Bump \\| Angular now'));
  assert.ok(text.includes('@angular/core: ^21.0.0 → ^22.0.0 (package.json)'));
  assert.ok(text.includes('| mergeStateStatus |'));
  assert.ok(text.includes('| CLEAN |'));
  assert.ok(text.includes('failing checks'));
  assert.ok(text.includes('| unit |'));
});

// Exact argument matching makes unexpected I/O fail rather than silently returning fixtures.
function fakeGh(routes) {
  const responses = new Map(routes.map(([args, response]) => [JSON.stringify(args), response]));
  const calls = [];
  const gh = async args => {
    calls.push([...args]);
    const key = JSON.stringify(args);
    assert.ok(responses.has(key), `Unexpected gh call: ${key}`);
    const response = responses.get(key);
    if (response instanceof Error) throw response;
    return response;
  };
  return { gh, calls };
}

const listArgs = repo => ['pr', 'list', '-R', `GSA/${repo}`, '--author', 'app/dependabot',
  '--state', 'open', '--limit', '100', '--json',
  'number,title,url,baseRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup'];
const viewArgs = (repo, number = pr.number) => ['pr', 'view', String(number), '-R', `GSA/${repo}`,
  '--json', 'files,baseRefOid'];
const contentsArgs = (path, sha) => ['api',
  `repos/GSA/fixture/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(sha)}`];
const treeArgs = ['api', 'repos/GSA/fixture/git/trees/base?recursive=1'];
const encodedJson = json => JSON.stringify({ encoding: 'base64',
  content: Buffer.from(JSON.stringify(json)).toString('base64') });
const apiError = stderr => Object.assign(new Error('gh failed'), { stderr });
const manifest = version => ({ dependencies: { '@angular/core': version } });

function fileFixture({ path = 'package.json', base = manifest('^21.0.0'),
  head = manifest('^22.0.0'), extra = [], headSha = 'head' } = {}) {
  return fakeGh([
    [listArgs('fixture'), JSON.stringify([{ ...pr, headRefOid: headSha }])],
    [viewArgs('fixture'), JSON.stringify({ files: [{ path }], baseRefOid: 'base' })],
    [contentsArgs(path, 'base'), base instanceof Error ? base : encodedJson(base)],
    [contentsArgs(path, headSha), encodedJson(head)],
    ...extra,
  ]);
}
const fixtureSweep = (fake, options = {}) => sweep({ gh: fake.gh,
  libraries: [{ repo: 'fixture' }], ...options });

test('sweep rejects a repo PR list at the limit', async () => {
  const fake = fakeGh([[listArgs('fixture'), JSON.stringify(Array(100).fill(pr))]]);
  await assert.rejects(fixtureSweep(fake), /fixture.*pr list.*100/i);
});

for (const count of [100, 101]) {
  test(`sweep rejects ${count} status checks even for pending PRs`, async () => {
    const fake = fakeGh([[listArgs('fixture'), JSON.stringify([
      { ...pr, statusCheckRollup: Array(count).fill(context('legacy', 'PENDING')) },
    ])]]);
    await assert.rejects(fixtureSweep(fake), /fixture.*statusCheckRollup.*100/);
  });

  test(`sweep rejects ${count} changed files`, async () => {
    const fake = fakeGh([
      [listArgs('fixture'), JSON.stringify([pr])],
      [viewArgs('fixture'), JSON.stringify({ files: Array(count).fill({ path: 'README.md' }), baseRefOid: 'base' })],
    ]);
    await assert.rejects(fixtureSweep(fake), /fixture.*files.*100/);
  });
}

for (const side of ['base', 'head']) {
  test(`sweep rejects a v1 lockfile on ${side} with repo/path diagnostics`, async () => {
    const fake = fileFixture({ path: 'projects/lib/package-lock.json',
      base: lock({}), head: lock({}),
      [side]: { lockfileVersion: 1, dependencies: { '@angular/core': { version: '22.0.0' } } },
    });
    await assert.rejects(fixtureSweep(fake), /fixture.*projects\/lib\/package-lock\.json.*packages/);
  });
}

test('sweep rejects a present empty lockfile instead of treating it as a missing file', async () => {
  const fake = fileFixture({ path: 'package-lock.json', base: {}, head: lock({}) });
  await assert.rejects(fixtureSweep(fake), /fixture.*package-lock\.json.*packages/);
});

for (const side of ['base', 'head']) {
  test(`sweep accepts a verified missing lockfile on ${side}`, async () => {
    const path = 'package-lock.json';
    const sha = side === 'base' ? 'base' : 'head';
    const fake = fileFixture({ path, base: lock({}), head: lock({}), extra: [
      [contentsArgs(path, sha), apiError('HTTP 404: Not Found')],
      [['api', `repos/GSA/fixture/git/trees/${sha}?recursive=1`], JSON.stringify({ truncated: false, tree: [] })],
    ] });
    const [record] = await fixtureSweep(fake);
    assert.equal(record.bucket, 'candidate');
    assert.deepEqual(record.angularBumps, []);
  });
}

test('sweep skips Angular I/O for red and pending PRs', async () => {
  const prs = [
    { ...pr, number: 1, statusCheckRollup: [run('unit', 'FAILURE')] },
    { ...pr, number: 2, statusCheckRollup: [run('unit', null, 'IN_PROGRESS')] },
  ];
  const fake = fakeGh([[listArgs('fixture'), JSON.stringify(prs)]]);
  const records = await fixtureSweep(fake);
  assert.deepEqual(records.map(r => [r.bucket, r.angularBumps]), [['red', []], ['pending', []]]);
  assert.deepEqual(records[0].failingChecks, ['unit']);
  assert.deepEqual(fake.calls, [listArgs('fixture')]);
});

test('sweep blocks a green PR introducing Angular 22 and preserves record fields', async () => {
  const fake = fileFixture();
  const records = await fixtureSweep(fake);
  assert.deepEqual(records, [classifyPR({ ...pr, repo: 'fixture' },
    [bump('@angular/core', '^21.0.0', '^22.0.0')])]);
  assert.deepEqual(fake.calls, [listArgs('fixture'), viewArgs('fixture'),
    contentsArgs('package.json', 'base'), contentsArgs('package.json', 'head')]);
});

test('sweep threads the configured Angular ceiling to file comparisons', async () => {
  const fake = fileFixture();
  const [record] = await fixtureSweep(fake, { maxAngular: 22 });
  assert.equal(record.bucket, 'candidate');
  assert.deepEqual(record.angularBumps, []);
});

test('sweep does not fetch contents for a green PR changing only workflow files', async () => {
  const fake = fakeGh([
    [listArgs('fixture'), JSON.stringify([pr])],
    [viewArgs('fixture'), JSON.stringify({ files: [{ path: '.github/workflows/x.yml' }], baseRefOid: 'base' })],
  ]);
  const [record] = await fixtureSweep(fake);
  assert.equal(record.bucket, 'candidate');
  assert.deepEqual(record.angularBumps, []);
  assert.deepEqual(fake.calls, [listArgs('fixture'), viewArgs('fixture')]);
});

test('sweep treats moved lockfile entries as existing versions, not bumps', async () => {
  const fake = fileFixture({ path: 'package-lock.json',
    base: lock({ 'node_modules/@angular-devkit/core': { version: '22.1.3' } }),
    head: lock({ 'node_modules/x/node_modules/@angular-devkit/core': { version: '22.1.3' } }),
  });
  const [record] = await fixtureSweep(fake);
  assert.equal(record.bucket, 'candidate');
  assert.deepEqual(record.angularBumps, []);
  assert.deepEqual(fake.calls.slice(2), [contentsArgs('package-lock.json', 'base'),
    contentsArgs('package-lock.json', 'head')]);
});

test('sweep verifies an added file is absent from the base tree and reports from=null', async () => {
  const fake = fileFixture({ base: apiError('HTTP 404: Not Found'),
    extra: [[treeArgs, JSON.stringify({ truncated: false, tree: [{ path: 'README.md' }] })]],
  });
  const [record] = await fixtureSweep(fake);
  assert.equal(record.bucket, 'angular-blocked');
  assert.deepEqual(record.angularBumps, [bump('@angular/core', null, '^22.0.0')]);
  assert.deepEqual(fake.calls, [listArgs('fixture'), viewArgs('fixture'),
    contentsArgs('package.json', 'base'), treeArgs, contentsArgs('package.json', 'head')]);
});

for (const [name, tree] of [
  ['contains the missing path', { truncated: false, tree: [{ path: 'package.json' }] }],
  ['is truncated', { truncated: true, tree: [] }],
  ['has no tree array', { truncated: false }],
]) {
  test(`sweep rejects a contents 404 when the tree ${name}`, async () => {
    const error = apiError('HTTP 404: Not Found');
    const fake = fileFixture({ base: error, extra: [[treeArgs, JSON.stringify(tree)]] });
    await assert.rejects(fixtureSweep(fake), actual => actual === error);
    assert.deepEqual(fake.calls, [listArgs('fixture'), viewArgs('fixture'),
      contentsArgs('package.json', 'base'), treeArgs]);
  });
}

test('sweep rejects non-404 API errors without checking the tree', async () => {
  const error = apiError('HTTP 401: Unauthorized');
  const fake = fileFixture({ base: error });
  await assert.rejects(fixtureSweep(fake), actual => actual === error);
  assert.deepEqual(fake.calls, [listArgs('fixture'), viewArgs('fixture'), contentsArgs('package.json', 'base')]);
});

test('sweep fetches and parses raw JSON when large-file contents have encoding=none', async () => {
  const rawArgs = [...contentsArgs('package.json', 'head'), '-H', 'Accept: application/vnd.github.raw'];
  const fake = fileFixture({ extra: [
    [contentsArgs('package.json', 'head'), JSON.stringify({ encoding: 'none', content: '' })],
    [rawArgs, JSON.stringify(manifest('^22.0.0'))],
  ] });
  const [record] = await fixtureSweep(fake);
  assert.equal(record.bucket, 'angular-blocked');
  assert.deepEqual(record.angularBumps, [bump('@angular/core', '^21.0.0', '^22.0.0')]);
  assert.deepEqual(fake.calls, [listArgs('fixture'), viewArgs('fixture'),
    contentsArgs('package.json', 'base'), contentsArgs('package.json', 'head'), rawArgs]);
});

for (const path of ['projects/lib/package.json', 'projects/lib #?/package.json']) {
  test(`sweep diffs nested manifest ${path} with per-segment URL encoding`, async () => {
    const fake = fileFixture({ path, headSha: 'head/#?' });
    const [record] = await fixtureSweep(fake);
    assert.equal(record.bucket, 'angular-blocked');
    assert.deepEqual(record.angularBumps, [bump('@angular/core', '^21.0.0', '^22.0.0', path)]);
    // Explicit expectations avoid sharing the encoding implementation with the fake.
    const encodedPath = path === 'projects/lib/package.json'
      ? 'projects/lib/package.json' : 'projects/lib%20%23%3F/package.json';
    assert.deepEqual(fake.calls.slice(2), [
      ['api', `repos/GSA/fixture/contents/${encodedPath}?ref=base`],
      ['api', `repos/GSA/fixture/contents/${encodedPath}?ref=head%2F%23%3F`],
    ]);
  });
}

test('sweep visits every supplied library, including empty repos, and tags records', async () => {
  const repos = ['first', 'empty', 'last'];
  const pending = { ...pr, statusCheckRollup: [] };
  const fake = fakeGh(repos.map(repo => [listArgs(repo), JSON.stringify(repo === 'empty' ? [] : [pending])]));
  const records = await sweep({ gh: fake.gh, libraries: repos.map(repo => ({ repo })) });
  assert.deepEqual(records, ['first', 'last'].map(repo => classifyPR({ ...pending, repo })));
  assert.deepEqual(fake.calls, repos.map(listArgs));
});

test('CLI rejects invalid arguments with usage on stderr and exit status 2', () => {
  for (const args of [['--wat'], ['--max-angular'], ['--max-angular', '-1'],
    ['--max-angular', '21.5'], ['--max-angular', '9007199254740992'], ['--json', '--typo']]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./dependabot-sweep.mjs', import.meta.url)),
      ...args], { encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, '');
    assert.equal(result.stderr,
      'Usage: node dashboard/dependabot-sweep.mjs [--json] [--max-angular <N>]\n');
  }
});
