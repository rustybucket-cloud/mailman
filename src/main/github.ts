// GitHub access through the user's authenticated `gh` CLI. No tokens are stored by Mailman.

import { CommandError, run } from './exec'
import { extractPrNumber, mapLimit } from './notes'
import type { Commit, PastRelease, PullRequestInfo, ToolStatus } from '../shared/types'

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  body?: unknown
}

async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const args = ['api', path]
  if (opts.method) args.push('--method', opts.method)
  if (opts.body !== undefined) args.push('--input', '-')
  const input = opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  const out = await run('gh', args, { input, timeoutMs: 60_000 })
  return (out.trim() ? JSON.parse(out) : null) as T
}

function isNotFound(err: unknown): boolean {
  return err instanceof CommandError && /HTTP 404/.test(err.message)
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export async function checkGh(): Promise<ToolStatus> {
  try {
    const user = await api<{ login: string }>('user')
    return { ok: true, detail: `Signed in as ${user.login}` }
  } catch (err) {
    const msg = (err as Error).message
    if (/not found on your PATH/.test(msg)) {
      return { ok: false, detail: 'GitHub CLI not found. Install it from https://cli.github.com' }
    }
    return { ok: false, detail: 'GitHub CLI is not signed in. Run `gh auth login` in a terminal.' }
  }
}

export async function getDefaultBranch(slug: string): Promise<string> {
  const repo = await api<{ default_branch: string }>(`repos/${slug}`)
  return repo.default_branch
}

export async function readFile(
  slug: string,
  path: string,
  ref: string
): Promise<{ text: string; sha: string } | null> {
  try {
    const file = await api<{ content?: string; sha: string; type: string }>(
      `repos/${slug}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`
    )
    if (file.type !== 'file' || file.content === undefined) return null
    return { text: Buffer.from(file.content, 'base64').toString('utf8'), sha: file.sha }
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

interface ApiCommit {
  sha: string
  html_url: string
  commit: { message: string; author: { name: string; date: string } | null }
  author: { login: string } | null
}

/** Each past version of the notes file, newest first. These are the PM-approved notes. */
export async function notesHistory(
  slug: string,
  path: string,
  branch: string,
  count: number
): Promise<PastRelease[]> {
  const commits = await api<ApiCommit[]>(
    `repos/${slug}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&per_page=${count}`
  )
  const releases = await mapLimit(commits, 4, async (c) => {
    const file = await readFile(slug, path, c.sha)
    return {
      sha: c.sha,
      date: c.commit.author?.date ?? '',
      notes: file?.text.trim() ?? '',
      url: c.html_url
    }
  })
  return releases.filter((r) => r.notes)
}

export async function latestTag(slug: string): Promise<string | null> {
  const [owner, name] = slug.split('/')
  const query = `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      refs(refPrefix: "refs/tags/", first: 1, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
        nodes { name }
      }
    }
  }`
  const res = await api<{ data: { repository: { refs: { nodes: { name: string }[] } } } }>(
    'graphql',
    { method: 'POST', body: { query, variables: { owner, name } } }
  )
  return res.data.repository.refs.nodes[0]?.name ?? null
}

const MAX_COMPARE_PAGES = 5

/** Commits on `head` after `base`, oldest first. */
export async function commitsSince(
  slug: string,
  base: string,
  head: string
): Promise<{ commits: ApiCommit[]; total: number }> {
  const commits: ApiCommit[] = []
  let total = 0
  for (let page = 1; page <= MAX_COMPARE_PAGES; page++) {
    const res = await api<{ total_commits: number; commits: ApiCommit[] }>(
      `repos/${slug}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100&page=${page}`
    )
    total = res.total_commits
    commits.push(...res.commits)
    if (res.commits.length < 100 || commits.length >= total) break
  }
  return { commits, total }
}

/** Most recent commits on the branch, newest first. Used when there's no release yet. */
export async function recentCommits(slug: string, branch: string, count: number): Promise<ApiCommit[]> {
  return api<ApiCommit[]>(
    `repos/${slug}/commits?sha=${encodeURIComponent(branch)}&per_page=${count}`
  )
}

const PR_BODY_LIMIT = 2000

async function pullRequest(slug: string, n: number): Promise<PullRequestInfo | null> {
  try {
    const pr = await api<{
      number: number
      title: string
      body: string | null
      html_url: string
      labels: { name: string }[]
    }>(`repos/${slug}/pulls/${n}`)
    return {
      number: pr.number,
      title: pr.title,
      body: (pr.body ?? '').slice(0, PR_BODY_LIMIT),
      url: pr.html_url,
      labels: pr.labels.map((l) => l.name)
    }
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

interface GraphQlPr {
  number: number
  title: string
  body: string
  url: string
  labels: { nodes: { name: string }[] }
}

const PR_BATCH = 50

/** Fetches many PRs in one GraphQL request per batch; falls back to REST if a batch fails. */
async function pullRequests(slug: string, numbers: number[]): Promise<Map<number, PullRequestInfo>> {
  const [owner, name] = slug.split('/')
  const found = new Map<number, PullRequestInfo>()
  const unique = [...new Set(numbers)]
  for (let i = 0; i < unique.length; i += PR_BATCH) {
    const batch = unique.slice(i, i + PR_BATCH)
    const fields = batch
      .map((n) => `pr${n}: pullRequest(number: ${n}) { number title body url labels(first: 10) { nodes { name } } }`)
      .join('\n')
    try {
      const res = await api<{ data: { repository: Record<string, GraphQlPr | null> } }>('graphql', {
        method: 'POST',
        body: {
          query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
          variables: { owner, name }
        }
      })
      for (const pr of Object.values(res.data.repository)) {
        if (!pr) continue
        found.set(pr.number, {
          number: pr.number,
          title: pr.title,
          body: pr.body.slice(0, PR_BODY_LIMIT),
          url: pr.url,
          labels: pr.labels.nodes.map((l) => l.name)
        })
      }
    } catch {
      // One bad number (e.g. an issue, not a PR) fails the whole query; fetch this batch one by one.
      const singles = await mapLimit(batch, 8, (n) => pullRequest(slug, n))
      for (const pr of singles) if (pr) found.set(pr.number, pr)
    }
  }
  return found
}

/** Attaches the merged PR (title, description, labels) to each commit when one is referenced. */
export async function withPullRequests(slug: string, commits: ApiCommit[]): Promise<Commit[]> {
  const numbers = commits.map((c) => extractPrNumber(c.commit.message))
  const prs = await pullRequests(slug, numbers.filter((n): n is number => n !== null))
  return commits.map((c, i) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
    date: c.commit.author?.date ?? '',
    url: c.html_url,
    pr: prs.get(numbers[i] ?? -1) ?? null
  }))
}

interface OpenPrInput {
  slug: string
  base: string
  path: string
  content: string
  title: string
  body: string
}

/** Commits the notes to a new branch and opens a PR, all through the API, so no local clone is needed. */
export async function openNotesPullRequest(input: OpenPrInput): Promise<string> {
  const { slug, base, path } = input
  const ref = await api<{ object: { sha: string } }>(
    `repos/${slug}/git/ref/heads/${encodePath(base)}`
  )
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const branch = `mailman/release-notes-${stamp}`
  await api(`repos/${slug}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/heads/${branch}`, sha: ref.object.sha }
  })

  const existing = await readFile(slug, path, base)
  await api(`repos/${slug}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: {
      message: input.title,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
      branch,
      ...(existing ? { sha: existing.sha } : {})
    }
  })

  const pr = await api<{ html_url: string }>(`repos/${slug}/pulls`, {
    method: 'POST',
    body: { title: input.title, head: branch, base, body: input.body }
  })
  return pr.html_url
}

interface ApiFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

export async function pullRequestFiles(slug: string, n: number): Promise<ApiFile[]> {
  return api<ApiFile[]>(`repos/${slug}/pulls/${n}/files?per_page=100`)
}

export async function commitFiles(slug: string, sha: string): Promise<ApiFile[]> {
  const commit = await api<{ files?: ApiFile[] }>(`repos/${slug}/commits/${encodeURIComponent(sha)}`)
  return commit.files ?? []
}
