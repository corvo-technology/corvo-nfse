import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("field", className)} {...props} />
));
Input.displayName = "Input";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  optionalLabel?: string;
  /** Shows a required asterisk next to the label. */
  required?: boolean;
  className?: string;
  /** Receives the props that must be spread on the control. */
  children: (control: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
  }) => ReactNode;
}

/** Label + control + hint/error, wired together for screen readers. */
function Field({ label, hint, error, optionalLabel, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="field-label">
        {label}
        {required && <span aria-hidden className="ml-1 text-danger">*</span>}
        {optionalLabel && <span className="ml-1.5 font-normal text-text-4">({optionalLabel})</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={`${id}-err`} className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export { Input, Field, type InputProps };
