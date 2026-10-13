import { useEffect, useState } from 'react'
import type { EnvStatus } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { RepoView } from './components/RepoView'
import { AddRepoForm } from './components/AddRepoForm'

export function App() {
  const [env, setEnv] = useState<EnvStatus | null>(null)
  const [repos, setRepos] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const recheck = () => void window.mailman.env.check().then(setEnv)

  useEffect(() => {
    recheck()
    void window.mailman.repos.list().then((list) => {
      setRepos(list)
      setSelected((s) => s ?? list[0] ?? null)
    })
  }, [])

  function onReposChange(list: string[], added?: string) {
    setRepos(list)
    if (added) setSelected(added)
    else if (selected && !list.includes(selected)) setSelected(list[0] ?? null)
  }

  const ready = env?.gh.ok && env?.claude.ok

  return (
    <div className="app">
      <Sidebar
        env={env}
        repos={repos ?? []}
        selected={selected}
        onSelect={setSelected}
        onReposChange={onReposChange}
      />
      <main className="main">
        {!env || !repos ? (
          <div className="center drag" />
        ) : !ready ? (
          <Setup env={env} onRecheck={recheck} />
        ) : selected ? (
          <RepoView key={selected} slug={selected} />
        ) : (
          <div className="center drag">
            <div className="center-card">
              <h2>Add your first repository</h2>
              <p>
                Mailman drafts release notes from the repository’s merged pull requests, then sends them to your
                team for approval as a pull request.
              </p>
              <AddRepoForm autoFocus onAdded={onReposChange} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function Setup({ env, onRecheck }: { env: EnvStatus; onRecheck(): void }) {
  const items = [
    { name: 'GitHub CLI', status: env.gh },
    { name: 'Claude Code', status: env.claude }
  ]
  return (
    <div className="center drag">
      <div className="center-card">
        <h2>Two things to set up</h2>
        <p>Mailman works through your own GitHub CLI and Claude Code sign-ins. It doesn’t store any accounts itself.</p>
        <ul className="checklist">
          {items.map(({ name, status }) => (
            <li key={name} className={status.ok ? 'ok' : 'bad'}>
              <span className="mark">{status.ok ? '✓' : '!'}</span>
              <div>
                <strong>{name}</strong>
                <span className="detail">{status.detail}</span>
              </div>
            </li>
          ))}
        </ul>
        <button className="btn" onClick={onRecheck}>
          Check again
        </button>
      </div>
    </div>
  )
}
