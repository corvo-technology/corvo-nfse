import { plain } from "./inline";
import { post as agenda } from "./posts/nota-fiscal-todo-mes-agendada";
import { post as certificado } from "./posts/certificado-digital-a1-o-que-e-quando-precisa";
import { post as claude } from "./posts/emitir-nota-fiscal-com-claude";
import { post as planilha } from "./posts/emitir-varias-notas-fiscais-com-planilha";
import { post as pilar } from "./posts/como-emitir-nota-fiscal-de-servico-nfse";
import { post as simples } from "./posts/simples-nacional-nfse-nacional-novembro-2026";
import { post as nfeProduto } from "./posts/o-que-e-nf-e-como-emitir-nota-fiscal-de-produto";
import { post as nfceCupom } from "./posts/o-que-e-nfc-e-cupom-fiscal-eletronico";
import { post as qualNota } from "./posts/nfse-nfe-ou-nfce-qual-nota-fiscal-emitir";
import { post as integracoes } from "./posts/nota-fiscal-automatica-para-cada-venda-integracoes";
import { post as infoprodutor } from "./posts/nota-fiscal-infoprodutor-hotmart-kiwify-eduzz-monetizze";
import { post as reembolso } from "./posts/reembolso-chargeback-nota-fiscal-cancelar";
import { post as emitirNotaNoSeuSistema } from "./posts/emitir-nota-fiscal-no-seu-sistema-saas";
import type { BlogBlock, BlogPost } from "./types";

/** The blog exists in Brazilian Portuguese only: the audience and the keywords are Brazilian. */
export const BLOG_LOCALE = "pt" as const;

/** Newest first. Posts with the same date keep the order written here. */
export const POSTS: BlogPost[] = [
  emitirNotaNoSeuSistema,
  nfeProduto,
  nfceCupom,
  qualNota,
  integracoes,
  infoprodutor,
  reembolso,
  pilar,
  simples,
  certificado,
  planilha,
  agenda,
  claude,
].sort((a, b) =>
  b.publishedAt.localeCompare(a.publishedAt),
);

export const POST_SLUGS = POSTS.map((post) => post.slug);

export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find((post) => post.slug === slug);
}

/** Editorial picks first, then same-cluster posts, never the post itself. */
export function relatedPosts(post: BlogPost, limit = 3): BlogPost[] {
  const picked = post.readNext.map(getPost).filter((item): item is BlogPost => Boolean(item));
  const sameCluster = POSTS.filter((item) => item.cluster === post.cluster);
  const rest = POSTS;
  const seen = new Set<string>([post.slug]);
  const out: BlogPost[] = [];
  for (const item of [...picked, ...sameCluster, ...rest]) {
    if (seen.has(item.slug)) continue;
    seen.add(item.slug);
    out.push(item);
    if (out.length === limit) break;
  }
  return out;
}

export function slugifyHeading(text: string): string {
  return plain(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const FAQ_ANCHOR = "perguntas-frequentes";

export interface TocEntry {
  id: string;
  text: string;
}

export function tableOfContents(post: BlogPost): TocEntry[] {
  const entries = post.blocks
    .filter((block): block is Extract<BlogBlock, { kind: "h2" }> => block.kind === "h2")
    .map((block) => ({ id: slugifyHeading(block.text), text: plain(block.text) }));
  if (post.faq.length > 0) entries.push({ id: FAQ_ANCHOR, text: "Perguntas frequentes" });
  return entries;
}

function blockText(block: BlogBlock): string {
  switch (block.kind) {
    case "p":
    case "h2":
    case "h3":
      return plain(block.text);
    case "callout":
      return plain(block.text);
    case "ul":
    case "ol":
      return block.items.map(plain).join(" ");
    case "table":
      return [...block.head, ...block.rows.flat()].map(plain).join(" ");
    case "code":
      return "";
  }
}

/** Words a reader sees: answer, body and FAQ. Code blocks are not counted. */
export function wordCount(post: BlogPost): number {
  const text = [
    plain(post.answer),
    ...post.blocks.map(blockText),
    ...post.faq.map((item) => `${item.q} ${plain(item.a)}`),
  ].join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(post: BlogPost): number {
  return Math.max(1, Math.round(wordCount(post) / 200));
}

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "10 de novembro de 2026" from an ISO date, independent of the server time zone. */
export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(`${iso}T00:00:00Z`));
}

/** Markdown for llms-full.txt and any other plain-text consumer. */
export function postToMarkdown(post: BlogPost, url: string): string {
  const body = post.blocks.map((block): string => {
    switch (block.kind) {
      case "p":
        return block.text;
      case "h2":
        return `## ${block.text}`;
      case "h3":
        return `### ${block.text}`;
      case "callout":
        return `> ${block.text}`;
      case "ul":
        return block.items.map((item) => `- ${item}`).join("\n");
      case "ol":
        return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
      case "table": {
        const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
        return [row(block.head), row(block.head.map(() => "---")), ...block.rows.map(row)].join("\n");
      }
      case "code":
        return `\`\`\`${block.language}\n${block.code}\n\`\`\``;
    }
  });
  const faq = post.faq.map((item) => `### ${item.q}\n\n${item.a}`).join("\n\n");
  return [
    `# ${post.title}`,
    `> ${post.answer}`,
    ...body,
    ...(faq ? [`## Perguntas frequentes\n\n${faq}`] : []),
    `Fonte: ${url} · atualizado em ${post.updatedAt}`,
  ].join("\n\n");
}
