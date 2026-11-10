import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { formatDate, readingMinutes } from "@/lib/blog/registry";
import { CLUSTER_LABEL, type BlogPost } from "@/lib/blog/types";

/** Post card. `featured` is the larger first card on the index. */
export function PostCard({
  post,
  featured = false,
  headingLevel: Heading = "h2",
}: {
  post: BlogPost;
  featured?: boolean;
  headingLevel?: "h2" | "h3";
}) {
  return (
    <li className={featured ? "md:col-span-2 lg:col-span-3" : undefined}>
      <Link
        href={`/pt/blog/${post.slug}`}
        className="group relative flex h-full flex-col rounded-2xl border border-border-soft bg-surface p-6 transition-colors hover:border-accent-border hover:bg-accent-surface sm:p-7"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-4 [&>*]:whitespace-nowrap">
          <span className="rounded-full border border-accent-border px-2.5 py-0.5 text-accent">
            {CLUSTER_LABEL[post.cluster]}
          </span>
          <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          <span aria-hidden="true">·</span>
          <span>{readingMinutes(post)} min</span>
        </div>
        <Heading
          className={`mt-4 font-semibold leading-[1.15] tracking-[-0.02em] text-text ${
            featured ? "max-w-[28ch] text-[28px] sm:text-[36px]" : "text-[21px] sm:text-[23px]"
          }`}
        >
          {post.title}
        </Heading>
        <p className={`mt-3 text-text-3 ${featured ? "max-w-[62ch] text-[16.5px] leading-[1.65]" : "text-[15px] leading-[1.6]"}`}>
          {post.description}
        </p>
        <span className="mt-auto flex items-center gap-1.5 pt-6 text-[14px] font-medium text-text-2 transition-colors group-hover:text-accent">
          Ler o guia
          <ArrowUpRight
            aria-hidden="true"
            className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </li>
  );
}
