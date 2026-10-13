import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { adoptLoginShellPath } from './exec'
import { checkClaude } from './claude'
import { checkGh } from './github'
import * as release from './release'
import * as store from './store'
import type { EnvStatus } from '../shared/types'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Mailman',
    show: false,
    // macOS: content runs under the title bar, with the window buttons over the sidebar.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12161c' : '#e9edf2',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win.show())

  // Links open in the browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== new URL(win.webContents.getURL()).origin) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function isSafeExternal(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

function registerIpc(): void {
  ipcMain.handle('env:check', async (): Promise<EnvStatus> => {
    const [gh, claude] = await Promise.all([checkGh(), checkClaude()])
    return { gh, claude }
  })
  ipcMain.handle('repos:list', () => store.listRepos())
  ipcMain.handle('repos:add', async (_e, input: string) => {
    const slug = release.parseSlug(input)
    await release.loadRepo(slug) // fail fast if the repo doesn't exist or isn't accessible
    return { repos: await store.addRepo(slug), slug }
  })
  ipcMain.handle('repos:remove', (_e, slug: string) => store.removeRepo(slug))
  ipcMain.handle('repo:load', (_e, slug: string) => release.loadRepo(slug))
  ipcMain.handle('repo:saveConfig', (_e, slug, config) => release.saveConfig(slug, config))
  ipcMain.handle('repo:resetConfig', (_e, slug: string) => release.resetConfig(slug))
  ipcMain.handle('release:scan', (_e, slug, config, sinceRef) => release.scan(slug, config, sinceRef))
  ipcMain.handle('release:generate', (e, req) =>
    release.generate(req, (p) => e.sender.send('release:progress', p))
  )
  ipcMain.handle('release:refine', (e, req) =>
    release.refine(req, (p) => e.sender.send('release:progress', p))
  )
  ipcMain.handle('release:cancel', () => release.cancel())
  ipcMain.handle('release:openPr', (_e, req) => release.openPr(req))
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (isSafeExternal(url)) await shell.openExternal(url)
  })
}

app.whenReady().then(async () => {
  await adoptLoginShellPath()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
