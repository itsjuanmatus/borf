import { useEffect } from "react";
import { Button } from "../../components/ui/button";

interface UpdateDialogReleaseDetails {
  currentVersion: string;
  availableVersion: string;
  publishedAt: string | null;
  releaseNotes: string | null;
}

export type UpdateDialogState =
  | ({ kind: "available" } & UpdateDialogReleaseDetails)
  | ({
      kind: "installing";
      progressPercent: number | null;
      downloadedBytes: number;
      totalBytes: number | null;
      stageLabel: string;
    } & UpdateDialogReleaseDetails)
  | ({ kind: "ready" } & UpdateDialogReleaseDetails)
  | {
      kind: "up-to-date";
      currentVersion: string;
      checkedAt: number;
    }
  | {
      kind: "error";
      title: string;
      message: string;
      currentVersion?: string;
      availableVersion?: string;
    };

export interface UpdateDialogProps {
  dialog: UpdateDialogState | null;
  onClose: () => void;
  onInstall: () => void;
  onRestart: () => void;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatBytes(value: number | null) {
  if (!value || value <= 0) {
    return "0 B";
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${value} B`;
}

function formatPublishedAt(value: string | null) {
  if (!value) {
    return "Not provided";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return dateFormatter.format(timestamp);
}

function renderVersionDetails(dialog: UpdateDialogState) {
  if (dialog.kind === "up-to-date") {
    return (
      <div className="mt-4 rounded-2xl bg-sand/70 p-4 text-sm text-muted">
        <div className="flex items-center justify-between gap-3">
          <span>Current version</span>
          <span className="font-semibold text-night">{dialog.currentVersion}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span>Checked</span>
          <span className="font-semibold text-night">{dateFormatter.format(dialog.checkedAt)}</span>
        </div>
      </div>
    );
  }

  if (dialog.kind === "error") {
    if (!dialog.currentVersion || !dialog.availableVersion) {
      return null;
    }

    return (
      <div className="mt-4 rounded-2xl bg-sand/70 p-4 text-sm text-muted">
        <div className="flex items-center justify-between gap-3">
          <span>Current version</span>
          <span className="font-semibold text-night">{dialog.currentVersion}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span>Attempted update</span>
          <span className="font-semibold text-night">{dialog.availableVersion}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl bg-sand/70 p-4 text-sm text-muted">
      <div className="flex items-center justify-between gap-3">
        <span>Current version</span>
        <span className="font-semibold text-night">{dialog.currentVersion}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span>Available version</span>
        <span className="font-semibold text-night">{dialog.availableVersion}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span>Published</span>
        <span className="font-semibold text-night">{formatPublishedAt(dialog.publishedAt)}</span>
      </div>
    </div>
  );
}

function renderProgress(dialog: UpdateDialogState) {
  if (dialog.kind !== "installing") {
    return null;
  }

  const progressWidth = dialog.progressPercent === null ? "12%" : `${dialog.progressPercent}%`;
  const transferText = dialog.totalBytes
    ? `${formatBytes(dialog.downloadedBytes)} / ${formatBytes(dialog.totalBytes)}`
    : `${formatBytes(dialog.downloadedBytes)} downloaded`;

  return (
    <div className="mt-4 rounded-2xl bg-sand/70 p-4 text-sm text-muted">
      <div className="flex items-center justify-between gap-3">
        <span>{dialog.stageLabel}</span>
        <span className="font-semibold text-night">
          {dialog.progressPercent === null ? "Preparing..." : `${dialog.progressPercent}%`}
        </span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-night/10">
        <div
          className="h-full rounded-full bg-bells transition-[width] duration-200"
          style={{ width: progressWidth }}
        />
      </div>
      <p className="mt-2 text-xs text-muted">{transferText}</p>
    </div>
  );
}

function renderReleaseNotes(dialog: UpdateDialogState) {
  if (dialog.kind !== "available" && dialog.kind !== "installing" && dialog.kind !== "ready") {
    return null;
  }

  if (!dialog.releaseNotes) {
    return null;
  }

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Release notes</p>
      <div className="mt-2 max-h-56 overflow-auto rounded-2xl bg-sand/70 p-4 text-sm leading-6 whitespace-pre-wrap text-muted">
        {dialog.releaseNotes}
      </div>
    </div>
  );
}

export function UpdateDialog({ dialog, onClose, onInstall, onRestart }: UpdateDialogProps) {
  useEffect(() => {
    if (!dialog || dialog.kind === "installing") {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [dialog, onClose]);

  if (!dialog) {
    return null;
  }

  let title = "Update Available";
  let description = "A signed borf update is ready to download from GitHub Releases.";

  if (dialog.kind === "installing") {
    title = "Installing Update";
    description = "borf is downloading and verifying the signed update package.";
  } else if (dialog.kind === "ready") {
    title = "Restart Required";
    description = "The update has been installed. Restart borf to begin using it.";
  } else if (dialog.kind === "up-to-date") {
    title = "borf Is Up to Date";
    description = "No newer signed release is available for this build.";
  } else if (dialog.kind === "error") {
    title = dialog.title;
    description = dialog.message;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-night/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-3xl bg-cloud p-6 text-night shadow-2xl">
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted">{description}</p>

        {renderVersionDetails(dialog)}
        {renderProgress(dialog)}
        {renderReleaseNotes(dialog)}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {dialog.kind === "available" ? (
            <>
              <Button type="button" variant="secondary" className="text-night" onClick={onClose}>
                Later
              </Button>
              <Button type="button" onClick={onInstall}>
                Install Update
              </Button>
            </>
          ) : null}

          {dialog.kind === "installing" ? (
            <Button type="button" disabled>
              Installing...
            </Button>
          ) : null}

          {dialog.kind === "ready" ? (
            <>
              <Button type="button" variant="secondary" className="text-night" onClick={onClose}>
                Restart Later
              </Button>
              <Button type="button" onClick={onRestart}>
                Restart Now
              </Button>
            </>
          ) : null}

          {dialog.kind === "up-to-date" || dialog.kind === "error" ? (
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
