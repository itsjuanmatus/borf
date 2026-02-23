import * as React from "react";
import { cn } from "../../lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded-full border border-border bg-white px-4 py-2 text-sm text-text outline-none transition-colors placeholder:text-muted focus-visible:border-accent",
        className,
      )}
      {...props}
    />
  );
});

Input.displayName = "Input";
