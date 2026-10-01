# CLAUDE.md

How to work in and with this project.

## Documentation layout

| File | Covers |
|---|---|
| `CLAUDE.md` | How we work: project purpose, the developer's background, working rules |
| `design.md` | Game design: what the game does for the player (characters, controls, combat, sessions) |
| `architecture.md` | Architecture: how the system is built (accounts, hosting, security, client/server protocol) |

Keep each topic in its own file; don't mix game design and architecture.

## Purpose of the project

This is a **learning project** about how games work, built as a small co-op
dungeon crawler with an authoritative server and a browser client. The goal is
understanding, not shipping. A clear, simple solution that teaches something
beats a clever or complete one.

## About the developer

- Has a lot of professional experience with on-premise server applications
  (Windows services) and some with client apps (WinForms).
- Has very little web experience and has never run a publicly reachable
  website. The security model of the public internet is new territory.
- Has very little JavaScript experience and has never used JavaScript or
  Node.js on the server.

## Workflow

- **Every change goes through a pull request**, including documentation-only
  changes. Never commit directly to the default branch.
- **All programming work needs a GitHub issue.** Documentation-only changes
  need a PR but no issue. Before writing any code:
  1. Find the existing issue for the work. If there is none, post the draft
     issue text in the chat.
  2. Wait for the user's explicit agreement on the contents, then create the
     issue on GitHub.
  3. Only then start the work, and link the PR to the issue.

  The only exception is when the user explicitly says to skip the issue.
- **One PR per issue.** Splitting one issue over several PRs is an exception.
  Never combine multiple issues in a single PR.
- **The user merges PRs.** Never merge a PR unless the user explicitly asks
  for that.
- **Design conversations produce no code.** When the user wants to talk about
  design, discuss it and update the docs. Don't write or change code until the
  user explicitly asks for an implementation, and then the issue rule above
  applies.

## How to work

- **Everything is in English**: code, comments, docs, issues, PRs and commit
  messages.
- **Explain new web/JS/Node concepts when they come up**, and relate them to
  the .NET/Windows equivalents where there is a good analogy (e.g. the Node
  event loop compared with threads and async/await in .NET).
- **Point out security concerns explicitly.** Anything reachable from the
  internet is hostile by default; call out where web assumptions differ from
  on-prem ones instead of handling them silently.
