import type { ComponentProps } from "react";
import { ItunesImportWizard } from "../../import/ItunesImportWizard";
import { EditCommentDialog } from "../../metadata/EditCommentDialog";
import { ManageTagsDialog } from "../../metadata/ManageTagsDialog";
import { SetCustomStartDialog } from "../../metadata/SetCustomStartDialog";
import { SongContextMenu } from "../../metadata/SongContextMenu";
import { SearchPalette } from "../../search/SearchPalette";

type SongContextMenuProps = ComponentProps<typeof SongContextMenu>;
type SearchPaletteProps = ComponentProps<typeof SearchPalette>;
type ManageTagsDialogProps = ComponentProps<typeof ManageTagsDialog>;
type EditCommentDialogProps = ComponentProps<typeof EditCommentDialog>;
type SetCustomStartDialogProps = ComponentProps<typeof SetCustomStartDialog>;
type ItunesImportWizardProps = ComponentProps<typeof ItunesImportWizard>;

export interface AppDialogLayerProps {
  songContextMenuProps: SongContextMenuProps;
  searchPaletteProps: SearchPaletteProps;
  manageTagsDialogProps: ManageTagsDialogProps;
  editCommentDialogProps: EditCommentDialogProps;
  setCustomStartDialogProps: SetCustomStartDialogProps;
  itunesImportWizardProps: ItunesImportWizardProps;
}

export function AppDialogLayer({
  songContextMenuProps,
  searchPaletteProps,
  manageTagsDialogProps,
  editCommentDialogProps,
  setCustomStartDialogProps,
  itunesImportWizardProps,
}: AppDialogLayerProps) {
  return (
    <>
      <SongContextMenu {...songContextMenuProps} />
      <SearchPalette {...searchPaletteProps} />
      <ManageTagsDialog {...manageTagsDialogProps} />
      <EditCommentDialog {...editCommentDialogProps} />
      <SetCustomStartDialog {...setCustomStartDialogProps} />
      <ItunesImportWizard {...itunesImportWizardProps} />
    </>
  );
}
