import GithubSlugger from "github-slugger";
import rehypeSanitize, { type Options as SanitizeSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

export interface TocItem {
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  id: string;
  text: string;
}

export interface TocNode extends TocItem {
  children: TocNode[];
}

export interface RenderedMarkdown {
  html: string;
  toc: readonly TocItem[];
}

interface SyntaxNode {
  type: string;
  value?: string;
  depth?: number;
  tagName?: string;
  children?: SyntaxNode[];
  data?: { hProperties?: Record<string, unknown> };
  properties?: Record<string, unknown>;
}

const sanitizeSchema: SanitizeSchema = {
  tagNames: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul"
  ],
  attributes: {
    a: ["href", "rel"],
    code: [["className", /^language-[A-Za-z0-9_-]+$/]],
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
    h4: ["id"],
    h5: ["id"],
    h6: ["id"],
    td: ["align"],
    th: ["align"]
  },
  protocols: {
    href: ["http", "https"]
  },
  clobberPrefix: ""
};

function textContent(node: SyntaxNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  return (node.children ?? []).map(textContent).join("");
}

function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function headingIds(toc: TocItem[]) {
  return () => (tree: SyntaxNode) => {
    const slugger = new GithubSlugger();
    walk(tree, (node) => {
      if (node.type !== "heading" || !node.depth) return;
      const text = textContent(node).trim();
      const id = slugger.slug(text || "section");
      node.data = node.data ?? {};
      node.data.hProperties = { ...(node.data.hProperties ?? {}), id };
      if (node.depth >= 1 && node.depth <= 6) {
        toc.push({ depth: node.depth as TocItem["depth"], id, text });
      }
    });
  };
}

function externalLinkRelations() {
  return (tree: SyntaxNode) => {
    walk(tree, (node) => {
      if (node.type !== "element" || node.tagName !== "a") return;
      const href = node.properties?.href;
      if (typeof href === "string" && /^https?:\/\//i.test(href)) {
        node.properties = { ...(node.properties ?? {}), rel: ["noopener", "noreferrer"] };
      }
    });
  };
}

export async function renderSafeMarkdown(
  source: Uint8Array | string
): Promise<RenderedMarkdown> {
  const toc: TocItem[] = [];
  const markdown = typeof source === "string" ? source : Buffer.from(source).toString("utf8");
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(headingIds(toc))
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSanitize, sanitizeSchema)
    .use(externalLinkRelations)
    .use(rehypeStringify)
    .process(markdown);
  return { html: String(result), toc };
}
