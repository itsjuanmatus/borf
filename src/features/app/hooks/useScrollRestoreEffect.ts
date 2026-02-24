import { type MutableRefObject, useEffect } from "react";
import type { NavigationRoute, NavigationScrollPositions } from "../navigation/navigation-types";
import { navigationRouteKey, normalizeScrollPosition } from "../navigation/navigation-utils";

interface PendingScrollRestore {
  route: NavigationRoute;
  scrollByRoute: NavigationScrollPositions;
}

interface UseScrollRestoreEffectParams {
  scrollRestoreTick: number;
  currentRouteKey: string;
  activePlaylistIsFolder: boolean;
  pendingScrollRestoreRef: MutableRefObject<PendingScrollRestore | null>;
  resolveScrollElementForRoute: (route: NavigationRoute) => HTMLElement | null;
  maxAttempts: number;
}

export function useScrollRestoreEffect({
  scrollRestoreTick,
  currentRouteKey,
  activePlaylistIsFolder,
  pendingScrollRestoreRef,
  resolveScrollElementForRoute,
  maxAttempts,
}: UseScrollRestoreEffectParams) {
  useEffect(() => {
    if (scrollRestoreTick < 0) {
      return;
    }

    const pending = pendingScrollRestoreRef.current;
    if (!pending) {
      return;
    }

    const pendingRouteKey = navigationRouteKey(pending.route);
    if (pendingRouteKey !== currentRouteKey) {
      return;
    }

    if (pending.route.kind === "history") {
      pendingScrollRestoreRef.current = null;
      return;
    }

    if (pending.route.kind === "playlist" && !activePlaylistIsFolder) {
      pendingScrollRestoreRef.current = null;
      return;
    }

    const targetScrollTop = normalizeScrollPosition(pending.scrollByRoute[pendingRouteKey] ?? 0);
    let attempts = 0;
    let frame = 0;

    const applyRestore = () => {
      const element = resolveScrollElementForRoute(pending.route);
      if (!element) {
        if (attempts >= maxAttempts) {
          pendingScrollRestoreRef.current = null;
          return;
        }
        attempts += 1;
        frame = window.requestAnimationFrame(applyRestore);
        return;
      }

      element.scrollTop = targetScrollTop;
      if (Math.abs(element.scrollTop - targetScrollTop) <= 1 || attempts >= maxAttempts) {
        pendingScrollRestoreRef.current = null;
        return;
      }

      attempts += 1;
      frame = window.requestAnimationFrame(applyRestore);
    };

    frame = window.requestAnimationFrame(applyRestore);
    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [
    activePlaylistIsFolder,
    currentRouteKey,
    maxAttempts,
    pendingScrollRestoreRef,
    resolveScrollElementForRoute,
    scrollRestoreTick,
  ]);
}
