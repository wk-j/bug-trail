# Using the map

Each trail page is a case file on a desk. From top to bottom:

1. **The case file.** The issue, a stamp with the bug's status, a one-line headline, labels,
   how sure the analysis is, and a short summary.
2. **Background.** What this part of the system does, **the rule** the code has to follow, and a
   glossary. Glossary terms are underlined everywhere on the page; hover one to see its meaning.
3. **Code flow**, an evidence board. This is the main view (below).
4. **Investigation**, a notebook: how people tracked the bug down, in date order. Ruled-out ideas
   are struck through.
5. **Where it stands**, a legal pad: open questions and next steps.

## The evidence board

- **Index cards** are the parts of the code the bug passes through (a class, a service, a
  handler). Cards from the same module or repository sit on one kraft-paper sheet with its name
  on masking tape. **Metal file boxes** are storage and external systems.
- **Sticky notes** under a card are the steps that run in it, numbered in execution order:
  - green: the correct logic, what should happen
  - pink: what the code does now, on the bug path
  - orange: where the user sees the problem
  - yellow: steps both flows share
  - blue, dashed: something running at the same time (another process or request)

  Small stamps on a note mark **bug starts**, **user sees** and **fixed**.
- **Yarn** joins the cards: **green** for the correct logic, **red** for the bug, plain for
  shared steps.

## Cases

The tabs above the board are **cases**: concrete inputs, such as "UW · sale number only". Picking
one lights up the route that input takes through each flow and dims everything else. Under the
tabs, **SHOULD** and **DOES NOW** give the two outcomes in one line each. A case the code already
handles correctly says **DOES (SAME)**.

## Following the bug

- The luggage tags on the board's rail jump to where the bug **starts** and where it is **seen**.
- **Follow the bug →** walks the red path one step at a time. You can keep stepping from the
  clipboard.
- **Click a note** to open the clipboard: the file and line with a link to GitHub, the code
  snippet, why the step matters, the fix if there is one, and the steps before and after.
  Esc or ✕ closes it.
- Links like `#/t/<trail>/<step>` open a trail with that step selected, so you can share a step.

The page redraws by itself when an agent writes or uploads a new version of the trail.
