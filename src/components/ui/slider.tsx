import * as SliderPrimitive from "@radix-ui/react-slider";
import type * as React from "react";
import { cn } from "../../lib/utils";

interface SliderProps extends React.ComponentProps<typeof SliderPrimitive.Root> {
  trackClassName?: string;
  rangeClassName?: string;
  thumbClassName?: string;
}

export function Slider({
  className,
  trackClassName,
  rangeClassName,
  thumbClassName,
  ...props
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex w-full touch-none select-none items-center", className)}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          "relative h-2 w-full grow overflow-hidden rounded-full",
          trackClassName ?? "bg-nook/20",
        )}
      >
        <SliderPrimitive.Range className={cn("absolute h-full", rangeClassName ?? "bg-playing")} />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          "block h-4 w-4 rounded-full shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf/70",
          thumbClassName ?? "bg-accent shadow-sm",
        )}
      />
    </SliderPrimitive.Root>
  );
}
