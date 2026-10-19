/**
 * OKF v0.2 patches: trust/stale facets (indexer), mapping frontmatter (curator),
 * deprecated badge + down-rank (formatter, store).
 */

import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { indexFile } from "../src/indexer";
import { DocumentStore } from "../src/store";
import { writeWikiEntry, CuratorError } from "../src/curator";
import { formatSearchResults } from "../src/search-formatter";

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "doctree-okf-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function indexDoc(dir: string, name: string, fm: string) {
  const p = join(dir, name);
  await writeFile(p, `---\n${fm}\n---\n# Title\n\nBody about widgets.\n`);
  return indexFile(p, dir, "t");
}

describe("indexer OKF facets", () => {
  test("generated → generated_by + trust, mapping string not leaked", async () => {
    await withDir(async (dir) => {
      const d = await indexDoc(dir, "a.md", "type: ADR\ngenerated: { by: claude-code/opus-5.5, at: 2026-10-19T12:00:00Z }");
      expect(d.meta.facets["generated_by"]).toEqual(["claude-code/opus-5.5"]);
      expect(d.meta.facets["trust"]).toEqual(["machine"]);
      expect(d.meta.facets["generated"]).toBeUndefined();
    });
  });

  test("human generator → trust human; no generated → unverified", async () => {
    await withDir(async (dir) => {
      const h = await indexDoc(dir, "h.md", "type: Guide\ngenerated: { by: human:voznik, at: 2026-10-19T12:00:00Z }");
      expect(h.meta.facets["trust"]).toEqual(["human"]);
      const u = await indexDoc(dir, "u.md", "type: Guide");
      expect(u.meta.facets["trust"]).toEqual(["unverified"]);
    });
  });

  test("stale_after in the past → stale true, future → false", async () => {
    await withDir(async (dir) => {
      const past = await indexDoc(dir, "p.md", "type: Guide\nstale_after: 2000-01-01");
      expect(past.meta.facets["stale"]).toEqual(["true"]);
      const future = await indexDoc(dir, "f.md", "type: Guide\nstale_after: 2999-01-01");
      expect(future.meta.facets["stale"]).toEqual(["false"]);
    });
  });
});

describe("curator mapping frontmatter", () => {
  test("writes generated mapping and list of mappings; rejects nested mapping", async () => {
    await withDir(async (dir) => {
      const store = new DocumentStore();
      const wiki = { root: dir, collection: "t", duplicateThreshold: 0.35 } as any;
      await writeWikiEntry(store, wiki, {
        path: "n.md",
        frontmatter: {
          type: "Guide",
          generated: { by: "claude-code/opus-5.5", at: "2026-10-19T12:00:00Z" },
          sources: [{ url: "https://example.com", note: "x" }],
        },
        content: "# N\n\nUnique content about zebras.\n",
      } as any);
      const text = await readFile(join(dir, "n.md"), "utf-8");
      expect(text).toContain("generated: { by: claude-code/opus-5.5, at: 2026-10-19T12:00:00Z }");
      expect(text).toContain("sources: [{ url: https://example.com, note: x }]");

      await expect(
        writeWikiEntry(store, wiki, {
          path: "bad.md",
          frontmatter: { generated: { a: { b: 1 } } },
          content: "# B\n\nOther.\n",
        } as any)
      ).rejects.toBeInstanceOf(CuratorError);
    });
  });
});

describe("deprecated handling", () => {
  test("badge shown and score halved vs identical live doc", async () => {
    await withDir(async (dir) => {
      const store = new DocumentStore();
      store.addDocument(await indexDoc(dir, "live.md", "type: ADR\nstatus: stable"));
      store.addDocument(await indexDoc(dir, "old.md", "type: ADR\nstatus: deprecated"));
      const results = store.searchDocuments("widgets");
      expect(results[0].doc_id).toContain("live");
      const old = results.find((r) => r.doc_id.includes("old"))!;
      expect(results[0].score).toBeCloseTo(old.score * 2, 5);
      const out = formatSearchResults(results, store as any, "widgets");
      expect(out).toContain("DEPRECATED");
    });
  });

  test("filter type=ADR status=deprecated returns only deprecated", async () => {
    await withDir(async (dir) => {
      const store = new DocumentStore();
      store.addDocument(await indexDoc(dir, "live.md", "type: ADR\nstatus: stable"));
      store.addDocument(await indexDoc(dir, "old.md", "type: ADR\nstatus: deprecated"));
      const r = store.searchDocuments("widgets", { filters: { type: "ADR", status: "deprecated" } });
      expect(r.map((x) => x.doc_id).every((id) => id.includes("old"))).toBe(true);
      expect(r.length).toBeGreaterThan(0);
    });
  });
});
