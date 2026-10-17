# Configuration reference

The server is configured only through environment variables. Unset variables
use the defaults below; invalid values (for example a non-numeric `PORT`)
stop the server at startup with a message naming the variable.

Where to set them:

- Locally: in `server/.env` (copy `server/.env.example`).
- In Docker: in the `environment:` list of the `recipes` service in your
  compose file (see `docker-compose.example.yml`). Only variables listed there
  reach the container; putting a value in the compose `.env` file is not
  enough unless the `environment:` list references it (`NAME: ${NAME}`). A
  listed variable that is missing from `.env` reaches the app as an empty
  string, not unset (numeric ones then fail at startup, an empty
  `WEB_DIST_DIR` turns the web app off), so set it in `.env` too or write the
  value directly in the compose file.

The "Docker image" column shows what the published image presets. A dash
means the image sets nothing and the default applies. Relative paths resolve
against the server's working directory.

Sources: `server/src/env.ts` and `server/src/services/ai/config.ts`.

## Server

| Name | Default | Docker image | Meaning |
| --- | --- | --- | --- |
| `PORT` | `8787` | `8787` | Port the server listens on. |
| `NODE_ENV` | `development` | `production` | One of `development`, `production`, `test`. With `production` and `AUTH_MODE=none` the server logs a startup warning. |
| `PUBLIC_BASE_URL` | `http://localhost:{PORT}` | - | Public URL of the app, without a trailing slash (e.g. `https://recipes.example.com`). Used to build stored image URLs, so set it before saving recipes. |
| `WEB_DIST_DIR` | unset | `/app/apps/web/dist` | Built frontend (`apps/web/dist`) to serve from this server. Leave unset locally (Vite serves the frontend). An empty value turns the web app off. |
| `INGREDIENT_ASSET_DIR` | `../shared/assets/ingredients` | `/app/shared/assets/ingredients` | Ingredient catalog images, served at `/ingredient-images/*`. |

## Storage

| Name | Default | Docker image | Meaning |
| --- | --- | --- | --- |
| `RECIPE_STORE` | `json` | `sqlite` | `json` keeps one file per recipe in `RECIPE_DATA_DIR`; `sqlite` keeps all recipes in one database at `RECIPE_DB_PATH`. |
| `RECIPE_DATA_DIR` | `./data/recipes` | - | Directory for recipe JSON files (`RECIPE_STORE=json`). |
| `RECIPE_DB_PATH` | `./data/db/recipes.db` | `/app/data/db/recipes.db` | SQLite database file (`RECIPE_STORE=sqlite`). |

## Images

| Name | Default | Docker image | Meaning |
| --- | --- | --- | --- |
| `IMAGE_DATA_DIR` | `./data/images` | `/app/data/images` | Where uploaded and re-hosted images are stored. |
| `IMAGE_MAX_BYTES` | `8000000` | - | Maximum size of a single image (download or upload), in bytes. |
| `MANUAL_REQUEST_MAX_BYTES` | `20000000` | - | Maximum body size of a manual ingest request, in bytes. |
| `DEFAULT_MAIN_IMAGE_URL` | unset | - | Image used for recipes without a main image. Unset or empty uses the bundled placeholder at `/images/placeholder-recipe.png`. |

## URL ingestion

| Name | Default | Docker image | Meaning |
| --- | --- | --- | --- |
| `URL_FETCH_TIMEOUT_MS` | `8000` | - | Timeout for the plain HTTP fetch of a recipe page, in milliseconds. |
| `URL_MAX_REDIRECTS` | `3` | - | Maximum redirects followed when fetching a page. `0` disables following. |
| `URL_MAX_RESPONSE_BYTES` | `5000000` | - | Maximum size of a fetched page, in bytes. |
| `BROWSER_FALLBACK_ENABLED` | `true` | - | Use headless Chromium (Playwright) for pages that need JavaScript or block the plain fetch. `false` or `0` disables it; any other value enables it. Locally it needs `pnpm --filter server exec playwright install chromium`; the Docker image includes the browser. |
| `BROWSER_FETCH_TIMEOUT_MS` | `15000` | - | Navigation timeout of the browser fallback, in milliseconds. |

## Gemini

| Name | Default | Docker image | Meaning |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | unset | - | Gemini API key. Required for URL and manual ingestion; without it those requests fail. Loading JSON and browsing saved recipes work without it. |
| `GEMINI_PRIMARY_MODEL` | `gemini-3.5-flash-lite` | - | Model used for recipe normalization. |
| `GEMINI_RETRY_MODEL` | `gemini-3.1-flash-lite` | - | Model for the single retry when the primary call fails. The retry count is fixed. |
| `GEMINI_TIMEOUT_MS` | `60000` | - | Timeout of one Gemini call, in milliseconds. Full extractions take 20-40 s, so do not go below the default. |
| `GEMINI_TOKEN_BUDGET` | `8000` | - | Maximum tokens per Gemini request. |

## Auth

| Name | Default | Docker image | Meaning |
| --- | --- | --- | --- |
| `AUTH_MODE` | `none` | `header` | `none` runs every request as the admin user `local` (local use only). `header` trusts the `Remote-User` header set by the reverse proxy after login. Use `header` only when the app port is reachable solely through that proxy; otherwise anyone can send the header and impersonate any user. A request without the header is rejected (`UNAUTHENTICATED`). |
| `ADMIN_USERS` | empty | - | Comma-separated usernames (matched case-insensitively, as sent in `Remote-User`) that may delete any recipe and clean up unused images. Ignored when `AUTH_MODE=none`, where the user is always admin. |

## Rate limiting

Applies to `/api/ingest/*` only. The limiter is in memory and per process,
and keys on the first `X-Forwarded-For` entry (so the reverse proxy must set
that header itself). Exceeding it returns `RATE_LIMITED` (429).

| Name | Default | Docker image | Meaning |
| --- | --- | --- | --- |
| `RATE_LIMIT_MAX` | `10` | - | Maximum ingest requests per client per window. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | - | Window length in milliseconds. |
