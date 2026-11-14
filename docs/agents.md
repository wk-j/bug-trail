# Agents and the skill

Bug Trail never calls an AI model itself. A coding agent (Claude Code, Codex, OpenCode, Pi, or
any agent that can run shell commands) analyzes the issue and writes the trail file; the
dashboard only reads it.

The agent learns how through the **bug-trail skill**. It needs the GitHub CLI (`gh`), logged in,
and the `bug-trail` command.

## Install the skill

```bash
bug-trail skill setup
```

This installs the skill into every agent found on this machine. Claude Code reads
`~/.claude/skills`; Codex, OpenCode and Pi share `~/.agents/skills`, which is written once. If no
agent is found, the skill goes into the shared folder. Running it again is safe and updates an
older install.

Check what is installed with `bug-trail skill status`, and remove it with `bug-trail skill remove`.
See the [command reference](cli.md#bug-trail-skill) for all options, including `--project` to
install into one repository instead of your account.

## How the skill works

The installed skill is a short stub. It tells the agent to run `bug-trail skill show`, which
prints the full guide and the [trail format](../skill/bug-trail/FORMAT.md) from the binary.
Upgrading `bug-trail` therefore updates what agents read, with nothing to reinstall.

The guide asks the agent to:

1. Read the issue, its timeline, and linked PRs and commits with `gh`.
2. Trace the real code path at the commit the bug happened on: the entry point, each call that
   matters, where the bug starts, and where the user sees it.
3. Write the trail: background, the buggy flow and the correct flow, concrete cases, and a short
   investigation. Text is written in the issue's language; code names stay as they are.
4. Check it with `bug-trail validate`.
5. Upload it with `bug-trail push` if a server is [configured](configuration.md).

## Ask for a trail

> Use the bug-trail skill to analyze https://github.com/OWNER/REPO/issues/123

Agents without skill support can be given the same instructions:

```bash
bug-trail prompt https://github.com/OWNER/REPO/issues/123
```

prints a prompt to paste, which tells the agent to run `bug-trail skill show`.

## Where trails go

The agent writes to the trails folder (`bug-trail config get dir`, `~/.bug-trail/trails` by
default). `bug-trail serve` shows that folder, and redraws as soon as a file changes. With a
shared server configured, the agent also uploads the file there.
