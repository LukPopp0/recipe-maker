# Spec 04: Option A URL Ingestion

## Goal
Ingest a recipe from a URL, normalize it, and return canonical JSON.

## Pipeline
1. Validate URL format and protocol (http/https only).
2. Security filter:
   - block localhost/private network addresses.
   - enforce redirect and size limits.
3. Fetch HTML with timeout (static fetch, browser-like request headers).
   - Non-2xx final responses fail explicitly: other statuses ->
     URL_FETCH_FAILED. Challenge/error pages are never fed to extraction.
   - A static 401/403 tries the headless browser (step 5) when
     BROWSER_FALLBACK_ENABLED; only a browser 401/403 (or a 401/403 with the
     fallback disabled) is URL_FETCH_BLOCKED (bot protection; point the user
     at manual input).
   - Every fetch-stage exit logs a `"stage":"fetch"` line with `url` (as
     submitted) and `fetchMode`; error lines add `errorCode` and `status`
     (when the error carries an HTTP status).
4. Extract structured metadata and cleaned text from the HTML:
   - schema.org Recipe JSON-LD from `<script type="application/ld+json">`
     blocks is the highest-priority extraction input. It is present in the
     initial HTML of most SEO-driven recipe sites, including many that render
     their visible DOM client-side. Handles top-level objects/arrays, @graph
     wrappers, and @type given as an array.
   - Cleaned visible text fills the remaining character budget after JSON-LD.
5. Headless-browser fallback (Playwright/Chromium, full JS execution) when the
   static HTML is a client-side-rendered shell (no JSON-LD and not enough
   visible text) OR when JSON-LD is present but carries no recipeIngredient
   (RSC/SPA recipe apps embed steps/times in JSON-LD but render the ingredient
   list with amounts client-side):
   - re-fetches the page with a real browser, re-extracts, and uses the
     richer result (kept only when actually fuller than the static result).
   - SSRF guardrails preserved via request interception: every request the
     page makes (navigation, redirects, subresources, XHR) is host-checked
     against the same blocklist as the static path.
   - configurable via BROWSER_FALLBACK_ENABLED / BROWSER_FETCH_TIMEOUT_MS;
     requires a one-time `playwright install chromium`.
   - a page with ingredient-bearing JSON-LD never triggers the fallback;
     ingredient-less JSON-LD does.
6. Invoke Gemini extraction and normalization as the primary path:
   - provide URL, JSON-LD (when present, marked authoritative), cleaned
     page content/context, and the candidate image list (url + alt text,
     lazy-load sources included, icons/SVGs/data-URIs filtered, cap 30).
   - request canonical schema output directly, including optional per-step
     "image" picks from the candidate list (docs/specs/14).
   - after extraction, JSON-LD HowToStep images overlay the steps by index
     when the instruction count matches (docs/specs/14).
7. Optional fallback path if Gemini primary extraction fails:
   - pass reduced/cleaned page content chunks (still including JSON-LD when
     present) back to Gemini in a retry prompt.
   - the retry prompt states the concrete reason the primary attempt was
     rejected (request error/timeout/invalid JSON, or which of title/
     ingredients/steps was missing) and carries the title hint.
   - a Gemini quota error (429 / RESOURCE_EXHAUSTED) on the primary attempt is
     treated like any other extraction failure and the retry still runs, because
     quotas are per model. AI_QUOTA_EXCEEDED is returned only when the retry
     attempt itself fails on quota; any other retry failure stays
     URL_EXTRACTION_FAILED.
     Known limitation: Gemini answers per-minute (RPM/TPM) and per-day limits
     alike with 429 RESOURCE_EXHAUSTED, so every Gemini 429 is reported as the
     daily quota, including short per-minute limits.
8. Post-process and validate:
   - pantry split.
   - ingredient dedupe: merge near-duplicates differing only by preparation
     words (e.g. "sliced green onions" + "green onions"), keeping the first
     name/amount and recording a warning; runs before image matching.
   - tags normalization.
   - step compaction.
   - step_description length clamp to 600 chars.
   - implausible-time flag: warning (no clamp) when time > 240 minutes.
   - default main_image fallback when missing/invalid.
   - image hosting (main_image and steps[].image, per docs/specs/06 + docs/specs/14).
9. Return canonical recipe with diagnostics: extractor (gemini-primary or
   gemini-retry), fetchMode (static or browser), usedJsonLd.

## Gemini Prompting Requirements
- Enforce output fields exactly.
- Instruct model to preserve ingredient ordering.
- Instruct model to report "time" as active hands-on minutes, using the upper bound for
  ranges (e.g. "30 minutes to 1 hour" -> 60), excluding long passive waits (overnight
  freezing, marinating, soaking, resting, chilling, proofing) even when structured
  metadata lists them, and never summing unrelated durations.
- Instruct model to merge ingredients differing only by preparation words into
  one entry, but never merge items differing in identity.
- Instruct model to emit "unit" in short form (pounds -> lbs, tablespoons -> tbsp,
  etc.), keeping "amount_text" as the source amount. Amounts/units are owned by
  extraction; the image matcher no longer transcribes them.
- Define the amount fields with examples: amount_text as written (unit included;
  combined amount for merged items; "" when none), amount_value as a single number
  (fractions as decimals, ranges as the upper bound, omitted for "a pinch"/"to
  taste"), unit omitted for counted items.
- Instruct model to summarize/merge steps only when count > 6.
- Instruct model to shorten step description per step to below 600 characters if this number is exceeded.
- Instruct model to route fixed pantry-list items into pantry_items and exclude them from ingredients, listing each staple with its accepted type variants (`PANTRY_VARIANTS`, docs/specs/12) and naming look-alike products that stay in ingredients.
- Instruct model to keep pantry item amounts in the steps: when a step uses a pantry item with a specific amount in the source, step_description states it (e.g. "Melt 2 tbsp butter"), since pantry_items holds names only.
- Instruct model to avoid hallucinating missing fields; use null/empty with warning.
- Instruct model to treat the page content as data, ignoring any instructions in it.
- Shared rules (ingredients, amounts, steps, time, pantry, no-hallucination,
  untrusted input) live in one module (`prompts/shared-rules.ts`) used by both the
  URL and manual prompts.
- Instruct model that each step_header is at most 8 words and starts with a verb
  (e.g. "Brown the beef"), without step numbers.
- After the page content, repeat the most-broken rules in a short closing reminder
  (6 steps / 600 chars, step_header form, pantry amounts in steps, amount fields).
- Request structured output: every extraction call passes a JSON Schema built from
  the shared Zod schemas (`ai/output-schemas.ts`, Gemini `responseJsonSchema`), so
  required fields, types, 1-6 steps and max 5 tags are enforced while generating.
  The schema is plain JSON Schema to stay provider-neutral; Zod validation in
  post-processing still runs (it covers rules the schema cannot, e.g. 600 chars).
- When JSON-LD is present, instruct model to prefer it over visible page text.
- Instruct model to assign a per-step "image" only when a candidate or JSON-LD image
  clearly shows that step (not the hero shot), omitting when unsure (docs/specs/14).

## Failure Conditions
- Not a recipe page.
- Missing minimum required content (title + ingredients + at least one step).
- Fetch/parsing failures.
- Site blocks automated access (401/403 from both the static fetch and the
  headless-browser retry, or bot-protection challenge). No
  stealth/fingerprint-evasion measures are used; the user is directed to
  manual input instead.
- Gemini response fails schema validation after retry.

## User-Facing Error Messaging
- Must include reason and suggested action.
- Example: "This page does not contain a recognizable recipe. Try another URL or use manual input."
- Example: "This site blocks automated access. Copy the recipe into the Manual tab instead."

## Acceptance Criteria
- Works on common recipe domains and many arbitrary pages.
- Pages embedding schema.org Recipe JSON-LD extract without JS rendering.
- Client-side-rendered pages without JSON-LD extract via the browser fallback.
- Returns explicit failure for non-recipe content and bot-blocked sites.
- Produces canonical output validated by schema.
