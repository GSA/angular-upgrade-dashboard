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

```bash
# Local run (uses your existing `gh auth` for github.com):
node dashboard/generate.mjs /tmp/index.html

# Tests:
node --test 'dashboard/*.test.mjs'
```

No generated HTML is committed; `dashboard/dist/` is git-ignored and produced
only as a Pages artifact.
