import { BLOG_LOCALE, POST_SLUGS } from "@/lib/blog/registry";
import { renderShareImage, SHARE_IMAGE_ALT } from "@/lib/blog/share-image";

export const alt = SHARE_IMAGE_ALT;
// Literals, so Next can read them without running the module.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Only the Portuguese blog exists. */
export function generateStaticParams() {
  return POST_SLUGS.map((slug) => ({ locale: BLOG_LOCALE, slug }));
}

export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { slug } = await params;
  return renderShareImage(slug);
}
