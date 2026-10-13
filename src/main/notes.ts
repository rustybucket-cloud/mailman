// Pure helpers: config merging, commit parsing, and the prompts sent to Claude Code.

import type { Commit, PastRelease, RepoConfig } from '../shared/types'

export const DEFAULT_CONFIG: RepoConfig = {
  branch: '',
  notesPath: 'release-notes/whatsnew-en-US',
  maxLength: 500,
  audience: 'People who use the app',
  styleGuide: '',
  historyCount: 5,
  model: ''
}

/** Keeps only known keys with the right types, so a malformed .mailman.json can't break the app. */
export function sanitizeConfig(raw: unknown): Partial<RepoConfig> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<RepoConfig> = {}
  for (const [key, def] of Object.entries(DEFAULT_CONFIG) as [keyof RepoConfig, unknown][]) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === typeof def) (out as Record<string, unknown>)[key] = value
  }
  return out
}

export function mergeConfig(...layers: Partial<RepoConfig>[]): RepoConfig {
  return Object.assign({}, DEFAULT_CONFIG, ...layers)
}

/** Finds the PR number in a squash-merge ("Title (#123)") or merge commit ("Merge pull request #123"). */
export function extractPrNumber(message: string): number | null {
  const subject = firstLine(message)
  const match = subject.match(/\(#(\d+)\)\s*$/) ?? subject.match(/^Merge pull request #(\d+)/)
  return match ? Number(match[1]) : null
}

export function firstLine(text: string): string {
  return text.split('\n', 1)[0].trim()
}

/** Play Console counts characters, not bytes; count code points so emoji aren't double-counted. */
export function charCount(text: string): number {
  return [...text].length
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    notes: { type: 'string', description: 'The release notes exactly as they should ship.' },
    reviewerNote: {
      type: 'string',
      description: 'One to three sentences for the reviewer: what was left out and any judgment calls.'
    }
  },
  required: ['notes', 'reviewerNote'],
  additionalProperties: false
} as const

export const SYSTEM_PROMPT = `You write release notes for a software product. A product manager reviews and edits every draft before it ships, and the notes they approved in the past are the best guide to what they want.

Write for the audience you're given, not for developers. Describe what changed for them and why it matters, in plain language. Leave out changes they can't notice: refactors, tests, CI, dependency bumps, and internal tooling, unless one fixes a problem they would have seen. Never include ticket keys, PR numbers, commit hashes, or contributor names.

Each change comes with its commit message and, when there is one, its pull request. If a change's description is too vague to tell what users would notice, use the GitHub tools to read its diff. Skip the tools when the description is clear; each call costs time.

When past releases are provided, match their format, length, tone, and level of detail closely; they reflect the PM's edits. A style guide, when given, overrides anything else here. Stay within the character limit; it is enforced by the app store.

Return the notes and a short note to the reviewer explaining what you left out and any judgment calls.`

const MAX_COMMITS_IN_PROMPT = 300

function describeCommit(c: Commit): string {
  const lines = [`- ${firstLine(c.message)}`]
  const rest = c.message.slice(firstLine(c.message).length).trim()
  if (rest) lines.push(indent(rest.slice(0, 600)))
  if (c.pr) {
    lines.push(`  PR #${c.pr.number}: ${c.pr.title}`)
    if (c.pr.labels.length) lines.push(`  Labels: ${c.pr.labels.join(', ')}`)
    if (c.pr.body.trim()) lines.push(indent(c.pr.body.trim()))
  }
  return lines.join('\n')
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n')
}

function contextSections(config: RepoConfig, commits: Commit[], history: PastRelease[]): string[] {
  const sections = [
    `<audience>\n${config.audience}\n</audience>`,
    `<character_limit>${config.maxLength}</character_limit>`
  ]
  if (config.styleGuide.trim()) {
    sections.push(`<style_guide>\n${config.styleGuide.trim()}\n</style_guide>`)
  }
  if (history.length) {
    const past = history
      .map((h, i) => `<release index="${i + 1}" date="${h.date.slice(0, 10)}">\n${h.notes}\n</release>`)
      .join('\n')
    sections.push(`<past_releases newest_first="true">\n${past}\n</past_releases>`)
  }
  const shown = commits.slice(-MAX_COMMITS_IN_PROMPT)
  const omitted = commits.length - shown.length
  sections.push(
    `<changes count="${commits.length}">\n${shown.map(describeCommit).join('\n')}${
      omitted ? `\n(${omitted} older changes omitted)` : ''
    }\n</changes>`
  )
  return sections
}

export function buildGeneratePrompt(config: RepoConfig, commits: Commit[], history: PastRelease[]): string {
  return [
    ...contextSections(config, commits, history),
    'Write the release notes for these changes.'
  ].join('\n\n')
}

export function buildRefinePrompt(
  config: RepoConfig,
  commits: Commit[],
  history: PastRelease[],
  draft: string,
  instruction: string
): string {
  return [
    ...contextSections(config, commits, history),
    `<current_draft>\n${draft}\n</current_draft>`,
    `Revise the current draft as follows: ${instruction}`
  ].join('\n\n')
}

/** Follow-up turn in the same session when the draft is over the limit. */
export function buildTooLongFollowup(draft: string, limit: number): string {
  return `That draft is ${charCount(draft)} characters, over the ${limit}-character limit. Rewrite it to fit, keeping the most important changes.`
}

/** Follow-up turn in the same session. Includes the current text because the PM may have edited it. */
export function buildRefineFollowup(draft: string, instruction: string): string {
  return `<current_draft>\n${draft}\n</current_draft>\n\nThis is the current draft, possibly edited by the reviewer. Revise it as follows: ${instruction}`
}

interface DiffFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

const PATCH_LIMIT_PER_FILE = 2_000
const DIFF_LIMIT = 16_000

/** Renders a GitHub file list as a compact diff, truncated so one tool result can't flood the context. */
export function formatDiff(files: DiffFile[]): string {
  if (!files.length) return 'No file changes.'
  let out = ''
  for (const [i, f] of files.entries()) {
    const patch = f.patch ? f.patch.slice(0, PATCH_LIMIT_PER_FILE) : '(binary or too large to show)'
    const cut = f.patch && f.patch.length > PATCH_LIMIT_PER_FILE ? '\n… (truncated)' : ''
    const entry = `### ${f.filename} (${f.status}, +${f.additions} -${f.deletions})\n${patch}${cut}\n\n`
    if (out.length + entry.length > DIFF_LIMIT) {
      const rest = files.slice(i).map((x) => x.filename)
      return `${out}… ${rest.length} more files not shown: ${rest.join(', ')}`
    }
    out += entry
  }
  return out.trim()
}

/** Models occasionally close a structured-output field with tool-call markup; drop it. */
export function stripLeakedMarkup(text: string): string {
  return text.replace(/\s*<\/(?:notes|reviewerNote|parameter|invoke)>[\s\S]*$/, '').trim()
}

/**
 * Reads a string field out of incomplete JSON, decoding escapes, so the notes can be
 * shown while Claude is still writing its structured output.
 */
export function partialStringField(json: string, field: string): string | null {
  const start = new RegExp(`"${field}"\\s*:\\s*"`).exec(json)
  if (!start) return null
  const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }
  let out = ''
  for (let i = start.index + start[0].length; i < json.length; i++) {
    const ch = json[i]
    if (ch === '"') return out
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = json[i + 1]
    if (next === undefined) return out
    if (next === 'u') {
      const hex = json.slice(i + 2, i + 6)
      if (hex.length < 4) return out
      out += String.fromCharCode(parseInt(hex, 16))
      i += 5
    } else {
      out += escapes[next] ?? next
      i++
    }
  }
  return out
}

export function buildPrBody(notes: string, reviewerNote: string, commits: Commit[]): string {
  const changes = commits
    .map((c) => `- ${firstLine(c.message)} (${c.sha.slice(0, 7)})`)
    .join('\n')
  return [
    '## Release notes',
    '',
    '```',
    notes,
    '```',
    '',
    reviewerNote ? `> ${reviewerNote.replace(/\n/g, '\n> ')}\n` : '',
    'Edit the file in this PR to change the wording. Merging it approves the notes.',
    '',
    `<details><summary>${commits.length} changes included</summary>`,
    '',
    changes,
    '',
    '</details>',
    '',
    '_Drafted by Mailman with Claude Code._'
  ].join('\n')
}
