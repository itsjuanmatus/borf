# Crossfade & Playback — Test Plan

## What was fixed (commit `5c0bbab`)

### 1. No crossfade on manual skip
`playNext()` always uses `{ transition: "immediate" }`. Crossfade only triggers via `handlePositionTick` for natural track endings.

### 2. Deferred crossfade — UI stays on current song
When crossfade triggers, the next song starts in the backend but the UI stays on the outgoing song until it finishes. A `DeferredCrossfade` object in the player store tracks the pending transition. Position events are intercepted to calculate the outgoing song's position.

### 3. Seeking cancels crossfade
`handleSeek` detects an active deferred crossfade, clears it, and re-plays the current song at the seek position with an immediate transition.

### 4. Pause works during crossfade
`pausedAt` on `DeferredCrossfade` freezes the elapsed timer. The `audio:state-changed` handler adjusts timestamps on pause/resume.

### 5. No double-advance on track end
`audio:track-ended` handler skips `playNext()` when a deferred crossfade is active.

### 6. New play request clears crossfade
`beginPlaybackRequest()` sets `deferredCrossfade` to `null`, covering every play path.

### 7. `setQueueIds` doesn't overwrite `nowPlaying`
Removed the auto-calculation. `bootstrapQueueRestore` only sets `nowPlaying` on initial load (`nowPlaying === null`).

### 8. Up-next reads from store directly
`previewQueueAdvanceTarget` calls `useQueueStore.getState().upNext[0]` instead of using a React closure prop.

---

## Prerequisite: extract pure functions

Most logic lives inside `useCallback` hooks in `usePlaybackController`. Before writing tests, extract these into standalone pure functions in a dedicated module (e.g. `src/features/app/playback-logic.ts`):

| Function to extract | Current location | Inputs | Output |
|---|---|---|---|
| `computeEffectiveCrossfadeMs` | usePlaybackController ~line 72 | requestedMs, currentDurationMs, nextDurationMs | number |
| `normalizeCrossfadeSeconds` | usePlaybackController ~line 72 | seconds | number (clamped 1-12) |
| `calculateDeferredPosition` | useAppEventListeners (inline) | deferred: DeferredCrossfade, now: number | number (position in ms) |
| `shouldCompleteDeferredCrossfade` | handlePositionTick (inline) | positionMs, deferredDurationMs | boolean |
| `adjustDeferredForPause` | useAppEventListeners (inline) | deferred: DeferredCrossfade | DeferredCrossfade with pausedAt set |
| `adjustDeferredForResume` | useAppEventListeners (inline) | deferred: DeferredCrossfade, now: number | DeferredCrossfade with startedAt shifted, pausedAt cleared |
| `resolveNextTarget` | previewQueueAdvanceTarget | upNext, queueIds, currentIndex, songCache, repeatMode | QueueAdvanceTarget or null |

---

## Test cases

### Group: player store — `setQueueIds`
**No mocks needed. Direct store tests.**

1. `setQueueIds` sets `queueIds` and `currentIndex` without touching `nowPlaying`
2. `setQueueIds` with a different `currentIndex` does not change an existing `nowPlaying`
3. `setQueueIds` with empty array sets both to `[]` and `null`

### Group: player store — `deferredCrossfade`
**No mocks needed.**

4. `setDeferredCrossfade` stores the value, `getState()` returns it
5. `setDeferredCrossfade(null)` clears it
6. Initial store state has `deferredCrossfade: null`

### Group: queue store — up-next
**No mocks needed.**

7. `enqueueSongs` adds songs to `upNext`
8. `enqueueSongs` deduplicates by id
9. `removeFromUpNext` removes the correct song
10. `getState().upNext` reflects changes immediately (no render needed)

### Group: `computeEffectiveCrossfadeMs`
**No mocks needed. Pure function.**

11. Returns `min(requested, currentDuration/2, nextDuration/2)`
12. Returns 0 when requested is 0
13. Clamps to half of shorter track

### Group: `normalizeCrossfadeSeconds`
**No mocks needed. Pure function.**

14. Clamps below minimum (1) to 1
15. Clamps above maximum (12) to 12
16. Passes through valid values unchanged

### Group: `calculateDeferredPosition`
**No mocks needed. Pure function (after extraction).**

17. Returns `positionAtStart + elapsed`, clamped to `durationMs`
18. When `pausedAt` is set, uses `pausedAt` instead of `now` for elapsed
19. Never exceeds `durationMs`
20. Returns `positionAtStart` when elapsed is 0

### Group: `adjustDeferredForPause` / `adjustDeferredForResume`
**No mocks needed. Pure functions (after extraction).**

21. Pause sets `pausedAt` to the given timestamp
22. Pause does nothing if `pausedAt` is already set
23. Resume shifts `startedAt` forward by pause duration
24. Resume clears `pausedAt`
25. Resume does nothing if `pausedAt` is null

### Group: `resolveNextTarget`
**No mocks needed. Pure function (after extraction).**

26. Returns `upNext[0]` with `fromUpNext: true` when up-next is non-empty
27. Returns song at `currentIndex + 1` when up-next is empty
28. Returns null when at end of queue and repeat is off
29. Wraps to index 0 when at end and repeat is "all"
30. Returns null when queue is empty
31. Returns null when song at next index is not in cache

### Group: integration — track-ended handler logic
**Mock only `audioApi` (system boundary). Real stores, real logic.**

32. When `deferredCrossfade` is active, track-ended does NOT advance the queue
33. When `deferredCrossfade` is null, track-ended calls the advance function

### Group: integration — beginPlaybackRequest
**Mock only `audioApi`. Real stores.**

34. Clears `deferredCrossfade` from the player store
35. Resets the auto-crossfade song ID ref (verified by subsequent crossfade being allowed)

---

## Running tests

```bash
pnpm test           # run all tests
pnpm test --watch   # watch mode
```
