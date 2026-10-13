// components/docs/inline-text.tsx
const CODE_CLASS =
  "rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] text-accent";

function renderParts(body: string) {
  return body.split(/`([^`]+)`/g).map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className={CODE_CLASS}>
        {part}
      </code>
    ) : (
      part
    ),
  );
}

export function InlineText({ body }: { body: string }) {
  return <>{renderParts(body)}</>;
}

export { renderParts as renderInlineParts };
