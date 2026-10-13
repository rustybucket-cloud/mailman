// Local settings: the saved repo list and per-repo config overrides, kept in the app's userData folder.

import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RepoConfig } from '../shared/types'

interface StoreData {
  repos: string[]
  overrides: Record<string, Partial<RepoConfig>>
}

const file = () => join(app.getPath('userData'), 'mailman.json')

async function load(): Promise<StoreData> {
  try {
    const data = JSON.parse(await readFile(file(), 'utf8')) as Partial<StoreData>
    return { repos: data.repos ?? [], overrides: data.overrides ?? {} }
  } catch {
    return { repos: [], overrides: {} }
  }
}

async function save(data: StoreData): Promise<void> {
  await writeFile(file(), JSON.stringify(data, null, 2))
}

export async function listRepos(): Promise<string[]> {
  return (await load()).repos
}

export async function addRepo(slug: string): Promise<string[]> {
  const data = await load()
  if (!data.repos.includes(slug)) data.repos.push(slug)
  await save(data)
  return data.repos
}

export async function removeRepo(slug: string): Promise<string[]> {
  const data = await load()
  data.repos = data.repos.filter((r) => r !== slug)
  delete data.overrides[slug]
  await save(data)
  return data.repos
}

export async function getOverrides(slug: string): Promise<Partial<RepoConfig> | null> {
  return (await load()).overrides[slug] ?? null
}

export async function setOverrides(slug: string, config: Partial<RepoConfig> | null): Promise<void> {
  const data = await load()
  if (config) data.overrides[slug] = config
  else delete data.overrides[slug]
  await save(data)
}
