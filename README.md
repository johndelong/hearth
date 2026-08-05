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
API seeds the family, chores, extra jobs, and rewards on first boot.

To run the way production does — one process serving both:

```bash
npm run build
node apps/api/dist/index.js     # http://localhost:8080
```

## Connecting Google Calendar

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project
   and enable the **Google Calendar API**.
2. Configure the OAuth consent screen as **External**, and add yourself and Robin as
   test users. (Test-user refresh tokens expire after 7 days while the app is in
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

Each chore has a repeat rule (Daily, Weekdays, Weekends, Weekly) and a point value.
Points are an append-only ledger rather than a running total, so unchecking a chore
reverses exactly what it added, and a double-tap can never pay twice.

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

```bash
cp .env.example .env    # fill in PUBLIC_URL, Google credentials, COOKIE_SECRET
docker compose up -d --build
```

The database lives in the `hearth-data` volume. `TZ` matters — chore resets and
the calendar's day boundaries follow it.

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
