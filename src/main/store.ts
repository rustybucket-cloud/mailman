// Local settings: the saved repo list, per-repo config overrides, and unsent drafts, kept in the app's userData folder.

import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RepoConfig, SavedDraft } from '../shared/types'

interface StoreData {
  repos: string[]
  overrides: Record<string, Partial<RepoConfig>>
  drafts: Record<string, SavedDraft>
}

const file = () => join(app.getPath('userData'), 'mailman.json')

async function load(): Promise<StoreData> {
  try {
    const data = JSON.parse(await readFile(file(), 'utf8')) as Partial<StoreData>
    return { repos: data.repos ?? [], overrides: data.overrides ?? {}, drafts: data.drafts ?? {} }
  } catch {
    return { repos: [], overrides: {}, drafts: {} }
  }
}

/** Updates run one at a time, so a draft autosave can't drop a concurrent settings change. */
let queue: Promise<unknown> = Promise.resolve()

/** Reads wait for pending writes, so they never see a half-written file. */
const read = () => queue.then(load)

function update<T>(fn: (data: StoreData) => T): Promise<T> {
  const run = queue.then(async () => {
    const data = await load()
    const result = fn(data)
    await writeFile(file(), JSON.stringify(data, null, 2))
    return result
  })
  queue = run.catch(() => {})
  return run
}

export async function listRepos(): Promise<string[]> {
  return (await read()).repos
}

export function addRepo(slug: string): Promise<string[]> {
  return update((data) => {
    if (!data.repos.includes(slug)) data.repos.push(slug)
    return data.repos
  })
}

export function removeRepo(slug: string): Promise<string[]> {
  return update((data) => {
    data.repos = data.repos.filter((r) => r !== slug)
    delete data.overrides[slug]
    delete data.drafts[slug]
    return data.repos
  })
}

export async function getOverrides(slug: string): Promise<Partial<RepoConfig> | null> {
  return (await read()).overrides[slug] ?? null
}

export function setOverrides(slug: string, config: Partial<RepoConfig> | null): Promise<void> {
  return update((data) => {
    if (config) data.overrides[slug] = config
    else delete data.overrides[slug]
  })
}

export async function listDrafts(): Promise<string[]> {
  return Object.keys((await read()).drafts)
}

export async function getDraft(slug: string): Promise<SavedDraft | null> {
  return (await read()).drafts[slug] ?? null
}

export function setDraft(slug: string, draft: SavedDraft | null): Promise<void> {
  return update((data) => {
    if (draft) data.drafts[slug] = draft
    else delete data.drafts[slug]
  })
}
