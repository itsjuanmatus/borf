import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";

interface AppHeaderProps {
  title: string;
  subtitle: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
}

export function AppHeader({
  title,
  subtitle,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
}: AppHeaderProps) {
  return (
    <header className="relative px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-1 pt-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-on-dark hover:bg-cloud/8 hover:text-cloud"
                  onClick={onGoBack}
                  disabled={!canGoBack}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back (Cmd/Ctrl+[ or Alt+Left)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-on-dark hover:bg-cloud/8 hover:text-cloud"
                  onClick={onGoForward}
                  disabled={!canGoForward}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Forward (Cmd/Ctrl+] or Alt+Right)</TooltipContent>
            </Tooltip>
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-cloud">{title}</h2>
            <p className="text-sm text-muted-on-dark">{subtitle}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
