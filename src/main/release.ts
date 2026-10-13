// The release workflow: find the last release, gather what changed, draft, and deliver as a PR.

import * as github from './github'
import * as store from './store'
import { runDraft } from './claude'
import {
  buildGeneratePrompt,
  buildPrBody,
  buildRefineFollowup,
  buildRefinePrompt,
  buildTooLongFollowup,
  charCount,
  mergeConfig,
  sanitizeConfig
} from './notes'
import type {
  Draft,
  DraftProgress,
  GenerateRequest,
  OpenPrRequest,
  RefineRequest,
  ReleaseBoundary,
  RepoConfig,
  RepoState,
  ScanResult
} from '../shared/types'

export const REPO_CONFIG_FILE = '.mailman.json'
const FALLBACK_COMMIT_COUNT = 30

/** Accepts "owner/repo" or a GitHub URL. */
export function parseSlug(input: string): string {
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/$/, '')
  const fromUrl = trimmed.match(/github\.com[/:]([\w.-]+\/[\w.-]+)/)
  const slug = fromUrl ? fromUrl[1] : trimmed
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) throw new Error(`"${input}" isn't an owner/repo name or GitHub URL`)
  return slug
}

export async function loadRepo(slug: string): Promise<RepoState> {
  const defaultBranch = await github.getDefaultBranch(slug)
  const repoFile = await github.readFile(slug, REPO_CONFIG_FILE, defaultBranch)
  let repoConfig: Partial<RepoConfig> = {}
  if (repoFile) {
    try {
      repoConfig = sanitizeConfig(JSON.parse(repoFile.text))
    } catch {
      throw new Error(`${REPO_CONFIG_FILE} in ${slug} isn't valid JSON`)
    }
  }
  const overrides = await store.getOverrides(slug)
  return {
    slug,
    defaultBranch,
    config: mergeConfig(repoConfig, overrides ?? {}),
    hasRepoConfig: !!repoFile,
    hasLocalConfig: !!overrides
  }
}

export async function saveConfig(slug: string, config: RepoConfig): Promise<RepoState> {
  await store.setOverrides(slug, sanitizeConfig(config))
  return loadRepo(slug)
}

export async function resetConfig(slug: string): Promise<RepoState> {
  await store.setOverrides(slug, null)
  return loadRepo(slug)
}

export async function scan(slug: string, config: RepoConfig, sinceRef?: string): Promise<ScanResult> {
  const branch = config.branch || (await github.getDefaultBranch(slug))
  const [history, current] = await Promise.all([
    github.notesHistory(slug, config.notesPath, branch, Math.max(config.historyCount, 1)),
    github.readFile(slug, config.notesPath, branch)
  ])

  let boundary: ReleaseBoundary
  if (sinceRef?.trim()) {
    boundary = { kind: 'manual', ref: sinceRef.trim(), label: `Since ${sinceRef.trim()}` }
  } else if (history[0]) {
    boundary = {
      kind: 'notes',
      ref: history[0].sha,
      label: `Since the last release on ${history[0].date.slice(0, 10)}`
    }
  } else {
    const tag = await github.latestTag(slug)
    boundary = tag
      ? { kind: 'tag', ref: tag, label: `Since tag ${tag}` }
      : {
          kind: 'none',
          ref: null,
          label: `Last ${FALLBACK_COMMIT_COUNT} commits (no earlier release found)`
        }
  }

  let raw: Awaited<ReturnType<typeof github.recentCommits>>
  let total: number
  if (boundary.ref) {
    const res = await github.commitsSince(slug, boundary.ref, branch)
    raw = res.commits
    total = res.total
  } else {
    raw = (await github.recentCommits(slug, branch, FALLBACK_COMMIT_COUNT)).reverse()
    total = raw.length
  }

  return {
    boundary,
    commits: await github.withPullRequests(slug, raw),
    truncated: raw.length < total,
    totalCommits: total,
    history: history.slice(0, config.historyCount),
    currentNotes: current?.text ?? null
  }
}

/** One draft runs at a time; the UI disables drafting while it's busy. */
let active: AbortController | null = null

export function cancel(): void {
  active?.abort()
}

async function withJob<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (active) throw new Error('A draft is already being written.')
  active = new AbortController()
  try {
    return await fn(active.signal)
  } finally {
    active = null
  }
}

type DraftBase = Omit<Parameters<typeof runDraft>[0], 'prompt' | 'resume'>

/** If a draft is over the limit, asks once more in the same session; the editor flags it if it's still over. */
async function fitToLimit(draft: Draft, limit: number, base: DraftBase): Promise<Draft> {
  if (charCount(draft.notes) <= limit) return draft
  base.onProgress?.({ activity: 'Shortening to fit the limit…' })
  const retry = await runDraft({ ...base, prompt: buildTooLongFollowup(draft.notes, limit), resume: draft.sessionId })
  return { ...retry, costUsd: sumCost(draft.costUsd, retry.costUsd) }
}

export function generate(req: GenerateRequest, onProgress: (p: DraftProgress) => void): Promise<Draft> {
  if (!req.commits.length) throw new Error('Select at least one change to write notes for.')
  return withJob(async (signal) => {
    const base: DraftBase = { slug: req.slug, model: req.config.model, signal, onProgress }
    const draft = await runDraft({ ...base, prompt: buildGeneratePrompt(req.config, req.commits, req.history) })
    return fitToLimit(draft, req.config.maxLength, base)
  })
}

export function refine(req: RefineRequest, onProgress: (p: DraftProgress) => void): Promise<Draft> {
  return withJob(async (signal) => {
    const base: DraftBase = { slug: req.slug, model: req.config.model, signal, onProgress }
    // Continuing the session keeps Claude's earlier reasoning and any diffs it read.
    const draft = req.sessionId
      ? await runDraft({ ...base, prompt: buildRefineFollowup(req.draft, req.instruction), resume: req.sessionId })
      : await runDraft({
          ...base,
          prompt: buildRefinePrompt(req.config, req.commits, req.history, req.draft, req.instruction)
        })
    return fitToLimit(draft, req.config.maxLength, base)
  })
}

export async function openPr(req: OpenPrRequest): Promise<{ url: string }> {
  if (charCount(req.notes) > req.config.maxLength) {
    throw new Error(`The notes are over the ${req.config.maxLength}-character limit.`)
  }
  const base = req.config.branch || (await github.getDefaultBranch(req.slug))
  const url = await github.openNotesPullRequest({
    slug: req.slug,
    base,
    path: req.config.notesPath,
    content: req.notes,
    title: `Release notes ${new Date().toISOString().slice(0, 10)}`,
    body: buildPrBody(req.notes, req.reviewerNote, req.commits)
  })
  return { url }
}

function sumCost(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0)
}
