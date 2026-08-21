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

## Branches: main takes one push an hour

`main` accepts **at most one push per hour**. Between windows, commits collect
on **`staging`**.

- Do your work on a feature branch, as before, and open a PR against `main`.
- When something needs to land and the window is shut, merge it to `staging`
  and push that. Nothing on `staging` is stranded — it is promoted for you.
- Never push to `main` on the hour's second attempt by renaming the branch,
  force-pushing, or pushing through another remote. If a change genuinely
  cannot wait for the window, say so and ask.

### What enforces it

`.claude/hooks/main-push-window.sh`, wired up as a `PreToolUse` hook on `Bash`
in `.claude/settings.json`. It reads the command about to run, works out
whether it would move `main` on the remote — including a push at the tail of a
chain, `HEAD:main`, `--all`, and a bare `git push` while standing on `main` —
and denies it with the time the window reopens.

Two things it is not:

- **Not branch protection.** A hook only sees tool calls Claude makes. A person
  at a terminal is unaffected. If the rule should bind everybody, add a GitHub
  ruleset with the same period.
- **Not a per-session limit.** It is one push an hour for the repository, and
  every session in the project shares it.

### How "when did main last move" is answered

By asking the remote: the committer date of the tip of `origin/main`. Sessions
here are ephemeral and isolated, each with its own container and its own fresh
clone, so a timestamp on disk would be visible to exactly one of them — while
the branch tip is state they all already share.

**This is why promotions must be merge commits.** `git merge --no-ff staging`
puts a commit authored _now_ at the tip of `main`, so the reading is the push
time. A fast-forward would leave an older commit on the tip and the window
would look like it had already reopened. The scheduled promotion below uses
`--no-ff`; anything else moving `main` should too.

## Promotion: staging → main, hourly

A scheduled routine wakes every hour, and when `staging` is ahead of `main` and
the window is open, merges and pushes:

```bash
git fetch origin main staging
git checkout main && git merge --ff-only origin/main
git merge --no-ff origin/staging -m "Promote staging to main"
git push origin main
```

It does nothing — quietly — when `staging` has nothing new or the window is
still shut. A merge conflict means something moved `main` outside this flow;
the routine stops and leaves it alone rather than guessing.

## Adjusting the rule

The script reads three environment variables, so none of this needs editing to
change:

| Variable                      | Default   | Meaning                         |
| ----------------------------- | --------- | ------------------------------- |
| `GF_PROTECTED_BRANCH`         | `main`    | The branch that is rate limited |
| `GF_STAGING_BRANCH`           | `staging` | Where commits collect meanwhile |
| `GF_MAIN_PUSH_WINDOW_SECONDS` | `3600`    | The window, in seconds          |

Set them under `env` in `.claude/settings.json` to change the policy for
everyone, or in `.claude/settings.local.json` for one machine.
