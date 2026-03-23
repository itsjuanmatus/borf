# borf

Local-first desktop music player built with Tauri 2, React 19, and Rust.

## Local development

```sh
pnpm install
pnpm tauri dev
```

## Signed updater and macOS releases

- The desktop app is configured to read signed updater metadata from `https://github.com/itsjuanmatus/borf/releases/latest/download/latest.json`.
- Pushing a semantic version tag such as `v0.2.0` triggers `.github/workflows/release-macos.yml`.
- The release workflow builds the Apple Silicon macOS bundle, creates updater artifacts, signs them, notarizes the app, and publishes the GitHub Release.
- `src-tauri/tauri.conf.json` keeps a checked-in placeholder updater public key. CI replaces it at build time with `TAURI_UPDATER_PUBLIC_KEY`.

Required GitHub secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_UPDATER_PUBLIC_KEY`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY`
- `APPLE_API_KEY_P8`

One-time updater key generation:

```sh
pnpm tauri signer generate -w ~/.tauri/borf-updater.key
```

Store the generated private key in `TAURI_SIGNING_PRIVATE_KEY`, and store the matching public key in `TAURI_UPDATER_PUBLIC_KEY`.

## Website and Railway deploy

- The public download site lives in `website/`.
- The site is static HTML/CSS/JS and is served on Railway with Docker + Caddy from that subdirectory.
- Merges to `main` that touch `website/**` trigger `.github/workflows/deploy-website-railway.yml`.
- The workflow deploys with `railway up --path-as-root website`.

Required Railway secrets:

- `RAILWAY_TOKEN`
- `RAILWAY_PROJECT_ID`
- `RAILWAY_SERVICE_ID`
- `RAILWAY_ENVIRONMENT_ID`
