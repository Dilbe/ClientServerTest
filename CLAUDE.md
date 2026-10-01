# CLAUDE.md

How to work in and with this project. What the game does and how the system is
built belong in the design docs, not here.

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

## How to work

- **Design conversations produce no code.** When the user wants to talk about
  design, discuss it and update the docs (`CLAUDE.md`, design docs). Don't
  write or change code until the user explicitly asks for an implementation.
- **Explain new web/JS/Node concepts when they come up**, and relate them to
  the .NET/Windows equivalents where there is a good analogy (e.g. the Node
  event loop compared with threads and async/await in .NET).
- **Point out security concerns explicitly.** Anything reachable from the
  internet is hostile by default; call out where web assumptions differ from
  on-prem ones instead of handling them silently.
