"use client";

import { useEffect } from "react";
import NextError from "next/error";
import { posthogConfigured, withPostHog } from "@/lib/posthog";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    // posthog-js is loaded on demand: this file is part of every page's first load.
    if (posthogConfigured) withPostHog((posthog) => posthog.captureException(error));
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
