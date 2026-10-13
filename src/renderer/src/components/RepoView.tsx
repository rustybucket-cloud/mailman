import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Commit, RepoConfig, RepoState, ScanResult } from '@shared/types'
import { errorMessage } from '../util'
import { SettingsDialog } from './SettingsDialog'
import { Rail } from './Rail'
import { DraftEditor } from './DraftEditor'
import { SlidersIcon } from './icons'

export function RepoView({ slug }: { slug: string }) {
  const [repo, setRepo] = useState<RepoState | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const runScan = useCallback(
    async (config: RepoConfig, sinceRef?: string) => {
      setLoading(true)
      setError(null)
      try {
        setScan(await window.mailman.release.scan(slug, config, sinceRef))
        setExcluded(new Set())
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
        const state = await window.mailman.repo.load(slug)
        setRepo(state)
        await runScan(state.config)
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
