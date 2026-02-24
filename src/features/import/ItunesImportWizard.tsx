import { CheckCircle2, LoaderCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import type {
  ItunesImportOptions,
  ItunesImportProgress,
  ItunesImportSummary,
  ItunesPreview,
} from "../../types";

export type ImportWizardStep = 1 | 2 | 3 | 4 | 5;

interface ItunesImportWizardProps {
  isOpen: boolean;
  step: ImportWizardStep;
  xmlPath: string;
  preview: ItunesPreview | null;
  options: ItunesImportOptions;
  progress: ItunesImportProgress | null;
  summary: ItunesImportSummary | null;
  isImporting: boolean;
  importProgressPercent: number;
  onClose: () => void;
  onPickXml: () => void;
  onSetStep: (step: ImportWizardStep) => void;
  onToggleOption: (key: keyof ItunesImportOptions, value: boolean) => void;
  onRunImport: () => void;
}

export function ItunesImportWizard({
  isOpen,
  step,
  xmlPath,
  preview,
  options,
  progress,
  summary,
  isImporting,
  importProgressPercent,
  onClose,
  onPickXml,
  onSetStep,
  onToggleOption,
  onRunImport,
}: ItunesImportWizardProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl bg-cloud p-8 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Import iTunes Library</h3>
            <p className="text-sm text-muted">Step {step} of 5</p>
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>

        {step === 1 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Select your iTunes <code>Library.xml</code> file to start.
            </p>
            <Button onClick={onPickXml}>Select Library.xml</Button>
            {xmlPath ? <p className="text-xs text-muted">{xmlPath}</p> : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">Preview detected content before importing.</p>
            {preview ? (
              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-sand/50 p-4 text-sm">
                <p>Tracks found: {preview.tracks_found.toLocaleString()}</p>
                <p>Playlists found: {preview.playlists_found.toLocaleString()}</p>
                <p>Matched tracks: {preview.matched_tracks.toLocaleString()}</p>
                <p>Unmatched tracks: {preview.unmatched_tracks.toLocaleString()}</p>
                <p>Smart playlists skipped: {preview.skipped_smart_playlists}</p>
                <p>System playlists skipped: {preview.skipped_system_playlists}</p>
              </div>
            ) : (
              <p className="text-sm text-muted">Loading preview...</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => onSetStep(1)}>
                Back
              </Button>
              <Button onClick={() => onSetStep(3)} disabled={!preview}>
                Next
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">Choose what to import from iTunes.</p>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                checked={options.import_play_counts}
                onChange={(event) => onToggleOption("import_play_counts", event.target.checked)}
              />
              Play counts and skip counts
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                checked={options.import_ratings}
                onChange={(event) => onToggleOption("import_ratings", event.target.checked)}
              />
              Ratings
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                checked={options.import_comments}
                onChange={(event) => onToggleOption("import_comments", event.target.checked)}
              />
              Comments
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                checked={options.import_playlists}
                onChange={(event) => onToggleOption("import_playlists", event.target.checked)}
              />
              Playlists
            </label>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => onSetStep(2)}>
                Back
              </Button>
              <Button onClick={onRunImport}>Run Import</Button>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Import in progress...
            </div>

            {progress ? (
              <div className="space-y-2 rounded-2xl bg-sand/50 p-4 text-sm">
                <p className="font-medium">Stage: {progress.stage}</p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-sky/30">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${importProgressPercent}%` }}
                  />
                </div>
                <p>
                  {progress.processed.toLocaleString()} / {progress.total.toLocaleString()}
                </p>
                <p>
                  Matched: {progress.matched.toLocaleString()} • Unmatched:{" "}
                  {progress.unmatched.toLocaleString()}
                </p>
                {progress.current_item ? (
                  <p className="truncate text-xs text-muted">{progress.current_item}</p>
                ) : null}
              </div>
            ) : null}

            {!isImporting ? (
              <div className="flex justify-end">
                <Button onClick={() => onSetStep(5)}>Continue</Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              Import complete
            </div>

            {summary ? (
              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-sand/50 p-4 text-sm">
                <p>Tracks found: {summary.tracks_found.toLocaleString()}</p>
                <p>Matched tracks: {summary.matched_tracks.toLocaleString()}</p>
                <p>Unmatched tracks: {summary.unmatched_tracks.toLocaleString()}</p>
                <p>Song updates imported: {summary.imported_song_updates.toLocaleString()}</p>
                <p>Playlists imported: {summary.imported_playlists.toLocaleString()}</p>
                <p>Playlists scanned: {summary.playlists_found.toLocaleString()}</p>
              </div>
            ) : (
              <p className="text-sm text-muted">No summary data available.</p>
            )}

            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
