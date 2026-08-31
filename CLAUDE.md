# Working in this repository

`README.md` is the map of the codebase and `docs/galaxy-farm-spec.md` is the
source of truth for the product. This file covers how every reply ends, and
how work reaches the default branch.

## End every response with What's Next

The last thing in every reply is a short block naming who owns the next step.
It is what gets read on a wall display across a room, and the project
dashboard parses the owner out of it.

```
**What's Next**
YOU: <the single next thing the human must do>
CLAUDE: <what I will do next, if anything>
NOTHING: everything here is done
```

Rules that make it useful rather than decorative:

- **One line per owner, at most one each.** A list of five things is a status
  report, not a next step. If several are outstanding, name the one that
  unblocks the rest.
- **`YOU:` is an instruction, not a summary.** "19 commits deployed to main"
  describes the past. "Trigger the Netlify deploy on main" is a next step. If
  the human has nothing to do, do not write a `YOU:` line at all.
- **Say `NOTHING` when it is true.** A block that always finds something for
  someone to do teaches people to ignore it.
- **Keep it under about 15 words.** It has to survive being summarised into
  the session's status line, which is where the dashboard actually reads it.

## Branches: push straight to main

`main` takes pushes whenever you have something to land. There is no rate
limit, no window, and no queue.

- Work on a feature branch and open a PR against `main` when a review is
  useful.
- When it isn't, commit and push to `main` directly.
- `staging` is no longer a collection point. Nothing promotes it, and nothing
  is waiting on it — treat it as an ordinary branch or delete it.

### The one piece of friction left

`main` still carries classic branch protection requiring a pull request
(Settings → Branches). Pushes from an account that can bypass it land anyway
and print `Bypassed rule violations for refs/heads/main` — cosmetic, and the
push succeeds. Turn the protection off there if the message is unwanted, or
leave it as a speed bump for everyone who lacks bypass.
