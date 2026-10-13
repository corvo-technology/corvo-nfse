// components/docs/callout.tsx
import { AlertTriangle, Info } from "lucide-react";
import { InlineText } from "./inline-text";

const TONE_CLASS = {
  warn: "banner-warn",
  accent: "banner-accent",
  danger: "banner-danger",
} as const;

const TONE_ICON = {
  warn: AlertTriangle,
  accent: Info,
  danger: AlertTriangle,
} as const;

const TONE_ICON_COLOR = {
  warn: "text-warn",
  accent: "text-accent",
  danger: "text-danger",
} as const;

export function Callout({
  tone,
  body,
}: {
  tone: "warn" | "accent" | "danger";
  body: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <p className={`banner ${TONE_CLASS[tone]} text-sm`}>
      <Icon
        aria-hidden="true"
        className={`size-4 shrink-0 translate-y-0.5 ${TONE_ICON_COLOR[tone]}`}
      />
      <span className="min-w-0 flex-1">
        <InlineText body={body} />
      </span>
    </p>
  );
}
