# ADR-008: Promote to production through a reviewed pull request (GitOps pin)

**Status:** Accepted (written retroactively on 2026-10-24 from the workflow files; the original decision date is not recorded in the repo)
**Date:** 2026-10-24

## Context
Images are built once per `main` commit and pushed to GHCR as `sha-<7>`. Staging deploys automatically. Production must not deploy without a human decision, must be reproducible (what is running should be answerable from the repo), and must have a rollback path that goes through the same checks.

The earlier flow, still described in older versions of `docs/ci-cd.md`, was `staging â†’ [approval] â†’ production` with a GitHub Environment "Required reviewers" rule on `production`.

## Decision
`deploy/production.yml` on `main` holds one line, `image_tag: sha-xxxxxxx`, and that tag is what production runs.

- `cd.yml` never deploys production. After staging succeeds it opens or updates a single rolling PR (`promote/production`) that edits that line.
- Merging the PR triggers `deploy-production.yml`, which **verifies in code** that the commit came from a merged PR with an approving review from someone other than the author, on the PR's final commit (earlier approvals are stale). It fails closed otherwise. The workflow header gives the reason: the gate works on any GitHub plan, without depending on environment protection rules or branch protection.
- If a newer tag has been merged while a run was queued, only the newest pin deploys.
- Rollback is `cd.yml` run manually with an older `image_tag`; it opens a `rollback/production-<tag>` PR through the same review path.
- Production deploys are followed by a 5-minute health soak (`deploy-render.yml`).

## Consequences
- The deployed version is auditable from git history and each deploy is linked to a PR and named approvers.
- Rollback is not instant: it needs a PR and an approval. In an emergency that is slower than re-running a deploy.
- A merge without an approval does not deploy but still leaves `main` pinning a tag that production isn't running, until a follow-up PR fixes it. Branch protection requiring review avoids that; see `docs/ci-cd.md`.
- Requires the repo setting "Allow GitHub Actions to create and approve pull requests".
- Database migrations run on backend start and are not rolled back with the image, so migrations must stay backward-compatible for rollback to be safe.

## Alternatives considered
- **Environment "Required reviewers" on `production`** (the previous approach): simple, but the approval lives in GitHub settings rather than in the repo, and it isn't recorded alongside the change. The workflow header cites plan independence as the reason for enforcing the gate in code instead; any other reasons for the switch aren't recorded here.
