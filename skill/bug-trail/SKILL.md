---
name: bug-trail
description: Trace a GitHub issue through the application's code — which components and functions run, where the bug starts, how it spreads, and where the user sees it — and write a bug-trail/v2 JSON file that the Bug Trail dashboard draws as a code-flow map. Use when asked to analyze, trace, map or "make a bug trail" for a GitHub issue URL or owner/repo#number.
---

# Bug Trail

You turn one GitHub issue into a **bug trail**. Its centrepiece is the **flow**: the path the
code takes from what the user did to what went wrong. It names the components the path crosses,
the steps in the order they run, and the file and function behind each step. It also marks
**where the bug starts** (`origin`), **how it spreads** (`propagates`), **where the user sees it**
(`symptom`), and where the fix landed. The dashboard draws the flow as a map, so the reader sees
at a glance which part of the code causes the bug.

Next to the flow, the trail keeps a short record of the investigation (hypotheses, evidence, PRs,
release) for context.

This skill works for any agent that can run shell commands. It needs `gh` (logged in) and the
`bug-trail` command, which installed this skill.

## Inputs

- The issue, as a URL (`https://github.com/OWNER/REPO/issues/N`) or `OWNER/REPO#N`.
- Optional: a local clone of the repo. Reading code locally is faster than through the API.

## Output location

Write to `$BUG_TRAIL_DIR/OWNER__REPO__N.json`. If `BUG_TRAIL_DIR` is unset, use
`~/.bug-trail/trails/` (create it). Overwrite an earlier trail for the same issue.

If `BUG_TRAIL_SERVER` is set, the dashboard runs on a shared server. Still write and validate the
file locally, then upload it in step 5. The file name without `.json` becomes the trail's id.

## Steps

### 1. Gather the facts

```bash
gh issue view N -R OWNER/REPO --json number,title,body,state,author,createdAt,closedAt,labels,assignees,comments,url
gh api repos/OWNER/REPO/issues/N/timeline --paginate \
  --jq '.[] | {event, created_at, actor: .actor.login, source: .source.issue.html_url,
               source_repo: .source.issue.repository.full_name,
               pr_merged_at: .source.issue.pull_request.merged_at, commit_id, commit_url}'
```
Most cross-references are noise (bots, forks, unrelated repos). Focus on the same repo or its
dependencies, merged PRs, and `closed` events that carry a `commit_id`.

For each relevant PR, **take OWNER/REPO from the PR's own URL**: the fix often lives in a library.
```bash
gh pr view PR -R PR_OWNER/PR_REPO --json number,title,state,mergedAt,url,files,commits \
  --jq '. + {body: (.body // "")[0:1500]}'
gh pr diff PR -R PR_OWNER/PR_REPO
```
If the issue is closed as fixed but no merged PR is linked, the fix may be a dependency bump:
`gh search prs --repo OWNER/REPO --merged "KEYWORDS"`, and the history of `go.mod`,
`package.json`, `Cargo.toml` and so on. For the release that shipped it: `gh release list` and
`gh release view TAG --json tagName,publishedAt,body`.

### 2. Trace the code path (the main job)

Read the code, not just the thread. Use the code **as it was when the bug happened**: the parent
of the fix commit, or the release the reporter used, never the default branch after the fix. When
the fix is in a dependency, use the dependency's fix parent, and use the reporter's release for
the app itself.

1. **Find the entry point**: the command, endpoint, screen or API the reporter used. Locate its
   handler (`gh search code`, `grep` in a clone, or the stack trace in the issue).
2. **Follow the calls** toward the failure. Write down each hop that matters: file, function,
   line, and what it does with the data. Skip plumbing that isn't relevant to the bug.
3. **Find the origin**: the first place the code does the wrong thing. The fix diff usually
   points straight at it. If the bug is not fixed yet, the origin is your best-supported
   location. Say how sure you are in `detail` and in `summary.confidence`.
4. **Follow the bad value or state forward** to where the user sees it (the error message, the
   crash, the wrong output). Those steps are `propagates`; the last one is the `symptom`.
5. **Note anything running at the same time** that the bug needs, such as another process,
   thread, request or job. Add it as a `concurrent` step with `alongside` set to the step it runs
   next to.

Read code at a commit:
```bash
gh api "repos/OWNER/REPO/contents/PATH?ref=SHA" --jq .content | base64 -d | sed -n '40,80p'
gh search code "funcName repo:OWNER/REPO"
```
Link each step to its code with a permalink:
`https://github.com/OWNER/REPO/blob/SHA/PATH#L10-L20`. Set `location.line` to the first line of
the snippet, and make the permalink's range cover the snippet. In zsh, quote globs and `--include`
patterns (`grep -rn "store(" --include='*.go'`).

### 3. Write the trail

Follow [FORMAT.md](FORMAT.md). The rules that matter most:

- **Components (2–6)** are the columns of the map. Merge small packages into the component that
  calls them. The kinds are: an app or CLI, a library, a service, storage
  (disk, database, cache), or an external system or other process. Name them the way the
  codebase does (`go-gh pkg/api`, not "the library").
- **Steps (4–12)** run in **execution order**: the map reads left to right, then top to bottom.
  When the bug needs two runs (written in one, read in a later one), keep that order and say
  "Later run …" in the title. Each `title` says what happens in
  plain words ("Cache entry written in place"). Put the file and function in `location`, never
  in the title.
- **Mark the bug path.** Exactly one `origin`, then `propagates` steps, then one `symptom`
  (more than one only if the issue reports separate symptoms). Steps before the bug are `normal`.
- **Show the code.** Give the origin step a `snippet` of 3–12 lines, copied exactly from the
  file at that commit, and do the same for any step where the code explains the bug.
- **Attach the fix** to the step it changes, with `fix: {label, url, detail}`. If the bug is
  open, leave `fix` out and say where a fix would go in `next_steps`.
- **Ground every fact.** File paths, line numbers, function names and messages must come from
  code or text you read. The validator cannot catch invented specifics. Before you finish,
  reread each step against its permalink. Your own inference stays out of `confirmed` wording.
  Say "likely" in the detail and lower `summary.confidence`.
- **Keep the investigation short:** 4–12 `nodes` for the report, key evidence, ruled-out
  hypotheses (status `rejected`), PRs and the release, with `refs` to the comment or PR.

### 4. Validate

```bash
bug-trail validate "$BUG_TRAIL_DIR/OWNER__REPO__N.json"
```
Fix every error. Read the warnings: they usually mean a bug-path step has no code location, or
no step is marked `origin` or `symptom`.

### 5. Upload (only if `BUG_TRAIL_SERVER` is set)

```bash
bug-trail push "$BUG_TRAIL_DIR/OWNER__REPO__N.json"
```
It prints the trail's URL. On a 401 the token is wrong: tell the user. Never guess a token or
look for one elsewhere.

### 6. Report back

In two or three sentences: where the bug starts (file and function), how it reaches the user,
the status, and where to see the map (the URL `bug-trail push` printed, or `bug-trail serve`
at http://localhost:4317).
