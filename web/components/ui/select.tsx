import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/** Native select with the same height and look as `Input` (see `select.field` in globals.css). */
const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn("field", className)} {...props} />
));
Select.displayName = "Select";

export { Select };
