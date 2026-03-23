import { getVersion } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appApi } from "../../lib/api";
import type { UpdateDialogProps, UpdateDialogState } from "./UpdateDialog";

const STARTUP_UPDATE_DELAY_MS = 5_000;
const UPDATE_CHECK_TIMEOUT_MS = 15_000;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 120_000;

type UpdateCheckSource = "startup" | "manual";

function normalizeReleaseNotes(notes: string | null | undefined) {
  const value = notes?.trim();
  return value ? value : null;
}

function formatFriendlyTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatUpdateError(error: unknown, action: "check" | "install" | "restart") {
  const rawMessage = String(error ?? "").trim();
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("network") ||
    normalized.includes("dns") ||
    normalized.includes("offline")
  ) {
    if (action === "check") {
      return "Couldn't reach GitHub Releases. Check your connection and try again.";
    }
    return "The download did not complete. Check your connection and try again.";
  }

  if (normalized.includes("signature")) {
    return "The downloaded update failed signature verification and was not installed.";
  }

  if (
    normalized.includes("404") ||
    normalized.includes("not found") ||
    normalized.includes("latest.json")
  ) {
    return "The latest release is missing a required updater asset.";
  }

  if (
    normalized.includes("pubkey") ||
    normalized.includes("public key") ||
    normalized.includes("minisign")
  ) {
    return "Updates are not configured for this build yet.";
  }

  if (action === "restart") {
    return "The update was installed, but borf could not restart automatically. Quit and reopen the app to finish applying it.";
  }

  if (action === "install") {
    return "borf could not finish installing the downloaded update.";
  }

  return "borf could not check for updates right now.";
}

function buildDialogFromUpdate(
  kind: "available" | "ready",
  update: Pick<Update, "currentVersion" | "version" | "date" | "body">,
): Extract<UpdateDialogState, { kind: "available" | "ready" }> {
  return {
    kind,
    currentVersion: update.currentVersion,
    availableVersion: update.version,
    publishedAt: update.date ?? null,
    releaseNotes: normalizeReleaseNotes(update.body),
  };
}

export function useAppUpdate() {
  const [dialog, setDialog] = useState<UpdateDialogState | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [statusText, setStatusText] = useState(
    import.meta.env.DEV
      ? "Startup update checks are skipped during local development."
      : "Signed releases are checked automatically after startup.",
  );

  const startupCheckStartedRef = useRef(false);
  const pendingUpdateRef = useRef<Update | null>(null);

  const releasePendingUpdate = useCallback(async () => {
    const pendingUpdate = pendingUpdateRef.current;
    pendingUpdateRef.current = null;

    if (!pendingUpdate) {
      return;
    }

    try {
      await pendingUpdate.close();
    } catch {
      // Ignore resource cleanup failures; they should not block the next check.
    }
  }, []);

  const closeDialog = useCallback(() => {
    if (dialog?.kind === "installing") {
      return;
    }

    setDialog(null);
    void releasePendingUpdate();
  }, [dialog, releasePendingUpdate]);

  const runCheck = useCallback(
    async (source: UpdateCheckSource) => {
      if (isChecking || isInstalling) {
        return;
      }

      setIsChecking(true);
      if (source === "manual") {
        setStatusText("Checking GitHub Releases for a signed update...");
      }

      await releasePendingUpdate();

      try {
        const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
        const currentVersion = update?.currentVersion ?? (await getVersion());
        const checkedAt = Date.now();

        if (!update) {
          const nextStatus = `Last checked ${formatFriendlyTimestamp(checkedAt)}. borf is up to date.`;
          setStatusText(nextStatus);
          if (source === "manual") {
            setDialog({
              kind: "up-to-date",
              currentVersion,
              checkedAt,
            });
          }
          return;
        }

        pendingUpdateRef.current = update;
        setStatusText(`Update ${update.version} is available.`);
        setDialog(buildDialogFromUpdate("available", update));
      } catch (error: unknown) {
        const message = formatUpdateError(error, "check");
        setStatusText(
          source === "startup"
            ? "Automatic update check failed. Open Settings to retry."
            : "Update check failed. Try again in a moment.",
        );

        if (source === "manual") {
          setDialog({
            kind: "error",
            title: "Couldn't Check for Updates",
            message,
          });
        }
      } finally {
        setIsChecking(false);
      }
    },
    [isChecking, isInstalling, releasePendingUpdate],
  );

  const checkForUpdatesManually = useCallback(() => {
    void runCheck("manual");
  }, [runCheck]);

  const installUpdate = useCallback(async () => {
    const update = pendingUpdateRef.current;
    if (!update || isInstalling) {
      return;
    }

    setIsInstalling(true);
    setDialog({
      ...buildDialogFromUpdate("available", update),
      kind: "installing",
      progressPercent: null,
      downloadedBytes: 0,
      totalBytes: null,
      stageLabel: "Preparing download...",
    });
    setStatusText(`Downloading update ${update.version}...`);

    let downloadedBytes = 0;
    let totalBytes: number | null = null;

    try {
      await update.downloadAndInstall(
        (event: DownloadEvent) => {
          if (event.event === "Started") {
            totalBytes = event.data.contentLength ?? null;
            setDialog({
              ...buildDialogFromUpdate("available", update),
              kind: "installing",
              progressPercent: totalBytes ? 0 : null,
              downloadedBytes,
              totalBytes,
              stageLabel: "Downloading update...",
            });
            return;
          }

          if (event.event === "Progress") {
            downloadedBytes += event.data.chunkLength;
            const progressPercent =
              totalBytes && totalBytes > 0
                ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
                : null;
            setDialog({
              ...buildDialogFromUpdate("available", update),
              kind: "installing",
              progressPercent,
              downloadedBytes,
              totalBytes,
              stageLabel: "Downloading update...",
            });
            return;
          }

          setDialog({
            ...buildDialogFromUpdate("available", update),
            kind: "installing",
            progressPercent: 100,
            downloadedBytes,
            totalBytes,
            stageLabel: "Verifying and installing update...",
          });
        },
        { timeout: UPDATE_DOWNLOAD_TIMEOUT_MS },
      );

      setStatusText(`Update ${update.version} is ready. Restart borf to finish.`);
      setDialog(buildDialogFromUpdate("ready", update));
    } catch (error: unknown) {
      const message = formatUpdateError(error, "install");
      setStatusText("Update installation failed. Try checking again.");
      setDialog({
        kind: "error",
        title: "Couldn't Install Update",
        message,
        currentVersion: update.currentVersion,
        availableVersion: update.version,
      });
    } finally {
      setIsInstalling(false);
      await releasePendingUpdate();
    }
  }, [isInstalling, releasePendingUpdate]);

  const restartToApplyUpdate = useCallback(async () => {
    try {
      await appApi.requestRestart();
    } catch (error: unknown) {
      const message = formatUpdateError(error, "restart");
      setStatusText("Restart failed. Quit and reopen borf to apply the update.");
      setDialog({
        kind: "error",
        title: "Couldn't Restart borf",
        message,
      });
    }
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV || startupCheckStartedRef.current) {
      return;
    }

    startupCheckStartedRef.current = true;
    const timeoutId = window.setTimeout(() => {
      void runCheck("startup");
    }, STARTUP_UPDATE_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [runCheck]);

  const dialogProps = useMemo<UpdateDialogProps>(
    () => ({
      dialog,
      onClose: closeDialog,
      onInstall: () => {
        void installUpdate();
      },
      onRestart: () => {
        void restartToApplyUpdate();
      },
    }),
    [closeDialog, dialog, installUpdate, restartToApplyUpdate],
  );

  return {
    statusText,
    isChecking: isChecking || isInstalling,
    checkForUpdatesManually,
    dialogProps,
  };
}
