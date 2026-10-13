import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  buildGeneratePrompt,
  buildPrBody,
  charCount,
  extractPrNumber,
  formatDiff,
  partialStringField,
  mapLimit,
  mergeConfig,
  sanitizeConfig,
  stripLeakedMarkup
} from './notes'
import type { Commit, PastRelease } from '../shared/types'

const commit = (over: Partial<Commit> = {}): Commit => ({
  sha: 'abc1234def',
  message: 'feat(OGEN-1): add offline mode (#12)',
  author: 'dev',
  date: '2026-10-01T00:00:00Z',
  url: 'https://github.com/o/r/commit/abc1234def',
  pr: null,
  ...over
})

describe('extractPrNumber', () => {
  it('reads squash-merge subjects', () => {
    expect(extractPrNumber('fix: cap count at 150 (#131)\n\nbody (#99)')).toBe(131)
  })
  it('reads merge commits', () => {
    expect(extractPrNumber('Merge pull request #42 from org/branch')).toBe(42)
  })
  it('ignores references that are not the merged PR', () => {
    expect(extractPrNumber('fix: see #12 for context')).toBeNull()
  })
})

describe('config', () => {
  it('drops unknown keys and wrong types', () => {
    expect(sanitizeConfig({ maxLength: '500', notesPath: 'a/b', extra: 1 })).toEqual({ notesPath: 'a/b' })
    expect(sanitizeConfig(null)).toEqual({})
  })
  it('layers later values over earlier ones', () => {
    const merged = mergeConfig({ maxLength: 400, audience: 'repo' }, { audience: 'local' })
    expect(merged).toEqual({ ...DEFAULT_CONFIG, maxLength: 400, audience: 'local' })
  })
})

describe('charCount', () => {
  it('counts emoji as one character', () => {
    expect(charCount('hi 🎉')).toBe(4)
  })
})

describe('mapLimit', () => {
  it('preserves order and caps concurrency', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      peak = Math.max(peak, ++active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBe(2)
  })
})

describe('buildGeneratePrompt', () => {
  const history: PastRelease[] = [
    { sha: 's1', date: '2026-09-01T00:00:00Z', notes: '• Faster sync', url: '' }
  ]

  it('includes PR context, past releases, and the style guide', () => {
    const prompt = buildGeneratePrompt(
      { ...DEFAULT_CONFIG, styleGuide: 'No jargon.' },
      [commit({ pr: { number: 12, title: 'Offline mode', body: 'Works without signal', url: '', labels: ['feature'] } })],
      history
    )
    expect(prompt).toContain('<style_guide>\nNo jargon.')
    expect(prompt).toContain('• Faster sync')
    expect(prompt).toContain('PR #12: Offline mode')
    expect(prompt).toContain('Works without signal')
    expect(prompt).toContain('<character_limit>500</character_limit>')
  })

  it('omits the style guide section when empty', () => {
    expect(buildGeneratePrompt(DEFAULT_CONFIG, [commit()], [])).not.toContain('<style_guide>')
  })
})

describe('buildPrBody', () => {
  it('lists the notes and included commits', () => {
    const body = buildPrBody('• Offline mode', 'Skipped CI changes.', [commit()])
    expect(body).toContain('• Offline mode')
    expect(body).toContain('> Skipped CI changes.')
    expect(body).toContain('add offline mode (#12) (abc1234)')
  })
})

describe('partialStringField', () => {
  it('decodes a field that is still streaming', () => {
    expect(partialStringField('{"notes":"• Faster\\nsy', 'notes')).toBe('• Faster\nsy')
  })
  it('stops at the closing quote', () => {
    expect(partialStringField('{"notes":"a \\"b\\"","reviewerNote":"x"}', 'notes')).toBe('a "b"')
  })
  it('waits for a complete unicode escape', () => {
    expect(partialStringField('{"notes":"hi \\u00', 'notes')).toBe('hi ')
    expect(partialStringField('{"notes":"hi \\u00e9', 'notes')).toBe('hi é')
  })
  it('returns null before the field starts', () => {
    expect(partialStringField('{"reviewerNote":"x"', 'notes')).toBeNull()
  })
})

describe('formatDiff', () => {
  it('truncates long patches and lists files that do not fit', () => {
    const big = { filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, patch: 'x'.repeat(5000) }
    const files = Array.from({ length: 20 }, (_, i) => ({ ...big, filename: `f${i}.ts` }))
    const out = formatDiff(files)
    expect(out).toContain('… (truncated)')
    expect(out).toMatch(/more files not shown: .*f19\.ts/)
    expect(out.length).toBeLessThan(17_000)
  })
})

describe('stripLeakedMarkup', () => {
  it('drops tool-call closing tags at the end of a field', () => {
    expect(stripLeakedMarkup('Left out CI changes.</reviewerNote> </invoke>')).toBe('Left out CI changes.')
  })
  it('leaves normal text alone', () => {
    expect(stripLeakedMarkup('Use <b>bold</b> sparingly')).toBe('Use <b>bold</b> sparingly')
  })
})
