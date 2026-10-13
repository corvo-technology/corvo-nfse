interface CorvoLogoProps {
  size?: number;
  variant?: "green" | "white" | "black";
  className?: string;
}

export function CorvoLogo({ size = 16, variant = "green", className }: CorvoLogoProps) {
  const fills = {
    green: { main: "#3fd6a8", wing: "#3fd6a88c", eye: "#0a0a0a" },
    white: { main: "#ededec", wing: "#ededec8c", eye: "#0a0a0a" },
    black: { main: "#0a0a0a", wing: "#0a0a0a8c", eye: "#ededec" },
  };

  const f = fills[variant];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="14 13 50 37"
      width={size}
      height={size * 0.74}
      className={className}
    >
      <path d="M17 44L21 21L39 16L45 25L20 47Z" fill={f.main} />
      <path d="M39 16L45 25L61 26L45 30L41 44L20 47Z" fill={f.wing} />
      <circle cx="33" cy="24.5" r="2.4" fill={f.eye} />
    </svg>
  );
}

export function CorvoWordmark({ size = 16, variant = "green", className }: CorvoLogoProps) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <CorvoLogo size={size} variant={variant} />
      <span className="font-semibold tracking-tight" style={{ fontSize: size * 1.06 }}>
        Corvo
      </span>
    </div>
  );
}
