const GITHUB_RELEASES_URL = "https://github.com/itsjuanmatus/borf/releases/latest";
const GITHUB_RELEASE_API = "https://api.github.com/repos/itsjuanmatus/borf/releases/latest";

const downloadLink = document.querySelector("#download-link");
const downloadStatus = document.querySelector("#download-status");
const releaseVersion = document.querySelector("#release-version");
const releaseDate = document.querySelector("#release-date");
const releaseArtifact = document.querySelector("#release-artifact");
const releaseNotesLink = document.querySelector("#release-notes-link");

function setDownloadButtonState({ label, href, disabled = false, loading = false }) {
  downloadLink.textContent = label;
  downloadLink.href = href ?? GITHUB_RELEASES_URL;
  downloadLink.classList.toggle("is-disabled", disabled);
  downloadLink.classList.toggle("is-loading", loading);
  downloadLink.setAttribute("aria-disabled", String(disabled));

  if (disabled) {
    downloadLink.removeAttribute("target");
    downloadLink.removeAttribute("rel");
    return;
  }

  downloadLink.setAttribute("target", "_blank");
  downloadLink.setAttribute("rel", "noreferrer");
}

function formatReleaseDate(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "Release date unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
  }).format(timestamp);
}

function pickDmgAsset(assets) {
  return assets.find((asset) => asset.name.toLowerCase().endsWith(".dmg")) ?? null;
}

async function loadLatestRelease() {
  setDownloadButtonState({
    label: "Loading latest release...",
    href: GITHUB_RELEASES_URL,
    loading: true,
  });

  try {
    const response = await fetch(GITHUB_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }

    const release = await response.json();
    const asset = pickDmgAsset(release.assets ?? []);
    const versionLabel = release.tag_name ?? release.name ?? "Latest release";

    releaseVersion.textContent = versionLabel;
    releaseDate.textContent = formatReleaseDate(release.published_at ?? "");
    releaseNotesLink.href = release.html_url ?? GITHUB_RELEASES_URL;

    if (!asset) {
      releaseArtifact.textContent = "DMG asset not attached yet";
      downloadStatus.textContent =
        "The latest GitHub release is live, but the macOS DMG has not finished publishing.";
      setDownloadButtonState({
        label: "DMG not available yet",
        href: GITHUB_RELEASES_URL,
        disabled: true,
      });
      return;
    }

    releaseArtifact.textContent = asset.name;
    downloadStatus.textContent = `${versionLabel} published ${formatReleaseDate(
      release.published_at ?? "",
    )}.`;
    setDownloadButtonState({
      label: "Download for macOS",
      href: asset.browser_download_url,
    });
  } catch (error) {
    console.error(error);
    releaseVersion.textContent = "Release unavailable";
    releaseDate.textContent = "Try again shortly";
    releaseArtifact.textContent = "GitHub metadata unavailable";
    downloadStatus.textContent =
      "Could not load the latest release metadata automatically. Open the latest GitHub release instead.";
    setDownloadButtonState({
      label: "Open latest GitHub release",
      href: GITHUB_RELEASES_URL,
    });
  }
}

void loadLatestRelease();
