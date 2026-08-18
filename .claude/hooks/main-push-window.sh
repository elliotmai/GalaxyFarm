#!/usr/bin/env bash
#
# One push to main an hour. Everything else collects on staging.
#
# Runs as a PreToolUse hook on Bash and reads the tool call on stdin. If the
# command would move the protected branch on the remote and that branch has
# moved within the window, the push is denied with an explanation naming the
# staging branch and the time the window reopens.
#
# ## How "when did main last move" is answered
#
# By asking the remote, not by remembering locally. Sessions in this project
# are ephemeral and isolated — each one gets its own container and its own
# fresh clone — so a timestamp written to disk would be a timestamp only one
# session can see, and the limit is meant to hold across all of them. The tip
# commit of origin/<protected> is state every session already shares.
#
# That reading is exact only because promotions are merge commits: the
# scheduled staging -> main promotion uses `git merge --no-ff`, so the commit
# at the tip of main was authored at the moment main was pushed. A
# fast-forward would put an older commit on the tip and the window would look
# like it had already reopened. See CLAUDE.md.
#
# Nothing here governs a human at a terminal — hooks only see tool calls Claude
# makes. It is a rate limit on this project's sessions, not branch protection.
# If you want the rule enforced against everybody, add a GitHub ruleset too.

set -uo pipefail

PROTECTED="${GF_PROTECTED_BRANCH:-main}"
STAGING="${GF_STAGING_BRANCH:-staging}"
WINDOW="${GF_MAIN_PUSH_WINDOW_SECONDS:-3600}"

# Read the whole payload once; `jq` is used rather than string matching because
# a command can contain anything, including things that look like JSON.
payload="$(cat)"
command_line="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null)"

# The cheap exit. This hook has no matcher narrow enough to be trusted — a
# push is often the tail of a chain (`pnpm verify && git push ...`), and a
# prefix matcher on "git" would miss every one of those — so it runs on every
# Bash call and leaves immediately when there is no push in sight.
case "$command_line" in
*"git"*"push"*) ;;
*) exit 0 ;;
esac

allow() { exit 0; }

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# Whether one shell segment is a `git push` that would move PROTECTED on the
# remote. Returns 0 for yes.
#
# What counts is the *destination* of each refspec, which is why `main:staging`
# does not count and `HEAD:main` does. A push with no refspec at all falls back
# to the current branch, the same way git does.
segment_targets_protected() {
  local segment="$1"
  local -a tokens
  read -ra tokens <<<"$segment"

  local seen_git=0 seen_push=0 seen_remote=0 skip_next=0
  local -a refspecs=()

  for token in "${tokens[@]}"; do
    if ((skip_next)); then
      skip_next=0
      continue
    fi

    if ((!seen_push)); then
      case "$token" in
      git | */git) seen_git=1 ;;
      push) ((seen_git)) && seen_push=1 ;;
      esac
      continue
    fi

    case "$token" in
    # Pushes every local branch, main included.
    --all | --mirror) return 0 ;;
    # Options that swallow the next word, so it is not mistaken for a refspec.
    -o | --push-option | --repo | --exec | --receive-pack)
      skip_next=1
      continue
      ;;
    -*) continue ;;
    esac

    if ((!seen_remote)); then
      seen_remote=1
      continue
    fi

    refspecs+=("$token")
  done

  ((seen_push)) || return 1

  # No refspec: git pushes the current branch, per push.default.
  if ((${#refspecs[@]} == 0)); then
    local here
    here="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
    [[ "$here" == "$PROTECTED" ]] && return 0
    return 1
  fi

  for spec in "${refspecs[@]}"; do
    local destination="${spec#+}"
    # `src:dst` moves dst; a bare ref is both.
    [[ "$destination" == *:* ]] && destination="${destination##*:}"
    destination="${destination#refs/heads/}"
    [[ "$destination" == "$PROTECTED" ]] && return 0
  done

  return 1
}

targets_protected() {
  local segment
  # Split on the shell separators, so a push at the end of a chain is seen.
  while IFS= read -r segment; do
    [[ -z "$segment" ]] && continue
    segment_targets_protected "$segment" && return 0
  done < <(printf '%s\n' "$command_line" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g; s/|/\n/g')
  return 1
}

targets_protected || allow

# Ask the remote when the branch last moved. A failure here — no network, no
# remote, not a repository — allows the push: a push that cannot reach the
# remote fails on its own, and blocking work over a flaky fetch would be a
# worse answer than letting git report the real problem.
git fetch --quiet origin "$PROTECTED" 2>/dev/null || allow

last="$(git log -1 --format=%ct "origin/$PROTECTED" 2>/dev/null ||
  git log -1 --format=%ct FETCH_HEAD 2>/dev/null || true)"
[[ "$last" =~ ^[0-9]+$ ]] || allow

now="$(date +%s)"
elapsed=$((now - last))
((elapsed >= WINDOW)) && allow

remaining=$((WINDOW - elapsed))
reopens="$(date -u -d "@$((now + remaining))" '+%H:%M UTC' 2>/dev/null ||
  date -u -r "$((now + remaining))" '+%H:%M UTC' 2>/dev/null || echo "shortly")"

deny "$(
  cat <<EOF
Blocked: $PROTECTED takes at most one push an hour in this project, and it was
last pushed $((elapsed / 60))m ago. The window reopens at $reopens (in $((remaining / 60))m).

Push to '$STAGING' instead — it is where commits collect between windows:

    git push -u origin $STAGING

A scheduled promotion merges $STAGING into $PROTECTED once the window is open,
so nothing pushed to $STAGING is stranded. Do not work around this by pushing
under another name; if this genuinely cannot wait, say so and ask.
EOF
)"
