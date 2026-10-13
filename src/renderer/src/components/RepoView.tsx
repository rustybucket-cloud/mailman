import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Commit, RepoConfig, RepoState, SavedDraft, ScanResult } from '@shared/types'
import { errorMessage } from '../util'
import { SettingsDialog } from './SettingsDialog'
import { Rail } from './Rail'
import { DraftEditor, type EditorDraft } from './DraftEditor'
import { SlidersIcon } from './icons'

interface Props {
  slug: string
  /** Called when the repo's saved draft is written or discarded. */
  onDraftChange(slug: string, saved: boolean): void
}

export function RepoView({ slug, onDraftChange }: Props) {
  const [repo, setRepo] = useState<RepoState | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<EditorDraft | null>(null)
  /** Last draft written to disk, as a draftKey. */
  const lastSaved = useRef<string | null>(null)
  const pendingSave = useRef<(() => void) | null>(null)

  const runScan = useCallback(
    async (config: RepoConfig, sinceRef?: string, keepExcluded: string[] = []) => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.mailman.release.scan(slug, config, sinceRef)
        setScan(result)
        setExcluded(new Set(keepExcluded.filter((sha) => result.commits.some((c) => c.sha === sha))))
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setLoading(false)
      }
    },
    [slug]
  )

  useEffect(() => {
    void (async () => {
      try {
        const [state, saved] = await Promise.all([window.mailman.repo.load(slug), window.mailman.drafts.get(slug)])
        if (saved) {
          setDraft({ notes: saved.notes, reviewerNote: saved.reviewerNote, sessionId: saved.sessionId })
          lastSaved.current = draftKey(saved)
        }
        setRepo(state)
        // Pick up where the draft left off: same starting point, same changes left out.
        await runScan(state.config, saved?.sinceRef ?? undefined, saved?.excluded)
      } catch (err) {
        setError(errorMessage(err))
        setLoading(false)
      }
    })()
  }, [slug, runScan])

  const included = useMemo<Commit[]>(
    () => scan?.commits.filter((c) => !excluded.has(c.sha)) ?? [],
    [scan, excluded]
  )

  // Autosaves the draft along with the range and selection it was written from.
  const sinceRef = scan?.boundary.kind === 'manual' ? scan.boundary.ref : null

  useEffect(() => {
    if (!scan || loading) return
    const content = draft && { ...draft, sinceRef, excluded: [...excluded] }
    const key = content && draftKey(content)
    if (key === lastSaved.current) {
      pendingSave.current = null
      return
    }
    const write = () => {
      pendingSave.current = null
      lastSaved.current = key
      void (content
        ? window.mailman.drafts.save(slug, { ...content, updatedAt: new Date().toISOString() })
        : window.mailman.drafts.discard(slug))
      onDraftChange(slug, !!content)
    }
    pendingSave.current = write
    const timer = setTimeout(write, 400)
    return () => clearTimeout(timer)
  }, [slug, scan, loading, draft, sinceRef, excluded, onDraftChange])

  // Switching repos mid-edit still saves the last keystrokes.
  useEffect(() => () => pendingSave.current?.(), [])

  async function saveSettings(config: RepoConfig | null) {
    const state = config
      ? await window.mailman.repo.saveConfig(slug, config)
      : await window.mailman.repo.resetConfig(slug)
    setRepo(state)
    setSettingsOpen(false)
    await runScan(state.config)
  }

  const [owner, name] = slug.split('/')
  const branch = repo ? repo.config.branch || repo.defaultBranch : null

  return (
    <>
      <header className="topbar drag">
        <div>
          <h1>
            <span className="owner">{owner} / </span>
            {name}
          </h1>
        </div>
        <button className="btn quiet" onClick={() => setSettingsOpen(true)} disabled={!repo}>
          <SlidersIcon /> Settings
        </button>
      </header>

      <div className="workspace">
        <section className="composer">
          <div className="composer-inner">
            {error && <div className="banner">{error}</div>}
            {repo && (
              <DraftEditor
                key={scan?.boundary.ref ?? 'none'}
                slug={slug}
                config={repo.config}
                commits={included}
                history={scan?.history ?? []}
                branch={branch ?? ''}
                ready={!loading && !!scan}
                initial={draft}
                onChange={setDraft}
              />
            )}
          </div>
        </section>

        <Rail
          scan={scan}
          loading={loading}
          excluded={excluded}
          onToggle={(sha) =>
            setExcluded((prev) => {
              const next = new Set(prev)
              if (next.has(sha)) next.delete(sha)
              else next.add(sha)
              return next
            })
          }
          onSetAll={(on) => setExcluded(on || !scan ? new Set() : new Set(scan.commits.map((c) => c.sha)))}
          onChangeRange={(ref) => repo && void runScan(repo.config, ref)}
        />
      </div>

      {settingsOpen && repo && (
        <SettingsDialog repo={repo} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
      )}
    </>
  )
}

function draftKey(d: Omit<SavedDraft, 'updatedAt'>): string {
  const { notes, reviewerNote, sessionId, sinceRef, excluded } = d
  return JSON.stringify({ notes, reviewerNote, sessionId, sinceRef, excluded })
}
