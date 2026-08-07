# Hearth

A wall-panel dashboard for the house: the family calendar (synced from Google) and
the kids' chore boards (kept locally). Built to run in a container on a machine
that stays on at home, and be opened full-screen on wall-mounted touch screens
and tablets.

Groceries and Home are in the design but not built yet — they need Apple Reminders
and Home Assistant integrations.

## Layout

```
apps/api          Fastify + TypeScript. Serves the API and, in production, the built web client.
apps/web          Vite + React + TypeScript. The dashboard itself.
packages/shared   Types shared by both.
data/             SQLite database (git-ignored; a Docker volume in production).
Family Dashboard.dc.html   The original design prototype, kept for reference.
```

Data lives in SQLite through Node's built-in `node:sqlite` module, so there is no
native dependency to compile and no database server to run.

## Running it locally

Requires Node 24 or newer (this repo pins 26.5.0 via `.node-version`).

```bash
npm install
npm run build --workspace=@dashboard/shared   # the other packages import its types
npm run dev                                   # api on :8080, web on :5173
```

Open http://localhost:5173. The web dev server proxies `/api` to the API, and the
API seeds a starter set of extra jobs and rewards on first boot. Add your own
household in **Settings › Family** — nothing about a specific family ships in the
repo.

To run the way production does — one process serving both:

```bash
npm run build
node apps/api/dist/index.js     # http://localhost:8080
```

## Connecting Google Calendar

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project
   and enable the **Google Calendar API**.
2. Configure the OAuth consent screen as **External**, and add every adult whose
   calendar you want on the dashboard as a test user. (Test-user refresh tokens expire after 7 days while the app is in
   "Testing"; publishing the app stops that. It stays private either way — nobody can
   use it without being added.)
3. Create an **OAuth client ID** of type *Web application* and add this authorized
   redirect URI:

   ```
   http://localhost:8080/api/google/callback
   ```

   It must be `localhost`, not the host's own hostname. Google requires HTTPS for
   redirect URIs and exempts only localhost, and `.local` is not a public-suffix
   domain — a hostname URI gets rejected outright. This is also why `PUBLIC_URL`
   defaults to localhost and generally shouldn't be changed; the redirect is the
   only thing it feeds.

4. Put the client ID and secret in `.env` (see `.env.example`) and restart the server.
5. **Sign in from the host machine itself**, since the redirect has to land on
   localhost. Either use that machine's own browser, or tunnel from your laptop:

   ```bash
   ssh -L 8080:localhost:8080 you@your-host.local
   # then browse http://localhost:8080 on the laptop
   ```

   Open **Settings › Calendar › Add a Google account** and sign in. Repeat for each
   account you want. This is one-time: the refresh token is stored, and afterwards
   the tablets reach the dashboard by hostname as usual.
6. Assign each calendar to a family member. That mapping is what gives events their
   color everywhere in the app; unassigned calendars show in neutral slate.

The server pulls changes every 5 minutes using Google's sync tokens, and caches
events locally — so the panel keeps rendering if the network or Google is down.
Events you add from the dashboard are written back to Google. Calendars you only
subscribe to (school, sports, holidays) come through read-only, and the app will
say so rather than failing on save.

## The parent PIN

Kids can always check chores off and claim extra jobs — that is the point of the
board. Everything in Settings (people, calendars, points, rewards, and the PIN
itself) is gated.

Set the PIN in **Settings › Parent PIN**. Until one is set, Settings is open to
anyone. The unlock lasts 30 minutes of continued use and resets when the server
restarts. The PIN is stored scrypt-hashed, never in plain text.

## Chore boards

Each chore has a repeat rule (Daily, Weekdays, Weekends, Weekly). Chores earn no
points — they are the everyday expectation. Points come from **extra jobs**, which
stay locked until that person's chores for the day are done.

Points are an append-only ledger rather than a running total, so unchecking an
extra job reverses exactly what it added, and a double-tap can never pay twice.

Boards "reset" by filing completions under a period key — nightly, or weekly from
Sunday or Monday per the setting. Nothing is deleted and no scheduled job runs, so a
reboot at 3 a.m. cannot miss a reset.

## Changing the database schema

Migrations are plain SQL files in `apps/api/src/db/migrations`, named `NNN_description.sql`.
On boot the server compares SQLite's `user_version` against the files on disk and applies
whatever is pending, in order, each inside a transaction.

To add a column:

```bash
# next number in sequence — 001 is the initial schema
cat > apps/api/src/db/migrations/002_add_chore_notes.sql <<'SQL'
ALTER TABLE chores ADD COLUMN notes TEXT;
SQL
```

Restart the server and it applies. Rules worth knowing:

- **Forward-only.** There are no down migrations; to undo something, write the next migration.
- **Never edit a migration that has already run** — the database records that it applied and
  will skip it. Add a new file instead.
- **A failed migration rolls back completely and the server refuses to start.** That is
  deliberate: it fails loudly on boot rather than serving requests against a half-changed schema.
- SQLite's `ALTER TABLE` is limited (no dropping or retyping columns). For those, create the
  new table, copy the rows across, drop the old one, and rename — all within the one file.

## Running it in the house

### First time

On the machine that will host it, with Docker Desktop installed and running:

```bash
git clone https://github.com/johndelong/hearth.git ~/hearth
cd ~/hearth
cp .env.example .env             # PUBLIC_URL, Google credentials, COOKIE_SECRET
./scripts/update.sh              # builds and starts the newest release tag
./scripts/install-updater.sh     # optional: lets Settings install updates itself
```

The database lives in the `hearth-data` volume, so it survives every update.
`TZ` matters — chore resets and the calendar's day boundaries follow it.

For the tablets: open `http://your-host.local:8080` and add it to the home
screen. The page is marked as a web app, so it opens without browser chrome.

Note that the app loads its two fonts (Outfit and Nunito) from Google Fonts. On a
panel with no internet they fall back to the system font; self-host them if that
matters.

### Cutting a release

From your laptop:

```bash
git tag v0.2.0 && git push --tags
```

That's all — `.github/workflows/release.yml` takes it from there. It typechecks
and builds the tag first, and only then publishes a GitHub Release.

Notes come from GitHub's own generator, which categorises and links merged pull
requests. That generator works *from* pull requests, though, so commits pushed
straight to `main` yield nothing but a compare link — when it finds none, the
workflow falls back to listing commit subjects. Either way the notes are worth
reading, which is a reason to keep writing commit subjects as statements of what
changed. The build gate matters: a tag that doesn't compile would otherwise cost
a failed update on the machine serving the house to find out. The Release itself
matters because the dashboard's update notice reads GitHub's *published
releases* — a bare tag is invisible to that API.

### Updating

The server asks GitHub hourly whether a newer release exists — once for the whole
house, not once per panel. This repository is public, so that call needs no
credentials. **Settings › Display › This dashboard** shows what's running,
what's available, a link to the release notes, and a **Check now** button when
you don't want to wait out the hour.

Installing it is one command on the host machine:

```bash
cd ~/hearth && ./scripts/update.sh
```

It fetches tags, checks out the newest one, rebuilds, and waits for the new
container to report that version. If the build fails, the container that is
already running is left alone — the house keeps its dashboard and the failure
shows up in Settings rather than as a dark screen.

```bash
./scripts/update.sh --check     # what's running vs what's tagged; needs no Docker
./scripts/update.sh v0.1.0      # a specific tag, i.e. roll back on purpose
```

The health check goes to this machine by default. Point it elsewhere when the
script runs somewhere else, or when the app sits behind a proxy — set `BASE_URL`
in `.env`, or pass it inline. Every message names the URL it is checking, so a
wrong host shows up immediately instead of as a mystery timeout.

### The Update button

With the launchd agent installed, nobody has to open a terminal: **Settings ›
Display › This dashboard** grows an **Update to v0.3.0** button whenever a
release is out, and shows progress until the new version answers.

```bash
./scripts/install-updater.sh              # install and start it
./scripts/install-updater.sh --uninstall  # remove it
```

The button only appears when the agent is installed. Everywhere else the
dashboard just links to the release notes, and updating stays a command.

**How it works.** A container cannot rebuild itself — the process doing the work
is killed partway through when its own container is replaced. So the work runs
outside Docker, and the two sides pass notes through `.hearth-control/`, a
directory bind-mounted into the container:

| File | Written by | Means |
| --- | --- | --- |
| `agent.json` | `install-updater.sh` | An agent exists. This is what shows the button. |
| `request.json` | the dashboard | Install this release. |
| `status.json` | `update.sh` | How it is going: `running`, `ok`, `failed`. |
| `update.log` | `update.sh` | The full output, for when `status.json` says `failed`. |

launchd watches `request.json` and runs `./scripts/update.sh --requested` when
it appears. The API never shells out and never talks to Docker; it writes one
file. Requesting an update needs the parent PIN, like everything else in
Settings.

macOS only, because launchd is. The agent is a *user* agent rather than a system
daemon because Docker Desktop runs as the logged-in user. On Linux the same two
files work behind a systemd path unit — see
`scripts/updater/com.hearth.updater.plist` for what it has to run; nothing in
the app changes.

`UPDATE_CHECK_TOKEN` is read if it is set, but it is not needed: it only raises
GitHub's rate limit, and one call an hour never comes close. Leave it blank.

### What the wall panels do afterwards

Every API response carries the running version in an `x-hearth-version` header,
and each panel remembers the version it loaded against. There is no polling for
this — the app is already fetching the board every minute, so an update is
noticed on the next request the panel makes anyway, and instantly on any tap.

- **Idle panels reload themselves.** A screen nobody has touched drops into frame
  mode, notices the mismatch, and refreshes silently. The kitchen display needs no
  attention after an update.
- **Panels in use ask first.** A tablet someone is holding gets a "Hearth v0.2.0 is
  ready · Refresh" toast rather than reloading under their finger.

This matters because a wall panel can sit on the same page for weeks; without it,
it keeps running whatever JavaScript it loaded back then.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` | Port the server listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | `./data/dashboard.db` | SQLite file location |
| `PUBLIC_URL` | `http://localhost:$PORT` | Base URL; determines the OAuth redirect URI |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | OAuth client; without them the Calendar settings explain what is missing |
| `COOKIE_SECRET` | dev value | Signs the parent-session cookie |
| `TRUST_PROXY` | `false` | Set `true` only behind a reverse proxy |
| `TZ` | system | Local time for resets and day boundaries |
| `APP_VERSION` | `dev` | Stamped in at build time; reported at `/api/version` |
| `UPDATE_CHECK_TOKEN` | — | Not needed. Only raises GitHub's rate limit for the release check |
| `UPDATE_REPO` | `johndelong/hearth` | Repo to check for releases |
| `UPDATE_CONTROL_DIR` | `/control` | Where the container and the host's update agent pass notes |
| `HEARTH_CONTROL_DIR` | `./.hearth-control` | The host side of that directory, used by the scripts and compose |
