# CI/CD

```
PR / push ──► CI ──► (main only) CD: publish images to GHCR ─► staging (auto)
                                         └─► opens/updates a "promotion" PR editing deploy/production.yml
                                                 └─► human reviews + merges ─► deploy-production.yml ─► production
```

Production is **GitOps-style**: the image tag in [`deploy/production.yml`](../deploy/production.yml) on `main` *is* what production runs. Why it works this way: [ADR-008](adr/008-gitops-production-promotion.md).

| Workflow | Does |
|---|---|
| `ci.yml` | Backend lint/format/types, backend tests + coverage (Postgres 16), frontend types/lint/build, frontend tests, dependency audit, Docker build + smoke test, SonarQube. A final **CI gate** job aggregates everything. Backend deps install from the hashed lockfile `backend/requirements-ci.txt` with `--require-hashes`. |
| `cd.yml` | After CI passes on a `main` push: builds `linux/amd64` images, pushes `ghcr.io/<owner>/<repo>/{backend,frontend}:sha-<7>` (+ `latest`), deploys **staging**, then opens or updates one rolling PR (`promote/production`) that changes `image_tag` in `deploy/production.yml`. It never deploys production itself. Also the entry point for rollbacks (manual dispatch). |
| `deploy-production.yml` | Runs when `deploy/production.yml` changes on `main`. Refuses to deploy unless that commit came from a **merged PR with an approving review from someone other than the author, on the PR's final commit**. Only the newest pinned tag deploys (a superseded run exits). Then calls `deploy-render.yml` with a 5-minute soak. |
| `deploy-render.yml` | Reusable: preflight (checks both images exist in GHCR), calls the Render deploy hooks with `imgURL` set to the exact tag, health-checks `APP_URL`, optional soak that keeps probing `/api/v1/health`. |
| `keep-alive.yml` | Optional. Every 10 minutes, pings `KEEP_ALIVE_URL` (a repository variable) so a sleeping Render backend stays warm. Does nothing until the variable is set. See [setup step 4](#4-keep-alive-optional). |

`image_tag: none` in `deploy/production.yml` means nothing has been promoted; the first merged promotion PR replaces it.

## Deploying to production

1. Merge to `main`. CI → CD publishes images and deploys staging.
2. When staging succeeds, CD opens or updates the PR **"Promote production to sha-xxxxxxx"**. Newer builds update the same PR.
3. Someone other than the PR author approves and merges it. That merge deploys.
4. Watch the run: after the deploy hooks fire, the health check and 5-minute soak must pass.

Direct pushes to `deploy/production.yml` fail closed: the workflow errors with "without a merged pull request". A merge without an approval on the final commit also fails; re-approving and re-running is the fix.

## Rollback

Actions → **CD** → Run workflow → `image_tag` = an earlier `sha-xxxxxxx`. This skips build and staging and opens a `rollback/production-<tag>` PR through the **same review path**. Retry a failed deploy by re-running the failed `deploy-production.yml` run. Images stay in GHCR; don't prune ones you might roll back to. Database migrations are **not** rolled back, so keep them backward-compatible. The backend runs `alembic upgrade head` on every start.

## One-time setup

### 1. SonarQube (free)
**Recommended: SonarQube Cloud free tier** (50k private LOC; this repo is ~12k). No server to run.
1. Sign in at sonarcloud.io with GitHub, import this repo, and choose **"With GitHub Actions"**. Turn **Automatic Analysis off** (it conflicts with CI analysis and can't see coverage).
2. Create a token. GitHub → Settings → Secrets and variables → Actions:
   - secret `SONAR_TOKEN`
   - variables `SONAR_PROJECT_KEY`, `SONAR_ORGANIZATION`
3. Until `SONAR_TOKEN` exists the Sonar job skips itself with a notice (it also skips on fork PRs, which have no secrets).

> Check on your account: Sonar's free-tier documentation is inconsistent on whether **pull-request analysis** is included. If the quality gate only reports on `main`, that's the plan's limit, not a pipeline bug.

**Self-hosted alternative:** run a SonarQube Community Build, set variable `SONAR_HOST_URL`, leave `SONAR_ORGANIZATION` empty. Same workflow, same action. Your runners must be able to reach the server, and you should confirm which branch/PR features your edition supports.

### 2. GitHub
- Settings → Actions → General → Workflow permissions: leave "Read repository contents" **and enable "Allow GitHub Actions to create and approve pull requests"**. `cd.yml` needs this to open the promotion PR.
- **Environments** `staging` and `production`. They scope secrets and variables and show deployments. The production approval gate is the PR review enforced by `deploy-production.yml`; environment "Required reviewers" are not needed (adding them would put a second approval step in front of every deploy).
- Per environment: secrets `RENDER_BACKEND_DEPLOY_HOOK`, `RENDER_FRONTEND_DEPLOY_HOOK`; optional variable `APP_URL` (e.g. `https://loantrack.onrender.com`) for the post-deploy health check and soak. Without `APP_URL` on `production`, the deploy runs with **no health check** and logs a warning.
- **Branch protection** on `main` (and `dev`): require the status check **`CI gate`**, require PRs, disallow force pushes. On a public repo or paid plan, also require an approving review so an unapproved promotion PR can't be merged at all. The workflow still fails closed without it, but `main` would then pin a tag that production isn't running until a follow-up PR.
- Enable Dependabot alerts + security updates.

### 3. Render
Create separate **staging** and **production** pairs of services, each *Existing Image* (not Git-backed):
- Image URLs: `ghcr.io/<owner>/<repo>/backend:latest` and `.../frontend:latest` (lowercase). Render rejects a deploy hook whose `imgURL` differs from the service's image URL in anything but the tag.
- If the GHCR packages are private, add a registry credential in Render (a GitHub PAT with `read:packages`).
- Keep your existing env vars (`DATABASE_URL`, `SECRET_KEY`, `ALLOWED_ORIGINS`, frontend `BACKEND_URL`). The backend entrypoint runs migrations and the first-boot admin seed on every start.
- Copy each service's **Deploy Hook** URL (Settings) into the matching GitHub environment secret. Treat them like passwords.

### 4. Keep-alive (optional)
The app already copes with a sleeping backend by itself (retries and a wake-up ping; see [ADR-009](adr/009-cold-start-handling.md)). This workflow removes the wait altogether and keeps the in-process webhook/cycle loops running.
1. Settings → Secrets and variables → Actions → **Variables** → add `KEEP_ALIVE_URL` = `https://<your-backend>.onrender.com/api/v1/health`.
2. Run **Keep backend awake** once from the Actions tab (`workflow_dispatch`) and check the log shows `HTTP 200`.

Caveats: ping the **backend only**. Render's free tier meters instance hours (check your plan), and one service awake all month roughly uses the whole allowance, so keeping two awake will not fit. GitHub's cron is best-effort (runs can be late), and GitHub disables scheduled workflows after 60 days without repository activity. An always-on paid instance is the reliable fix. To turn this off, delete the variable.

## Gates that start warn-only (ratchets)
These were red on the day the pipeline was added, so they warn instead of block. Each has a `RATCHET` comment in `ci.yml`; delete its `continue-on-error: true` once clean.

| Gate | Baseline when added | Fix |
|---|---|---|
| mypy | 31 errors / 17 files | fix, then flip to blocking |
| pip-audit | starlette, python-multipart, cryptography, python-jose, ecdsa | upgrade `fastapi` (pulls Starlette), re-run |
| npm audit (high+) | axios, follow-redirects, source-map-js | `npm audit fix` in `frontend/`, commit lockfile |
| ESLint | not installed | add `eslint` + `eslint.config.js`; the step activates automatically |

The baselines are from when the pipeline was added and have not been re-measured; run the gate locally for current numbers.

Blocking from day one: ruff lint + format, migrations on an empty DB, backend tests, backend coverage ≥ 80% (production code only), `tsc -b`, frontend tests + build, Docker smoke test, SonarQube quality gate (once configured).

## Known gaps
- Backend dependencies are locked with hashes for CI (`requirements-ci.txt`, regenerated from `requirements.in` with `pip-compile`; the command is in that file's header). The Docker image, however, installs from `pyproject.toml` ranges, so **the shipped image can resolve newer versions than CI tested**. `pyproject.toml` and `requirements.in` also disagree on some ranges.
- Frontend coverage is ~35% (as last measured); no threshold. The Sonar gate checks coverage on *new* code instead.
- The post-deploy check can't tell the new version from the old (Render serves the old instance until the new one is healthy). Watch the Render dashboard for the deploy result.
- Container image CVE scanning is not included.
