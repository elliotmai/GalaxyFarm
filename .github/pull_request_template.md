## What changed

<!-- One or two sentences. What does this do that the codebase could not do before? -->

## Why

<!-- Link the issue, or name the spec section this implements (e.g. "spec §5.2, breeding records"). -->

## Data operations contract (spec §4.5)

Tick every line, or say why it does not apply. CI enforces most of this, but CI
cannot tell whether a confirmation dialog names the right dependents.

- [ ] Every entity touched here has **create, read/list, update, and delete** — or is on the enumerated exception list
- [ ] Input is validated by **one shared Zod schema**, imported by the form, the sync payload, and the API handler
- [ ] Every destructive action **confirms first**, naming the record and what else it affects
- [ ] Deletes write a **tombstone** and are restorable from Trash
- [ ] Every new relationship declares its **delete behaviour** (`restrict` / `cascade` / `detach`)
- [ ] N/A — this PR touches no entities <!-- delete the boxes above if so -->

## Checks

- [ ] Works offline (reads from the local store; writes go through the outbox)
- [ ] Tests cover the behaviour, not just the happy path
- [ ] Spec updated if this changed a decision (§12 decision log)

## Screenshots

<!-- For UI work, both themes where relevant: Midnight Nebula and Bluebonnet Linen. -->
