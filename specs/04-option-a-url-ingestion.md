# Spec 04: Option A URL Ingestion

## Goal
Ingest a recipe from a URL, normalize it, and return canonical JSON.

## Pipeline
1. Validate URL format and protocol (http/https only).
2. Security filter:
   - block localhost/private network addresses.
   - enforce redirect and size limits.
3. Fetch HTML with timeout (static fetch, browser-like request headers).
   - Non-2xx final responses fail explicitly: 401/403 -> URL_FETCH_BLOCKED
     (bot protection; point the user at manual input), other statuses ->
     URL_FETCH_FAILED. Challenge/error pages are never fed to extraction.
4. Extract structured metadata and cleaned text from the HTML:
   - schema.org Recipe JSON-LD from `<script type="application/ld+json">`
     blocks is the highest-priority extraction input. It is present in the
     initial HTML of most SEO-driven recipe sites, including many that render
     their visible DOM client-side. Handles top-level objects/arrays, @graph
     wrappers, and @type given as an array.
   - Cleaned visible text fills the remaining character budget after JSON-LD.
5. Headless-browser fallback (Playwright/Chromium, full JS execution) when the
   static HTML has neither JSON-LD nor enough visible text to plausibly be a
   recipe page (client-side-rendered shell):
   - re-fetches the page with a real browser, re-extracts, and uses the
     richer result.
   - SSRF guardrails preserved via request interception: every request the
     page makes (navigation, redirects, subresources, XHR) is host-checked
     against the same blocklist as the static path.
   - configurable via BROWSER_FALLBACK_ENABLED / BROWSER_FETCH_TIMEOUT_MS;
     requires a one-time `playwright install chromium`.
   - a page with JSON-LD never triggers the fallback.
6. Invoke Gemini extraction and normalization as the primary path:
   - provide URL, JSON-LD (when present, marked authoritative), and cleaned
     page content/context.
   - request canonical schema output directly.
7. Optional fallback path if Gemini primary extraction fails:
   - pass reduced/cleaned page content chunks (still including JSON-LD when
     present) back to Gemini in a retry prompt.
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
   - image hosting.
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
- Instruct model to summarize/merge steps only when count > 6.
- Instruct model to shorten step description per step to below 600 characters if this number is exceeded.
- Instruct model to route fixed pantry-list items into pantry_items and exclude them from ingredients.
- Instruct model to avoid hallucinating missing fields; use null/empty with warning.
- When JSON-LD is present, instruct model to prefer it over visible page text.

## Failure Conditions
- Not a recipe page.
- Missing minimum required content (title + ingredients + at least one step).
- Fetch/parsing failures.
- Site blocks automated access (401/403, bot-protection challenge). No
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
