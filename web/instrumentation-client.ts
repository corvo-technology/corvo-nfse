import { loadPostHogWhenIdle } from "@/lib/posthog";

// PostHog is loaded after the page is interactive, not in the first-load bundle.
loadPostHogWhenIdle();
