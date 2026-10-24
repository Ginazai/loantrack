# CI/CD

```
PR / push ──► CI ──► (main only) CD: publish images to GHCR ─► staging ─► [approval] ─► production
```

| Workflow | Does |
|---|---|
| `ci.yml` | Backend lint/format/types, backend tests + coverage (Postgres 16), frontend types/lint/build, frontend tests, dependency audit, Docker build + smoke test, SonarQube. A final **CI gate** job aggregates everything. |
| `cd.yml` | After CI passes on `main`: builds `linux/amd64` images, pushes `ghcr.io/<owner>/<repo>/{backend,frontend}:sha-<7>` (+ `latest`), deploys staging, then production after approval. |
| `deploy-render.yml` | Reusable: calls the Render deploy hooks with `imgURL` set to the exact tag, then health-checks. |

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
- **Environments** `staging` and `production`. On `production` add **Required reviewers**.
- Per environment: secrets `RENDER_BACKEND_DEPLOY_HOOK`, `RENDER_FRONTEND_DEPLOY_HOOK`; optional variable `APP_URL` (e.g. `https://loantrack.onrender.com`) for the post-deploy health check.
- **Branch protection** on `main` (and `dev`): require the status check **`CI gate`** only. Require PRs, disallow force pushes.
- Settings → Actions → General → Workflow permissions: leave "Read repository contents" (jobs request what they need).
- Enable Dependabot alerts + security updates.

### 3. Render
Create separate **staging** and **production** pairs of services, each *Existing Image* (not Git-backed):
- Image URLs: `ghcr.io/<owner>/<repo>/backend:latest` and `.../frontend:latest` (lowercase). Render rejects a deploy hook whose `imgURL` differs from the service's image URL in anything but the tag.
- If the GHCR packages are private, add a registry credential in Render (a GitHub PAT with `read:packages`).
- Keep your existing env vars (`DATABASE_URL`, `SECRET_KEY`, `ALLOWED_ORIGINS`, frontend `BACKEND_URL`). The backend entrypoint already runs migrations and seeding on boot.
- Copy each service's **Deploy Hook** URL (Settings) into the matching GitHub environment secret. Treat them like passwords.

## Rollback
Actions → **CD** → Run workflow → `image_tag` = an earlier `sha-xxxxxxx`. Skips build and staging, redeploys that existing image to production (still needs approval). Images are kept in GHCR; don't prune the ones you might roll back to. Database migrations are **not** rolled back, so keep them backward-compatible.

## Gates that start warn-only (ratchets)
These were red on the day the pipeline was added, so they warn instead of block. Each has a `RATCHET` comment in `ci.yml`; delete its `continue-on-error: true` once clean.

| Gate | Baseline | Fix |
|---|---|---|
| mypy | 31 errors / 17 files | fix, then flip to blocking |
| pip-audit | starlette, python-multipart, cryptography, python-jose, ecdsa | upgrade `fastapi` (pulls Starlette), re-run |
| npm audit (high+) | axios, follow-redirects, source-map-js | `npm audit fix` in `frontend/`, commit lockfile |
| ESLint | not installed | add `eslint` + `eslint.config.js`; the step activates automatically |

Blocking from day one: ruff lint + format, migrations on an empty DB, backend tests, backend coverage ≥ 80% (production code only), `tsc -b`, frontend tests + build, Docker smoke test, SonarQube quality gate (once configured).

## Known gaps
- Backend deps are **unlocked** (no `poetry.lock`/constraints), so CI resolves the newest compatible versions each run. A lockfile would make builds reproducible.
- Frontend coverage is ~35%; no threshold. The Sonar gate checks coverage on *new* code instead.
- The post-deploy check can't tell the new version from the old (Render serves the old instance until the new one is healthy). Watch the Render dashboard for the deploy result.
- Container image CVE scanning is not included.
