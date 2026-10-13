import { useState } from 'react'
import type { EnvStatus, ToolStatus } from '@shared/types'
import { AddRepoForm } from './AddRepoForm'
import { CloseIcon, EnvelopeIcon, PlusIcon } from './icons'

interface Props {
  env: EnvStatus | null
  repos: string[]
  /** Repos with an unsent draft. */
  drafted: Set<string>
  selected: string | null
  onSelect(slug: string): void
  onReposChange(list: string[], added?: string): void
}

export function Sidebar({ env, repos, drafted, selected, onSelect, onReposChange }: Props) {
  const [adding, setAdding] = useState(false)

  async function remove(slug: string) {
    if (!confirm(`Remove ${slug} from Mailman? Its local settings will be deleted.`)) return
    onReposChange(await window.mailman.repos.remove(slug))
  }

  return (
    <aside className="sidebar drag">
      <div className="brand">
        <span className="brand-mark">
          <EnvelopeIcon />
        </span>
        Mailman
      </div>

      <ul className="repo-list">
        {repos.map((slug) => {
          const [owner, name] = slug.split('/')
          return (
            <li key={slug} className={`repo-item${slug === selected ? ' active' : ''}`}>
              <button className="repo" onClick={() => onSelect(slug)} title={slug}>
                <span className="repo-name">{name}</span>
                <span className="repo-owner">
                  {owner}
                  {drafted.has(slug) && <span className="repo-draft"> · Draft</span>}
                </span>
              </button>
              <button className="icon-btn remove" onClick={() => void remove(slug)} aria-label={`Remove ${slug}`}>
                <CloseIcon />
              </button>
            </li>
          )
        })}
      </ul>

      {repos.length > 0 && (
        <div className="add-repo">
          {adding ? (
            <AddRepoForm
              compact
              autoFocus
              onCancel={() => setAdding(false)}
              onAdded={(list, slug) => {
                setAdding(false)
                onReposChange(list, slug)
              }}
            />
          ) : (
            <button className="btn quiet add-trigger" onClick={() => setAdding(true)}>
              <PlusIcon /> Add repository
            </button>
          )}
        </div>
      )}

      {env && (
        <div className="sidebar-foot">
          <Tool name="GitHub CLI" status={env.gh} />
          <Tool name="Claude Code" status={env.claude} />
        </div>
      )}
    </aside>
  )
}

function Tool({ name, status }: { name: string; status: ToolStatus }) {
  return (
    <div className={`tool ${status.ok ? 'ok' : 'bad'}`} title={status.detail}>
      <span className="dot" /> {name}
    </div>
  )
}
