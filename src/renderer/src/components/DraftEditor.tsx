import { useEffect, useState } from 'react'
import type { Commit, Draft, PastRelease, RepoConfig } from '@shared/types'
import { charCount, errorMessage, pluralize } from '../util'
import { Postmark } from './Postmark'

interface Props {
  slug: string
  config: RepoConfig
  commits: Commit[]
  history: PastRelease[]
  branch: string
  /** False while the changes are still loading. */
  ready: boolean
}

type Busy = 'generate' | 'refine' | 'send' | null

export function DraftEditor({ slug, config, commits, history, branch, ready }: Props) {
  const [notes, setNotes] = useState('')
  const [reviewerNote, setReviewerNote] = useState('')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [sentAt, setSentAt] = useState<Date | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [activity, setActivity] = useState<string | null>(null)

  const writing = busy === 'generate' || busy === 'refine'
  const sent = !!prUrl
  const count = charCount(notes)
  const over = count > config.maxLength
  const hasDraft = notes.trim().length > 0

  // The notes stream into the sheet while Claude writes them.
  useEffect(() => {
    if (!writing) return
    return window.mailman.release.onProgress((p) => {
      if (p.notes !== undefined) setNotes(p.notes)
      if (p.activity) setActivity(p.activity)
    })
  }, [writing])

  async function act(kind: Exclude<Busy, null>, fn: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    const before = notes
    try {
      await fn()
    } catch (err) {
      if (kind !== 'send') setNotes(before) // drop a half-written draft
      const msg = errorMessage(err)
      if (msg !== 'Cancelled.') setError(msg)
    } finally {
      setBusy(null)
      setActivity(null)
    }
  }

  function apply(draft: Draft) {
    setNotes(draft.notes)
    setReviewerNote(draft.reviewerNote)
    setSessionId(draft.sessionId)
  }

  const generate = () =>
    act('generate', async () => {
      setReviewerNote('')
      apply(await window.mailman.release.generate({ slug, config, commits, history }))
    })

  const refine = () =>
    act('refine', async () => {
      apply(
        await window.mailman.release.refine({ slug, sessionId, config, commits, history, draft: notes, instruction })
      )
      setInstruction('')
    })

  const send = () =>
    act('send', async () => {
      const { url } = await window.mailman.release.openPr({ slug, config, notes, reviewerNote, commits })
      setPrUrl(url)
      setSentAt(new Date())
    })

  function startOver() {
    setNotes('')
    setReviewerNote('')
    setSessionId(null)
    setPrUrl(null)
    setSentAt(null)
    setError(null)
  }

  const prNumber = prUrl?.match(/\/pull\/(\d+)/)?.[1]
  const fileName = config.notesPath.split('/').pop()

  return (
    <>
      <div className="sheet">
        <div className="letterhead" title={config.notesPath}>
          <span>{fileName}</span>
          <span>{branch}</span>
        </div>
        {!hasDraft && !writing ? (
          <div className="sheet-empty">
            <div>
              <h2>Release notes</h2>
              <p>
                {!ready
                  ? 'Finding what changed since the last release…'
                  : commits.length === 0
                    ? 'Include at least one change to write notes for.'
                    : `Claude drafts them from the ${pluralize(commits.length, 'change')} you’ve included, in the style of your past notes.`}
              </p>
              <button className="btn primary large" onClick={() => void generate()} disabled={!ready || !commits.length}>
                Write release notes
              </button>
            </div>
          </div>
        ) : (
          <>
            {sent && sentAt && <Postmark date={sentAt} pr={prNumber} />}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              readOnly={writing || sent}
              placeholder={writing ? 'Claude is reading the changes…' : ''}
              aria-label="Release notes"
              spellCheck={!writing}
            />
            <div className="sheet-foot">
              {writing ? (
                <span className="writing">
                  <span className="pulse" />
                  {activity ?? 'Starting…'}
                  <button className="link" onClick={() => void window.mailman.release.cancel()}>
                    Stop
                  </button>
                </span>
              ) : (
                <span />
              )}
              <span className={`count${over ? ' over' : ''}`}>
                {count} / {config.maxLength}
              </span>
            </div>
          </>
        )}
      </div>

      {error && <div className="banner">{error}</div>}

      {reviewerNote && !writing && (
        <div className="note">
          <div className="note-body">
            <strong>Claude’s note</strong>
            {reviewerNote}
          </div>
        </div>
      )}

      {hasDraft && !sent && !writing && (
        <form
          className="revise"
          onSubmit={(e) => {
            e.preventDefault()
            if (instruction.trim()) void refine()
          }}
        >
          <textarea
            rows={3}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter adds a line.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            placeholder="Ask for changes, like “shorter” or “lead with the camera fix”"
            disabled={!!busy}
            aria-label="Ask Claude for changes"
          />
          <button type="submit" className="btn" disabled={!!busy || !instruction.trim()}>
            Revise
          </button>
        </form>
      )}

      {hasDraft && !sent && !writing && (
        <div className="actions">
          <p className="explain">
            Opens a pull request that updates <code>{fileName}</code>. Merging it approves the notes.
          </p>
          <div className="right">
            <button className="btn quiet" onClick={() => void generate()} disabled={!!busy || !commits.length}>
              Rewrite
            </button>
            <button className="btn primary" onClick={() => void send()} disabled={!!busy || over}>
              {busy === 'send' ? 'Sending…' : 'Send for approval'}
            </button>
          </div>
        </div>
      )}

      {sent && (
        <div className="sent">
          <div>
            <strong>Sent for approval</strong>
            <p>Edit the wording in the pull request if needed. Merging it approves the notes.</p>
          </div>
          <div className="right" style={{ display: 'flex', gap: 8 }}>
            <button className="btn quiet" onClick={startOver}>
              Start over
            </button>
            <a className="btn primary" href={prUrl!} target="_blank" rel="noreferrer">
              Open pull request{prNumber ? ` #${prNumber}` : ''}
            </a>
          </div>
        </div>
      )}
    </>
  )
}
