# Self-hosting

How to run Recipe Maker on your own server with Docker, behind nginx (HTTPS)
and [tinyauth](https://github.com/tinyauthapp/tinyauth) (login). Every
environment variable is listed in [configuration.md](configuration.md); to
work on the code, see [local-development.md](local-development.md).

The examples use `recipes.example.com` for the app, `auth.recipes.example.com`
for the login page, the users `alice` and `bob`, and `/opt/recipes` as the
install directory. Replace them with your own values.

## Overview

```
                     server
 browser             +--------------------------------------------------+
    |   HTTPS        | nginx (TLS, ports 80/443)                        |
    +--------------->|   auth.recipes.example.com --> tinyauth  :3000   |
                     |   recipes.example.com                            |
                     |     1. auth_request --------> tinyauth  :3000    |
                     |        (logged in? which user?)                  |
                     |     2. proxy + Remote-User --> app      :8787    |
                     |                                                  |
                     | docker compose (both ports on 127.0.0.1 only)    |
                     |   recipes   ./data/db      SQLite database       |
                     |             ./data/images  recipe images         |
                     |   tinyauth  tinyauth-data  login sessions        |
                     +--------------------------------------------------+
```

- nginx terminates TLS and asks tinyauth on every request whether the visitor
  is logged in. If not, it redirects to the login page on
  `auth.recipes.example.com`.
- If they are, nginx forwards the request to the app with the username in the
  `Remote-User` header. The app has no accounts of its own; it trusts that
  header (`AUTH_MODE=header`) and records the username as recipe owner.
- The app keeps recipes in SQLite (`data/db/recipes.db`) and images in
  `data/images/`, both bind-mounted from the install directory. tinyauth keeps
  its sessions in the named volume `tinyauth-data`.

## Requirements

- A Linux server with Docker and the Docker Compose plugin
  (`docker compose version` works).
- A domain with two DNS A records (IPv4) pointing at the server:
  `recipes.example.com` and `auth.recipes.example.com`. The login host must
  be a subdomain of the app host (see [Troubleshooting](#troubleshooting)).
  The nginx sites below listen on IPv4 only; an AAAA record (IPv6) also needs
  `listen [::]:80;` in both sites, otherwise certbot's challenge fails over
  IPv6 (not covered by the setup tested for this guide).
- nginx and certbot on the host for HTTPS (on Debian/Ubuntu:
  `sudo apt install nginx certbot python3-certbot-nginx`). Other reverse
  proxies work too, as long as they do what the nginx config below does; only
  nginx is shown here.
- A Gemini API key ([aistudio.google.com/apikey](https://aistudio.google.com/apikey),
  the free tier works).
- About 5 GB of free disk per image version (the image is about 4 GB because
  it includes Chromium).
- The published image is `linux/arm64` only. On an x86 server, build the
  image yourself first (see
  [Building the image yourself](#building-the-image-yourself)), before
  Data directories and Start.

The commands below assume a user who can run `docker` (member of the
`docker` group) and `sudo`.

## Get the files

From a checkout of the repository (`git clone` it anywhere), copy the two
example files into the install directory:

```bash
sudo mkdir -p /opt/recipes
sudo chown "$USER" /opt/recipes
cp docker-compose.example.yml /opt/recipes/docker-compose.yml
cp docker.env.example /opt/recipes/.env
chmod 600 /opt/recipes/.env
cd /opt/recipes
```

`docker compose` reads `.env` next to `docker-compose.yml` automatically. Run
all later `docker compose` commands from `/opt/recipes`.

### docker-compose.yml

- **Image.** Replace `OWNER` in `ghcr.io/OWNER/recipe-maker:latest` with the
  GitHub owner (user or organization) that publishes the image, in lowercase
  (GHCR names must be lowercase). CI publishes `latest` and a `sha-<7>` tag
  per commit on `main` and keeps the last 10 versions. Pin a `sha-<7>` tag if
  you want to decide when to update (see [Updates](#updates-and-rollback)). If
  you build the image yourself, use `image: recipe-maker`.
- **tinyauth** is pinned to `v5.2.0`, the version this setup was verified
  with. Read the tinyauth release notes before moving to a newer tag.
- **`environment:`** The `recipes` service gets an explicit list of variables
  interpolated from `.env` (`NAME: ${NAME}`), so tinyauth's password hashes in
  the same `.env` never reach the app container. Any other setting from
  [configuration.md](configuration.md) must be added to this list too; putting
  it only into `.env` has no effect on the app. A variable that is listed
  here but missing from `.env` reaches the app as an empty string, not unset:
  numeric ones then fail at startup and an empty `WEB_DIST_DIR` turns the web
  app off. So set it in `.env` too, or write the value directly in the
  compose file.
- **`init: true`** runs a small init process in the container that reaps the
  Chromium processes left behind by the URL browser fallback.
- **`stop_grace_period: 45s`** lets an ingest that is in progress (browser
  fetch plus Gemini calls) finish when the container is stopped or updated.
- **Ports** are bound to `127.0.0.1`, so only nginx on the same host can reach
  the app (8787) and tinyauth (3000). Keep it that way; see the warning in
  [nginx and HTTPS](#nginx-and-https).
- **`TINYAUTH_LABELPROVIDER: none`**: no Docker socket is mounted and no
  access-control labels are used; the default (`auto`) probes for the socket
  and logs a warning.
- **`tinyauth-data:/data`** keeps tinyauth's session database in a named
  volume, so `docker compose down` and `up` do not log everyone out.

### .env

Edit `.env` (`nano /opt/recipes/.env`):

| Name | Value |
| --- | --- |
| `GEMINI_API_KEY` | Your Gemini API key. |
| `PUBLIC_BASE_URL` | `https://recipes.example.com`, no trailing slash. Stored image URLs are built from it, so set it before saving recipes. |
| `AUTH_MODE` | `header` (trust `Remote-User` from nginx). See [Without a login service](#without-a-login-service) for `none`. |
| `ADMIN_USERS` | Comma-separated usernames that may delete any recipe and clean up unused images, e.g. `alice`. |
| `TINYAUTH_APPURL` | `https://auth.recipes.example.com`, the login page. |
| `TINYAUTH_AUTH_USERS` | Logins as `username:bcrypt-hash`, comma-separated, inside single quotes. See [Users](#users). |
| `TINYAUTH_AUTH_SECURECOOKIE` | `true` (the login cookie is sent over HTTPS only). |

## Data directories

The image runs as the user `pwuser`, uid and gid 1001. Check it with:

```bash
docker run --rm ghcr.io/OWNER/recipe-maker:latest id
# uid=1001(pwuser) gid=1001(pwuser) groups=1001(pwuser),100(users)
```

(or `docker run --rm recipe-maker id` for a local build). Create the data
directories and give them to that uid before the first start; otherwise
Docker creates them owned by root and the app exits at startup with
`Storage directory is not writable`:

```bash
cd /opt/recipes
mkdir -p data/db data/images && sudo chown -R 1001:1001 data
```

## Users

Logins live in tinyauth (`TINYAUTH_AUTH_USERS` in `.env`); the app has no
accounts of its own. The login name is what the app shows in the header and
stores as recipe owner, so pick it once and keep it. Usernames: lowercase, no
`:`.

### Add a user

1. Create the password hash:

   ```bash
   docker run --rm -it ghcr.io/tinyauthapp/tinyauth:v5.2.0 user create --interactive
   ```

   Enter the username and password. Answer **No** when asked whether to
   format the output for Docker: the value in `.env` is single-quoted, so
   each `$` must stay single. Under "Environment variable" it prints
   `TINYAUTH_AUTH_USERS=alice:$2a$10$...`; you need the part after the `=`,
   `alice:$2a$10$...`.

2. Add it to `.env`, inside the single quotes, separated from other users by
   a comma, every `$` left as is. Keep exactly one `TINYAUTH_AUTH_USERS`
   line:

   ```bash
   TINYAUTH_AUTH_USERS='alice:$2a$10$...,bob:$2a$10$...'
   ```

   The single quotes keep the `$` signs literal. Do not double them to `$$`.

3. Check what Compose makes of it (the `sed` masks the hashes). Each user must
   show as `name:$$2a$$10$$<hash>`; Compose prints every literal `$` as `$$`:

   ```bash
   docker compose config | grep TINYAUTH_AUTH_USERS | sed -E 's/(\$\$2[aby]\$\$[0-9]+\$\$)[^,"]{53}/\1<hash>/g'
   #       TINYAUTH_AUTH_USERS: alice:$$2a$$10$$<hash>,bob:$$2a$$10$$<hash>
   ```

   If a hash looks shorter or a `$$2a` is missing, the quotes are wrong.

4. Apply. This recreates only tinyauth; existing logins stay because the
   sessions are in the `tinyauth-data` volume:

   ```bash
   docker compose up -d tinyauth
   docker compose ps
   ```

5. Test in a private browser window: open `https://recipes.example.com`, log
   in as the new user; the header shows the username. On a first install
   this test comes after [nginx and HTTPS](#nginx-and-https), because the
   site is not reachable before that.

### Make a user admin

Admins can delete any recipe and use "Unused images". Add the username to
`ADMIN_USERS` in `.env` (comma-separated, same spelling as the login, e.g.
`ADMIN_USERS=alice,bob`), then:

```bash
docker compose up -d recipes
# wait until `docker compose ps` shows the app healthy, then:
curl -s -H 'Remote-User: bob' http://127.0.0.1:8787/api/me
# {"ok":true,"requestId":"...","user":{"username":"bob","isAdmin":true}}
```

(The `curl` runs on the server itself; port 8787 is not reachable from
outside.)

### Remove a user or change a password

Remove or replace their `username:hash` entry in `.env`, then
`docker compose up -d tinyauth`. tinyauth checks on every request that the
user still exists, so a removed user is logged out at their next request even
with an open session. Their recipes stay and keep their name as owner.

## Start

```bash
cd /opt/recipes
docker compose up -d
docker compose ps
curl -s http://127.0.0.1:8787/api/health
# {"ok":true,"requestId":"...","status":"ok","storage":"ready"}
```

Within about 30 seconds both containers show `(healthy)` in
`docker compose ps`. Logs: `docker compose logs -f recipes` (or `tinyauth`).
tinyauth logs `Trusted proxies are not configured, IP access controls will
NOT work` at startup; that is expected, this setup uses no IP rules.

## nginx and HTTPS

Two sites: the app (behind `auth_request`) and the tinyauth login page. One
certificate covers both names.

> [!WARNING]
> Never run `AUTH_MODE=header` with port 8787 reachable from anywhere but
> nginx on the same host. The app believes whatever `Remote-User` header it
> receives: anyone who can reach the port can send `Remote-User: alice` and
> act as any user, including an admin. Keep the ports in
> `docker-compose.yml` bound to `127.0.0.1`. Note that Docker's published
> ports bypass host firewall rules such as `ufw`, so the `127.0.0.1` binding
> is what protects you, not the firewall.

### App site

`/etc/nginx/sites-available/recipes.example.com`:

```nginx
# Recipe Maker behind tinyauth (auth.recipes.example.com).
server {
    listen 80;
    server_name recipes.example.com;

    # Matches MANUAL_REQUEST_MAX_BYTES (20 MB).
    client_max_body_size 20m;

    # Internal subrequest to tinyauth; never reachable from outside.
    location = /tinyauth {
        internal;
        proxy_pass http://127.0.0.1:3000/api/auth/nginx;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
        proxy_set_header X-Original-Method $request_method;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        auth_request /tinyauth;
        auth_request_set $tinyauth_redirect $upstream_http_x_tinyauth_location;
        auth_request_set $tinyauth_user $upstream_http_remote_user;
        error_page 401 = @tinyauth_login;

        # Always overwrite: the app trusts this header (AUTH_MODE=header).
        proxy_set_header Remote-User $tinyauth_user;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # Overwrite, not append: the app's rate limiter keys on the first
        # X-Forwarded-For entry, so a client-sent value must not survive.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        # URL ingestion (fetch + browser fallback + two Gemini calls) can take ~1-2 min.
        proxy_read_timeout 180s;
        proxy_pass http://127.0.0.1:8787;
    }

    # API calls from the web app: an expired login must come back as the
    # app's JSON 401 (UNAUTHENTICATED, "reload the page to log in again"),
    # not a redirect - fetch would follow it cross-origin and fail as a
    # misleading network error.
    location /api/ {
        auth_request /tinyauth;
        auth_request_set $tinyauth_user $upstream_http_remote_user;
        error_page 401 = @api_unauthenticated;

        proxy_set_header Remote-User $tinyauth_user;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 180s;
        proxy_pass http://127.0.0.1:8787;
    }

    location @tinyauth_login {
        return 302 $tinyauth_redirect;
    }

    location @api_unauthenticated {
        default_type application/json;
        return 401 '{"ok":false,"requestId":"proxy","error":{"code":"UNAUTHENTICATED","message":"You are not logged in."}}';
    }
}
```

What the parts do:

- **`location = /tinyauth`** is the `auth_request` target. `internal` means
  nginx only uses it for subrequests; a browser asking for `/tinyauth` gets a
  404. tinyauth answers 200 with a `Remote-User` header for a logged-in
  visitor, or 401 with the login URL in `X-Tinyauth-Location`.
- **`Remote-User` is always overwritten** with the user tinyauth reported
  (`proxy_set_header` replaces any header the browser sent). Without it, a
  visitor could send their own `Remote-User` header and the app would
  believe it.
- **`X-Forwarded-For` is overwritten with `$remote_addr`**, not appended
  (`$proxy_add_x_forwarded_for`). The ingest rate limiter
  (`server/src/middleware/rate-limit.ts`) keys on the first
  `X-Forwarded-For` entry; with appending, that first entry is whatever the
  client sent, so a client could pick a fresh rate-limit bucket for every
  request.
- **`location /api/`** handles the web app's `fetch` calls. When the login
  has expired, it returns the app's JSON 401 (`UNAUTHENTICATED`; the app then
  asks you to reload the page) instead of the login redirect: `fetch` would
  follow the redirect to the other origin and fail with a misleading network
  error. Page loads under `location /` still get the redirect.
- **`client_max_body_size 20m`** matches the app's manual ingest limit
  (`MANUAL_REQUEST_MAX_BYTES`, several images per request). nginx's default
  (1 MB) answers larger uploads with 413.
- **`proxy_read_timeout 180s`**: URL ingestion (page fetch, browser fallback,
  two Gemini calls) can take one to two minutes; the default 60 s ends it with
  a 504.

### Login site

`/etc/nginx/sites-available/auth.recipes.example.com`:

```nginx
# tinyauth login for recipes.example.com. No auth_request here.
server {
    listen 80;
    server_name auth.recipes.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Enable the sites and get the certificate

```bash
sudo ln -s /etc/nginx/sites-available/recipes.example.com /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/auth.recipes.example.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d recipes.example.com -d auth.recipes.example.com
```

certbot gets one certificate for both names and edits both site files: it
replaces `listen 80;` with the HTTPS settings and adds a second `server`
block per site that redirects HTTP to HTTPS. Both sites use the same
certificate files, under the first name given (`live/recipes.example.com/`).
Afterwards each site ends like this (the app site shown):

```nginx
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/recipes.example.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/recipes.example.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}

server {
    if ($host = recipes.example.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    server_name recipes.example.com;
    return 404; # managed by Certbot
}
```

With another ACME client, add `listen 443 ssl;` and the `ssl_certificate`
lines yourself. Login only works over HTTPS (`TINYAUTH_AUTH_SECURECOOKIE=true`),
so test it after this step: open `https://recipes.example.com` in a private
window, you land on the tinyauth login page, and after logging in you are
back in the app with your username in the header.

## Sites that block the server

Many recipe sites block datacenter IPs, so URL ingestion can fail with
"URL_FETCH_BLOCKED". The fix is the "Send to Recipe Maker" button: a
bookmarklet or browser extension that sends the page from the user's own
browser. The setup page at `/setup` explains how to install it. No extra
server configuration is needed.

## Without a login service

On a trusted home network you can skip tinyauth and nginx. Then there is no
login: every visitor is the admin user `local`, can delete every recipe, and
everything is saved with `local` as owner. Never do this on a server that is
reachable from the internet.

The image presets `AUTH_MODE=header` (so a forgotten setting cannot make
everyone admin), so `none` must be set explicitly. In `.env`:

```bash
AUTH_MODE=none
PUBLIC_BASE_URL=http://192.168.1.10:8787
```

(use your server's LAN address). In `docker-compose.yml`, change the app's
port to your server's LAN address, e.g. `"192.168.1.10:8787:8787"`, so other
machines on the network can reach it (plain `"8787:8787"` publishes on all
interfaces and bypasses ufw), and start only the app (or delete the `tinyauth` service from the file):

```bash
docker compose up -d recipes
```

The app logs a warning at startup (`AUTH_MODE=none in production: every
request runs as the admin user "local"`); that is expected in this mode. If
you switch to `AUTH_MODE=header` later, the existing recipes keep `local` as
owner; admins can still delete them.

## Updates and rollback

Check the free disk first: each image version is about 4 GB.

```bash
cd /opt/recipes
df -h /
```

With a fixed `sha-<7>` tag (recommended), replace `sha-OLD` and `sha-NEW`
with the old and new tag:

```bash
sed -i 's/sha-OLD/sha-NEW/' docker-compose.yml
docker compose pull recipes
docker compose up -d recipes
docker image rm ghcr.io/OWNER/recipe-maker:sha-OLD
docker image prune -f
```

`docker image prune -f` only removes untagged images, so the old tag has to
be removed with `docker image rm`; otherwise every update leaves a 4 GB image
behind.

With `:latest`, the old image loses its tag when the new one is pulled, so
this is enough:

```bash
docker compose pull recipes
docker compose up -d recipes
docker image prune -f
```

**Rollback:** set the image to the previous tag
(`ghcr.io/OWNER/recipe-maker:sha-<previous>`) in `docker-compose.yml` and run
`docker compose up -d recipes`. CI keeps the last 10 versions on GHCR, so
pinning a `sha-<7>` tag is what makes a rollback possible; with `:latest` you
do not know which version you ran before.

Update tinyauth the same way (change its tag, `docker compose pull tinyauth`,
`docker compose up -d tinyauth`), after reading its release notes.

## Backups

What to back up: `data/db/recipes.db` (all recipes) and `data/images/`. Keep
a copy of `.env` and `docker-compose.yml` somewhere safe too (`.env` holds
your API key and password hashes). The tinyauth volume only holds sessions;
losing it means everyone logs in again.

Never copy the live database file with `cp`: the app keeps it open in WAL
mode, and a plain copy can be inconsistent. Use SQLite's `.backup`, which
takes a consistent copy while the app keeps running.

The script below does that every night, checks the copy, keeps dated
database copies for 14 days and mirrors the images. It writes to a separate
disk or network share mounted at `/mnt/backup` and refuses to run (exit 1,
nothing written) when nothing is mounted there, so a missing mount cannot
fill the root disk. Change `APP_DIR`, `MOUNT` and `KEEP_DAYS` to your setup.
It needs `sqlite3` and `rsync` on the host (`sudo apt install sqlite3
rsync`); `setpriv` and `mountpoint` come with util-linux.

Save it as `/opt/recipes/backup.sh`:

```bash
#!/usr/bin/env bash
# Nightly backup of Recipe Maker data. Run as root (cron), see docs/self-hosting.md.
set -euo pipefail

APP_DIR=/opt/recipes      # holds docker-compose.yml and data/
MOUNT=/mnt/backup         # backup disk or network share, must be mounted
DEST="$MOUNT/recipes"
KEEP_DAYS=14              # dated database copies older than this are deleted
APP_UID=1001              # pwuser in the image; owns data/
STAMP=$(date +%F)

# Without this check a missing mount would fill the root disk instead.
if ! mountpoint -q "$MOUNT"; then
  echo "$(date -Is) $MOUNT is not mounted, backup skipped" >&2
  exit 1
fi

mkdir -p "$DEST/db" "$DEST/images"

# .backup takes a consistent copy while the app keeps running (WAL mode);
# never copy the live database file directly. sqlite3 runs as the app's uid
# so it can never leave root-owned -wal/-shm files the app cannot open.
TMP_DIR=$(mktemp -d /tmp/recipes-backup-XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT
chown "$APP_UID:$APP_UID" "$TMP_DIR"
setpriv --reuid="$APP_UID" --regid="$APP_UID" --clear-groups \
  sqlite3 "$APP_DIR/data/db/recipes.db" ".backup '$TMP_DIR/recipes.db'"

CHECK=$(sqlite3 "$TMP_DIR/recipes.db" 'PRAGMA quick_check;')
if [ "$CHECK" != "ok" ]; then
  echo "$(date -Is) backup copy failed quick_check: $CHECK" >&2
  exit 1
fi

# Copy under a .part name first, so a partial copy never looks like a
# finished backup. Plain cp and rsync -rt (not -a) because the target this
# was written for is a CIFS share that cannot store owner/group/mode.
cp "$TMP_DIR/recipes.db" "$DEST/db/recipes-$STAMP.db.part"
mv -f "$DEST/db/recipes-$STAMP.db.part" "$DEST/db/recipes-$STAMP.db"
rsync -rt --delete "$APP_DIR/data/images/" "$DEST/images/"

find "$DEST/db" -name 'recipes-*.db' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup ok"
```

About the copy commands: the script was written for a CIFS (SMB) share
mounted with forced ownership, which cannot store owner, group or mode.
`rsync -a` would fail there (exit code 23), hence `rsync -rt` and plain `cp`;
the restore re-applies the owner. This is one way, not the only one: on a
normal local disk (or if you adapt the script to copy to an SSH target),
`rsync -a` and `cp -p` work and keep the ownership.

`--delete` makes `images/` an exact mirror of last night, so deleted images
disappear from it the next night. If you need older states of the images,
use snapshots on the backup target.

Install it and run it once:

```bash
sudo chown root:root /opt/recipes/backup.sh
sudo chmod 700 /opt/recipes/backup.sh
sudo /opt/recipes/backup.sh
# 2026-10-16T03:30:00+00:00 backup ok
```

Then add it to root's crontab (`sudo crontab -e`), here every night at 03:30:

```
30 3 * * * /opt/recipes/backup.sh >> /var/log/recipes-backup.log 2>&1
```

Check it now and then: `tail /var/log/recipes-backup.log`; the last line
should be `backup ok`.

### Restore

Replace `YYYY-MM-DD` with the date of the copy you want:

```bash
cd /opt/recipes
docker compose stop recipes
sudo cp /mnt/backup/recipes/db/recipes-YYYY-MM-DD.db data/db/recipes.db
sudo rm -f data/db/recipes.db-wal data/db/recipes.db-shm
sudo rsync -rt /mnt/backup/recipes/images/ data/images/
sudo chown -R 1001:1001 data
docker compose start recipes
```

The images mirror is always last night's state. An older database copy may
reference images that were deleted since; those show as missing unless you
restore them from a snapshot.

To move to a new server: set it up as above (files, data directories, nginx),
restore the database and images, then `docker compose up -d`.

## Building the image yourself

Needed on x86 servers (the published image is arm64 only) or to run your own
changes. From a checkout of the repository:

```bash
docker build -t recipe-maker .
```

Set `image: recipe-maker` for the `recipes` service in `docker-compose.yml`
and start it as usual. The build uses the architecture of the machine it runs
on and takes a while the first time (several GB, because of the Playwright
base image). To update, pull the new sources, build again, then run
`docker compose up -d recipes` and `docker image prune -f`. For a rollback,
tag your builds (for example `docker build -t recipe-maker:2026-10-16 .`) and
point `image:` at the tag you want.

The image takes Chromium from the Playwright base image, so `ARG
PLAYWRIGHT_VERSION` in the `Dockerfile` must equal the `playwright` package
version; see [local-development.md](local-development.md#playwright-version-coupling).
`scripts/docker-smoke-test.sh recipe-maker` checks a build
([local-development.md](local-development.md#docker-image)).

## Troubleshooting

- **Login loops back to the login page (302 loop).** tinyauth sets its
  session cookie for the parent domain of `TINYAUTH_APPURL`
  (`auth.recipes.example.com` gives a cookie for `recipes.example.com`), so
  the app must be on that domain or a subdomain of it. Check that
  `TINYAUTH_APPURL` is exactly the login URL with `https://`, and that you use
  HTTPS: with `TINYAUTH_AUTH_SECURECOOKIE=true` the browser does not send the
  cookie over plain HTTP.
- **"Your login may have expired" in the app** (`UNAUTHENTICATED`). The
  tinyauth session has expired; reload the page to log in again. If it happens right after logging in,
  check that nginx sets `Remote-User` from `$tinyauth_user` in both
  `location /` and `location /api/`, and that `AUTH_MODE=header`.
- **413 Request Entity Too Large** on a manual ingest with images:
  `client_max_body_size 20m` is missing from the app site.
- **504 Gateway Timeout** on URL ingestion: `proxy_read_timeout 180s` is
  missing from the app site.
- **`AI_QUOTA_EXCEEDED`**: the Gemini API key has hit its quota (free-tier
  limits are per minute and per day). Wait and try again, or enable billing
  on the key's project. Saved recipes and Load JSON keep working.
- **The container keeps restarting or is `unhealthy`.** The app needs
  writable data directories. `docker compose logs recipes` shows
  `Storage directory is not writable` when the ownership is wrong; the
  healthcheck reason is in:

  ```bash
  docker inspect --format '{{json .State.Health}}' $(docker compose ps -q recipes)
  ```

  Fix it with `sudo chown -R 1001:1001 data` (see
  [Data directories](#data-directories)) and `docker compose up -d recipes`.
- **Unknown hostnames or the bare server IP show the login page (or another
  site).** Without a `default_server` on port 443, nginx answers every
  request for a name it does not know with the first HTTPS site in
  alphabetical order, often `auth.recipes.example.com`. To refuse those
  requests instead, add a catch-all site, e.g.
  `/etc/nginx/sites-available/default-https` (enable it like the others):

  ```nginx
  server {
      listen 443 ssl default_server;
      ssl_reject_handshake on;
  }
  ```

  `ssl_reject_handshake` needs nginx 1.19.4 or newer (Ubuntu 22.04 and
  Debian 11 ship 1.18).
