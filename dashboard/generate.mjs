#!/usr/bin/env node
// Status dashboard generator — self-contained, no runtime dependencies.
//
// Fetches the two live public GSA/* epics (and their sub-issues) via
// `gh api graphql` using the workflow's built-in GITHUB_TOKEN (sufficient for
// public reads), then renders a static HTML page. Run:
//   node dashboard/generate.mjs [outfile]
// Default outfile: dashboard/dist/index.html (git-ignored — artifact only).

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIBRARIES, angularMajor, collectMetricWarnings, orderLibraries, renderPage } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// GraphQL: an epic issue, its direct sub-issues, and each sub-issue's own
// sub-issues (needed for the Angular per-major parent rollup). The
// package.json is looked up by a caller-supplied expression so libraries whose
// @angular/core pin lives outside the repo root (e.g. sam-ui-elements'
// test-app) can point at the right manifest.
//
// The quality-metric blobs (coverage floor / badge, lint baseline) and the
// default branch's last commit date ride along in this SAME query, so adding
// the metrics grid costs no extra API calls and no new credential: everything
// is a public read with the built-in GITHUB_TOKEN. A blob that doesn't exist
// comes back as null rather than erroring, which is what lets an
// intentionally-absent metric render as "not published".
const QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $packageExpression: String!, $coverageExpression: String!, $lintExpression: String!) {
  repository(owner: $owner, name: $repo) {
    description
    packageJson: object(expression: $packageExpression) {
      ... on Blob { text }
    }
    coverageSource: object(expression: $coverageExpression) {
      ... on Blob { text }
    }
    lintSource: object(expression: $lintExpression) {
      ... on Blob { text }
    }
    defaultBranchRef {
      target {
        ... on Commit { committedDate }
      }
    }
    issue(number: $number) {
      title
      state
      url
      subIssues(first: 50) {
        nodes {
          number
          state
          subIssues(first: 50) {
            nodes { number state }
          }
        }
      }
    }
  }
}`;

// A repo-only variant of the query above: same metric blobs and last-commit
// date, but no `issue` field. Used for libraries with no epic filed yet
// (sam-design-system) so they still get a metrics row and a staleness date.
const REPO_QUERY = `
query($owner: String!, $repo: String!, $packageExpression: String!, $coverageExpression: String!, $lintExpression: String!) {
  repository(owner: $owner, name: $repo) {
    description
    packageJson: object(expression: $packageExpression) {
      ... on Blob { text }
    }
    coverageSource: object(expression: $coverageExpression) {
      ... on Blob { text }
    }
    lintSource: object(expression: $lintExpression) {
      ... on Blob { text }
    }
    defaultBranchRef {
      target {
        ... on Commit { committedDate }
      }
    }
  }
}`;

function ghGraphql(query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(variables)) {
    args.push('-F', `${k}=${v}`);
  }
  const out = execFileSync('gh', args, { encoding: 'utf8' });
  return JSON.parse(out);
}

// A declared metric path, or '' when the library declares the metric as null.
// An empty expression resolves to no blob, which the resolver reads as
// "not published" rather than as a broken source.
function metricExpression(decl) {
  return decl?.path ? `HEAD:${decl.path}` : '';
}

function metricVariables(lib) {
  return {
    packageExpression: `HEAD:${lib.packageJsonPath ?? 'package.json'}`,
    coverageExpression: metricExpression(lib.metrics?.coverage),
    lintExpression: metricExpression(lib.metrics?.lint),
  };
}

/** Fields shared by epic and no-epic libraries. */
function repoFields(repository) {
  return {
    description: repository.description ?? null,
    angularVersion: angularMajor(repository.packageJson?.text),
    coverageSource: repository.coverageSource?.text ?? null,
    lintSource: repository.lintSource?.text ?? null,
    lastCommitDate: repository.defaultBranchRef?.target?.committedDate ?? null,
  };
}

function fetchEpic(lib) {
  const res = ghGraphql(QUERY, {
    owner: lib.epic.owner,
    repo: lib.repo,
    number: lib.epic.number,
    ...metricVariables(lib),
  });
  const repository = res?.data?.repository;
  const issue = repository?.issue;
  if (!issue) throw new Error(`No issue for ${lib.repo}#${lib.epic.number}`);
  return {
    ...lib,
    ...repoFields(repository),
    subIssues: (issue.subIssues?.nodes ?? []).map((n) => ({
      number: n.number,
      state: n.state,
      subIssues: (n.subIssues?.nodes ?? []).map((c) => ({
        number: c.number,
        state: c.state,
      })),
    })),
  };
}

// Libraries with no epic still need repo-level data: sam-design-system's
// 15-months-stale last commit is one of the more useful facts on the page.
function fetchRepo(lib) {
  const res = ghGraphql(REPO_QUERY, {
    owner: 'GSA',
    repo: lib.repo,
    ...metricVariables(lib),
  });
  const repository = res?.data?.repository;
  if (!repository) throw new Error(`No repository GSA/${lib.repo}`);
  return { ...lib, ...repoFields(repository) };
}

function buildLibraries() {
  return orderLibraries(LIBRARIES).map((lib) =>
    lib.epic ? fetchEpic(lib) : fetchRepo(lib),
  );
}

// A broken metric source is reported but does NOT fail the build: the epic
// cards and the published link are still good, and a red daily run that blocks
// the Pages deploy would cost more than the broken cell. Warnings go to stderr
// and to the workflow run summary so the rot is visible without anyone having
// to notice a changed cell on the page.
function reportWarnings(libraries) {
  const warnings = collectMetricWarnings(libraries);
  if (warnings.length === 0) return;
  for (const w of warnings) console.error(`WARN ${w}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const md = [
      '### ⚠ Dashboard metric sources needing attention',
      '',
      ...warnings.map((w) => `- ${w}`),
      '',
    ].join('\n');
    appendFileSync(summary, md);
  }
}

function main() {
  const outfile = process.argv[2] ?? join(HERE, 'dist', 'index.html');
  const libraries = buildLibraries();
  const html = renderPage(libraries);
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, html);
  reportWarnings(libraries);
  console.error(`Wrote ${outfile} (${html.length} bytes)`);
}

main();
