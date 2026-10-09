# MCP

PlayerVox OverCrow has a server for AI assistants: `@overcrow/mcp`. Add it
to Claude Code, Claude Desktop, Cursor, VS Code or Codex, and your
assistant can create a widget, check it, test it, audit it, package it and
prepare its submission. You need Node.js 22.18 or later, nothing else: the
server installs the OverCrow tools it needs by itself.

```sh
claude mcp add overcrow -- npx -y @overcrow/mcp
```

Then ask: "Create an OverCrow widget that shows…".

## Add the server

Open your widgets folder in the assistant, then add the server.

### In one command

**Claude Code**, from that folder:

```sh
claude mcp add overcrow -- npx -y @overcrow/mcp
```

**Codex**:

```sh
codex mcp add overcrow -- npx -y @overcrow/mcp
```

**VS Code**: [install in VS Code](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522overcrow%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540overcrow%252Fmcp%2522%255D%257D), or:

```sh
code --add-mcp '{"name":"overcrow","command":"npx","args":["-y","@overcrow/mcp"]}'
```

### With a configuration file

**Cursor**: a `.cursor/mcp.json` file in the folder.

<!-- source: mcp/examples/cursor-mcp.json -->
```json
{
  "mcpServers": {
    "overcrow": {
      "command": "npx",
      "args": ["-y", "@overcrow/mcp"]
    }
  }
}
```

**VS Code**: a `.vscode/mcp.json` file in the folder.

<!-- source: mcp/examples/vscode-mcp.json -->
```json
{
  "servers": {
    "overcrow": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@overcrow/mcp"]
    }
  }
}
```

**Claude Desktop** starts its servers outside your folders: name your
widgets folder with `--root` in `claude_desktop_config.json` (Settings,
Developer, Edit Config), then restart Claude Desktop.

<!-- source: mcp/examples/claude_desktop_config.json -->
```json
{
  "mcpServers": {
    "overcrow": {
      "command": "npx",
      "args": ["-y", "@overcrow/mcp", "--root", "C:\\Users\\you\\Documents\\widgets"]
    }
  }
}
```

## What the server does

- **The first time**, it downloads the OverCrow creator tools of your
  computer (the [command-line tool](cli.md) and the runtime that plays the
  [tests](testing.md), about 15 MB) from OverCrow's GitHub release. It
  checks every file against the digests written in the server, then keeps
  them in its own folder (`~/.cache/overcrow-mcp`, or
  `%LOCALAPPDATA%\overcrow-mcp` on Windows). Nothing goes on your `PATH`,
  and no administrator right is needed.
- **Then** your assistant works with its tools, in this order: create the
  widget from a template, install the SDK (it asks you first), check, test
  (it sees the images that differ), audit, package, prepare the
  submission.
- **The widget ID** is final. Your assistant asks you for it: your
  publisher handle in the OverCrow creator space and a name
  (`valhallab.lol-timers`), or a domain you can verify
  (`gg.valhallab.lol-timers`).
- **The submission**: the server checks everything the creator space asks
  for, then writes the ZIP of your widget's sources to `dist/`, without
  `node_modules`, `dist`, hidden files or keys, and lists what it left out.
  It also lists the texts to write: why the widget needs each permission,
  the release notes and the description in English and French. Your
  assistant drafts them with you.
- **The audit** scores the widget out of 100 for security and for
  lightness, with a fix and an example from a
  [reference widget](widgets.md) for each finding: unused permissions,
  network rules that are too broad, secrets, clipboard writes without a
  user action, fast timers, network polling, lists that never stop
  growing, large responses read in one turn, heavy images.
- **The documentation** of this site, in English and French, and the
  sources of the reference widgets come with the server: your assistant
  reads them without network access.

## What it does not do

- It never sends, signs or publishes anything. You send the ZIP and the
  texts in the OverCrow creator space on overcrow.playervox.com.
- It does not install your widget in OverCrow: trying it in a game is the
  [development channel](dev-channel.md) of the command-line tool.
- It sends nothing about you: no telemetry, no account.

## Security

- **Your folders only.** The server works in the folder open in your
  assistant (or the ones given with `--root`). It refuses a system folder,
  your whole home folder, hidden folders, and links that lead outside.
- **No command of its own choice.** The server runs the OverCrow
  command-line tool and npm, nothing else, never through a shell.
- **Checked downloads.** It downloads only the pinned files from GitHub,
  and checks them before use. npm installs only `@overcrow/sdk` and
  TypeScript, with install scripts disabled, and their integrity is
  checked against the published packages.
- **You confirm.** Installing packages and replacing reference images
  need your agreement.
- **Your files are data.** What the tools return from your files is
  marked as data: a text inside a widget cannot give orders to your
  assistant through the server. Still read what your assistant changes,
  and approve its actions as you usually do.

## Offline

Download `overcrow-creator-tools-VERSION-PLATFORM.zip` of your platform
from OverCrow's GitHub release once, put it in your widgets folder, and ask
your assistant to run `setup` with it (`zipPath`). Or start the server with
`--tools-zip` and the path of the file. The file must be exactly the one
the server pins.

## Supported computers

Checking, testing and packaging need Windows x64 or Linux x86-64. On
macOS and on ARM, the server still gives the documentation, the
explanations and the audit.

## If something goes wrong

- **"not tied to a published OverCrow release"**: update the server with
  `npx -y @overcrow/mcp@latest`.
- **Behind a proxy**: set `HTTPS_PROXY` in the server's environment.
- **"cannot work in /"** (often Claude Desktop): add `--root` and your
  widgets folder.
