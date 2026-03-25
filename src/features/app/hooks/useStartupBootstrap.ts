import { useEffect, useRef } from "react";
import { scheduleIdleWork, startupTrace, startupTraceDuration } from "../../../lib/startup-trace";
import type { LibraryView, QueueRestoreMode } from "../../../types";

type StartupTokenChecker = (token: number) => boolean;
type StartupTask = (token: number, isCurrent: StartupTokenChecker) => Promise<void>;

interface UseStartupBootstrapParams {
  activeView: LibraryView;
  queueRestoreMode?: QueueRestoreMode;
  bootstrapSongs: StartupTask;
  bootstrapAlbums: StartupTask;
  bootstrapArtists: StartupTask;
  bootstrapPlaylists: StartupTask;
  bootstrapTags: StartupTask;
  bootstrapQueueRestore: (
    mode: QueueRestoreMode,
    token: number,
    isCurrent: StartupTokenChecker,
  ) => Promise<void>;
  setErrorMessage: (message: string | null) => void;
}

export function useStartupBootstrap(params: UseStartupBootstrapParams) {
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const bootTokenRef = useRef(0);

  useEffect(() => {
    const {
      activeView,
      queueRestoreMode = "lazy",
      bootstrapSongs,
      bootstrapAlbums,
      bootstrapArtists,
      bootstrapPlaylists,
      bootstrapTags,
      bootstrapQueueRestore,
      setErrorMessage,
    } = paramsRef.current;

    const token = bootTokenRef.current + 1;
    bootTokenRef.current = token;
    let cancelDeferredWarmup: (() => void) | null = null;
    const isCurrent: StartupTokenChecker = (value) => bootTokenRef.current === value;

    const kickoffHandle = window.setTimeout(() => {
      void (async () => {
        startupTrace("bootstrap.begin", `token=${token} view=${activeView}`);

        const phaseAStartedAt = performance.now();
        await bootstrapSongs(token, isCurrent);
        if (!isCurrent(token)) {
          return;
        }

        await bootstrapQueueRestore(queueRestoreMode, token, isCurrent);
        if (!isCurrent(token)) {
          return;
        }

        if (activeView === "albums") {
          await bootstrapAlbums(token, isCurrent);
        } else if (activeView === "artists") {
          await bootstrapArtists(token, isCurrent);
        } else if (activeView === "playlist") {
          await bootstrapPlaylists(token, isCurrent);
        }
        if (!isCurrent(token)) {
          return;
        }

        startupTraceDuration("bootstrap.phase-a", phaseAStartedAt, `view=${activeView}`);

        cancelDeferredWarmup = scheduleIdleWork(() => {
          void (async () => {
            if (!isCurrent(token)) {
              return;
            }
            const phaseBStartedAt = performance.now();
            startupTrace("bootstrap.phase-b.begin");

            const deferredTasks: Promise<void>[] = [];
            if (activeView !== "albums") {
              deferredTasks.push(bootstrapAlbums(token, isCurrent));
            }
            if (activeView !== "artists") {
              deferredTasks.push(bootstrapArtists(token, isCurrent));
            }
            if (activeView !== "playlist") {
              deferredTasks.push(bootstrapPlaylists(token, isCurrent));
            }
            deferredTasks.push(bootstrapTags(token, isCurrent));

            await Promise.all(deferredTasks);
            if (!isCurrent(token)) {
              return;
            }

            startupTraceDuration("bootstrap.phase-b", phaseBStartedAt);
            startupTrace("bootstrap.complete");
          })().catch((error: unknown) => {
            if (!isCurrent(token)) {
              return;
            }
            setErrorMessage(String(error));
          });
        });
      })().catch((error: unknown) => {
        if (!isCurrent(token)) {
          return;
        }
        setErrorMessage(String(error));
      });
    }, 0);

    return () => {
      bootTokenRef.current += 1;
      window.clearTimeout(kickoffHandle);
      cancelDeferredWarmup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
