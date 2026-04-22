import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const SectionHeader = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, children, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("text-xs font-semibold tracking-wide text-muted-foreground uppercase", className)}
      {...props}
    >
      {children}
    </h2>
  )
);
SectionHeader.displayName = "SectionHeader";
