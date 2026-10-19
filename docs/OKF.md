# OKF (Open Knowledge Format) support

doctree-mcp indexes any markdown tree, and a tree that follows [OKF v0.2](./reports/okf-open-knowledge-format.md)
(markdown + YAML frontmatter, `type`/`description`/`generated`/`status`) gets extra search
signals. Nothing changes for docs without OKF keys.

**Why:** the homelab repo adopted OKF for its 246 own docs (ADR-047) so that agents, `rumdl`/`okf-schema`
lint and doctree all read one frontmatter convention. This fork carries the doctree side.

## What doctree does with OKF keys

| Frontmatter | Effect |
| --- | --- |
| `type`, `status`, `decision`, any scalar | filter facets, as before: `filters: { type: "ADR", status: "deprecated" }` |
| `generated: { by, at }` | `generated_by` facet; `trust` facet: `human` (`by` starts with `human:`, or `verified` present), `machine`, or `unverified` (has `type`, no `generated`) |
| `stale_after: <date>` | `stale` facet: `true` once the date has passed, else `false` |
| `status: deprecated` | search score ×0.5, and a `DEPRECATED` badge on the result |
| `stale: true`, `trust: machine\|unverified` | `stale` / `trust: …` badge on the result |

Limitation: the frontmatter reader is line-based, so `generated` is read as a one-line flow
mapping (`generated: { by: x, at: y }`). Nested YAML and block mappings are not parsed.

## Writing OKF frontmatter

`write_wiki_entry` accepts one-level mappings and lists of mappings, written as flow style:

```json
{ "type": "Guide", "generated": { "by": "claude-code/opus-5.5", "at": "2026-10-19T12:00:00Z" } }
```

Nested mappings are rejected (`FRONTMATTER_INVALID`).

Tests: `tests/okf.test.ts`.
