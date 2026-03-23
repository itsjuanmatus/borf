# borf

Local-first desktop music player built with Tauri 2, React 19, and Rust.

## Local development

```sh
pnpm install
pnpm tauri dev
```

## Releasing a new version

1. Bump the version in all three files:
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `package.json`
2. Commit the version bump:
   ```sh
   git add src-tauri/tauri.conf.json src-tauri/Cargo.toml package.json
   git commit -m "Bump version to X.Y.Z"
   ```
3. Create and push an annotated tag:
   ```sh
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin main --follow-tags
   ```

The tag push triggers `.github/workflows/release-macos.yml`, which builds the Apple Silicon macOS bundle, code-signs it, submits it to Apple for notarization, signs the updater artifacts, and publishes a GitHub Release with the DMG and auto-updater files.

Existing installations will detect the new version via the in-app updater and prompt the user to install it.

## CI/CD details

- The release workflow builds for `aarch64-apple-darwin` (Apple Silicon).
- `src-tauri/tauri.conf.json` keeps a placeholder updater public key. CI injects the real key at build time from `TAURI_UPDATER_PUBLIC_KEY`.
- The updater manifest is published at `https://github.com/itsjuanmatus/borf/releases/latest/download/latest.json`.

### Required GitHub secrets

| Secret | Description |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Ed25519 private key for signing updater artifacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the Tauri signing key |
| `TAURI_UPDATER_PUBLIC_KEY` | Matching public key (injected into config at build time) |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application .p12 |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the .p12 export |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_API_ISSUER` | App Store Connect API issuer ID |
| `APPLE_API_KEY` | App Store Connect API key ID |
| `APPLE_API_KEY_P8` | Raw contents of the .p8 API key file |

### One-time updater key generation

```sh
pnpm tauri signer generate -w ~/.tauri/borf.key
```

Back up `~/.tauri/borf.key` securely — if lost, existing installations cannot verify future updates.

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
