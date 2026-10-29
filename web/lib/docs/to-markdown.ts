import type { DocBlock, DocSection } from "./types";

const fence = (language: string, code: string) => `\`\`\`${language}\n${code}\n\`\`\``;
const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");

function table(head: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map(cell).join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}

function block(item: DocBlock): string {
  switch (item.kind) {
    case "text":
      return item.body;
    case "list":
      return item.items.map((entry) => `- ${entry}`).join("\n");
    case "table":
      return table(item.head, item.rows);
    case "callout":
      return `> ${item.body}`;
    case "municipalities":
      return item.labels.markdown;
    case "heading":
      return `${"#".repeat(item.level + 1)} ${item.body}`;
    case "code":
      return fence(item.language, item.code);
    case "endpoint": {
      const parts = [
        `### ${item.method} ${item.path}`,
        `Scopes: ${item.scopes.join(", ")}. Success: ${item.success}.`,
        item.summary,
      ];
      if (item.params)
        parts.push(
          table(
            ["Name", "Type", "Required", "Description"],
            item.params.rows.map((row) => [row.name, row.type, row.required ? "yes" : "no", row.description]),
          ),
        );
      parts.push(fence("bash", item.examples.curl));
      if (item.response.json) parts.push(`Response ${item.response.label}:\n\n${fence("json", item.response.json)}`);
      for (const note of item.notes ?? []) parts.push(`> ${note.body}`);
      return parts.join("\n\n");
    }
  }
}

/** Renders a documentation section as Markdown. */
export function sectionToMarkdown(section: DocSection, level = 1): string {
  const parts = [`${"#".repeat(level)} ${section.title}`];
  if (section.description) parts.push(section.description);
  for (const item of section.blocks) parts.push(block(item));
  return parts.join("\n\n");
}
