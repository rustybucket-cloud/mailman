// Types shared by the main process, preload bridge, and renderer.

export interface RepoConfig {
  /** Branch releases are cut from. Empty means the repo's default branch. */
  branch: string
  /** Path of the release notes file inside the repo, e.g. a Play Store whatsnew file. */
  notesPath: string
  /** Character limit for the notes (Google Play caps "What's new" at 500). */
  maxLength: number
  /** Who reads the notes. Shapes tone and what counts as user-visible. */
  audience: string
  /** Free-form writing rules from the PM. */
  styleGuide: string
  /** How many past releases to show Claude as examples. */
  historyCount: number
  /** Optional Claude Code model alias or ID. Empty uses the user's default. */
  model: string
}

export interface PullRequestInfo {
  number: number
  title: string
  body: string
  url: string
  labels: string[]
}

export interface Commit {
  sha: string
  message: string
  author: string
  date: string
  url: string
  pr: PullRequestInfo | null
}

export interface PastRelease {
  sha: string
  date: string
  notes: string
  url: string
}

export type BoundaryKind = 'notes' | 'tag' | 'manual' | 'none'

export interface ReleaseBoundary {
  kind: BoundaryKind
  /** Commit-ish the next release starts after. Null when nothing was found. */
  ref: string | null
  label: string
}

export interface RepoState {
  slug: string
  defaultBranch: string
  config: RepoConfig
  /** True when the repo ships a .mailman.json. */
  hasRepoConfig: boolean
  /** True when this machine has local overrides saved for the repo. */
  hasLocalConfig: boolean
}

export interface ScanResult {
  boundary: ReleaseBoundary
  commits: Commit[]
  /** True when GitHub returned fewer commits than exist in the range. */
  truncated: boolean
  totalCommits: number
  history: PastRelease[]
  currentNotes: string | null
}

export interface Draft {
  notes: string
  reviewerNote: string
  /** Agent SDK session, resumed by refine so Claude keeps its context. */
  sessionId: string
}

/** Live updates while a draft is being written. */
export interface DraftProgress {
  /** The notes so far, as Claude writes them. */
  notes?: string
  /** What Claude is doing, e.g. reading a PR's diff. */
  activity?: string
}

export interface ToolStatus {
  ok: boolean
  detail: string
}

export interface EnvStatus {
  gh: ToolStatus
  claude: ToolStatus
}

export interface GenerateRequest {
  slug: string
  config: RepoConfig
  commits: Commit[]
  history: PastRelease[]
}

export interface RefineRequest {
  slug: string
  /** Session from the last draft. Without one, the full context is sent again. */
  sessionId: string | null
  config: RepoConfig
  commits: Commit[]
  history: PastRelease[]
  draft: string
  instruction: string
}

export interface OpenPrRequest {
  slug: string
  config: RepoConfig
  notes: string
  reviewerNote: string
  commits: Commit[]
}

export interface MailmanApi {
  env: { check(): Promise<EnvStatus> }
  repos: {
    list(): Promise<string[]>
    add(input: string): Promise<{ repos: string[]; slug: string }>
    remove(slug: string): Promise<string[]>
  }
  repo: {
    load(slug: string): Promise<RepoState>
    saveConfig(slug: string, config: RepoConfig): Promise<RepoState>
    resetConfig(slug: string): Promise<RepoState>
  }
  release: {
    scan(slug: string, config: RepoConfig, sinceRef?: string): Promise<ScanResult>
    generate(req: GenerateRequest): Promise<Draft>
    refine(req: RefineRequest): Promise<Draft>
    openPr(req: OpenPrRequest): Promise<{ url: string }>
    /** Stops the draft in progress, if any. */
    cancel(): Promise<void>
    /** Subscribes to live draft updates. Returns an unsubscribe function. */
    onProgress(cb: (p: DraftProgress) => void): () => void
  }
  openExternal(url: string): Promise<void>
}
