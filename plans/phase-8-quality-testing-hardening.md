# Phase 8: Quality, Testing, and Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Context

Phases 0-7.5 are done. Phase 8 of `plans/recipe-maker-implementation-plan.md` calls for
unit tests, integration tests with golden fixtures, operational guards, and logging
(spec: `specs/11-testing-observability-and-ops.md`). A current-state survey showed most
Phase 8 unit-test targets were already covered during earlier TDD phases (schema
validators, step compaction, pantry classifier, tag normalizer, ingredient matcher,
RecipeRepository, post-processing, url-security/html-cleaner/jsonld-extractor, gemini
client/config, route integration tests). This phase closes only the real gaps:

- No golden fixtures (all test data inlined)
- `server/src/services/url-ingestion/browser-fetcher.ts` (Playwright fallback) untested
- No inbound rate limiting on ingest endpoints (spec 11 requirement)
- Only total `diagnostics.durationMs` per pipeline; no per-stage structured logs
- Frontend never sends `x-request-id`; discards envelope requestId on success
  (`apps/web/src/api/client.ts:90-92`); transport failures have no requestId
- `GEMINI_MAX_RETRIES` env parsed (`server/src/services/ai/config.ts:13,22,39`) but
  unused by any retry path (verified by grep - only config + config.test reference it)
- No CI config
- Frontend components untested: `FieldErrors`, `StageStatus`, `IngestTabs`

Decisions locked with the user:
1. **Golden fixtures**: fixture directory with saved HTML pages + expected canonical
   JSON, Gemini mocked (deterministic).
2. **Rate limiting**: simple in-memory fixed-window per-IP Hono middleware on
   `/api/ingest/*` only, env-configurable, new `RATE_LIMITED` error code -> 429.
3. **Observability**: per-stage structured log lines only; NO metrics module
   (deferred, rates derivable from logs).
4. **CI**: single GitHub Actions workflow (install, typecheck, test); Playwright
   mocked in tests, no browser install in CI.

Out of scope: Gemini 429 backoff, metrics counters/endpoint, performance thresholds,
auth gate, Phase 9 PDF.

**Architecture:** New `RATE_LIMITED` code flows through existing `ERROR_CODES` union
(`shared/src/contracts/envelope.ts`) / `ERROR_STATUS_MAP` (`server/src/lib/errors.ts`,
`Record<ErrorCode, ...>` typing forces both map updates at compile time). A `logStage`
helper in `server/src/lib/log.ts` emits the same one-line JSON format as
`middleware/logger.ts`; pipelines and ingest route call it directly. Golden fixtures
live under `server/src/test-support/fixtures/`, reusing the `fakeGeminiSequence` +
dns-stub + mkdtemp pattern from `server/src/routes/ingest.test.ts`. Browser-fetcher
tests mock the `playwright` module - no Chromium launches anywhere in tests.

**Test commands** (both `test` scripts are `vitest run`, so a path arg filters):
- Server: `pnpm --filter server run test [path]`
- Web: `pnpm --filter web run test [path]`

**Facts verified during planning:**
- Frontend already surfaces envelope requestId on API errors (`client.ts:85`,
  `ErrorBanner.tsx` renders `Request ID:`). Task 9 only adds the outbound header +
  requestId on transport-level failures.
- `services/ai/prompt-version.ts` is a single exported constant - no test needed.
- Pre-existing oddity, do NOT fix in passing: `fetchWithGuardrails` maps
  too-many-redirects to `URL_FETCH_TIMEOUT` (`url-security.ts` ~line 197).
- `server/src/lib/errors.test.ts` does not exhaustively enumerate codes, so adding
  one breaks no existing test.
- `middleware/logger.test.ts:49-52` filters console lines by `"status"`, so extra
  stage-log JSON lines are harmless to existing tests.

---

### Task 1: Add the RATE_LIMITED error code

**Files:**
- Modify: `shared/src/contracts/envelope.ts` (append `'RATE_LIMITED'` to `ERROR_CODES`)
- Modify: `server/src/lib/errors.ts` (`ERROR_STATUS_MAP` + `RATE_LIMITED: 429`,
  `ERROR_DEFAULT_MESSAGE` + user-safe message)
- Modify: `server/src/lib/errors.test.ts`

**Interfaces:** `ErrorCode` union gains `'RATE_LIMITED'`; `new AppError('RATE_LIMITED', ...)`
gets `.status === 429`. Task 2 relies on this.

- [ ] **Step 1:** Append to `errors.test.ts`: `AppError('RATE_LIMITED', 'msg')` has
  status 429; `serializeError` passes code through; `ERROR_DEFAULT_MESSAGE.RATE_LIMITED`
  non-empty (suggestion: `'Too many ingestion requests. Wait a moment and try again.'`).
- [ ] **Step 2:** Run `pnpm --filter server run test src/lib/errors.test.ts` - FAIL.
- [ ] **Step 3:** Implement (code + both map entries; `Record<ErrorCode, ...>` makes
  omissions compile errors).
- [ ] **Step 4:** Full server suite + root `pnpm typecheck` green.
- [ ] **Step 5:** Commit: `feat: add RATE_LIMITED error code (429)`

### Task 2: In-memory fixed-window rate limiter on /api/ingest/*

**Files:**
- Create: `server/src/middleware/rate-limit.ts`, `server/src/middleware/rate-limit.test.ts`
- Modify: `server/src/env.ts` (+ `RATE_LIMIT_MAX` int positive default 10,
  `RATE_LIMIT_WINDOW_MS` int positive default 60000), `server/src/env.test.ts`
- Modify: `server/src/app.ts` (mount before `app.route('/api', ingestApp)` ~line 51)
- Modify: `server/.env.example` (document both vars)

**Interfaces:**
- `createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }): MiddlewareHandler<{ Variables: AppVariables }>`
  - factory closing over `Map<string, { count: number; windowStart: number }>`.
  Injectable `now` (default `Date.now`) keeps tests deterministic.
- Key: first entry of `x-forwarded-for` if present, else literal `'local'`
  (single-user local-first; per-IP only matters behind a proxy - say so in a comment).
- On exceed: `throw new AppError('RATE_LIMITED', ..., { retryAfterMs })` - existing
  `errorHandler` produces the envelope.
- Mount in `createApp`:
  `app.use('/api/ingest/*', createRateLimiter({ max: deps.env.RATE_LIMIT_MAX, windowMs: deps.env.RATE_LIMIT_WINDOW_MS }))`
  after logger, before route mounts. Fresh limiter per `createApp` keeps tests isolated.

- [ ] **Step 1:** Failing tests:
  - Unit (bare `new Hono()` + middleware + dummy route + `onError` from
    `error-handler.js`): allows `max` requests, 429s next, envelope code `RATE_LIMITED`;
    window rollover via injected `now`; distinct `x-forwarded-for` tracked independently.
  - Integration: `createApp` with `loadServerEnv({ ..., RATE_LIMIT_MAX: '2' })` +
    `makeIngestDeps()` from `server/src/test-support/ingest-deps.ts`; POST
    `/api/ingest/url` invalid body 3x -> 400, 400, 429; `/api/recipes` never limited.
  - Env default/override assertions in `env.test.ts`.
- [ ] **Step 2:** Run both test files - FAIL.
- [ ] **Step 3:** Implement middleware, env fields, app.ts mount, `.env.example`.
- [ ] **Step 4:** Full server suite green (ingest.test.ts makes few requests per app
  instance, default max 10 - no conflict).
- [ ] **Step 5:** Commit: `feat: fixed-window in-memory rate limiter for ingest endpoints`

### Task 3: logStage helper

**Files:**
- Create: `server/src/lib/log.ts`, `server/src/lib/log.test.ts`

**Interfaces (later tasks rely on exact names):**
```typescript
export type StageLogFields = {
  requestId: string
  stage: 'fetch' | 'extract' | 'host-images' | 'normalize' | 'post-process' | 'image-rehost'
  durationMs: number
  outcome: 'ok' | 'error'
  errorCode?: string
} & Record<string, unknown>
export function logStage(fields: StageLogFields): void
```
Single `console.log(JSON.stringify({...}))`, same style as `middleware/logger.ts:15-23`.
Round `durationMs`.

- [ ] **Step 1:** Failing test: spy `console.log` (pattern from
  `middleware/logger.test.ts:22`), parse logged string, assert fields + extra detail
  fields (e.g. `fetchMode`) spread into the line.
- [ ] **Step 2:** Run - FAIL. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Step 5:** Commit: `feat: logStage structured stage logging helper`

### Task 4: Stage logging in the URL ingestion pipeline

**Files:**
- Modify: `server/src/services/ingestion/url-ingestion-pipeline.ts`
- Modify: `server/src/services/ingestion/url-ingestion-pipeline.test.ts` (append)

**Log points** (no signature changes - pipeline already receives `requestId`):
- `fetch`: one line covering static fetch + optional browser fallback, emitted just
  after `usedJsonLd` computed (~line 181), `outcome: 'ok'`, extras
  `{ fetchMode, usedJsonLd }`. Thrown fetch errors propagate unlogged (request-level
  logger line still records failure - keep minimal). Min-content throw (~line 174):
  emit `stage: 'fetch', outcome: 'error', errorCode: 'URL_EXTRACTION_FAILED'` (no
  extraction attempted yet).
- `extract`: on primary success (`gemini-primary`), retry success (`gemini-retry`),
  and before the final `URL_EXTRACTION_FAILED` throw (~line 246) with
  `outcome: 'error'`. Duration from just before the primary Gemini call.

- [ ] **Step 1:** Append failing tests: spy `console.log`, run pipeline with the file's
  existing fake fetch/gemini setup, filter lines where `JSON.parse(line).stage` exists;
  assert happy path emits `fetch` (ok, `fetchMode: 'static'`) and `extract` (ok) with
  the passed requestId; both-attempts-fail emits `extract` error with
  `URL_EXTRACTION_FAILED`.
- [ ] **Step 2:** Run - FAIL. **Step 3:** Implement (import from `../../lib/log.js`).
- [ ] **Step 4:** Full server suite green.
- [ ] **Step 5:** Commit: `feat: per-stage structured logs for URL ingestion pipeline`

### Task 5: Stage logging in manual pipeline and ingest route

**Files:**
- Modify: `server/src/services/ingestion/manual-ingestion-pipeline.ts` (`host-images`
  around steps 1-2, `normalize` around Gemini call + pre-check, error line
  `AI_NORMALIZATION_FAILED` before the ~line-124 throw)
- Modify: `server/src/services/ingestion/manual-ingestion-pipeline.test.ts` (append)
- Modify: `server/src/routes/ingest.ts` (both routes: `post-process` around
  `applyPostProcessing`; URL route: `image-rehost` around `rehostRecipeImages`;
  `requestId` already in scope)
- Modify: `server/src/routes/ingest.test.ts` (append one test per route asserting
  stage lines carry the response's requestId)

- [ ] **Step 1:** Failing tests (same spy pattern; route tests reuse `mockFetch` /
  `fakeGeminiSequence` helpers already in the file). Assert stages `post-process` +
  `image-rehost` (URL) / `host-images`, `normalize`, `post-process` (manual).
- [ ] **Step 2:** Run both files - FAIL. **Step 3:** Implement.
- [ ] **Step 4:** Full server suite green.
- [ ] **Step 5:** Commit: `feat: per-stage structured logs for manual pipeline and ingest routes`

### Task 6: browser-fetcher unit tests (mocked playwright)

**Files:**
- Create: `server/src/services/url-ingestion/browser-fetcher.test.ts`

Tests-for-existing-code (not red/green). If a test exposes a real bug, stop and apply
superpowers:systematic-debugging before touching `browser-fetcher.ts`.

**Tricky details (verified against the file):**
- `vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }))` at top (hoisted).
  `browserPromise` is module-level state (line 30): call exported `closeBrowser()` in
  `afterEach` (fake browser needs `close()`) rather than `vi.resetModules()`.
- Fake graph: `browser = { newContext, close }`, `context = { newPage, close }`,
  `page = { route, goto, waitForLoadState, content, url }`;
  `chromium.launch.mockResolvedValue(browser)`.
- SSRF: capture handler passed to `page.route('**/*', handler)` (lines 62-75); stub
  `dns.promises.lookup` like `ingest.test.ts:78` (public IP allow, `127.0.0.1` block).

**Cases:**
1. Happy path: goto `{ status: () => 200 }`, content html, `url()` effective URL ->
   `{ html, effectiveUrl }`; `context.close` called.
2. goto rejects `Object.assign(new Error('t'), { name: 'TimeoutError' })` ->
   `URL_FETCH_TIMEOUT` (lines 112-113); `context.close` still called (finally, 117).
3. Status 403 -> `URL_FETCH_BLOCKED` with `details.status` 403; 500 -> `URL_FETCH_FAILED`
   (lines 85-96).
4. `waitForLoadState('networkidle')` rejection swallowed; html still returned
   (98-102); called with `{ timeout: 5000 }`.
5. `content()` longer than `opts.maxBytes` -> `INVALID_INPUT` (105-106).
6. Route interception handler with fake routes
   (`{ request: () => ({ url: () => ... }), abort, continue }`): `ftp://` -> abort;
   host resolving to `127.0.0.1` -> abort; public host -> continue.
7. Singleton: two calls -> one `chromium.launch`; after `closeBrowser()` a third call
   launches again.

- [ ] **Step 1:** Write tests. **Step 2:** Run - expect PASS (code exists).
- [ ] **Step 3:** Full server suite.
- [ ] **Step 4:** Commit: `test: browser fetcher unit tests with mocked playwright`

### Task 7: Golden fixtures - URL ingestion flow

**Files:**
- Create: `server/src/test-support/fixtures/html/recipe-plain.html`,
  `html/recipe-json-ld.html` (schema.org Recipe only in
  `<script type="application/ld+json">`, thin visible text), `html/non-recipe.html`
- Create: `server/src/test-support/fixtures/gemini/url-candidate.json`
  (`VALID_CANDIDATE`-shaped, remote `main_image` on `cdn.example.com`),
  `gemini/ingredient-match.json` (real catalog filenames, same order/length as
  candidate ingredients)
- Create: `server/src/test-support/fixtures/expected/url-recipe.json`
- Create: `server/src/routes/ingest-golden.test.ts`

**Details:**
- Reuse `ingest.test.ts` patterns exactly: mkdtemp data/image dirs,
  `vi.spyOn(dns.promises, 'lookup')` public IP, `makeApp` with
  `BROWSER_FALLBACK_ENABLED: 'false'`, `fakeGeminiSequence` (call 1 = candidate,
  call 2 = matcher), mocked `globalThis.fetch` serving fixture HTML + tiny byte
  buffer for cdn images.
- Load fixtures via `readFileSync` relative to `import.meta.url`.
- Nondeterminism: `normalizeRecipe(recipe)` helper replaces `/images/<uuid>/` with
  `/images/__ID__/`; strip `diagnostics.durationMs`; expected fixture uses `__ID__`.
- Golden capture: write test against initially-empty expected fixture; run; it fails
  printing actual normalized output; MANUALLY REVIEW against schema/candidate (never
  blind-copy); save as `expected/url-recipe.json`; re-run green.

**Tests:**
1. Plain-HTML happy path -> 200, deep-equals expected, `extractor === 'gemini-primary'`.
2. JSON-LD variant -> 200, `usedJsonLd === true`, fake Gemini first-call prompt
   contains a distinctive string from the fixture's JSON-LD.
3. Blocked: page fetch 403 -> 422 `URL_FETCH_BLOCKED`, Gemini never called.
4. Non-recipe html -> 422 `URL_EXTRACTION_FAILED`, Gemini never called.
5. Timeout: fetch rejects `Object.assign(new Error('aborted'), { name: 'AbortError' })`
   -> 504 `URL_FETCH_TIMEOUT`.

- [ ] **Step 1:** Fixtures + test file with expected placeholder.
- [ ] **Step 2:** Run - happy path FAILS showing actual output.
- [ ] **Step 3:** Review + capture expected fixture; re-run PASS.
- [ ] **Step 4:** Full server suite.
- [ ] **Step 5:** Commit: `test: golden-fixture integration tests for URL ingestion`

### Task 8: Golden fixtures - manual ingestion flow

**Files:**
- Create: `server/src/test-support/fixtures/gemini/manual-candidate.json`,
  `expected/manual-with-images.json`, `expected/manual-without-step-images.json`
- Modify: `server/src/routes/ingest-golden.test.ts` (append manual describe block)

**Details:** copy `makeImageFile` / `validFormData` helpers from `ingest.test.ts` into
the golden file (keep `ingest.test.ts` untouched). "Without images" = mainImage only
(mainImage required - 400 case covered elsewhere). Hosted URLs go through the same
`normalizeRecipe`. Assert `metadata.source_type === 'manual'` survives (candidate
deliberately says `'url'`, like `VALID_MANUAL_CANDIDATE` at ingest.test.ts:264-278).
Same golden capture procedure.

- [ ] **Step 1:** Fixtures + failing tests. **Step 2:** Capture/review expected, green.
- [ ] **Step 3:** Full server suite.
- [ ] **Step 4:** Commit: `test: golden-fixture integration tests for manual ingestion`

### Task 9: Frontend outbound x-request-id + requestId on transport failures

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/client.test.ts`

**Details:** in `request()` (~line 56): `const requestId = crypto.randomUUID();`
(available in browser + jsdom/Node test env). Merge into headers without clobbering:
`headers: { ...(init?.headers as Record<string, string>), 'x-request-id': requestId }`
- the manual-ingest FormData path passes no headers object; spreading undefined adds
nothing, so no accidental Content-Type. Change `networkFailure()` /
`malformedResponseFailure()` to take the id so transport failures carry a requestId
(`ErrorBanner` already renders it). Error-envelope path keeps preferring
`errorEnvelope.requestId` (same value anyway - `request-id.ts:16` honors inbound header).

- [ ] **Step 1:** Failing tests (existing `vi.stubGlobal('fetch', ...)` pattern):
  (a) `ingestUrl` sends `x-request-id` alongside Content-Type; (b) `ingestManual`
  sends it and does NOT set Content-Type; (c) fetch rejection -> `error.requestId`
  equals the sent header.
- [ ] **Step 2:** Run `pnpm --filter web run test src/api/client.test.ts` - FAIL.
- [ ] **Step 3:** Implement. **Step 4:** Full web suite +
  `pnpm --filter web run typecheck`.
- [ ] **Step 5:** Commit: `feat: send x-request-id from the frontend and keep requestId on transport failures`

### Task 10: RTL tests for FieldErrors, StageStatus, IngestTabs

**Files:**
- Create: `apps/web/src/components/review/FieldErrors.test.tsx`
- Create: `apps/web/src/components/ingest/StageStatus.test.tsx`
- Create: `apps/web/src/components/ingest/IngestTabs.test.tsx`

Tests-for-existing-code. Follow sibling test conventions (`WarningsPanel.test.tsx`,
`UrlTab.test.tsx`).
- FieldErrors: `role="alert"`; form errors listed; field errors grouped under field
  name; empty formErrors renders no form list.
- StageStatus: phases from `apps/web/src/workspace-types.ts` - `submitting` ->
  "Submitting...", `processing` -> its message text, `complete` -> "Complete.",
  `idle`/`error` -> renders nothing; `role="status"`.
- IngestTabs: three `role="tab"` in tablist named "Ingestion method"; URL selected by
  default (`aria-selected`); clicking Manual/Load JSON swaps panel (assert on a
  distinctive control from ManualTab/LoadJsonTab - check rendered labels first).
  Tabs call API only on submit, plain render safe.

- [ ] **Step 1:** Write tests. **Step 2:** Run - expect PASS; debug systematically if not.
- [ ] **Step 3:** Full web suite.
- [ ] **Step 4:** Commit: `test: FieldErrors, StageStatus, and IngestTabs component tests`

### Task 11: Remove unused GEMINI_MAX_RETRIES env var

**Decision: remove, don't wire.** Both retry paths are structurally single-retry with
different prompt/model on the second attempt (URL pipeline: retry prompt + retryModel +
halved budget, `url-ingestion-pipeline.ts:213-243`; matcher: one retry then degrade).
A numeric count maps to neither shape. Grep-verified only usages: `config.ts:13,22,39`
+ `config.test.ts`.

**Files:**
- Modify: `server/src/services/ai/config.ts` (drop schema field, type field, loader line)
- Modify: `server/src/services/ai/config.test.ts` (remove `maxRetries` assertions at
  lines 13, 28-36, 47-60; add test that `GEMINI_MAX_RETRIES: '2'` still parses -
  unknown keys ignored by zod object)
- Modify: `server/.env.example` (delete the var; note next to `GEMINI_RETRY_MODEL`
  that the pipeline performs exactly one retry, not configurable)

- [ ] **Step 1:** Update `config.test.ts`. **Step 2:** Implement removals.
- [ ] **Step 3:** `pnpm --filter server run test && pnpm --filter server run typecheck`
  (typecheck is the real guard for forgotten consumers).
- [ ] **Step 4:** Commit: `refactor: remove unused GEMINI_MAX_RETRIES (retry is fixed single-attempt by design)`

### Task 12: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml` (no `.github` dir exists yet)
- Modify: root `package.json` (add `"packageManager": "pnpm@9.14.2"` - matches local;
  verify with `pnpm --version` before writing)

**Details:**
- Trigger: `push` to `main` + `pull_request`.
- Steps: `actions/checkout@v4`; `pnpm/action-setup@v4` (reads `packageManager`);
  `actions/setup-node@v4` node 22 + `cache: pnpm`; `pnpm install --frozen-lockfile`
  (root `postinstall` runs shared's `generate:manifest` automatically - required
  before tests); `pnpm typecheck`; `pnpm test` (existing recursive root scripts).
- No Playwright browser install - verified safe: every server test sets
  `BROWSER_FALLBACK_ENABLED: 'false'`, injects a fake fetcher, or mocks `playwright`;
  importing the package never downloads/launches Chromium.

- [ ] **Step 1:** Write workflow + packageManager field.
- [ ] **Step 2:** Run locally: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` - green.
- [ ] **Step 3:** Commit: `ci: GitHub Actions workflow (install, typecheck, test)`.
- [ ] **Step 4:** After push, verify run passes via `gh run list --workflow=ci.yml`.

### Task 13: Documentation updates

**Files:**
- Modify: `CLAUDE.md` (Status: Phase 8 done - rate limiting, stage logs, golden
  fixtures, CI; "Next:" becomes Phase 9 PDF upgrade (future))
- Modify: `plans/recipe-maker-implementation-plan.md` (Phase 8 section ~lines 518-546:
  mark done with scope note recording locked decisions - in-memory fixed-window
  limiter on ingest only; stage logs via logStage, metrics deferred; fixture set
  covers URL happy/blocked/non-recipe/timeout + manual with/without step images,
  Load JSON stays frontend-tested; GEMINI_MAX_RETRIES removed in favor of fixed
  single retry; CI = install/typecheck/test with Playwright mocked)
- Modify: `specs/11-testing-observability-and-ops.md` (metrics bullets: "deferred -
  stage logs only for now"; Gemini "fallback model chain" -> single fixed retry model,
  count not configurable; guardrails: note implemented rate-limit env vars; release
  gates: performance thresholds deferred)

- [ ] **Step 1:** Make edits (+ README.md only if it documents changed env vars).
- [ ] **Step 2:** Re-read all three for consistency; root `pnpm test` once more.
- [ ] **Step 3:** Commit: `docs: Phase 8 quality/testing/hardening complete with scope decisions`

---

## Task ordering rationale

Tasks 1-2 dependency chain (error code -> limiter). Task 3 precedes 4-5 (consumers).
Tasks 6-8 independent, before CI so the first workflow run exercises them. Tasks 9-10
frontend, independent. Task 11 anytime. Task 12 after all code tasks so CI is green
on first push. Task 13 last.

## Verification

- Per task: TDD steps as written; full package suite after each task.
- End of phase: root `pnpm typecheck && pnpm test` all green; push and confirm CI run
  passes (`gh run list --workflow=ci.yml`).
- Manual smoke: start `pnpm dev` (remember `server/.env` is not auto-loaded), ingest
  one real URL, confirm stage log lines with matching requestId appear in server
  output and the browser network tab shows the outbound `x-request-id` echoed back.
  Fire >RATE_LIMIT_MAX rapid ingest requests, confirm 429 envelope with RATE_LIMITED.
  Do not use example.com for smoke tests (unresolvable via router DNS).
