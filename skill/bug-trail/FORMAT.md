# bug-trail/v2 format

A trail is one UTF-8 JSON file per issue. `bug-trail validate FILE` checks it; this page explains
the rules. The centrepiece is `flow`, the code path the bug takes, which the dashboard draws as
the map. `nodes` and `edges` record the investigation around it.

## Top level

| Field            | Type            | Required | Notes |
|------------------|-----------------|----------|-------|
| `format`         | `"bug-trail/v2"`| yes      | v1 files (no `flow`) still load, with a warning. |
| `analyzed_at`    | ISO date-time   | yes      | When you wrote the analysis. |
| `language`       | string          | no       | Language of the trail's text, such as `"th"` or `"en"` (default). |
| `analyzed_by`    | string          | no       | Agent and model, for example `"Claude Code (claude-opus-5-5)"`. |
| `issue`          | object          | yes      | See below. |
| `summary`        | object          | yes      | See below. |
| `background`     | object          | no*      | What a reader needs to know first. See below. *Warned if missing. |
| `flow`           | object          | yes      | **The code path.** See below. |
| `nodes`          | Node[]          | no       | The investigation: report, evidence, hypotheses, PRs, release. |
| `edges`          | Edge[]          | no       | Links between investigation nodes. |
| `open_questions` | string[]        | no       | Things still unknown. |
| `next_steps`     | string[]        | no       | Concrete actions that would move the bug forward. |

### `issue`

`url`, `repo` (`"owner/name"`), `number` (integer), `title`, `state` (`open` | `closed`) are
required. Optional: `author`, `created_at`, `closed_at`, `labels` (string[]), `assignees` (string[]).

### `summary`

| Field        | Values |
|--------------|--------|
| `headline`   | One sentence that names the bug and its cause in plain words, such as "Uploads over 2 GB fail because the size is stored in a 32-bit int". |
| `tldr`       | Two to four sentences: what breaks, where in the code, and where it stands. |
| `status`     | `new`, `investigating`, `root_caused`, `fix_in_progress`, `fixed`, `wont_fix`, `duplicate`, `cannot_reproduce` |
| `severity`   | `critical`, `high`, `medium`, `low` |
| `confidence` | 0–1. How sure you are of the origin and status. |

## Background

The page shows this above the map, because nobody can follow the bug without knowing what this
part of the system is for and what it is supposed to do.

```json
"background": {
  "context": "What this part of the system does, in plain words, for someone new to it.",
  "rule": "The rule the code must follow, and where it comes from (spec, CR, reference version).",
  "terms": [{ "term": "tempRpNo", "meaning": "Temporary receipt number from the index file." }],
  "refs": [{ "label": "CR12 item 1", "url": "https://…" }]
}
```

| Field     | Notes |
|-----------|-------|
| `context` | Required. Two short paragraphs at most: the job of this part of the system and how data moves through it. |
| `rule`    | The correct behaviour the bug breaks, stated so the reader can check each case against it. |
| `terms`   | Domain words, field names, codes and abbreviations the steps use. The page underlines each one wherever it appears and shows the meaning on hover, so use the exact spelling the steps use. |
| `refs`    | Where the context and rule come from. |

## Flow

```json
"flow": {
  "title": "What happens when you upload a video",
  "components": [
    { "id": "app",  "name": "Android app", "detail": "apps/android", "kind": "app" },
    { "id": "core", "name": "Upload core", "detail": "core/upload",  "kind": "library" }
  ],
  "steps": [
    { "id": "start", "component": "app", "title": "User shares a 2.4 GB video",
      "location": { "path": "apps/android/src/ShareActivity.kt", "symbol": "onShare", "line": 48,
                    "url": "https://github.com/o/r/blob/SHA/apps/android/src/ShareActivity.kt#L48" } },
    { "id": "plan", "component": "core", "title": "Size stored in a 32-bit int", "role": "origin",
      "location": { "path": "core/upload/chunk_plan.go", "symbol": "ChunkPlan", "line": 14, "url": "…" },
      "snippet": "type ChunkPlan struct {\n\ttotalSize int32\n}",
      "detail": "Why this is wrong. `backticks` render as code; blank lines split paragraphs.",
      "fix": { "label": "PR #151", "url": "https://github.com/o/r/pull/151", "detail": "Use int64." },
      "refs": [{ "label": "bisect result", "url": "…" }] }
  ],
  "edges": [
    { "from": "start", "to": "plan", "kind": "call", "label": "newChunkPlan(size)" }
  ]
}
```

The map draws **both flows in one graph**: what the code should do (`path: "correct"`) and what
it does now (`path: "bug"`), from the steps they share (`path: "both"`, the default) up to where
they split. **Cases** are concrete inputs; picking one lights up the route it takes through each
flow.

**Components** are the boxes on the map. They are placed left to right in call order and grouped
into containers by `group`.

| Field    | Notes |
|----------|-------|
| `id`     | Unique. |
| `name`   | As the codebase names it: "gh CLI", "go-gh pkg/api", "Postgres". |
| `detail` | Optional short label under the name: a repo, package or path. |
| `kind`   | `app`, `library`, `service`, `storage`, `external`, `process`. Defaults to `app`. `storage` and `external` are drawn as dashed cylinders below the code. |
| `group`  | Optional module, repo or service the component belongs to (`cli/go-gh`, `tli-mapping-tool`). Containers are drawn only when there are two or more groups. |

Model **where the document, request or data ends up** as its own component at the end (for
example "DIM import" and "InsureDoc upload"), not as a step back in the component that started.
The map then reads left to right to the outcome.

**Steps** are the map's rows, top to bottom **in execution order**.

| Field       | Notes |
|-------------|-------|
| `id`, `component`, `title` | Required. The title says what happens, in plain words. |
| `path`      | `both` (default: the correct logic and the code agree), `correct` (only what should happen), `bug` (only what the code does now). |
| `role`      | `normal` (default), `origin` (the bug starts here), `propagates` (the bad value or state moves on), `symptom` (the user sees it), `concurrent` (something running at the same time that the bug needs). |
| `location`  | `{ path, symbol?, line?, url? }`. `url` is a permalink at the commit the bug happened on, with `line` the first line of the snippet. Expected on every `origin`, `propagates` and `symptom` step in code. For a `storage` step, `path` can be the on-disk path or the code that names it. |
| `snippet`   | 3–12 lines copied exactly from the file. |
| `detail`    | What happens here and why it matters for the bug. `backticks` render as code and bare URLs become links. A snippet comes from the step's own file; mention call sites in other files here. |
| `fix`       | `{ label, url?, detail? }` on the step the fix changes. |
| `alongside` | The id of an earlier step this one runs at the same time as. Both share a row. |
| `refs`      | `[{label, url}]`: comments, PRs or logs that back the step. |

**Cases** (`flow.cases`) are concrete inputs, each with the route it takes through both flows:

```json
{ "id": "uw-sale-only", "title": "UW · sale number only",
  "input": { "tempRpNo": "", "saleNo": "S00123" },
  "correct": ["offer", "read", "dispatch", "c-decide", "c-request", "c-ask", "c-insuredoc", "c-dim"],
  "bug": ["offer", "read", "dispatch", "decide", "dim"],
  "should": "getProposalNo is called with salesIllustrationNo `S00123`",
  "does": "getProposalNo is never called; filed into DIM",
  "works": false }
```

`correct` may use `both` and `correct` steps; `bug` may use `both` and `bug` steps. Set `works:
true` on a case the code already handles correctly; include at least one such case when there is
one, so the fix is known to keep it.

**Edges** connect steps. If you leave `edges` out, the viewer connects the steps in order.
`kind` is `call`, `data`, `return`, `error` or `concurrent`. `label` is optional, such as a
function call, a value or an HTTP status. It shows on hover.

## Investigation nodes

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

The investigation shows up below the map, as a timeline and in the details drawer. `kind` groups the node:

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
  "format": "bug-trail/v2",
  "analyzed_at": "2026-11-14T09:00:00Z",
  "analyzed_by": "Claude Code (claude-opus-5-5)",
  "issue": { "url": "https://github.com/o/r/issues/1", "repo": "o/r", "number": 1,
             "title": "Crash on save", "state": "closed" },
  "summary": { "headline": "Saving a file with an emoji name crashes because the name is cut by bytes",
               "tldr": "`fs.ShortName` truncates by bytes and splits a multi-byte character. Fixed in #2.",
               "status": "fixed", "severity": "high", "confidence": 0.9 },
  "flow": {
    "title": "What happens when you press Save",
    "components": [{ "id": "ui", "name": "Editor", "kind": "app" },
                   { "id": "fs", "name": "fs package", "kind": "library" }],
    "steps": [
      { "id": "save", "component": "ui", "title": "User presses Save",
        "location": { "path": "ui/save.go", "symbol": "onSave" } },
      { "id": "cut", "component": "fs", "title": "Name cut in the middle of a character", "role": "origin",
        "location": { "path": "fs/name.go", "symbol": "ShortName", "line": 12,
                      "url": "https://github.com/o/r/blob/abc123/fs/name.go#L12" },
        "snippet": "return name[:maxLen]",
        "fix": { "label": "PR #2", "url": "https://github.com/o/r/pull/2" } },
      { "id": "crash", "component": "ui", "title": "App crashes with invalid UTF-8", "role": "symptom",
        "location": { "path": "ui/save.go", "symbol": "onSave", "line": 40 } }
    ]
  },
  "nodes": [
    { "id": "r", "kind": "report", "title": "App crashes on save",
      "refs": [{ "label": "issue", "url": "https://github.com/o/r/issues/1" }] },
    { "id": "pr", "kind": "pr", "title": "Truncate by character", "status": "done",
      "refs": [{ "label": "PR #2", "url": "https://github.com/o/r/pull/2" }] }
  ],
  "edges": [{ "from": "pr", "to": "r", "relation": "fixes" }]
}
```
