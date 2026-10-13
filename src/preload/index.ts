import { contextBridge, ipcRenderer } from 'electron'
import type { DraftProgress, MailmanApi } from '../shared/types'

const api: MailmanApi = {
  env: { check: () => ipcRenderer.invoke('env:check') },
  repos: {
    list: () => ipcRenderer.invoke('repos:list'),
    add: (slug) => ipcRenderer.invoke('repos:add', slug),
    remove: (slug) => ipcRenderer.invoke('repos:remove', slug)
  },
  repo: {
    load: (slug) => ipcRenderer.invoke('repo:load', slug),
    saveConfig: (slug, config) => ipcRenderer.invoke('repo:saveConfig', slug, config),
    resetConfig: (slug) => ipcRenderer.invoke('repo:resetConfig', slug)
  },
  drafts: {
    list: () => ipcRenderer.invoke('drafts:list'),
    get: (slug) => ipcRenderer.invoke('drafts:get', slug),
    save: (slug, draft) => ipcRenderer.invoke('drafts:save', slug, draft),
    discard: (slug) => ipcRenderer.invoke('drafts:discard', slug)
  },
  release: {
    scan: (slug, config, sinceRef) => ipcRenderer.invoke('release:scan', slug, config, sinceRef),
    generate: (req) => ipcRenderer.invoke('release:generate', req),
    refine: (req) => ipcRenderer.invoke('release:refine', req),
    openPr: (req) => ipcRenderer.invoke('release:openPr', req),
    cancel: () => ipcRenderer.invoke('release:cancel'),
    onProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, p: DraftProgress) => cb(p)
      ipcRenderer.on('release:progress', listener)
      return () => ipcRenderer.removeListener('release:progress', listener)
    }
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
}

contextBridge.exposeInMainWorld('mailman', api)
