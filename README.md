# Hearth

Hearth is a private, wall-mounted family dashboard for shared calendars and
kids' chore boards. It syncs Google Calendar into a local cache, keeps chore and
reward data in SQLite, and is designed for full-screen touch displays and
tablets on a home network.

Calendar events remain available when Google is unreachable. Chore boards can
reset nightly or weekly without a scheduled reset job, and extra jobs feed a
points-and-rewards system. Kids can claim jobs and redeem earned rewards;
parents configure the catalog and household rules. Configuration and parent
controls can be protected with a PIN.

## Install at home

Hearth is distributed as a container image. The host needs Docker and curl:

```bash
curl -fsSL https://raw.githubusercontent.com/johndelong/hearth/main/scripts/install.sh | bash
cd ~/hearth
```

Edit `~/hearth/.env` and set at least:

```dotenv
TZ=America/Detroit
COOKIE_SECRET=replace-with-a-long-random-value
```

Then start Hearth:

```bash
./scripts/update.sh
```

Open `http://your-host.local:8080` on each tablet or wall display and add it to
the home screen. Household data is stored in the `hearth-data` Docker volume and
survives application updates.

The optional macOS update agent enables the update button inside Settings:

```bash
./scripts/install-updater.sh
```

## Google Calendar

1. Enable the Google Calendar API in a Google Cloud project.
2. Configure an External OAuth consent screen and add the participating adults
   as test users. Publish the app if refresh tokens should not expire after the
   testing period.
3. Create a Web application OAuth client with this redirect URI:

   ```text
   http://localhost:8080/api/google/callback
   ```

4. Add the credentials to `~/hearth/.env`:

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

5. Restart Hearth, open it through `http://localhost:8080` on the host, and use
   **Settings › Calendar › Add a Google account**. If the host has no browser,
   forward the port from another computer:

   ```bash
   ssh -L 8080:localhost:8080 you@your-host.local
   ```

6. Assign each imported calendar to a family member in Settings.

## Local development

Requires Node 24 or newer.

```bash
npm install
npm run dev
```

The web client runs at `http://localhost:5173` and proxies API requests to port
8080. To run the production build locally:

```bash
npm run build
npm start
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | `./data/dashboard.db` | SQLite database path |
| `PUBLIC_URL` | `http://localhost:$PORT` | Public base URL and OAuth redirect base |
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `COOKIE_SECRET` | development value | Cookie plugin secret; set a random production value |
| `CREDENTIAL_ENCRYPTION_KEY` | `COOKIE_SECRET` | Key used to encrypt stored Google tokens; keep stable across updates |
| `TRUST_PROXY` | `false` | Enable only behind a trusted reverse proxy |
| `TZ` | system timezone | Chore reset and calendar day boundaries |
| `APP_VERSION` | `dev` | Version reported by the server |
| `UPDATE_REPO` | `johndelong/hearth` | GitHub repository used for update checks |
| `UPDATE_CHECK_TOKEN` | — | Optional GitHub token for a higher rate limit |
| `HEARTH_IMAGE` | `ghcr.io/johndelong/hearth` | Container image installed by the updater |
| `UPDATE_CONTROL_DIR` | `/control` | Container-side update-agent directory |
| `HEARTH_CONTROL_DIR` | `./.hearth-control` | Host-side update-agent directory |

Hearth is intended for a trusted home network. Put it behind HTTPS and normal
network access controls before exposing it outside that network.
