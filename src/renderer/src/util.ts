/** Strips Electron's "Error invoking remote method" wrapper from IPC errors. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export function charCount(text: string): number {
  return [...text].length
}

export function firstLine(text: string): string {
  return text.split('\n', 1)[0].trim()
}

export function shortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}

export type ChangeKind = 'new' | 'fix' | 'internal' | null

const INTERNAL = new Set(['chore', 'ci', 'build', 'test', 'tests', 'docs', 'refactor', 'style'])

/**
 * Turns a developer commit subject into something a PM can scan:
 * "feat(OGEN-2596): always fetch the flag" -> { kind: 'new', text: 'Always fetch the flag' }.
 */
export function readableTitle(subject: string): { kind: ChangeKind; text: string } {
  let text = subject.trim()
  let kind: ChangeKind = null
  const conventional = text.match(/^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/)
  if (conventional) {
    const type = conventional[1].toLowerCase()
    kind = type === 'feat' ? 'new' : type === 'fix' ? 'fix' : INTERNAL.has(type) ? 'internal' : null
    text = conventional[2]
  }
  text = text
    .replace(/^[A-Z][A-Z0-9]+-\d+:?\s*/, '') // leading ticket key
    .replace(/\s*\(#\d+\)$/, '') // trailing PR number
  return { kind, text: text.charAt(0).toUpperCase() + text.slice(1) }
}

export function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
