import type * as React from "react";
import { cn } from "../../lib/utils";

export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-full border border-border bg-white px-4 py-2 text-sm text-text outline-none transition-colors placeholder:text-muted focus-visible:border-accent",
        className,
      )}
      {...props}
    />
  );
}
