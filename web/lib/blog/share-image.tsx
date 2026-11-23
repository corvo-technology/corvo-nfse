import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { CLUSTER_LABEL } from "./types";
import { formatDate, getPost, readingMinutes } from "./registry";

export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const SHARE_IMAGE_TYPE = "image/png";
export const SHARE_IMAGE_ALT = "Guia do blog da Corvo sobre nota fiscal de serviço (NFS-e)";

// The brand colors of the site (globals.css): off-black canvas, emerald accent, paper for the print.
const BG = "#0a0a0a";
const TEXT = "#ededec";
const MUTED = "#8f8f8f";
const ACCENT = "#5fe0b0";
const PAPER = "#e9e7df";

/** Longer titles get a smaller size so they stay within three lines. */
const titleSize = (title: string) => (title.length > 80 ? 52 : title.length > 56 ? 60 : 68);

/**
 * The share card of one post (1200x630): the title in large type, its topic, and the brand.
 * It is generated at build time from the same registry the page reads, so it never drifts from the title.
 */
export async function renderShareImage(slug: string): Promise<Response> {
  const post = getPost(slug);
  if (!post) return new Response("Not found", { status: 404 });
  const mark = await readFile(join(process.cwd(), "public", "brand", "corvo-faceted-green.png"));
  const markSrc = `data:image/png;base64,${mark.toString("base64")}`;
  const meta = `${CLUSTER_LABEL[post.cluster]} · ${readingMinutes(post)} min de leitura · ${formatDate(post.publishedAt)}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: BG, color: TEXT }}>
        {/* A sheet of paper on the right edge, the receipt of the "Resposta rápida" box. */}
        <div style={{ width: 28, height: "100%", display: "flex", background: PAPER }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px 56px 64px" }}>
          <div style={{ display: "flex", color: ACCENT, fontSize: 28, letterSpacing: 1 }}>{meta}</div>
          <div style={{ display: "flex", fontSize: titleSize(post.title), lineHeight: 1.08, letterSpacing: -1.5, maxWidth: 1000 }}>{post.title}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={markSrc} width={44} height={44} alt="" />
              <div style={{ display: "flex", fontSize: 34, color: TEXT }}>Corvo</div>
            </div>
            <div style={{ display: "flex", fontSize: 26, color: MUTED }}>corvo.tech/pt/blog</div>
          </div>
        </div>
      </div>
    ),
    SHARE_IMAGE_SIZE,
  );
}
