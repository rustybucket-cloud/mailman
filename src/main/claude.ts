// Drafting with the Claude Agent SDK, driving the user's own Claude Code install and sign-in.
// Claude gets the release context in the prompt and two read-only GitHub tools for looking at
// diffs when a change's description isn't enough.

import { app } from 'electron'
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  AbortError,
  createSdkMcpServer,
  query,
  tool,
  type SDKMessage
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { run } from './exec'
import * as github from './github'
import { DRAFT_SCHEMA, SYSTEM_PROMPT, formatDiff, partialStringField, stripLeakedMarkup } from './notes'
import type { Draft, DraftProgress, ToolStatus } from '../shared/types'

const TOOL_PREFIX = 'mcp__github__'
const PR_TOOL = 'get_pull_request_diff'
const COMMIT_TOOL = 'get_commit_diff'
const MAX_TURNS = 20
/** Hard stop per call so a runaway loop can't run up a bill. */
const MAX_BUDGET_USD = 3

function githubTools(slug: string) {
  return createSdkMcpServer({
    name: 'github',
    tools: [
      tool(
        PR_TOOL,
        'Show the files and diff of a pull request in the repository being released.',
        { number: z.number().int().positive().describe('Pull request number') },
        async ({ number }) => ({
          content: [{ type: 'text', text: formatDiff(await github.pullRequestFiles(slug, number)) }]
        }),
        { annotations: { readOnlyHint: true } }
      ),
      tool(
        COMMIT_TOOL,
        'Show the files and diff of a single commit in the repository being released.',
        { sha: z.string().min(7).describe('Commit SHA') },
        async ({ sha }) => ({
          content: [{ type: 'text', text: formatDiff(await github.commitFiles(slug, sha)) }]
        }),
        { annotations: { readOnlyHint: true } }
      )
    ]
  })
}

/** Resolves the user's installed `claude`, so drafts use their Claude Code version and sign-in. */
async function localClaude(): Promise<string | null> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  try {
    return (await run(finder, ['claude'], { timeoutMs: 5000 })).split(/\r?\n/)[0].trim() || null
  } catch {
    return null
  }
}

export async function checkClaude(): Promise<ToolStatus> {
  const path = await localClaude()
  if (!path) {
    return {
      ok: false,
      detail: 'Claude Code not found. Install it from https://claude.com/claude-code and sign in.'
    }
  }
  try {
    const version = (await run(path, ['--version'], { timeoutMs: 15_000 })).trim()
    return { ok: true, detail: version }
  } catch (err) {
    return { ok: false, detail: `Claude Code is installed but didn't start: ${(err as Error).message}` }
  }
}

/**
 * Mailman skips the user's Claude Code settings (hooks, MCP servers, plugins), but should still
 * draft with the model they chose there.
 */
function userDefaultModel(): string | undefined {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  try {
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { model?: unknown }
    return typeof settings.model === 'string' && settings.model ? settings.model : undefined
  } catch {
    return undefined
  }
}

function workspaceDir(): string {
  const dir = join(app.getPath('userData'), 'workspace')
  mkdirSync(dir, { recursive: true })
  return dir
}

function describeTool(name: string, input: Record<string, unknown>): string | null {
  if (name === TOOL_PREFIX + PR_TOOL) return `Reading the diff for PR #${input.number}`
  if (name === TOOL_PREFIX + COMMIT_TOOL) return `Reading the diff for ${String(input.sha).slice(0, 7)}`
  return null
}

export interface DraftOptions {
  prompt: string
  slug: string
  model: string
  /** Continue this session instead of starting a new one. */
  resume?: string
  signal?: AbortSignal
  onProgress?(p: DraftProgress): void
}

/** Running cost per session; the SDK reports cumulative totals, and callers want per-call cost. */
const sessionTotals = new Map<string, number>()

export async function runDraft(opts: DraftOptions): Promise<Draft> {
  const abortController = new AbortController()
  opts.signal?.addEventListener('abort', () => abortController.abort())

  const q = query({
    prompt: opts.prompt,
    options: {
      abortController,
      // An empty folder, and no user/project settings, hooks, MCP servers, or CLAUDE.md:
      // sign-in comes from the user's Claude Code, everything else is Mailman's.
      cwd: workspaceDir(),
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: `mailman/${app.getVersion()}` },
      model: opts.model.trim() || userDefaultModel(),
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      mcpServers: { github: githubTools(opts.slug) },
      allowedTools: [TOOL_PREFIX + PR_TOOL, TOOL_PREFIX + COMMIT_TOOL],
      strictMcpConfig: true,
      settingSources: [],
      outputFormat: { type: 'json_schema', schema: DRAFT_SCHEMA },
      includePartialMessages: true,
      maxTurns: MAX_TURNS,
      maxBudgetUsd: MAX_BUDGET_USD,
      resume: opts.resume,
      pathToClaudeCodeExecutable: (await localClaude()) ?? undefined
    }
  })

  // Tool-call JSON streams in pieces; track it per content block to show the notes as they're written.
  const partialInputs = new Map<number, { name: string; json: string }>()
  const progress = opts.onProgress ?? (() => {})

  try {
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (msg.type === 'stream_event') {
        const ev = msg.event
        if (ev.type === 'message_start') partialInputs.clear()
        else if (ev.type === 'content_block_start') {
          const block = ev.content_block
          if (block.type === 'thinking') progress({ activity: 'Thinking…' })
          if (block.type === 'tool_use') {
            partialInputs.set(ev.index, { name: block.name, json: '' })
            if (!block.name.startsWith(TOOL_PREFIX)) progress({ activity: 'Writing…' })
          }
        } else if (ev.type === 'content_block_delta' && ev.delta.type === 'input_json_delta') {
          const entry = partialInputs.get(ev.index)
          if (!entry) continue
          entry.json += ev.delta.partial_json
          if (!entry.name.startsWith(TOOL_PREFIX)) {
            const notes = partialStringField(entry.json, 'notes')
            if (notes !== null) progress({ notes })
          }
        }
      } else if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type !== 'tool_use') continue
          const activity = describeTool(block.name, block.input as Record<string, unknown>)
          if (activity) progress({ activity })
        }
      } else if (msg.type === 'result') {
        return toDraft(msg, opts.resume)
      }
    }
  } catch (err) {
    if (err instanceof AbortError || abortController.signal.aborted) throw new Error('Cancelled.')
    throw err
  }
  throw new Error('Claude finished without returning a draft.')
}

function toDraft(msg: Extract<SDKMessage, { type: 'result' }>, resumed?: string): Draft {
  const previous = sessionTotals.get(msg.session_id) ?? (resumed ? undefined : 0)
  sessionTotals.set(msg.session_id, msg.total_cost_usd)
  const costUsd = previous === undefined ? null : msg.total_cost_usd - previous

  if (msg.subtype !== 'success') {
    const reasons: Record<string, string> = {
      error_max_turns: 'Claude used too many steps without finishing.',
      error_max_budget_usd: `Stopped at the $${MAX_BUDGET_USD} per-draft budget.`,
      error_max_structured_output_retries: "Claude couldn't produce a draft in the expected format."
    }
    throw new Error(reasons[msg.subtype] ?? msg.errors.join('; ') ?? 'Claude ran into an error.')
  }
  const out = msg.structured_output as { notes?: string; reviewerNote?: string } | undefined
  if (msg.is_error || !out?.notes) throw new Error(msg.result || 'Claude did not return a draft.')
  return {
    notes: stripLeakedMarkup(out.notes),
    reviewerNote: stripLeakedMarkup(out.reviewerNote ?? ''),
    costUsd,
    sessionId: msg.session_id
  }
}
