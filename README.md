# angular-upgrade-dashboard

CI-generated status dashboard for the **SAM design-library Angular upgrade**
(JIRA epic `IAEMOD-57412`). It reads the live public `GSA/*` upgrade epics via
the GitHub GraphQL API and publishes a static HTML page to GitHub Pages.

## Why this repo exists

Planning and decisions for the upgrade live in the internal Helix coordination
repo (`mcaas-iae/iae-angular-upgrade`). That repo is docs-only. The dashboard
runs **here on github.com** because:

- the data source (`GSA/*` epics) is public github.com, and
- the Helix GitHub Enterprise instance has **no GitHub-hosted runners**, so an
  Actions-based build/deploy can't run there.

## How it works

`.github/workflows/dashboard.yml` runs on push to `main`, on a daily schedule,
and on demand (`workflow_dispatch`). It runs the tests, generates the page with
the built-in `GITHUB_TOKEN` (public reads only), and deploys it to Pages.

## Quality metrics grid

Below the epic cards, the page publishes a cross-repo quality snapshot at
`#metrics` — coverage, lint debt, accessibility gate, and last release-branch
commit, one row per library. It is built in the same daily run and the same
GraphQL query as the cards, so it costs no extra API calls and no new
credential.

Metrics are read **only from files each repo commits** (`coverage-floor.json`,
`.github/badges/coverage.svg`, `eslint-baseline.json`). We deliberately do *not*
download CI artifacts: that would need a long-lived cross-org PAT with
`actions:read`, and this repo's whole security posture is "public reads with the
built-in token." The tradeoff is that we report the **CI-enforced floor** rather
than measured actuals — a stronger claim anyway, since the ratchet guarantees
coverage cannot regress below it.

Each metric source is declared explicitly per library in `LIBRARIES.metrics`.
Three cell states are kept strictly distinct:

| cell | meaning |
| --- | --- |
| a number | read from the declared source |
| `not published` | declared `null` — a human verified there is no committed source. **Never rendered as `0`**: a missing number shown as 0% would misrepresent a repo that does run the check. |
| `⚠ source missing` | a source *was* declared but couldn't be read or parsed — a dashboard config problem, not a repo one. |

A `⚠ source missing` cell warns to stderr and `$GITHUB_STEP_SUMMARY` but exits
`0`: a broken metric source must not fail the daily build, because the cards and
the published link are still good.

The grid is a real `<table>` with a `<caption>` and scoped headers rather than a
CSS-grid of `div`s — it would be embarrassing to ship an inaccessible
accessibility report. The "as of" date lives in the caption so it travels with a
copy-paste into a monthly report.

There is no history: the page always shows today. A dated-snapshot archive for
month-over-month deltas is deliberately deferred.

```bash
# Local run (uses your existing `gh auth` for github.com):
node dashboard/generate.mjs /tmp/index.html

# Tests:
node --test 'dashboard/*.test.mjs'
```

No generated HTML is committed; `dashboard/dist/` is git-ignored and produced
only as a Pages artifact.
