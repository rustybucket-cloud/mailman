# Mailman

Mailman is a desktop app that drafts release notes from your GitHub history with Claude Code. You review and edit the draft, then Mailman delivers it as a pull request. Merging the PR approves the notes.

It runs on the tools you already have: your signed-in [GitHub CLI](https://cli.github.com) and [Claude Code](https://claude.com/claude-code), driven through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview). Mailman stores no tokens and needs no local clone of the repo.

## How it works

1. **Finds the last release.** By default that's the last commit that changed the notes file on your release branch. If the file has no history yet, Mailman uses the most recent tag. You can also enter any tag, branch, or SHA.
2. **Collects what changed.** It lists every commit since that point, with the merged PR's title, description, and labels. Untick anything you want left out.
3. **Drafts with Claude.** Claude gets the changes, your audience and style guide, and recent past releases. When a change's description is too vague, it reads the PR or commit diff through two read-only GitHub tools. The draft streams into the editor as Claude writes it, and you can cancel at any point. If the result is over the character limit, Claude shortens it. It also explains what it left out.
4. **You edit.** Change the text directly, or ask for revisions like "shorter" or "lead with the camera fix." Revisions continue the same Claude session, so Claude still has the diffs it read and its earlier reasoning.
5. **Delivers a PR.** Mailman creates a branch that updates the notes file and opens a pull request. Anyone can still edit the wording in the PR. Merging it approves the notes and becomes the boundary for the next release.

### It learns your PM's style

Past releases are the previous versions of the notes file in git, after the PM's edits. Mailman sends the most recent few to Claude as examples, so each draft gets closer to how your PM writes. You don't need a separate history store.

## Requirements

- `gh`, signed in (`gh auth login`), with permission to push branches and open PRs on the repo
- `claude` (Claude Code), installed and signed in. Mailman uses your installed copy and its sign-in
- Node.js 22 or later (only for building from source)

## Getting started

```sh
git clone <this repo> mailman && cd mailman
npm install
npm run dev
```

Add a repository in the sidebar as `owner/repo` or a GitHub URL. Open **Settings** to set the notes file path and audience.

To build a distributable app (`.dmg`, AppImage, or installer):

```sh
npm run dist
```

## Shared settings: `.mailman.json`

Commit a `.mailman.json` to the repo's default branch so everyone who uses Mailman gets the same settings. Every field is optional. Settings changed in the app are saved on that computer and override the file.

```json
{
  "branch": "main",
  "notesPath": "release-notes/whatsnew-en-US",
  "maxLength": 500,
  "audience": "Field auditors using the Android app",
  "styleGuide": "Start with the most visible change. Short bullets, no jargon, no exclamation marks.",
  "historyCount": 5,
  "model": ""
}
```

| Field | Default | Meaning |
|---|---|---|
| `branch` | repo default branch | Branch releases are cut from, and the PR's base |
| `notesPath` | `release-notes/whatsnew-en-US` | Notes file to write |
| `maxLength` | `500` | Character limit. Google Play's "What's new" field allows 500 |
| `audience` | `People who use the app` | Who reads the notes |
| `styleGuide` | empty | The PM's writing rules. These override everything else |
| `historyCount` | `5` | Number of past releases sent to Claude as examples |
| `model` | Claude Code default | Model alias or ID passed to `claude --model` |

## Example: Google Play

[`upload-google-play`](https://github.com/r0adkll/upload-google-play) reads release notes from a `whatsNewDirectory`. Point `notesPath` at a file in that directory and include it in your upload step:

```yaml
- uses: r0adkll/upload-google-play@v1
  with:
    serviceAccountJsonPlainText: ${{ secrets.SERVICE_ACCOUNT_JSON }}
    packageName: com.example.app
    releaseFiles: app-release.aab
    track: beta
    whatsNewDirectory: release-notes
```

Merging the notes PR then ships a build that carries the approved notes.

## How Mailman uses Claude Code

Drafts go through the Agent SDK, pointed at your installed `claude`. Mailman uses your Claude Code sign-in: a Claude subscription, `ANTHROPIC_API_KEY`, Bedrock, or Vertex. It also uses the default `model` from `~/.claude/settings.json`, unless you set one in Mailman.

Everything else is kept separate from your own Claude Code setup. Sessions run in an empty folder inside Mailman's app data. They load no hooks, plugins, MCP servers, or CLAUDE.md files, and have no built-in tools. The only tools are Mailman's two read-only diff tools. Each draft stops at 20 turns or $3.

Anthropic doesn't let third-party products offer claude.ai sign-in or subscription limits to their users without approval ([Agent SDK docs](https://code.claude.com/docs/en/agent-sdk/overview)). Mailman is meant to run on your own Claude Code setup. If you distribute it to others, have them use API-key, Bedrock, or Vertex auth.

## Privacy

- Mailman sends commit messages, PR titles and descriptions, and past notes to Claude through your own Claude Code. Claude only sees source code when it reads a diff with the GitHub tools.
- All GitHub access goes through `gh api` using your existing sign-in.
- Local settings are saved in the app's data folder (`mailman.json`).

## Development

```sh
npm run dev        # run with hot reload
npm test           # unit tests (vitest)
npm run typecheck
```

| Path | Contents |
|---|---|
| `src/main/github.ts` | GitHub access via `gh api` |
| `src/main/claude.ts` | Agent SDK session: options, GitHub diff tools, streaming |
| `src/main/notes.ts` | Prompts and pure helpers (unit tested) |
| `src/main/release.ts` | Release workflow: scan, generate, refine, cancel, open PR |
| `src/renderer/` | React UI |

**Troubleshooting:** if `npm run dev` fails with "Electron uninstall", your npm skipped Electron's install script. Run `node node_modules/electron/install.js`.

## License

MIT
