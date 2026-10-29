import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { LIBRARIES } from './lib.mjs';

const execFileAsync = promisify(execFile);
const GREEN = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const RED = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const BUCKETS = ['candidate', 'angular-blocked', 'pending', 'red'];
const MISSING_FILE = Symbol('verified missing file');
const LIST_LIMIT = 100;

export function isAngularPackage(name) {
  return /^@(angular|angular-devkit|angular-eslint)\//.test(name)
    || ['angular-eslint', '@schematics/angular', 'ng-packagr', '@ngtools/webpack'].includes(name);
}

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Minimum numeric version admitted by an npm semver range; no registry lookups.
 * Tags, URLs, workspace references and other non-semver specs return null.
 * Zero-major devkit releases encode Angular MM in 0.MMmm.patch versions. */
export function versionToMajor(name, spec) {
  if (typeof spec !== 'string') return null;
  spec = spec.trim().replace(/^npm:(?:@[^/]+\/)?[^@]+@/, '');
  if (!spec) return null;
  const minima = [];
  for (let range of spec.split('||')) {
    range = range.trim().replace(/(\S+)\s+-\s+(\S+)/g, '>=$1 <=$2');
    const tokens = range.match(/(?:[~^]|>=|<=|>|<|=)?\s*[vV]?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?/g) ?? [];
    if (range.replace(/\s+/g, '') !== tokens.join('').replace(/\s+/g, '')) continue;
    let lower = [0, 0, 0];
    const uppers = [];
    for (const token of tokens) {
      const match = token.trim().match(/^([~^]|>=|<=|>|<|=)?\s*[vV]?([^+\-]+)/);
      const op = match[1] ?? '';
      const parts = match[2].split('.');
      const precision = parts.findIndex(p => /[xX*]/.test(p));
      const count = precision < 0 ? parts.length : precision;
      const value = [0, 1, 2].map(i => i < count ? Number(parts[i]) : 0);
      if (count === 0) continue;
      if (op === '<' || op === '<=') {
        if (op === '<=' && count < 3) {
          const upper = [...value]; upper[count - 1]++;
          uppers.push({ value: upper, inclusive: false });
        } else uppers.push({ value, inclusive: op === '<=' });
        continue;
      }
      const min = [...value];
      if (op === '>') min[count - 1]++;
      if (compare(min, lower) > 0) lower = min;
      if (op === '^' || op === '~' || ((op === '' || op === '=') && count < 3)) {
        let index = count - 1;
        if (op === '^') index = value.findIndex(n => n !== 0);
        if (index < 0) index = count - 1;
        if (op === '~') index = count === 1 ? 0 : 1;
        const upper = [...value]; upper[index]++;
        for (let i = index + 1; i < 3; i++) upper[i] = 0;
        uppers.push({ value: upper, inclusive: false });
      } else if ((op === '' || op === '=') && count === 3) {
        uppers.push({ value, inclusive: true });
      }
    }
    if (!uppers.some(u => compare(lower, u.value) > 0 || (!u.inclusive && compare(lower, u.value) === 0))) minima.push(lower);
  }
  if (!minima.length) return null;
  minima.sort(compare);
  const [major, minor] = minima[0];
  return name.startsWith('@angular-devkit/') && major === 0 ? Math.floor(minor / 100) : major;
}

function manifestEntries(json) {
  return ['dependencies', 'devDependencies', 'peerDependencies'].flatMap(section =>
    Object.entries(json?.[section] ?? {}).map(([name, version]) => ({ name, version })));
}

function lockEntries(json) {
  return Object.entries(json?.packages ?? {}).flatMap(([key, entry]) => {
    const marker = 'node_modules/';
    const index = key.lastIndexOf(marker);
    if (index < 0 || !entry.version) return [];
    return [{ key, name: key.slice(index + marker.length), version: entry.version }];
  });
}

function diffEntries(base, head, source, maxAngular) {
  const basePairs = new Set(base.map(e => `${e.name}:${versionToMajor(e.name, e.version)}`));
  const seen = new Set();
  return head.flatMap(({ name, version }) => {
    if (!isAngularPackage(name)) return [];
    const major = versionToMajor(name, version);
    const pair = `${name}:${major}`;
    if (major === null || major <= maxAngular || basePairs.has(pair) || seen.has(name)) return [];
    seen.add(name);
    const previous = base.find(e => e.name === name);
    return [{ name, from: previous?.version ?? null, to: version, source }];
  });
}

export function diffPackageJson(base, head, source, maxAngular = 21) {
  return diffEntries(manifestEntries(base), manifestEntries(head), source, maxAngular);
}

export function diffLockfile(base, head, source, maxAngular = 21) {
  const baseEntries = lockEntries(base);
  const headEntries = lockEntries(head);
  const baseByKey = new Map(baseEntries.map(e => [e.key, e]));
  const headByKey = new Map(headEntries.map(e => [e.key, e]));
  // Only a disappearing key/major can explain an above-cap addition as a move.
  const movedPairs = new Set(baseEntries.filter(e => {
    const retained = headByKey.get(e.key);
    return !retained || versionToMajor(e.name, retained.version) !== versionToMajor(e.name, e.version);
  }).map(e => `${e.name}:${versionToMajor(e.name, e.version)}`));
  const seen = new Set();
  return headEntries.flatMap(({ key, name, version }) => {
    if (!isAngularPackage(name) || seen.has(name)) return [];
    const major = versionToMajor(name, version);
    if (major === null || major <= maxAngular) return [];
    const previous = baseByKey.get(key);
    if (previous) {
      const oldMajor = versionToMajor(name, previous.version);
      if (oldMajor === null || oldMajor >= major) return [];
    } else if (movedPairs.has(`${name}:${major}`)) return [];
    seen.add(name);
    return [{ name, from: previous?.version ?? null, to: version, source }];
  });
}

export function classifyChecks(checks = []) {
  checks ??= [];
  const result = check => (check.conclusion || check.state || '').toUpperCase();
  const failingChecks = checks.filter(c => RED.has(result(c))).map(c => c.name || c.context || '(unnamed check)');
  if (failingChecks.length) return { bucket: 'red', failingChecks };
  const green = checks.length > 0 && checks.every(c =>
    (!c.status || c.status === 'COMPLETED') && GREEN.has(result(c)));
  return { bucket: green ? 'candidate' : 'pending', failingChecks: [] };
}

export function classifyPR(pr, angularBumps = []) {
  const checks = classifyChecks(pr.statusCheckRollup);
  return {
    repo: pr.repo, number: pr.number, title: pr.title, url: pr.url,
    baseRefName: pr.baseRefName, mergeable: pr.mergeable, mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision,
    bucket: checks.bucket === 'candidate' && angularBumps.length ? 'angular-blocked' : checks.bucket,
    failingChecks: checks.failingChecks,
    angularBumps,
  };
}

async function realGh(args) {
  const { stdout } = await execFileAsync('gh', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}
const ghJson = async (args, gh) => JSON.parse(await gh(args));

/** A missing file is legitimate for additions/deletions. Verify the commit's
 * tree before treating a 404 as absence, rather than hiding auth/API errors. */
async function readJsonFile(repo, path, sha, cache, gh) {
  const endpoint = `repos/GSA/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(sha)}`;
  let data;
  try {
    data = await ghJson(['api', endpoint], gh);
  } catch (error) {
    if (!/\b404\b/.test(error.stderr ?? '')) throw error;
    const key = `${repo}:${sha}`;
    if (!cache.has(key)) cache.set(key, ghJson(['api', `repos/GSA/${repo}/git/trees/${sha}?recursive=1`], gh));
    const tree = await cache.get(key);
    if (tree.truncated || !Array.isArray(tree.tree) || tree.tree.some(e => e.path === path)) throw error;
    return MISSING_FILE;
  }
  const text = data.encoding === 'base64' && data.content
    ? Buffer.from(data.content, 'base64').toString('utf8')
    : await gh(['api', endpoint, '-H', 'Accept: application/vnd.github.raw']);
  return JSON.parse(text);
}

export async function sweep({ maxAngular = 21, gh = realGh, libraries = LIBRARIES } = {}) {
  const records = [];
  const cache = new Map();
  for (const { repo } of libraries) {
    const prs = await ghJson(['pr', 'list', '-R', `GSA/${repo}`, '--author', 'app/dependabot',
      '--state', 'open', '--limit', String(LIST_LIMIT), '--json',
      'number,title,url,baseRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup'], gh);
    if (prs.length >= LIST_LIMIT) throw new Error(`GSA/${repo}: pr list reached limit ${LIST_LIMIT}; results may be truncated`);
    for (const pr of prs) {
      if (pr.statusCheckRollup?.length >= 100) throw new Error(`GSA/${repo}#${pr.number}: statusCheckRollup reached limit 100; results may be truncated`);
      const angularBumps = [];
      if (classifyChecks(pr.statusCheckRollup).bucket === 'candidate') {
        const detail = await ghJson(['pr', 'view', String(pr.number), '-R', `GSA/${repo}`, '--json', 'files,baseRefOid'], gh);
        if (detail.files.length >= 100) throw new Error(`GSA/${repo}#${pr.number}: files reached limit 100; results may be truncated`);
        for (const { path } of detail.files) {
          if (!/(^|\/)package(?:-lock)?\.json$/.test(path)) continue;
          const base = await readJsonFile(repo, path, detail.baseRefOid, cache, gh);
          const head = await readJsonFile(repo, path, pr.headRefOid, cache, gh);
          const isLockfile = path.endsWith('package-lock.json');
          if (isLockfile) {
            for (const [side, json] of [['base', base], ['head', head]]) {
              if (json !== MISSING_FILE && (!json?.packages || typeof json.packages !== 'object' || Array.isArray(json.packages))) {
                throw new Error(`GSA/${repo}#${pr.number}: ${path} (${side}) lacks a packages object; v1 lockfiles are unsupported`);
              }
            }
          }
          const diff = isLockfile ? diffLockfile : diffPackageJson;
          angularBumps.push(...diff(base === MISSING_FILE ? {} : base, head === MISSING_FILE ? {} : head, path, maxAngular));
        }
      }
      records.push(classifyPR({ ...pr, repo }, angularBumps));
    }
  }
  return records;
}

export function formatTables(records) {
  const cell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n\t]+/g, ' ');
  return BUCKETS.map(bucket => {
    const extra = bucket === 'red' ? 'failing checks' : bucket === 'angular-blocked' ? 'offending packages' : null;
    const headers = ['repo', '#', 'title', 'mergeable', 'mergeStateStatus', 'reviewDecision', 'url', ...(extra ? [extra] : [])];
    const rows = records.filter(r => r.bucket === bucket).map(r => {
      const values = [r.repo, r.number, r.title, r.mergeable, r.mergeStateStatus, r.reviewDecision, r.url];
      if (bucket === 'red') values.push(r.failingChecks.join(', '));
      if (bucket === 'angular-blocked') values.push(r.angularBumps.map(b => `${b.name}: ${b.from ?? '(new)'} → ${b.to} (${b.source})`).join(', '));
      return `| ${values.map(cell).join(' | ')} |`;
    });
    return [`## ${bucket} (${rows.length})`, `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows].join('\n');
  }).join('\n\n');
}

export function parseArgs(args) {
  let json = false;
  let maxAngular = 21;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') json = true;
    else if (args[i] === '--max-angular' && /^\d+$/.test(args[i + 1] ?? '') && Number.isSafeInteger(Number(args[i + 1]))) maxAngular = Number(args[++i]);
    else return null;
  }
  return { json, maxAngular };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error('Usage: node dashboard/dependabot-sweep.mjs [--json] [--max-angular <N>]');
    process.exitCode = 2;
    return;
  }
  try {
    const records = await sweep({ maxAngular: options.maxAngular });
    console.log(options.json ? JSON.stringify(records, null, 2) : formatTables(records));
  } catch (error) {
    console.error(`Dependabot sweep failed: ${error.stderr?.trim() || error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
