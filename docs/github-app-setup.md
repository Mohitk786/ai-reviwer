# GitHub App setup

You need a GitHub App for both auth (sign-in) and ingestion (per-installation rate
limits + webhooks). One-time setup.

## Step 1 — Register the App

1. Go to <https://github.com/settings/apps/new> (or your org's app settings).
2. **GitHub App name:** something unique, e.g., `rag-engineering-memory`.
3. **Homepage URL:** your production URL (or `http://localhost:3000` for dev).
4. **Callback URL** (request user authorization during install):
   - Local: `http://localhost:3000/api/auth/github/callback`
   - Production: `https://your-domain.com/api/auth/github/callback`
   You can list multiple URLs (one per line).
5. **Setup URL** (optional): same as callback URL.
6. **Webhook:**
   - **Active:** yes.
   - **Webhook URL:** `https://your-tunnel.example.com/api/webhooks/github` for local
     dev (use `cloudflared tunnel` — ngrok works but is flakier).
   - **Webhook secret:** generate a strong random string and store in `.env.local`
     as `GITHUB_WEBHOOK_SECRET`.

## Step 2 — Permissions (repository)

| Scope | Access | Reason |
|---|---|---|
| Contents | Read | Read commit messages + file metadata |
| Issues | Read & write | Read for ingestion; write reserved for "similar incidents" comments (Phase 2) |
| Metadata | Read | Mandatory — no choice |
| Pull requests | Read | Read PRs, reviews, comments |

## Step 3 — Account permissions

| Scope | Access | Reason |
|---|---|---|
| Email addresses | Read | Show signed-in user identity |

## Step 4 — Subscribe to events

- `pull_request`
- `pull_request_review`
- `pull_request_review_comment`
- `issues`
- `issue_comment`
- `installation`
- `installation_repositories`

NOT subscribed in MVP:
- `push` — too high volume on busy repos. Pull commits lazily via PR association.

## Step 5 — Where can this GitHub App be installed?

- **Any account** if you intend to make this a public product.
- **Only on this account** for private dev / single-tenant.

## Step 6 — Generate the private key

After creating the App:

1. Scroll to **Private keys** → **Generate a private key**.
2. Save the `.pem` file securely — you can't retrieve it later.
3. For env storage:
   - Either: paste the entire PEM into `GITHUB_APP_PRIVATE_KEY`, replacing newlines
     with literal `\n`. The env loader (`packages/shared/src/env.ts`) un-escapes
     them on read.
   - Or: keep the PEM file mounted into the container and read its path.

## Step 7 — Note the IDs

From the App settings page:
- **App ID** → `GITHUB_APP_ID`
- **Client ID** → `GITHUB_APP_CLIENT_ID`
- **Client Secret** → click "Generate a new client secret" → `GITHUB_APP_CLIENT_SECRET`

## Step 8 — Install on a test repo

1. App settings → **Install App** → choose your account → select 1–2 repos.
2. After install, GitHub redirects to your callback URL with `installation_id`
   and `code` query params. (M1 wires this; for Phase 1 the redirect just
   404s — that's expected.)

## Production note

Treat all four secrets (App private key, client secret, webhook secret, encryption
key) as critical. Loss of the private key requires re-registering the App and re-
installing on every customer org. Loss of the encryption key makes every
ProviderCredential row unreadable.

Use your secret manager of choice (AWS Secrets Manager, Doppler, 1Password Connect,
etc.) — never `.env.example`.
