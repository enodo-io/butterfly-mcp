# butterfly-mcp

Model Context Protocol server that exposes a Butterfly headless CMS instance to LLM agents. All tools talk to the Butterfly API — the public surface of the CMS — over HTTPS, authenticated with the property's **Private Key**.

## Configuration

Three env vars:

| Var | Required | Meaning |
| --- | --- | --- |
| `PUBLIC_API_URL` | yes | Base URL of the property's Butterfly API — either `https://<propertyId>.pubbtf.eno.do` or a custom API domain. |
| `PRIVATE_API_KEY` | yes | The property's **Private Key**. Full admin (create/edit/delete, read unpublished, admin-only endpoints). Keep it server-side. |
| `PUBLIC_API_KEY` | no | The property's **Public Key**. Read-only, published content only. When set, read tools default to it so responses go through the edge cache. When unset, reads fall back to the Private Key — still works, just no cache. |

Both keys come from the Settings page of the Butterfly app.

## Running standalone

```bash
npm install
PUBLIC_API_URL=https://1234.pubbtf.eno.do \
PRIVATE_API_KEY=<32 char hex> \
node src/index.js
```

The server uses the stdio MCP transport and just waits for a client to connect — normal.

## Team setup (recommended)

Goal: each web project has its own `.mcp.json` that everyone on the team can share without hard-coding your local path to the repo.

### Once per machine

Clone this repo and register the binary globally:

```bash
git clone git@github.com:enodo-io/butterfly-mcp.git
cd butterfly-mcp
npm install
npm link
```

`npm link` uses the `bin` declaration in `package.json` to create a `butterfly-mcp` executable in your npm global prefix — wherever you cloned the repo, the command is now in your `$PATH`.

Verify:

```bash
which butterfly-mcp
butterfly-mcp --help  # should just run (no help output — MCP server waits on stdio)
```

### Once per project (committed to git)

The MCP reads its three env vars from `process.env`. There are two supported ways to set them, pick whichever fits the project:

**A. Project `.env` (simplest, recommended when the project already has one)**

Add `.mcp.json` at the root of each project that consumes the MCP:

```json
{
  "mcpServers": {
    "butterfly": {
      "command": "butterfly-mcp"
    }
  }
}
```

And a local, untracked `.env` next to it (add `.env` to `.gitignore`):

```
PUBLIC_API_URL=https://1234.pubbtf.eno.do
PUBLIC_API_KEY=<the property's Public Key>     # optional
PRIVATE_API_KEY=<the property's Private Key>
```

The MCP process loads that `.env` itself (via `dotenv` + `dotenv-expand`) on startup. `.mcp.json` stays identical across teammates; each keeps their credentials in their own `.env`. If your project already exports these values under different names (e.g. `VITE_PUBLIC_API_URL`), add a three-line alias at the bottom of the `.env` so the MCP sees the names it expects:

```
PUBLIC_API_URL=${VITE_PUBLIC_API_URL}
PUBLIC_API_KEY=${VITE_PUBLIC_API_KEY}
# PRIVATE_API_KEY already matches; no alias needed.
```

**B. Inline in `.mcp.json` (for projects without a `.env`, or when running several butterfly servers side-by-side)**

Every MCP client passes the `env:` block on an entry into the subprocess's environment before it starts, so you can skip the `.env` file entirely:

```json
{
  "mcpServers": {
    "butterfly": {
      "command": "butterfly-mcp",
      "env": {
        "PUBLIC_API_URL": "https://1234.pubbtf.eno.do",
        "PUBLIC_API_KEY": "<public key>",
        "PRIVATE_API_KEY": "<private key>"
      }
    }
  }
}
```

This is also how you point several butterfly instances at distinct properties from a single `.mcp.json` — each entry gets its own env:

```json
{
  "mcpServers": {
    "butterfly-prod": {
      "command": "butterfly-mcp",
      "env": {
        "PUBLIC_API_URL": "https://prod.pubbtf.eno.do",
        "PRIVATE_API_KEY": "<prod key>"
      }
    },
    "butterfly-staging": {
      "command": "butterfly-mcp",
      "env": {
        "PUBLIC_API_URL": "https://staging.pubbtf.eno.do",
        "PRIVATE_API_KEY": "<staging key>"
      }
    }
  }
}
```

Mind the security: `.mcp.json` is typically committed, so don't put secrets in it directly — prefer option A for anything that can't go in git. When you must, use the client's `${VAR}` expansion feature (reading from your shell env) rather than hard-coding values.

> MCP clients launch the subprocess with the project root as its cwd, so the `.env` is loaded from where you expect. If you want to pin a specific path, set `DOTENV_CONFIG_PATH=/absolute/path/.env` in the MCP entry's `env`.

### Per-client cheatsheet

Same `.mcp.json` shape, different file path depending on the editor:

| Client | File |
| --- | --- |
| Claude Code | `<project>/.mcp.json` |
| Cursor | `<project>/.cursor/mcp.json` |
| VS Code / Copilot Chat | `<project>/.vscode/mcp.json` |
| Claude Desktop | global only: `~/Library/Application Support/Claude/claude_desktop_config.json` |

For Claude Desktop, register distinct entries per property (`butterfly-site1`, `butterfly-site2`, …) rather than one shared config — Desktop has no per-project scope.

## Tools

### Reads (shape follows the Butterfly API GET endpoints)
- `list_posts` — filter by status / category / author / type / flag / search query.
- `get_post` — full post incl. body. Admin key returns unpublished posts.
- `list_medias` — filter by type / search.
- `list_categories`, `list_authors`, `list_taxonomies`, `list_terms`.
- `list_types`, `list_flags`, `list_feeds`, `list_custom_settings` (admin only).

### Content writes
- `create_post` — optional `body` is a butterfly block array; converted to the semantic editor shape server-side so a human can continue in the semantic editor.
- `update_post` — change any field; if `body` changes a new fs revision is created.
- `delete_post`.
- `upload_media` — accepts `source_url`, `source_path`, or `source_base64`. Butterfly API streams to fs on the property owner's behalf.
- `update_media`, `delete_media`.

### Structural writes
- `create_category` / `update_category` / `delete_category` (ids are numeric `propertycategoryId`).
- `create_author` / `update_author` / `delete_author` (keyed on slug).
- `create_taxonomy` / `update_taxonomy` / `delete_taxonomy` (slug).
- `create_term` / `update_term` / `delete_term` (slug within taxonomy).
- `create_type` / `update_type` / `delete_type` — admin only.
- `create_flag` / `update_flag` / `delete_flag` — admin only.
- `create_feed` / `update_feed` / `delete_feed` (slug). Elements use `{ type: 'post'|'category'|'term<taxonomySlug>', id }`.
- `create_custom_setting` / `update_custom_setting` / `delete_custom_setting` (key).

## Notes

- The server uses the MCP stdio transport; bind it via any MCP-compatible client.
- Read-only responses return the JSON:API payload; write responses return the re-read resource. Errors surface as `isError: true` with the upstream status + detail.
- Pagination uses `page[size]` / `page[number]` and the same `page[before]` / `page[after]` cursors the Butterfly API exposes.
- The server is stateless — no caching, no local DB. Scale horizontally if you need more throughput.
