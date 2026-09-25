/**
 * Search result formatter for agent consumption.
 *
 * Three improvements over raw result output:
 * 1. Facet badges on each result
 * 2. Auto-inlines full subtree content for top N results (default 3, env-capped)
 * 3. Appends resolved cross-references after each inlined block
 */

import type { SearchResult, TreeNode, DocumentMeta } from "./types.js";

export interface SubtreeProvider {
  getSubtree(
    doc_id: string,
    node_id: string
  ): {
    nodes: Pick<TreeNode, "node_id" | "title" | "level" | "content">[];
  } | null;
  resolveRef(path: string): { doc_id: string; node_id?: string } | null;
  getDocMeta(doc_id: string): DocumentMeta | null;
}

export function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * Token-budget guard shared by search inlining, get_node_content and navigate_tree.
 * Over the cap: several nodes → outline with sizes (agent fetches the one it needs);
 * one node → head of its text plus a truncation marker.
 */
export function capOutput(
  nodes: Pick<TreeNode, "node_id" | "title" | "level" | "content">[],
  full: string,
  maxChars: number
): string {
  if (full.length <= maxChars) return full;
  if (nodes.length > 1) {
    const base = nodes[0].level;
    const outline = nodes
      .map((n) => `${"  ".repeat(Math.max(0, n.level - base))}[${n.node_id}] ${"#".repeat(n.level)} ${n.title} (${(n.content ?? "").length} chars)`)
      .join("\n")
      .slice(0, maxChars);
    return `(${full.length} chars, over the ${maxChars}-char cap — outline only; fetch one node with get_node_content)\n${outline}`;
  }
  return `${full.slice(0, maxChars)}\n…[truncated: ${maxChars} of ${full.length} chars]`;
}

export const maxOutputChars = () => envInt("DOCTREE_MAX_OUTPUT_CHARS", Infinity);

export function formatSearchResults(
  results: SearchResult[],
  store: SubtreeProvider,
  query: string
): string {
  if (results.length === 0) {
    return `No results found for "${query}". Try broader terms or use list_documents to browse the catalog.`;
  }

  // 1. Ranked snippet list
  const summary = results
    .map((r, i) => {
      const badge = buildFacetBadge(r.facets);
      return `${i + 1}. [${r.doc_id}] ${r.doc_title}\n   Section: ${r.node_title} (${r.node_id})\n   Score: ${r.score.toFixed(1)}${badge}\n   Snippet: ${r.snippet}`;
    })
    .join("\n\n");

  // 2. Full content blocks for top N (DOCTREE_INLINE_TOP_N, capped by DOCTREE_INLINE_MAX_CHARS)
  const inlineTopN = envInt("DOCTREE_INLINE_TOP_N", 3);
  const inlineMaxChars = envInt("DOCTREE_INLINE_MAX_CHARS", Infinity);
  const contentBlocks = results
    .slice(0, inlineTopN)
    .map((r) => {
      const subtree = store.getSubtree(r.doc_id, r.node_id);
      if (!subtree || subtree.nodes.length === 0) return null;

      const root = subtree.nodes[0];
      const formatted = subtree.nodes
        .map((n) => {
          const indent = "  ".repeat(Math.max(0, n.level - root.level));
          return `${indent}${"#".repeat(n.level)} ${n.title} [${n.node_id}]\n${indent}${n.content || "(empty)"}`;
        })
        .join("\n\n");

      const subsectionCount = subtree.nodes.length - 1;
      const label =
        subsectionCount > 0
          ? `${r.node_title} + ${subsectionCount} subsection(s)`
          : r.node_title;

      const meta = store.getDocMeta(r.doc_id);
      const refLine = buildRefLine(meta?.references ?? [], store);

      return `=== [${r.doc_id}] ${label} ===\n\n${capOutput(subtree.nodes, formatted, inlineMaxChars)}${refLine}`;
    })
    .filter((b): b is string => b !== null);

  const parts = [
    `Search results for "${query}" (${results.length} matches):\n\n${summary}`,
  ];

  if (contentBlocks.length > 0) {
    const n = Math.min(results.length, inlineTopN);
    parts.push(
      `\n--- Full content (top ${n} match${n === 1 ? "" : "es"}) ---\n\n${contentBlocks.join("\n\n")}`
    );
  }

  return parts.join("\n");
}

function buildFacetBadge(facets: Record<string, string[]>): string {
  const parts: string[] = [];
  const langs = facets["code_languages"];
  if (langs?.length) parts.push(`code: ${langs.join(", ")}`);
  else if (facets["has_code"]?.[0] === "true") parts.push("has_code");
  if (facets["has_links"]?.[0] === "true") parts.push("has_links");
  return parts.length ? ` | ${parts.join(" | ")}` : "";
}

function buildRefLine(
  references: string[],
  store: SubtreeProvider
): string {
  if (!references.length) return "";

  const resolved = references
    .map((ref) => {
      const r = store.resolveRef(ref);
      if (!r) return null;
      return r.node_id ? `[${r.doc_id}] (${r.node_id})` : `[${r.doc_id}]`;
    })
    .filter((r): r is string => r !== null);

  if (!resolved.length) return "";
  return `\n\n→ References: ${resolved.join(", ")}`;
}
