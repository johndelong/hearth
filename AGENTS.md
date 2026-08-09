# Hearth contributor instructions

Hearth is a local-first household dashboard for Google Calendar and chore
boards. It runs as a React client served by a Fastify API with SQLite storage.

## Working conventions

- Preserve the trusted-home-network product model. The parent PIN protects
  configuration and parent controls; it is not general authentication for
  reading the dashboard or performing normal kid interactions.
- Keep automatic and wake/reconnect calendar synchronization available without
  the PIN. Sync entry points must share an in-flight operation and avoid
  redundant calls to Google.
- Treat TypeScript types as compile-time help, not request validation. Validate
  external input at the API boundary and preserve important invariants in the
  database or domain layer.
- Store all-day calendar boundaries as `YYYY-MM-DD`. Do not convert them into
  instants. Timed events remain ISO 8601 instants with offsets.
- Use local calendar arithmetic for chore periods and recurrence. Do not add or
  subtract fixed 24-hour millisecond intervals where DST can affect the result.
- Keep points as ledger entries. Mutations involving claims, rewards, or points
  must be atomic and idempotent where retries are possible.
- Preserve the offline/local-first behavior. Avoid runtime dependencies on
  third-party fonts, scripts, or CDNs.
- Use semantic design tokens and shared components before adding literal
  colors, spacing, radii, shadows, or control styles. Maintain large touch
  targets, keyboard focus, reduced-motion support, and responsive layouts.
- Keep comments focused on invariants or non-obvious constraints. Avoid change
  history and long design narratives in source files.
- Keep the README limited to the product, installation, and configuration.
  Contributor or implementation details belong in focused documentation only
  when they are genuinely needed.

## Repository map

- `apps/api`: Fastify routes, domain stores, Google synchronization, and SQLite
  migrations.
- `apps/web`: React application, screens, components, state, and theme tokens.
- `packages/shared`: Types and deterministic recurrence/date helpers shared by
  API and web.
- `scripts`: Installation and host-side update tooling.

## Commands

```bash
npm run typecheck
npm test
npm run build
```

Run all three before handing off a change that affects application behavior.
API tests use temporary real SQLite databases. Add regression coverage for
domain rules, authorization boundaries, migrations, and date behavior rather
than relying only on mocked units.

## Database changes

- Add a new forward-only, sequential SQL migration under
  `apps/api/src/db/migrations`; never edit a released migration.
- Keep migrations transactional and test that a fresh database reaches the
  current schema.
- Preserve foreign keys, ledger history, and existing household data.

## Security and secrets

- Never return PIN hashes, Google tokens, cookie values, or encryption keys to
  the client or logs.
- Parent-only mutations must use the existing parent guard.
- Escape values inserted into HTML and prefer JSON or React rendering.
- Google credentials stored in SQLite remain encrypted. Changes to credential
  handling must retain compatibility with existing encrypted and legacy rows.
