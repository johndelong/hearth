# Hearth

A wall-panel dashboard for the house: the family calendar (synced from Google) and
the kids' chore boards (kept locally). Built to run in a container on the Mac mini
and be opened full-screen on wall-mounted touch screens and tablets.

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
   redirect URI, matching `PUBLIC_URL` exactly:

   ```
   http://mac-mini.local:8080/api/google/callback
   ```

4. Put the client ID and secret in `.env` (see `.env.example`) and restart the server.
5. Open **Settings › Calendar › Add a Google account** and sign in. Repeat for each
   account you want on the dashboard.
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

## Deploying to the Mac mini

### First time

On the mini, with Docker Desktop installed and running:

```bash
# The repo is private, so give the mini read-only access. On the mini:
ssh-keygen -t ed25519 -C "hearth-mac-mini" -f ~/.ssh/hearth_deploy
cat ~/.ssh/hearth_deploy.pub
# Add that key at: github.com/johndelong/hearth → Settings → Deploy keys
#   (leave "Allow write access" unchecked)

git clone git@github.com:johndelong/hearth.git ~/hearth
cd ~/hearth
cp .env.example .env        # fill in PUBLIC_URL, Google credentials, COOKIE_SECRET
./scripts/deploy.sh         # builds and starts the newest release tag
```

The database lives in the `hearth-data` volume, so it survives every redeploy.
`TZ` matters — chore resets and the calendar's day boundaries follow it.

### Cutting a release and shipping it

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
changed. The build gate matters: a tag that doesn't compile would otherwise cost you
a deploy and an automatic rollback to find out. The Release itself matters because
the dashboard's update notice reads GitHub's *published releases* — a bare tag is
invisible to that API.

Then on the mini:

```bash
cd ~/hearth && ./scripts/deploy.sh
```

That one command snapshots the database, checks out the newest tag, rebuilds,
waits for the new container to report healthy, and **rolls back to the previous
tag if it doesn't**. Snapshots land in `~/hearth-backups` (last 20 kept).

```bash
./scripts/deploy.sh --check     # what's running vs what's tagged; needs no Docker
./scripts/deploy.sh v0.1.0      # deploy a specific tag, i.e. roll back on purpose
```

### What the wall panels do after a deploy

Every API response carries the running version in an `x-hearth-version` header,
and each panel remembers the version it loaded against. There is no polling for
this — the app is already fetching the board every minute, so a deploy is noticed
on the next request the panel makes anyway, and instantly on any tap.

- **Idle panels reload themselves.** A screen nobody has touched drops into frame
  mode, notices the mismatch, and refreshes silently. The kitchen display needs no
  attention after a deploy.
- **Panels in use ask first.** A tablet someone is holding gets a "Hearth v0.2.0 is
  ready · Refresh" toast rather than reloading under their finger.

This matters because a wall panel can sit on the same page for weeks; without it,
it keeps running whatever JavaScript it loaded back then.

### Optional: notice undeployed releases from the dashboard

You probably don't need this. Panels already notice a **deploy** without any
token — that half reads the version off the server they're talking to. This adds
one thing on top: a nudge that you tagged a release and haven't deployed it yet.
Since you're the one cutting releases, `./scripts/deploy.sh --check` on the mini
usually answers that already, using the deploy key it already has.

If you do want it in the UI, set `UPDATE_CHECK_TOKEN` in `.env` to a GitHub
[fine-grained token](https://github.com/settings/tokens?type=beta) scoped to just
this repository with **Contents: Read-only**. The server checks GitHub hourly —
once for the whole house, not per panel — and **Settings › Display › This
dashboard** shows what's running, what's available, a link to the release notes,
and a **Check now** button when you don't want to wait for the next check.

Without the token everything still works — the panel just won't know a newer
release exists until you deploy it.

A token is needed only because the repo is private. Making it public would remove
that need, but the seed data carries the girls' names and birthdays, so keeping it
private is worth more than saving one line of config.

The deploy itself is deliberately a command you run, not a button in the app. A
container can't rebuild itself: the process doing the work gets killed partway
through when its own container is replaced. (Immich works the same way — it tells
you a release is out, you run the compose command.) Automating it would mean
running something outside Docker on the mini — a launchd agent, or Watchtower
against a registry — which is worth adding later if the manual step gets old.
Nothing above changes when you do.

For the tablets: open `http://mac-mini.local:8080` and add it to the home screen.
The page is marked as a web app, so it opens without browser chrome.

Note that the app loads its two fonts (Outfit and Nunito) from Google Fonts. On a
panel with no internet they fall back to the system font; self-host them if that
matters.

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
| `UPDATE_CHECK_TOKEN` | — | Read-only GitHub token; enables the new-release notice |
| `UPDATE_REPO` | `johndelong/hearth` | Repo to check for releases |
