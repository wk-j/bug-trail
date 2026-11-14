# bug-trail/v1 format

A trail is one UTF-8 JSON file per issue. `bug-trail validate FILE` checks it; this page explains
the rules.

## Top level

| Field            | Type            | Required | Notes |
|------------------|-----------------|----------|-------|
| `format`         | `"bug-trail/v1"`| yes      | |
| `analyzed_at`    | ISO date-time   | yes      | When you wrote the analysis. |
| `analyzed_by`    | string          | no       | Agent and model, for example `"Claude Code (claude-opus-5-5)"`. |
| `issue`          | object          | yes      | See below. |
| `summary`        | object          | yes      | See below. |
| `nodes`          | Node[]          | yes      | At least one. |
| `edges`          | Edge[]          | yes      | May be empty. |
| `story`          | string[]        | no*      | Node ids of the main storyline, in order. *Warned if missing. |
| `open_questions` | string[]        | no       | Things still unknown. |
| `next_steps`     | string[]        | no       | Concrete actions that would move the bug forward. |

### `issue`

`url`, `repo` (`"owner/name"`), `number` (integer), `title`, `state` (`open` | `closed`) are
required. Optional: `author`, `created_at`, `closed_at`, `labels` (string[]), `assignees` (string[]).

### `summary`

| Field        | Values |
|--------------|--------|
| `headline`   | One sentence that names the bug in plain words, such as "Uploads over 2 GB fail because the size is stored in a 32-bit int". |
| `tldr`       | Two to four sentences: what breaks, why, and where it stands. |
| `status`     | `new`, `investigating`, `root_caused`, `fix_in_progress`, `fixed`, `wont_fix`, `duplicate`, `cannot_reproduce` |
| `severity`   | `critical`, `high`, `medium`, `low` |
| `confidence` | 0–1. How sure you are of the root cause and status. |

## Nodes

```json
{
  "id": "rc1",
  "kind": "root_cause",
  "title": "Content-Length is parsed into an int32",
  "detail": "Longer explanation. Plain text; `backticks` render as code; blank lines split paragraphs.",
  "status": "confirmed",
  "at": "2026-03-04T10:12:00Z",
  "actor": "octocat",
  "refs": [{ "label": "comment by octocat", "url": "https://github.com/o/r/issues/1#issuecomment-123" }]
}
```

`kind` decides the column (lane) the node sits in, left to right:

| Lane             | Kinds |
|------------------|-------|
| **Reported**     | `report` (the original issue), `environment` (OS, version, config) |
| **Observed**     | `symptom` (what goes wrong, error messages, repro steps) |
| **Investigated** | `hypothesis`, `evidence` (logs, bisect results, experiments), `question` |
| **Root cause**   | `root_cause`, `code` (a file and line or function that is involved) |
| **Resolution**   | `fix` (the idea of the fix), `pr`, `commit`, `workaround` |
| **Verified**     | `verification` (test added, release shipped, reporter confirmed) |

`status`: `confirmed` (stated or shown by evidence), `likely` (strong inference), `open` (not
known yet), `rejected` (ruled out), `done` (a PR merged, a commit landed, a release shipped).

`at` is when it happened (the comment time, the merge time), not when you wrote it. For a node you
put together from several sources (a root cause nobody stated in one comment), use the time of the
source that first established it, or leave `at` out.

`actor` is the GitHub login of whoever made it happen. A bot counts (`dependabot[bot]`).

Which kind fits:
- An open follow-up PR that isn't the fix: `pr` with status `open`.
- A related issue or duplicate: `evidence`, with a ref to that issue.
- A hypothesis that was ruled out: keep it as `hypothesis` with status `rejected`, and add a
  `refutes` edge from whatever ruled it out. That can be an `evidence` node, a `root_cause`, or a
  later `hypothesis` that replaced it.

## Edges

```json
{ "from": "ev2", "to": "h1", "relation": "refutes", "note": "Same crash with the cache disabled" }
```

| Relation     | Read as |
|--------------|---------|
| `leads_to`   | A led someone to B (the general "next step in the story") |
| `causes`     | A causes B (root cause → symptom, code → root cause) |
| `supports`   | Evidence A supports hypothesis B |
| `refutes`    | Evidence A rules out hypothesis B |
| `fixes`      | PR or commit A fixes root cause or symptom B |
| `mitigates`  | Workaround A softens B without fixing it |
| `implements` | Commit or PR A implements fix idea B |
| `verifies`   | Verification A proves fix B |
| `blocks`     | A blocks progress on B |
| `relates`    | Anything else |

`note` is optional. The viewer shows it when someone hovers over the edge.

## Minimal complete example

```json
{
  "format": "bug-trail/v1",
  "analyzed_at": "2026-11-14T09:00:00Z",
  "analyzed_by": "Claude Code (claude-opus-5-5)",
  "issue": { "url": "https://github.com/o/r/issues/1", "repo": "o/r", "number": 1,
             "title": "Crash on save", "state": "closed" },
  "summary": { "headline": "Saving a file with an emoji name crashes the app",
               "tldr": "The filename is truncated by bytes, not characters. Fixed in #2.",
               "status": "fixed", "severity": "high", "confidence": 0.9 },
  "nodes": [
    { "id": "r", "kind": "report", "title": "App crashes on save",
      "refs": [{ "label": "issue", "url": "https://github.com/o/r/issues/1" }] },
    { "id": "rc", "kind": "root_cause", "title": "Name truncated mid-codepoint", "status": "confirmed",
      "refs": [{ "label": "PR #2", "url": "https://github.com/o/r/pull/2" }] },
    { "id": "pr", "kind": "pr", "title": "Truncate by grapheme", "status": "done",
      "refs": [{ "label": "PR #2", "url": "https://github.com/o/r/pull/2" }] }
  ],
  "edges": [
    { "from": "rc", "to": "r", "relation": "causes" },
    { "from": "pr", "to": "rc", "relation": "fixes" }
  ],
  "story": ["r", "rc", "pr"]
}
```
