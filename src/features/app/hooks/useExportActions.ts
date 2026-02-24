import { save } from "@tauri-apps/plugin-dialog";
import { useCallback } from "react";
import { exportApi } from "../../../lib/api";

interface UseExportActionsParams {
  setErrorMessage: (message: string | null) => void;
}

export function useExportActions({ setErrorMessage }: UseExportActionsParams) {
  const handleExportPlayStatsCsv = useCallback(async () => {
    const filePath = await save({
      defaultPath: "play-stats.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;

    try {
      await exportApi.playStatsCsv(filePath);
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, [setErrorMessage]);

  const handleExportTagsCsv = useCallback(async () => {
    const filePath = await save({
      defaultPath: "tags.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;

    try {
      await exportApi.tagsCsv(filePath);
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, [setErrorMessage]);

  const handleExportHierarchyMd = useCallback(async () => {
    const filePath = await save({
      defaultPath: "library-hierarchy.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!filePath) return;

    try {
      await exportApi.libraryHierarchyMd(filePath);
    } catch (error: unknown) {
      setErrorMessage(String(error));
    }
  }, [setErrorMessage]);

  return {
    handleExportPlayStatsCsv,
    handleExportTagsCsv,
    handleExportHierarchyMd,
  };
}
