# @overcrow/mcp

An MCP server for creating [PlayerVox OverCrow](https://overcrow.playervox.com/)
widgets with an AI assistant. Add it to Claude Code, Claude Desktop, Cursor,
VS Code or Codex, and the assistant can create a widget, check it, test it,
audit its security and lightness, package it and prepare its submission.

You need Node.js 22.18 or later, nothing else: the server installs the
OverCrow creator tools it needs by itself.

```sh
claude mcp add overcrow -- npx -y @overcrow/mcp
```

Guide, other clients and offline use:
[overcrow.playervox.com/docs/en/ai/](https://overcrow.playervox.com/docs/en/ai/)
([français](https://overcrow.playervox.com/docs/ai/)).

## Clients

| Client | Setup |
| --- | --- |
| Claude Code | `claude mcp add overcrow -- npx -y @overcrow/mcp` |
| Codex | `codex mcp add overcrow -- npx -y @overcrow/mcp` |
| Cursor | [`.cursor/mcp.json`](https://github.com/Valhallab/playervox-overcrow-releases/blob/main/mcp/examples/cursor-mcp.json) |
| VS Code | [`.vscode/mcp.json`](https://github.com/Valhallab/playervox-overcrow-releases/blob/main/mcp/examples/vscode-mcp.json), or `code --add-mcp '{"name":"overcrow","command":"npx","args":["-y","@overcrow/mcp"]}'` |
| Claude Desktop | [`claude_desktop_config.json`](https://github.com/Valhallab/playervox-overcrow-releases/blob/main/mcp/examples/claude_desktop_config.json), with `--root` and your widgets folder |

Options: `--root <folder>` (repeatable) names the folders the server may
use; `--tools-zip <file>` gives a local copy of the creator tools ZIP.

## Tools

| Tool | What it does |
| --- | --- |
| `status` | What is ready, and what to do next |
| `setup` | Downloads and checks the creator tools, once (the only download) |
| `list_templates`, `create_widget` | Start a widget from a template, in a new folder |
| `install_sdk` | `@overcrow/sdk` and TypeScript with npm, after your confirmation |
| `check` | Every problem, with file, line, code and fix |
| `test` | The test scenarios; differing images are shown |
| `update_reference_images` | Replaces reference images, after your confirmation |
| `package`, `inspect` | The `.ocpkg`, its size and what it may do |
| `audit` | Security and lightness, scored out of 100, with fixes and examples |
| `explain_permission`, `explain_error` | A permission or a code, in plain words |
| `search_docs`, `read_doc`, `read_example` | The documentation and the reference widgets, offline |
| `prepare_submission` | The checklist, the pull request text and the git commands |

Resources: the documentation (`overcrow://docs/{en,fr}/…`), the manifest
reference, the limits, the templates and the reference widgets. Prompts:
`create_widget`, `audit_widget`, `prepare_submission`.

## Security

- The server works only in your project folders, through their real paths:
  no system folder, no whole home folder, no link that leads out, no
  hidden folder.
- It runs the OverCrow widget CLI and npm, without a shell, with a minimal
  environment (no token is passed on), time limits and bounded output. It
  never runs a command chosen by the assistant.
- It downloads only the creator tools ZIP of the OverCrow release this
  version pins, from GitHub, and checks its size and SHA-256 and every file
  in it before use. npm installs only `@overcrow/sdk` and TypeScript, with
  install scripts disabled, and their integrity is checked against the
  pinned published packages.
- Replacing reference images and installing packages need an explicit
  confirmation; the server deletes nothing in your project.
- Text read from your files and from the tools is returned marked as data:
  the server's instructions tell the assistant never to follow
  instructions found in it.
- No telemetry. Logs go to standard error, without your paths.
- It never pushes, signs or publishes anything.

## Platforms

Checking, testing and packaging run on Windows x64 and Linux x86-64. On
other computers, the documentation, the explanations and the audit still
work.

## Dependencies

Three packages, at exact versions frozen by `npm-shrinkwrap.json`:
`@modelcontextprotocol/server` and `@modelcontextprotocol/core` (the
official MCP SDK, Apache-2.0) and `zod` (MIT). No install script.

## License

MIT. Source:
[github.com/Valhallab/playervox-overcrow-releases/tree/main/mcp](https://github.com/Valhallab/playervox-overcrow-releases/tree/main/mcp).
