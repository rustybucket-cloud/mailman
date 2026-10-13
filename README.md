<img src="build/icon.png" alt="" width="128" align="right">

# Mailman

A desktop app that drafts release notes from your GitHub history with Claude Code and delivers them as a pull request.

## Requirements

- [GitHub CLI](https://cli.github.com), signed in (`gh auth login`)
- [Claude Code](https://claude.com/claude-code), signed in
- Node.js 22+

## Usage

```sh
git clone https://github.com/rustybucket-cloud/mailman.git && cd mailman
npm install
npm run dev
```

Build a distributable app with `npm run dist`.

## License

MIT
