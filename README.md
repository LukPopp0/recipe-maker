# Recipe Maker

Recipe Maker turns a recipe from a web page, or from text and photos you
provide, into a clean, structured recipe with at most six steps. It uses
Gemini to read the source, sorts the ingredients into main and pantry items,
matches each ingredient to an image, and lets you save recipes to a shared
library and print them as a two-page recipe card.

## Features

- Ingest a recipe from a URL (JSON-LD first, headless browser fallback) or
  from pasted text and images; load an existing recipe from JSON.
- Normalized recipes: at most 6 steps, ingredients split into main and
  pantry, tags from a fixed vocabulary. Input is English only.
- Ingredient images matched from a bundled catalog of 215 images; step images
  extracted from the source or uploaded in the review panel.
- Editable review panel; saving is always an explicit action.
- Library with a My/All switch, JSON download, and "Open in Create".
- Printable two-page letter-size recipe card (landscape or portrait) through
  the browser print dialog.
- Multi-user behind a login: every recipe has an owner, everyone can edit,
  only the owner or an admin can delete.
- Single Docker image with SQLite storage for self-hosting.

## Quick start

You need Node.js 22 or newer and a Gemini API key (free tier works).

```bash
corepack enable
pnpm install
pnpm --filter server exec playwright install chromium
cp server/.env.example server/.env
pnpm dev
```

Edit `server/.env` and set `GEMINI_API_KEY` before ingesting a recipe.
Open the URL Vite prints (usually http://localhost:5173/). The Chromium
download is optional; details, tests and troubleshooting are in
[docs/local-development.md](docs/local-development.md).

## Self-hosting

Recipe Maker runs as one Docker image behind nginx and a login service such
as tinyauth, with recipes in SQLite and images on disk. The published image
is `linux/arm64`; on x86 you build it yourself. The step-by-step guide covers
both: [docs/self-hosting.md](docs/self-hosting.md).

## Documentation

- [docs/local-development.md](docs/local-development.md) - set up, run, test
  and debug on your machine
- [docs/self-hosting.md](docs/self-hosting.md) - deploy with Docker, nginx,
  users, backups, updates
- [docs/configuration.md](docs/configuration.md) - every environment variable
  and its default
- [docs/architecture.md](docs/architecture.md) - packages, ingestion
  pipelines, storage, auth, card rendering
- [docs/specs/](docs/specs/) - one spec per feature

## Status

MVP phases 0-8 and 10 are done: both ingestion pipelines, ingredient image
matching, library, printable cards, hardening and step images. Deployment
phases D1-D7 are done: auth and users, SQLite storage and ownership, image
normalization, Gemini quota handling, Docker image and CI, server setup and
these docs. Deferred: Phase 9 (server-side PDF) and Phase 11 (automatic step
image generation).
