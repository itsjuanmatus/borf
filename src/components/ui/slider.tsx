import * as SliderPrimitive from "@radix-ui/react-slider";
import type * as React from "react";
import { cn } from "../../lib/utils";

export function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex w-full touch-none select-none items-center", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-sky/40">
        <SliderPrimitive.Range className="absolute h-full bg-playing" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-white bg-accent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf/70" />
    </SliderPrimitive.Root>
  );
}
