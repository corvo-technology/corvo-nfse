import { cn } from "@/lib/utils";

type AvatarSize = "sm" | "md" | "lg";

interface AvatarProps {
  initial: string;
  size?: AvatarSize;
  className?: string;
}

const sizeStyles: Record<AvatarSize, string> = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-[13px]",
  lg: "h-12 w-12 text-[15px]",
};

function Avatar({ initial, size = "md", className }: AvatarProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-[#232323] font-mono font-medium text-text-3 select-none shrink-0",
        sizeStyles[size],
        className
      )}
    >
      {initial}
    </div>
  );
}

export { Avatar, type AvatarProps, type AvatarSize };
