---
name: bug-trail
description: Analyze a GitHub issue end to end (report, symptoms, investigation, root cause, fix, verification) and write a bug-trail/v1 JSON file that the Bug Trail dashboard renders as a map. Use when asked to analyze, trace, map or "make a bug trail" for a GitHub issue URL or owner/repo#number.
---

# Bug Trail

You turn one GitHub issue into a **bug trail**: a small graph that tells the bug's story from the
first report to the verified fix. Write it as a JSON file in the `bug-trail/v1` format. The Bug
Trail dashboard watches the output folder and draws the file as a map as soon as you save it.

This skill works for any agent that can run shell commands. It needs `gh` (logged in) and the
`bug-trail` command (which installed this skill).

## Inputs

- The issue, as a URL (`https://github.com/OWNER/REPO/issues/N`) or `OWNER/REPO#N`.
- Optional: a local clone of the repo. If you are inside one, read the code to locate the cause.

## Output location

Write to `$BUG_TRAIL_DIR/OWNER__REPO__N.json`. If `BUG_TRAIL_DIR` is unset, use
`~/.bug-trail/trails/` (create it). Overwrite an earlier trail for the same issue: the file is the
latest analysis.

If `BUG_TRAIL_SERVER` is set, the dashboard runs on a shared server. Still write and validate the
file locally as above, then upload it in step 4. The file name, without `.json`, becomes the
trail's id on the server.

## Steps

1. **Gather the facts.** Collect everything before you start writing.
   ```bash
   gh issue view N -R OWNER/REPO --json number,title,body,state,author,createdAt,closedAt,labels,assignees,comments,url
   gh api repos/OWNER/REPO/issues/N/timeline --paginate \
     --jq '.[] | {event, created_at, actor: .actor.login, source: .source.issue.html_url,
                  source_repo: .source.issue.repository.full_name,
                  pr_merged_at: .source.issue.pull_request.merged_at, commit_id, commit_url}'
   ```
   Most cross-references are noise (bots, forks, unrelated repos). Focus on events from the same
   repo or its dependencies, merged PRs, and `closed` events that carry a `commit_id`.

   For each relevant pull request, **take OWNER/REPO from the PR's own URL**: the fix often lives
   in another repository, such as a library the project depends on.
   ```bash
   gh pr view PR -R PR_OWNER/PR_REPO --json number,title,state,mergedAt,url,files,commits,reviews \
     --jq '. + {body: (.body // "")[0:1500]}'   # bodies are often long templates
   gh pr diff PR -R PR_OWNER/PR_REPO            # only if you need to explain the fix
   ```
   For a commit: `gh api repos/OWNER/REPO/commits/SHA --jq '{message: .commit.message, files: [.files[].filename]}'`.
   For code at a path: read the local clone, or `gh api 'repos/OWNER/REPO/contents/PATH?ref=SHA' --jq .content | base64 -d`.

   **If no merged PR is linked but the issue is closed as fixed**, the fix may have arrived with no
   link to the issue, for example a dependency bump. Search for it:
   `gh search prs --repo OWNER/REPO --merged "KEYWORDS"`, and the history of the dependency file
   (`gh api 'repos/OWNER/REPO/commits?path=go.mod'`, or package.json, Cargo.toml and so on).
   Say in the node's `detail` how you connected it to the issue.

   **To find the release that shipped the fix**:
   `gh release list -R OWNER/REPO --limit 30`, then `gh release view TAG -R OWNER/REPO --json tagName,publishedAt,body`
   and look for the PR number in the notes. Record the first release with the fix as a `verification` node.

2. **Work out the story.** Answer, from the evidence:
   - What did the reporter see, and in what environment?
   - What did people suspect along the way? Which ideas were confirmed and which were ruled out?
   - What is the root cause, and which file and function hold it?
   - What fixed it (PR or commit), or what workaround do people use while it is open?
   - What proves the fix works (a test, a release, a reporter confirming)?
   - What is still unknown?

3. **Write the trail** in the format described in [FORMAT.md](FORMAT.md). Rules that matter most:
   - **Ground every fact.** A node that comes from the issue, a comment, a PR or a commit gets a
     `refs` entry linking that exact URL (comment URLs look like `…/issues/N#issuecomment-ID`).
   - **Write only what the sources say.** Every name, version, file path and number in a title or
     detail must appear in what you read. The validator cannot catch made-up specifics. Before
     you finish, reread each node against its `refs`.
   - **Label inference as inference.** Your own reasoning that nobody on the thread stated is a
     `hypothesis` node with status `likely` or `open`. Never present a guess as `confirmed`.
   - **Keep rejected ideas.** A hypothesis people ruled out stays on the map with status
     `rejected` and a `refutes` edge from the evidence that killed it. The dead ends are part of
     the trail.
   - **Aim for 6–25 nodes.** Merge repetitive "+1, me too" comments into one `symptom` or
     `environment` node. Do not create one node per comment.
   - **Set `story`** to the ordered node ids of the main storyline (report → … → verification).
     The viewer uses it for "step through the story".
   - Write titles as short plain sentences (under 80 characters). Put the detail in `detail`.

4. **Validate** and fix every error before you finish:
   ```bash
   bug-trail validate "$BUG_TRAIL_DIR/OWNER__REPO__N.json"
   ```
   Warnings are allowed, but read them: most mean a
   node is missing its source link or is not connected.

   If `BUG_TRAIL_SERVER` is set, upload it (this uses `BUG_TRAIL_TOKEN`):
   ```bash
   bug-trail push "$BUG_TRAIL_DIR/OWNER__REPO__N.json"
   ```
   It prints the trail's URL on the server. If it fails with 401, the token is wrong. Tell the
   user; never guess a token or look for one elsewhere.

5. **Report back** in two or three sentences: the root cause (or that it is unknown), the
   status, the path of the file you wrote, and where to see it: the URL `bug-trail push` printed,
   or the local dashboard (`bug-trail serve`, default http://localhost:4317).
