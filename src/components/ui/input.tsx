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
        "flex h-10 w-full rounded-full bg-cloud/10 px-4 py-2 text-sm text-cloud outline-none transition-all placeholder:text-muted-on-dark focus-visible:ring-1 focus-visible:ring-leaf/40",
        className,
      )}
      {...props}
    />
  );
});

Input.displayName = "Input";
