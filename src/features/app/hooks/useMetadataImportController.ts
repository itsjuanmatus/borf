import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useMemo, useState } from "react";
import { libraryApi, tagsApi } from "../../../lib/api";
import type {
  ItunesImportOptions,
  ItunesImportProgress,
  ItunesImportSummary,
  ItunesPreview,
  SongListItem,
} from "../../../types";
import type { ImportWizardStep } from "../../import/ItunesImportWizard";

interface UseMetadataImportControllerParams {
  songLookupById: Map<string, SongListItem>;
  loadSongsByIdsInBatches: (songIds: string[]) => Promise<SongListItem[]>;
  refreshAllViews: () => Promise<void>;
  setErrorMessage: (message: string | null) => void;
}

export function useMetadataImportController({
  songLookupById,
  loadSongsByIdsInBatches,
  refreshAllViews,
  setErrorMessage,
}: UseMetadataImportControllerParams) {
  const [metadataTargetSongIds, setMetadataTargetSongIds] = useState<string[]>([]);
  const [showManageTagsDialog, setShowManageTagsDialog] = useState(false);
  const [manageTagsSelection, setManageTagsSelection] = useState<string[]>([]);
  const [manageTagsBaseline, setManageTagsBaseline] = useState<string[]>([]);
  const [showEditCommentDialog, setShowEditCommentDialog] = useState(false);
  const [showCustomStartDialog, setShowCustomStartDialog] = useState(false);

  const [showImportWizard, setShowImportWizard] = useState(false);
  const [importWizardStep, setImportWizardStep] = useState<ImportWizardStep>(1);
  const [itunesXmlPath, setItunesXmlPath] = useState("");
  const [itunesPreview, setItunesPreview] = useState<ItunesPreview | null>(null);
  const [itunesOptions, setItunesOptions] = useState<ItunesImportOptions>({
    import_play_counts: true,
    import_ratings: true,
    import_comments: true,
    import_playlists: true,
  });
  const [itunesProgress, setItunesProgress] = useState<ItunesImportProgress | null>(null);
  const [itunesSummary, setItunesSummary] = useState<ItunesImportSummary | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const metadataTargetSongs = useMemo(
    () =>
      metadataTargetSongIds
        .map((songId) => songLookupById.get(songId))
        .filter((song): song is SongListItem => Boolean(song)),
    [metadataTargetSongIds, songLookupById],
  );

  const openManageTagsForSongs = useCallback(
    async (songIds: string[]) => {
      const deduped = Array.from(new Set(songIds));
      if (deduped.length === 0) {
        return;
      }

      let targetSongs = deduped
        .map((songId) => songLookupById.get(songId))
        .filter((song): song is SongListItem => Boolean(song));

      try {
        const freshSongs = await loadSongsByIdsInBatches(deduped);
        if (freshSongs.length > 0) {
          targetSongs = freshSongs;
        }
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }

      if (targetSongs.length === 0) {
        return;
      }

      const firstSongTagIds = targetSongs[0]?.tags.map((tag) => tag.id) ?? [];
      const baseline = firstSongTagIds.filter((tagId) =>
        targetSongs.every((song) => song.tags.some((tag) => tag.id === tagId)),
      );

      setMetadataTargetSongIds(deduped);
      setManageTagsBaseline(baseline);
      setManageTagsSelection(baseline);
      setShowManageTagsDialog(true);
    },
    [loadSongsByIdsInBatches, setErrorMessage, songLookupById],
  );

  const applyManageTags = useCallback(async () => {
    if (metadataTargetSongIds.length === 0) {
      return;
    }

    const baselineSet = new Set(manageTagsBaseline);
    const selectedSet = new Set(manageTagsSelection);
    const tagsToAssign = manageTagsSelection.filter((tagId) => !baselineSet.has(tagId));
    const tagsToRemove = manageTagsBaseline.filter((tagId) => !selectedSet.has(tagId));

    try {
      if (tagsToAssign.length > 0) {
        await tagsApi.assign(metadataTargetSongIds, tagsToAssign);
      }
      if (tagsToRemove.length > 0) {
        await tagsApi.remove(metadataTargetSongIds, tagsToRemove);
      }
      setShowManageTagsDialog(false);
      await refreshAllViews();
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, [
    manageTagsBaseline,
    manageTagsSelection,
    metadataTargetSongIds,
    refreshAllViews,
    setErrorMessage,
  ]);

  const applySongComment = useCallback(
    async (comment: string | null) => {
      if (metadataTargetSongIds.length === 0) {
        return;
      }
      try {
        await Promise.all(
          metadataTargetSongIds.map((songId) => libraryApi.updateSongComment(songId, comment)),
        );
        setShowEditCommentDialog(false);
        await refreshAllViews();
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [metadataTargetSongIds, refreshAllViews, setErrorMessage],
  );

  const applyCustomStart = useCallback(
    async (customStartMs: number) => {
      if (metadataTargetSongIds.length === 0) {
        return;
      }
      try {
        await Promise.all(
          metadataTargetSongIds.map((songId) =>
            libraryApi.setSongCustomStart(songId, customStartMs),
          ),
        );
        setShowCustomStartDialog(false);
        await refreshAllViews();
      } catch (error: unknown) {
        setErrorMessage(String(error));
      }
    },
    [metadataTargetSongIds, refreshAllViews, setErrorMessage],
  );

  const openImportWizard = useCallback(() => {
    setShowImportWizard(true);
    setImportWizardStep(1);
    setErrorMessage(null);
  }, [setErrorMessage]);

  const resetImportWizard = useCallback(() => {
    setShowImportWizard(false);
    setImportWizardStep(1);
    setItunesXmlPath("");
    setItunesPreview(null);
    setItunesProgress(null);
    setItunesSummary(null);
    setIsImporting(false);
    setItunesOptions({
      import_play_counts: true,
      import_ratings: true,
      import_comments: true,
      import_playlists: true,
    });
  }, []);

  const handlePickItunesXml = useCallback(async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      title: "Select iTunes Library.xml",
      filters: [{ name: "iTunes XML", extensions: ["xml"] }],
    });

    if (typeof selected !== "string") {
      return;
    }

    setItunesXmlPath(selected);
    setImportWizardStep(2);
    setErrorMessage(null);

    try {
      const preview = await libraryApi.importItunesPreview(selected);
      setItunesPreview(preview);
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, [setErrorMessage]);

  const handleRunItunesImport = useCallback(async () => {
    if (!itunesXmlPath) {
      return;
    }

    setImportWizardStep(4);
    setIsImporting(true);
    setErrorMessage(null);

    try {
      const summary = await libraryApi.importItunes(itunesXmlPath, itunesOptions);
      setItunesSummary(summary);
      setImportWizardStep(5);
      await refreshAllViews();
    } catch (error: unknown) {
      setErrorMessage(String(error));
    } finally {
      setIsImporting(false);
    }
  }, [itunesOptions, itunesXmlPath, refreshAllViews, setErrorMessage]);

  return {
    metadataTargetSongIds,
    setMetadataTargetSongIds,
    metadataTargetSongs,
    showManageTagsDialog,
    setShowManageTagsDialog,
    manageTagsSelection,
    setManageTagsSelection,
    showEditCommentDialog,
    setShowEditCommentDialog,
    showCustomStartDialog,
    setShowCustomStartDialog,
    showImportWizard,
    setShowImportWizard,
    importWizardStep,
    setImportWizardStep,
    itunesXmlPath,
    itunesPreview,
    itunesOptions,
    setItunesOptions,
    itunesProgress,
    setItunesProgress,
    itunesSummary,
    isImporting,
    openManageTagsForSongs,
    applyManageTags,
    applySongComment,
    applyCustomStart,
    openImportWizard,
    resetImportWizard,
    handlePickItunesXml,
    handleRunItunesImport,
  };
}
