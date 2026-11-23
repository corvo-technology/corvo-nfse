import Link from "next/link";
import { NoBreakTerms } from "@/lib/blog/inline";
import { readingMinutes } from "@/lib/blog/registry";
import { CLUSTER_LABEL, type BlogPost } from "@/lib/blog/types";

/**
 * One post as a ruled row: title and description on the left, topic and reading time on the right.
 * No box, no repeated "read more" label; the whole row is the link and the title lights up on hover.
 */
export function PostRow({
  post,
  large = false,
  headingLevel: Heading = "h2",
}: {
  post: BlogPost;
  large?: boolean;
  headingLevel?: "h2" | "h3";
}) {
  return (
    <li className="border-t border-border-soft first:border-t-0">
      <Link
        href={`/pt/blog/${post.slug}`}
        className="group grid gap-3 py-7 sm:grid-cols-[minmax(0,1fr)_9.5rem] sm:gap-12 sm:py-9"
      >
        <div className="min-w-0">
          <Heading
            className={`font-semibold leading-[1.15] tracking-[-0.02em] text-text text-balance transition-colors group-hover:text-accent ${
              large ? "text-[28px] sm:text-[36px]" : "text-[22px] sm:text-[26px]"
            }`}
          >
            <NoBreakTerms text={post.title} />
          </Heading>
          <p className="mt-3 max-w-[64ch] text-[16px] leading-[1.65] text-text-3 text-pretty">{post.description}</p>
        </div>
        <p className="text-[14px] leading-[1.6] text-text-4 sm:pt-1.5 sm:text-right">
          {CLUSTER_LABEL[post.cluster]}
          <br />
          {readingMinutes(post)} min de leitura
        </p>
      </Link>
    </li>
  );
}
