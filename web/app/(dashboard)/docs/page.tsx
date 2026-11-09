import { permanentRedirect } from "next/navigation";

/** Fallback if the proxy did not run. Same destination as the proxy 301: always /pt/docs, one hop. */
export default function DocsRedirect() {
  permanentRedirect("/pt/docs");
}
