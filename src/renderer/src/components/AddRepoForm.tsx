import { useState } from 'react'
import { errorMessage } from '../util'

interface Props {
  onAdded(repos: string[], slug: string): void
  onCancel?(): void
  autoFocus?: boolean
  compact?: boolean
}

export function AddRepoForm({ onAdded, onCancel, autoFocus, compact }: Props) {
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    setAdding(true)
    setError(null)
    try {
      const res = await window.mailman.repos.add(input)
      setInput('')
      onAdded(res.repos, res.slug)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
      <form onSubmit={submit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel?.()}
          placeholder="owner/repo or GitHub URL"
          autoFocus={autoFocus}
          disabled={adding}
          aria-label="Repository"
        />
        {!compact && (
          <button type="submit" className="btn primary" disabled={adding || !input.trim()}>
            {adding ? 'Adding…' : 'Add'}
          </button>
        )}
      </form>
      {compact && !error && <div className="hint">{adding ? 'Checking access…' : 'Press Return to add'}</div>}
      {error && <div className={compact ? 'err' : 'banner'} style={compact ? undefined : { marginTop: 10 }}>{error}</div>}
    </>
  )
}
