// GitHub through a classic personal access token (the notifications API doesn't accept fine-grained tokens).
const API = 'https://api.github.com';

class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function gh(token, pathOrUrl, { method = 'GET', body, raw = false } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'start-page',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new GitHubError('Couldn’t reach GitHub. Check your internet connection.');
  }
  if (res.status === 401) throw new GitHubError('GitHub didn’t accept this token. It may be mistyped, expired or deleted.', 401);
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new GitHubError('GitHub’s rate limit was reached. It resets within the hour; a longer refresh interval helps.', 403);
  }
  if (raw) return res;
  if (res.status === 204 || res.status === 205 || res.status === 202) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new GitHubError((json && json.message) || `GitHub answered with an error (${res.status}).`, res.status);
  return json;
}

async function graphql(token, query, variables) {
  const json = await gh(token, '/graphql', { method: 'POST', body: { query, variables } });
  if (json.errors && !json.data) throw new GitHubError(json.errors[0].message);
  return json.data;
}

// Check a token and report who it belongs to, what it can do, and when it expires.
async function verify(token) {
  token = String(token || '').trim();
  if (!token) throw new GitHubError('Paste your token first.');
  if (/^github_pat_/.test(token)) {
    throw new GitHubError('This is a fine-grained token, which can’t read notifications. Create a classic token instead (Tokens (classic) → Generate new token (classic)).');
  }
  const res = await gh(token, '/user', { raw: true });
  const user = await res.json().catch(() => ({}));
  if (!res.ok) throw new GitHubError(user.message || `GitHub answered with an error (${res.status}).`, res.status);
  const scopes = (res.headers.get('x-oauth-scopes') || '').split(',').map(s => s.trim()).filter(Boolean);
  const has = s => scopes.includes(s);
  const missing = [];
  if (!has('notifications') && !has('repo')) missing.push('notifications');
  if (!has('read:user') && !has('user')) missing.push('read:user');
  return {
    username: user.login, name: user.name || '', avatar: user.avatar_url || '',
    scopes, missing, privateRepos: has('repo'),
    expires: res.headers.get('github-authentication-token-expiration') || '',
  };
}

async function watched(token) {
  const repos = await gh(token, '/user/subscriptions?per_page=100');
  return repos
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .map(r => ({ fullName: r.full_name, description: r.description || '', private: r.private, pushedAt: r.pushed_at }));
}

// ---------- notifications ----------
const REASONS = {
  review_requested: ['Review requested', 'reviews'],
  approval_requested: ['Approval requested', 'reviews'],
  mention: ['Mentioned', 'mentions'],
  team_mention: ['Team mentioned', 'mentions'],
  assign: ['Assigned', 'assigned'],
  ci_activity: ['CI', 'ci'],
  comment: ['Comment', 'other'],
  author: ['Your thread', 'other'],
  state_change: ['State changed', 'other'],
  subscribed: ['Watching', 'other'],
  manual: ['Subscribed', 'other'],
  security_alert: ['Security alert', 'other'],
  invitation: ['Invitation', 'other'],
};
const TYPES = { PullRequest: 'pr', Issue: 'issue', Release: 'release', CheckSuite: 'ci', WorkflowRun: 'ci', Discussion: 'discussion' };

function htmlUrl(n) {
  const repoUrl = n.repository.html_url;
  const api = n.subject.url;
  if (!api) return n.subject.type === 'CheckSuite' ? repoUrl + '/actions' : n.subject.type === 'Discussion' ? repoUrl + '/discussions' : repoUrl;
  if (/\/releases\/\d+$/.test(api)) return repoUrl + '/releases';
  return api.replace('https://api.github.com/repos/', 'https://github.com/').replace('/pulls/', '/pull/');
}

function shapeNotification(n) {
  let [reason, cat] = REASONS[n.reason] || [n.reason.replace(/_/g, ' '), 'other'];
  let type = TYPES[n.subject.type] || 'other';
  if (n.reason === 'ci_activity') type = 'ci';
  if (type === 'ci' && /fail|cancel/i.test(n.subject.title)) reason = 'CI failed';
  if (type === 'release') cat = 'releases';
  const num = (n.subject.url || '').match(/\/(?:issues|pulls)\/(\d+)$/);
  return {
    id: n.id, type, cat, reason, unread: n.unread,
    repo: n.repository.full_name, num: num ? '#' + num[1] : '',
    title: n.subject.title, url: htmlUrl(n), updated: n.updated_at,
  };
}

async function notifications(token) {
  const list = await gh(token, '/notifications?per_page=30');
  return list.map(shapeNotification);
}

const markRead = (token, id) => (id
  ? gh(token, `/notifications/threads/${encodeURIComponent(id)}`, { method: 'PATCH' })
  : gh(token, '/notifications', { method: 'PUT', body: { last_read_at: new Date().toISOString(), read: true } }));

// ---------- contributions, pull requests and watched repos in one GraphQL call ----------
async function overview(token, username, repos) {
  const since = new Date(Date.now() - 365 * 86400e3).toISOString().slice(0, 10);
  const vars = { merged: `is:pr author:${username} is:merged merged:>=${since}` };
  const repoDefs = [], repoFields = [];
  repos.forEach((full, i) => {
    const [o, n] = full.split('/');
    vars['o' + i] = o; vars['n' + i] = n;
    repoDefs.push(`$o${i}: String!, $n${i}: String!`);
    repoFields.push(`r${i}: repository(owner: $o${i}, name: $n${i}) { nameWithOwner description url stargazerCount pushedAt
      pullRequests(states: OPEN) { totalCount } issues(states: OPEN) { totalCount } latestRelease { tagName url } }`);
  });
  const query = `query($merged: String!${repoDefs.length ? ', ' + repoDefs.join(', ') : ''}) {
    viewer {
      login name
      contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } }
      pullRequests(states: OPEN, first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        nodes { title url number additions deletions isDraft reviewDecision repository { nameWithOwner }
          commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
      }
    }
    merged: search(type: ISSUE, query: $merged, first: 1) { issueCount }
    ${repoFields.join('\n')}
  }`;
  const d = await graphql(token, query, vars);

  const days = d.viewer.contributionsCollection.contributionCalendar.weeks.flatMap(w => w.contributionDays);
  const today = new Date().toISOString().slice(0, 10);
  let i = days.length - 1;
  if (days[i] && days[i].date === today && days[i].contributionCount === 0) i--; // today isn't over yet
  let streak = 0;
  for (; i >= 0 && days[i].contributionCount > 0; i--) streak++;
  const week = days.slice(-7).reduce((s, x) => s + x.contributionCount, 0);

  const CHECKS = { SUCCESS: 'pass', FAILURE: 'fail', ERROR: 'fail', PENDING: 'running', EXPECTED: 'running' };
  const REVIEW = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: 'Awaiting review' };
  const prs = d.viewer.pullRequests.nodes.map(p => {
    const rollup = p.commits.nodes[0] && p.commits.nodes[0].commit.statusCheckRollup;
    return {
      title: p.title, url: p.url, number: p.number, repo: p.repository.nameWithOwner, draft: p.isDraft,
      additions: p.additions, deletions: p.deletions,
      checks: rollup ? CHECKS[rollup.state] || 'running' : 'none',
      review: p.isDraft ? 'Draft' : REVIEW[p.reviewDecision] || '',
    };
  });

  const watchedRepos = repos.map((_, i) => d['r' + i]).filter(Boolean).map(r => ({
    name: r.nameWithOwner, description: r.description || '', url: r.url, stars: r.stargazerCount,
    openPrs: r.pullRequests.totalCount, openIssues: r.issues.totalCount, pushedAt: r.pushedAt,
    release: r.latestRelease ? r.latestRelease.tagName : '', releaseUrl: r.latestRelease ? r.latestRelease.url : '',
  }));

  return {
    name: d.viewer.name || d.viewer.login,
    contributions: {
      total: d.viewer.contributionsCollection.contributionCalendar.totalContributions,
      streak, week, merged: d.merged.issueCount,
      weeks: d.viewer.contributionsCollection.contributionCalendar.weeks.map(w =>
        w.contributionDays.map(x => ({ date: x.date, count: x.contributionCount, level: x.contributionLevel }))),
    },
    prs: { total: d.viewer.pullRequests.totalCount, items: prs },
    repos: watchedRepos,
  };
}

// Commit search covers each repository's default branch.
async function commits(token, username) {
  const r = await gh(token, `/search/commits?q=${encodeURIComponent('author:' + username)}&sort=author-date&order=desc&per_page=6`);
  return r.items.map(c => ({
    id: c.sha, parents: (c.parents || []).map(p => p.sha),
    sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0], repo: c.repository.full_name,
    url: c.html_url, date: c.commit.author.date,
  }));
}

// ---------- activity of watched repositories, day by day ----------
const ACTIVITY_DAYS = 180; // 90-day range plus the 90 days before it, for comparisons
const utcDay = d => new Date(d).toISOString().slice(0, 10);
// Whole days before today (UTC). Takes an ISO date string or a timestamp in milliseconds.
const daysAgo = when => Math.floor((Date.parse(utcDay(Date.now())) - Date.parse(typeof when === 'string' ? when.slice(0, 10) : utcDay(when))) / 86400e3);
// Daily series are arrays indexed by days ago (0 = today).
const zeros = () => new Array(ACTIVITY_DAYS).fill(0);
const add = (arr, when, n = 1) => { if (!when) return; const a = daysAgo(when); if (a >= 0 && a < ACTIVITY_DAYS) arr[a] += n; };

// Weekly commit counts for the default branch. GitHub answers 202 while it computes them.
async function commitActivity(token, full) {
  const res = await gh(token, `/repos/${full}/stats/commit_activity`, { raw: true });
  if (res.status === 202) return 'pending';
  if (res.status === 204) return [];
  if (!res.ok) return 'unavailable';
  return res.json().catch(() => 'unavailable');
}

async function activity(cfg) {
  const { token, repos } = cfg.github;
  if (!token || !repos.length) return { configured: false };
  const vars = {}, defs = [], fields = [];
  repos.forEach((full, i) => {
    const [o, n] = full.split('/');
    vars['o' + i] = o; vars['n' + i] = n;
    defs.push(`$o${i}: String!, $n${i}: String!`);
    fields.push(`r${i}: repository(owner: $o${i}, name: $n${i}) { nameWithOwner url pushedAt
      pullRequests(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { createdAt mergedAt } }
      issues(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { createdAt closedAt } }
      releases(first: 20, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { tagName publishedAt createdAt url isPrerelease isDraft } }
      latestRelease { tagName publishedAt url } }`);
  });
  const [stats, d] = await Promise.all([
    Promise.all(repos.map(r => commitActivity(token, r).catch(() => 'unavailable'))),
    graphql(token, `query(${defs.join(', ')}) { ${fields.join('\n')} }`, vars),
  ]);

  // A list of the latest 100 covers everything if it isn't full; otherwise only back to its oldest item.
  const coverage = nodes => (nodes.length < 100 ? ACTIVITY_DAYS : Math.min(ACTIVITY_DAYS, daysAgo(nodes[nodes.length - 1].createdAt)));

  const list = repos.map((full, i) => {
    const r = d['r' + i];
    if (!r) return null;
    const commits = zeros();
    if (Array.isArray(stats[i])) {
      for (const w of stats[i]) w.days.forEach((n, day) => add(commits, (w.week + day * 86400) * 1000, n));
    }
    const prs = zeros(), merged = zeros(), issues = zeros(), closed = zeros();
    r.pullRequests.nodes.forEach(p => { add(prs, p.createdAt); add(merged, p.mergedAt); });
    r.issues.nodes.forEach(x => { add(issues, x.createdAt); add(closed, x.closedAt); });
    return {
      name: r.nameWithOwner, url: r.url, pushedAt: r.pushedAt,
      commitsStatus: Array.isArray(stats[i]) ? 'ok' : stats[i],
      commits, prs, issues, merged, closed,
      coverage: { commits: ACTIVITY_DAYS, prs: coverage(r.pullRequests.nodes), issues: coverage(r.issues.nodes) },
      releases: r.releases.nodes.filter(x => !x.isDraft)
        .map(x => ({ tag: x.tagName, date: x.publishedAt || x.createdAt, ago: daysAgo(x.publishedAt || x.createdAt), url: x.url, pre: x.isPrerelease }))
        .filter(x => x.ago >= 0 && x.ago < ACTIVITY_DAYS),
      // The newest full release, even if it's older than the charts reach.
      latest: r.latestRelease ? { tag: r.latestRelease.tagName, date: r.latestRelease.publishedAt, url: r.latestRelease.url } : null,
    };
  }).filter(Boolean);
  return { configured: true, days: ACTIVITY_DAYS, today: utcDay(Date.now()), repos: list, pending: list.some(r => r.commitsStatus === 'pending') };
}

// ---------- people and organizations you follow ----------
// Everyone you follow, plus organizations you publicly belong to.
async function following(token, username) {
  const [people, orgs] = await Promise.all([
    gh(token, '/user/following?per_page=100').catch(() => []),
    gh(token, `/users/${encodeURIComponent(username)}/orgs?per_page=100`).catch(() => []),
  ]);
  const out = new Map();
  for (const o of orgs) out.set(o.login, { login: o.login, avatar: o.avatar_url, type: 'org', member: true });
  for (const p of people) if (!out.has(p.login)) out.set(p.login, { login: p.login, avatar: p.avatar_url, type: p.type === 'Organization' ? 'org' : 'user', member: false });
  return [...out.values()];
}

const SPLIT_RANGES = [7, 30, 90]; // the dashboard's range choices

// Daily activity for the accounts you chose: contribution calendars for people, public events for organizations.
async function people(cfg) {
  const { token, accounts } = cfg.github;
  if (!token || !accounts.length) return { configured: false };
  const to = new Date();
  const dayStart = n => new Date(Date.parse(utcDay(to)) - (n - 1) * 86400e3).toISOString();
  const vars = { from: dayStart(ACTIVITY_DAYS), to: to.toISOString() };
  const defs = ['$from: DateTime!', '$to: DateTime!'], fields = [];
  for (const r of SPLIT_RANGES) { vars['f' + r] = dayStart(r); defs.push(`$f${r}: DateTime!`); }
  accounts.forEach((login, i) => {
    vars['l' + i] = login;
    defs.push(`$l${i}: String!`);
    // People: the daily calendar, plus which repositories their contributions went to in each range.
    fields.push(`a${i}: repositoryOwner(login: $l${i}) { __typename login avatarUrl url
      ... on User { name contributionsCollection(from: $from, to: $to) { contributionCalendar { weeks { contributionDays { date contributionCount } } } }
        ${SPLIT_RANGES.map(r => `r${r}: contributionsCollection(from: $f${r}, to: $to) { ...byRepo }`).join('\n')} }
      ... on Organization { name } }`);
  });
  const byRepoFields = ['commit', 'pullRequest', 'issue', 'pullRequestReview']
    .map(k => `${k}ContributionsByRepository(maxRepositories: 25) { repository { nameWithOwner url } contributions { totalCount } }`).join('\n');
  const d = await graphql(token, `query(${defs.join(', ')}) { ${fields.join('\n')} }
    fragment byRepo on ContributionsCollection { ${byRepoFields} }`, vars);

  const list = await Promise.all(accounts.map(async (login, i) => {
    const o = d['a' + i];
    if (!o) return null;
    const isOrg = o.__typename === 'Organization';
    // Organizations have no contribution calendar, so their chart comes from up to 3 pages of public events.
    let events = [];
    for (let page = 1; isOrg && page <= 3; page++) {
      const batch = await gh(token, `/orgs/${encodeURIComponent(login)}/events?per_page=100&page=${page}`).catch(() => []);
      events = events.concat(Array.isArray(batch) ? batch : []);
      if (!Array.isArray(batch) || batch.length < 100) break;
    }
    const series = zeros();
    let coverage = ACTIVITY_DAYS;
    if (isOrg) {
      events.forEach(e => add(series, e.created_at));
      // GitHub keeps 90 days of events, at most 300; a full list only reaches back to its oldest event.
      coverage = events.length >= 300 ? Math.min(90, daysAgo(events[events.length - 1].created_at)) : 90;
    } else {
      o.contributionsCollection.contributionCalendar.weeks.forEach(w => w.contributionDays.forEach(x => add(series, x.date, x.contributionCount)));
    }
    // Where the activity went, for each range: [{ repo, url, count }], largest first.
    const byRepo = {};
    for (const r of SPLIT_RANGES) {
      const counts = new Map();
      const bump = (repo, url, n) => { const c = counts.get(repo) || { repo, url, count: 0 }; c.count += n; counts.set(repo, c); };
      if (isOrg) {
        events.filter(e => e.repo && daysAgo(e.created_at) < r).forEach(e => bump(e.repo.name, 'https://github.com/' + e.repo.name, 1));
      } else {
        const c = o['r' + r];
        for (const k of ['commit', 'pullRequest', 'issue', 'pullRequestReview']) {
          (c[`${k}ContributionsByRepository`] || []).forEach(x => bump(x.repository.nameWithOwner, x.repository.url, x.contributions.totalCount));
        }
      }
      byRepo[r] = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 20);
    }
    return {
      login: o.login, name: o.name || '', avatar: o.avatarUrl, url: o.url, type: isOrg ? 'org' : 'user',
      unit: isOrg ? 'events' : 'contributions', series, coverage, byRepo,
    };
  }));
  return { configured: true, days: ACTIVITY_DAYS, today: utcDay(Date.now()), accounts: list.filter(Boolean) };
}

async function dashboard(cfg) {
  const { token, username, repos } = cfg.github;
  if (!token || !username) return { configured: false };
  const [n, o, c] = await Promise.allSettled([notifications(token), overview(token, username, repos), commits(token, username)]);
  const err = r => (r.status === 'rejected' ? r.reason.message : null);
  if (n.status === 'rejected' && o.status === 'rejected' && n.reason.status === 401) {
    return { configured: true, authError: n.reason.message, username };
  }
  return {
    configured: true, username, avatar: cfg.github.avatar,
    notifications: n.status === 'fulfilled' ? n.value : [],
    ...(o.status === 'fulfilled' ? o.value : { name: cfg.github.name || username }),
    commits: c.status === 'fulfilled' ? c.value : [],
    errors: { notifications: err(n), overview: err(o), commits: err(c) },
  };
}

module.exports = { verify, watched, following, dashboard, activity, people, markRead, GitHubError };
