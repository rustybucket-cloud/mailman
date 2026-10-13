import { useEffect, useRef, useState } from 'react'
import type { RepoConfig, RepoState } from '@shared/types'
import { errorMessage } from '../util'

interface Props {
  repo: RepoState
  onClose(): void
  /** Saves overrides on this computer, or clears them when given null. */
  onSave(config: RepoConfig | null): Promise<void>
}

export function SettingsDialog({ repo, onClose, onSave }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [config, setConfig] = useState<RepoConfig>(repo.config)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  const set = <K extends keyof RepoConfig>(key: K, value: RepoConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }))

  async function save(next: RepoConfig | null) {
    setSaving(true)
    setError(null)
    try {
      await onSave(next)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <dialog ref={ref} className="settings" onClose={onClose} onCancel={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(config)
        }}
      >
        <header>
          <h2>Settings for {repo.slug.split('/')[1]}</h2>
          <p>
            {repo.hasRepoConfig
              ? 'Defaults come from .mailman.json in the repository. Changes here apply on this computer only.'
              : 'These apply on this computer only. Commit a .mailman.json to share them with your team.'}
          </p>
        </header>

        <div className="fields">
          <label className="field wide">
            <span>Notes file</span>
            <input value={config.notesPath} onChange={(e) => set('notesPath', e.target.value)} required />
            <small>The file the pull request updates, such as a Play Store whatsnew file.</small>
          </label>
          <label className="field">
            <span>Release branch</span>
            <input
              value={config.branch}
              onChange={(e) => set('branch', e.target.value)}
              placeholder={repo.defaultBranch}
            />
          </label>
          <label className="field">
            <span>Character limit</span>
            <input
              type="number"
              min={50}
              value={config.maxLength}
              onChange={(e) => set('maxLength', Number(e.target.value))}
            />
          </label>
          <label className="field wide">
            <span>Who reads the notes</span>
            <input value={config.audience} onChange={(e) => set('audience', e.target.value)} />
          </label>
          <label className="field wide">
            <span>Style guide</span>
            <textarea
              rows={4}
              value={config.styleGuide}
              onChange={(e) => set('styleGuide', e.target.value)}
              placeholder="Start with the biggest change. Short bullets. No exclamation marks."
            />
            <small>Claude follows this over anything else.</small>
          </label>
          <label className="field">
            <span>Past notes to learn from</span>
            <input
              type="number"
              min={0}
              max={20}
              value={config.historyCount}
              onChange={(e) => set('historyCount', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Model</span>
            <input value={config.model} onChange={(e) => set('model', e.target.value)} placeholder="Your Claude Code default" />
          </label>
        </div>

        {error && (
          <div className="banner" style={{ margin: '0 24px 12px' }}>
            {error}
          </div>
        )}

        <footer>
          <span>
            {repo.hasLocalConfig && (
              <button type="button" className="link" disabled={saving} onClick={() => void save(null)}>
                Reset to {repo.hasRepoConfig ? 'repository' : 'default'} settings
              </button>
            )}
          </span>
          <span className="right">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </span>
        </footer>
      </form>
    </dialog>
  )
}
