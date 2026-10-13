import { useState } from 'react'
import type { ScanResult } from '@shared/types'
import { firstLine, readableTitle, shortDate } from '../util'

interface Props {
  scan: ScanResult | null
  loading: boolean
  excluded: Set<string>
  onToggle(sha: string): void
  onSetAll(on: boolean): void
  onChangeRange(ref: string): void
}

type Tab = 'changes' | 'past'

export function Rail({ scan, loading, excluded, onToggle, onSetAll, onChangeRange }: Props) {
  const [tab, setTab] = useState<Tab>('changes')
  const [editingRange, setEditingRange] = useState(false)
  const [ref, setRef] = useState('')

  const total = scan?.commits.length ?? 0
  const included = total - excluded.size

  return (
    <aside className="rail">
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
          Changes<span className="n">{scan ? total : ''}</span>
        </button>
        <button className="tab" role="tab" aria-selected={tab === 'past'} onClick={() => setTab('past')}>
          Past notes<span className="n">{scan ? scan.history.length : ''}</span>
        </button>
      </div>

      {tab === 'changes' ? (
        <>
          <div className="range">
            {editingRange ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  onChangeRange(ref)
                  setEditingRange(false)
                }}
              >
                <input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setEditingRange(false)}
                  placeholder="Tag, branch, or commit"
                  autoFocus
                  aria-label="Start from"
                />
                <button className="btn" type="submit">
                  Apply
                </button>
              </form>
            ) : (
              <div className="range-line">
                <span>{loading ? 'Finding the last release…' : scan?.boundary.label}</span>
                {!loading && (
                  <button className="link" onClick={() => setEditingRange(true)}>
                    Change
                  </button>
                )}
              </div>
            )}
            {scan && total > 0 && !loading && (
              <div className="select-line">
                <span>
                  {included === total ? `All ${total} included` : `${included} of ${total} included`}
                </span>
                <span className="links">
                  {included < total && (
                    <button className="link" onClick={() => onSetAll(true)}>
                      Include all
                    </button>
                  )}
                  {included > 0 && (
                    <button className="link" onClick={() => onSetAll(false)}>
                      Clear
                    </button>
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="rail-body">
            {scan?.truncated && !loading && (
              <div className="warning">
                GitHub returned {total} of {scan.totalCommits} commits. Choose a later starting point to see the rest.
              </div>
            )}
            {loading || !scan ? (
              <ul className="changes" aria-hidden>
                {[72, 88, 64, 80, 56, 76, 68].map((w, i) => (
                  <li key={i} className="skeleton">
                    <span className="sk-box" />
                    <span className="sk-lines">
                      <span className="sk-line" style={{ width: `${w}%` }} />
                      <span className="sk-line short" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : total === 0 ? (
              <p className="rail-note">Nothing has changed since then.</p>
            ) : (
              <ul className="changes">
                {[...scan.commits].reverse().map((c) => {
                  const { kind, text } = readableTitle(c.pr?.title ?? firstLine(c.message))
                  const off = excluded.has(c.sha)
                  return (
                    <li key={c.sha} className={`change${off ? ' off' : ''}`}>
                      <label>
                        <input type="checkbox" checked={!off} onChange={() => onToggle(c.sha)} />
                        <span className="change-text">
                          <span className="change-title">{text}</span>
                          <span className="change-meta">
                            {kind && <span className={`kind ${kind}`}>{KIND_LABEL[kind]}</span>}
                            <a href={c.pr?.url ?? c.url} target="_blank" rel="noreferrer">
                              {c.pr ? `#${c.pr.number}` : c.sha.slice(0, 7)}
                            </a>
                            <span>{shortDate(c.date)}</span>
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="rail-body">
          <p className="rail-note">
            Claude copies the style of these. They’re earlier versions of the notes file, as approved.
          </p>
          {scan && scan.history.length > 0 ? (
            <div className="past">
              {scan.history.map((h) => (
                <div key={h.sha} className="past-item">
                  <div className="when">
                    <a href={h.url} target="_blank" rel="noreferrer">
                      {shortDate(h.date)}
                    </a>
                  </div>
                  <pre>{h.notes}</pre>
                </div>
              ))}
            </div>
          ) : (
            <p className="rail-note faint">None yet. Your first approved notes will appear here.</p>
          )}
        </div>
      )}
    </aside>
  )
}

const KIND_LABEL = { new: 'New', fix: 'Fix', internal: 'Internal' } as const
