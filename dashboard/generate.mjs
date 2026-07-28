#!/usr/bin/env node
// Status dashboard generator — self-contained, no runtime dependencies.
//
// Fetches the two live public GSA/* epics (and their sub-issues) via
// `gh api graphql` using the workflow's built-in GITHUB_TOKEN (sufficient for
// public reads), then renders a static HTML page. Run:
//   node dashboard/generate.mjs [outfile]
// Default outfile: dashboard/dist/index.html (git-ignored — artifact only).

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIBRARIES, angularMajor, orderLibraries, renderPage } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// GraphQL: an epic issue, its direct sub-issues, and each sub-issue's own
// sub-issues (needed for the Angular per-major parent rollup).
const QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    description
    packageJson: object(expression: "HEAD:package.json") {
      ... on Blob { text }
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

function ghGraphql(variables) {
  const args = ['api', 'graphql', '-f', `query=${QUERY}`];
  for (const [k, v] of Object.entries(variables)) {
    args.push('-F', `${k}=${v}`);
  }
  const out = execFileSync('gh', args, { encoding: 'utf8' });
  return JSON.parse(out);
}

function fetchEpic(lib) {
  const res = ghGraphql({
    owner: lib.epic.owner,
    repo: lib.repo,
    number: lib.epic.number,
  });
  const repository = res?.data?.repository;
  const issue = repository?.issue;
  if (!issue) throw new Error(`No issue for ${lib.repo}#${lib.epic.number}`);
  return {
    ...lib,
    description: repository.description ?? null,
    angularVersion: angularMajor(repository.packageJson?.text),
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

function buildLibraries() {
  return orderLibraries(LIBRARIES).map((lib) =>
    lib.epic ? fetchEpic(lib) : lib,
  );
}

function main() {
  const outfile = process.argv[2] ?? join(HERE, 'dist', 'index.html');
  const libraries = buildLibraries();
  const html = renderPage(libraries);
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, html);
  console.error(`Wrote ${outfile} (${html.length} bytes)`);
}

main();
