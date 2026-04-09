# voice-coda execution plan

## Goal

Create `voice-coda` as the successor to `voice-claude`, with wake-word-first positioning, while keeping the migration low-risk for existing installs and contributors.

## Success criteria

- `voice-coda` exists as a new repository
- the new repo opens with wake-word + provider-agnostic positioning
- package scope, CLI, config, service, and container naming are internally consistent
- existing `voice-claude` users have a documented migration path
- the first `voice-coda` release installs and updates cleanly

## Constraints

- avoid breaking existing self-hosted installs without a migration path
- keep the first cut focused on naming/cutover, not a broad architecture rewrite
- preserve the merged openWakeWord and OpenCode work as core differentiators

## Recommended cutover strategy

Use a **copy-forward successor repo**, not an in-place hard rename.

Why:

- `voice-coda` should feel like a new phase of the project, not just a rewritten git history label
- existing `voice-claude` users may still need old install/update instructions for a transition period
- it allows one transition release in the old repo that points users toward `voice-coda`

## Phases

### Phase 0 — Freeze the starting point

**Objective:** choose the exact branch/commit that becomes the `voice-coda` starting snapshot.

Tasks:

1. confirm the branch includes:
   - provider abstraction + OpenCode path
   - wake-word service + browser integration
   - successor docs
2. tag or record the source commit SHA used for repo creation
3. decide whether to create the new repo from:
   - a fresh import preserving history, or
   - a new repo seeded from a working tree snapshot

Deliverable:

- an agreed source commit for repo creation

### Phase 1 — Create the new repository shell

**Objective:** stand up `voice-coda` with correct top-level branding before deep renames.

Tasks:

1. create GitHub repo `voice-coda`
2. push the chosen source snapshot/history into it
3. update top-level metadata immediately:
   - repo description
   - README title/opening copy
   - root `package.json` name
4. add a short note in the old repo README pointing to the new successor repo

Deliverable:

- new repo exists and presents itself as `voice-coda`

### Phase 2 — Rename user-facing operational surfaces

**Objective:** rename the things users touch first, while keeping migration shims where practical.

Tasks:

1. rename CLI references:
   - `voice-claude` → `voice-coda`
2. rename config locations:
   - `~/.config/voice-claude` → `~/.config/voice-coda`
3. rename systemd unit/service references:
   - `voice-claude.service` → `voice-coda.service`
4. rename environment variables where branding is embedded:
   - `VOICE_CLAUDE_*` → `VOICE_CODA_*`
5. keep compatibility fallbacks for one transition release where feasible

Deliverable:

- operator-facing docs and commands consistently say `voice-coda`

### Phase 3 — Rename workspace package scope

**Objective:** make the monorepo internally consistent without changing runtime behavior.

Tasks:

1. rename package names:
   - `@voice-claude/server` → `@voice-coda/server`
   - `@voice-claude/web` → `@voice-coda/web`
   - `@voice-claude/contracts` → `@voice-coda/contracts`
   - `@voice-claude/ui` → `@voice-coda/ui`
2. update imports and workspace dependency references
3. refresh the lockfile
4. run full verification:
   - lint
   - typecheck
   - tests
   - build

Deliverable:

- package graph builds cleanly under `@voice-coda/*`

### Phase 4 — Rename deployment and publish surfaces

**Objective:** make containers and reverse-proxy setup match the new name.

Tasks:

1. rename image coordinates:
   - `ghcr.io/.../voice-claude/*` → `ghcr.io/.../voice-coda/*`
2. rename Compose service labels and Traefik routers/services
3. update install/update scripts that reference repo/image names
4. verify fresh install flow for:
   - bare metal
   - docker compose
   - prebuilt image path

Deliverable:

- deployment docs and artifacts use `voice-coda`

### Phase 5 — Productize the wake-word-first story

**Objective:** make the successor repo read like a wake-word-first product, not a renamed Claude shell.

Tasks:

1. move wake-word setup into the main quick-start path
2. document passive-listen state transitions clearly:
   - passive listen
   - wake detected
   - active request capture
   - response playback
   - return to passive mode
3. document openWakeWord tuning inputs:
   - threshold
   - debounce
   - patience
   - model path
4. update screenshots/demo media later if available

Deliverable:

- README and docs lead with the actual differentiator: “Coda” wake-word activation

### Phase 6 — Transition release and handoff

**Objective:** close the loop for existing users of `voice-claude`.

Tasks:

1. publish the first `voice-coda` release
2. add migration notes for existing installs
3. optionally cut one final `voice-claude` release that:
   - points to `voice-coda`
   - documents the rename
   - explains whether future development has moved
4. decide whether `voice-claude` becomes archived, maintenance-only, or a redirect repo

Deliverable:

- users know where to go and how to migrate

## Commit grouping recommendation

Use this sequence in the new repo:

1. `docs: establish voice-coda branding and successor docs`
2. `refactor: rename workspace packages to voice-coda scope`
3. `refactor: rename CLI config and service surfaces to voice-coda`
4. `refactor: rename deployment env and image references`
5. `docs: promote wake-word-first quick start and migration notes`

That keeps revert boundaries clean and avoids mixing branding, packaging, and infra in one commit.

## Risks and mitigations

### Risk: breaking existing installs

Mitigation:

- keep config-path migration logic
- support old env names temporarily where practical
- document the exact migration commands

### Risk: package rename churn causes import breakage

Mitigation:

- do package-scope rename as its own commit
- run full verification immediately after
- avoid directory churn in the same change

### Risk: wake-word positioning outruns actual stability

Mitigation:

- present wake-word support as the primary direction, but mark tuning/background-audio limitations clearly
- keep “experimental” callouts for mobile/browser caveats

## Exit criteria for creating the new repo

Before declaring `voice-coda` ready:

- [ ] README opens with the new name and wake-word-first positioning
- [ ] package scope is consistent
- [ ] CLI/config/service/container names are consistent
- [ ] old-to-new migration notes exist
- [ ] lint/typecheck/test/build all pass

## Immediate next action

When you’re ready to execute, start with:

1. create the GitHub repo
2. copy this branch state into it
3. do the **Phase 1** branding commit first

After that, use the migration checklist to work through the renames in order.
