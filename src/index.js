#!/usr/bin/env node
import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { get, post, patch, del, uploadMedia } from "./client.js";
import {
  BLOCK_CATALOG,
  INLINE_NODES,
  BODY_SHAPE_SUMMARY,
} from "./blockCatalog.js";
import { bodySchema } from "./bodySchema.js";
import { markdownToButterfly } from "./markdownToButterfly.js";

// Load .env from the subprocess cwd (= the project root when launched by a
// MCP client) and expand ${VAR} references against the same env. This lets
// projects that already export PUBLIC_API_URL under another name — say
// VITE_PUBLIC_API_URL — alias it in three lines instead of duplicating
// secret values:
//   PUBLIC_API_URL=${VITE_PUBLIC_API_URL}
//   PUBLIC_API_KEY=${VITE_PUBLIC_API_KEY}
//   PRIVATE_API_KEY=${INTERNAL_PRIVATE_KEY}
dotenvExpand.expand(dotenv.config());

// Shared zod fragments. All ids that travel over the public API are
// either numeric (posts, categories, medias) or slugs (authors, taxonomies,
// terms, types, flags, feeds, custom keys). Relationship id shapes follow
// the GET payload conventions one-to-one so POST payloads can round-trip.

const idOrSlug = z.union([z.string(), z.number()]);

const relationshipRef = z
  .object({
    type: z.string(),
    id: idOrSlug,
  })
  .nullable();

const relationshipOne = z.object({ data: relationshipRef });
const relationshipMany = z.object({ data: z.array(relationshipRef.unwrap()) });

const jsonApiData = (attributes) => ({
  data: z.object({
    attributes: attributes.optional(),
    relationships: z.record(z.any()).optional(),
    meta: z.record(z.any()).optional(),
  }),
});

function wrap(promise) {
  return promise.then(
    (data) => ({
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    }),
    (err) => ({
      isError: true,
      content: [
        { type: "text", text: `${err.status || "error"}: ${err.message}` },
      ],
    }),
  );
}

const server = new McpServer(
  { name: "butterfly-mcp", version: "0.1.0" },
  {
    instructions: `
This MCP lets you read and write content in a **Butterfly** headless CMS property.

Data model (important before you create or edit a post):

- A **post** belongs to exactly one **type** (required). Types are defined per
  property and represent the kind of content — e.g. "article", "page",
  "video", "recipe". List them with \`list_types\`. Create a new one with
  \`create_type\` if the right one doesn't exist.

- A **post** belongs to at most one **category** (optional). Categories form
  a tree (each category may have a parentCategory). Use categories as the
  post's *primary classification / section* — usually one per post. List
  them with \`list_categories\`.

- A **post** can have many **flags** (0..N). Flags are short editorial
  badges: "news", "sponso", "live", "breaking". List with \`list_flags\`.

- A **post** can have many **terms** (0..N) across many **taxonomies**.
  Taxonomies are additional classification axes that complement categories.
  Examples: a "tags" taxonomy for free-form keywords, a "countries"
  taxonomy for geography, a "skills" taxonomy for a cooking site. List
  taxonomies with \`list_taxonomies\`; list terms inside one with
  \`list_terms\`. When attaching terms to a post, group them by taxonomy
  via \`terms: { tags: ["ai", "tech"], countries: ["fr"] }\`.

- A **post** can have many **authors** (0..N). Authors are keyed on their
  slug (generated from name). List with \`list_authors\`.

- A **post** has a **thumbnail** (one optional media) and can embed medias
  directly in its **body**. Upload new medias first with \`upload_media\`
  (accepts a URL, a local path, or base64), then reference the returned
  \`id\` in the post's \`thumbnail_media_id\` or inside body blocks.

Post body:

${BODY_SHAPE_SUMMARY}

Semantic editor helpers (optional, stored on the fs document — not
on the butterfly post row):

- \`keyphrase\`  string — primary SEO phrase the editor's readability /
                         SEO algorithm scores the article against.
- \`keywords\`   array of strings — supporting terms.
- \`questions\`  array of strings — FAQ-style questions the article is
                 expected to answer.
- \`brief\`      string — briefing / writer recommendations shown in
                 the semantic editor above the article. "" clears it.
- \`numbers\`    object — target counts the editor grades against:
                 { words, titles, paragraphs, internalLinks,
                   externalLinks, images }. Defaults to
                 { 600, 3, 6, 1, 2, 2 } when unset.

Set any of these on create_post / update_post to help the editor and
any downstream humans editing the post. They coexist with — and are
kept in sync separately from — the butterfly attrs (canonical,
hreflangs, featured image).

Erasing fields:

- canonical, hreflangs, featured (thumbnail_media_id) accept null
  to clear an existing value.
- brief accepts "" to clear.

Statuses:

- Posts have a status (lowercased in responses): \`draft\`, \`published\`,
  \`planned\`, \`awaiting_approval\`, \`approved\`, \`deleted\`. Only
  \`published\` is visible without an admin key. To publish, send
  \`status: "published"\` on create or update.

Ids at a glance:

- post, category, media → numeric id (\`propertypostId\`, \`propertycategoryId\`, \`propertymediaId\`).
- author, taxonomy, term, type, flag, feed → slug.
- custom setting → key.

Discover the property's current state in one call with \`get_property_context\` —
it returns the available types, flags, taxonomies (with their terms), and top
categories so you can pick valid values before writing. For the property
itself (title / description / locale / hostname / permalink template),
use \`get_property\` and \`update_property\`.

Custom fields:

- Any resource can carry free-form key/value pairs under
  \`attributes.custom\`. Each value is constrained by a "custom
  setting" definition registered on the property. Run
  \`list_custom_settings\` to see the defined keys and their expected
  types (string / multiline / dropdown / multiplechoice / color /
  date), grouped by \`target\`. Targets: \`general\` (property-wide,
  set via \`update_property\`), \`post\`, \`term\`, \`category\`,
  \`author\`, \`media\`. The server validates every value you send
  against its definition — unknown keys or wrong-typed values are
  rejected.
- Create / update tools for posts / terms / categories / authors /
  medias / property all accept a \`custom\` object. Keys you have
  not defined via \`create_custom_setting\` will fail validation.
`.trim(),
  },
);

// ── Context ─────────────────────────────────────────────────────────────

server.tool(
  "get_property",
  "Read the current Butterfly property — its title, description, locale, timezone, hostname, permalink template and custom field values. Use this to see what is editable before calling update_property, and to inspect the current permalink (URL shape of posts on the live site).",
  {},
  () => wrap(get("/v1")),
);

server.tool(
  "update_property",
  "Update the current Butterfly property. Every field is optional — send only the ones you want to change. The property title / description / locale / timezone drive SEO metadata on the live site; hostname is the base URL; permalink is the URL template applied to every post.",
  {
    title: z
      .string()
      .optional()
      .describe("Site title shown on the homepage and in <title>."),
    description: z
      .string()
      .optional()
      .describe("Site description used in meta tags."),
    locale: z
      .string()
      .optional()
      .describe(
        'BCP-47 locale, e.g. "fr-FR", "en-US". Affects the semantic editor\'s language-specific scoring and default SEO hints.',
      ),
    timezone: z
      .string()
      .optional()
      .describe(
        'IANA timezone, e.g. "Europe/Paris". Used for publishedAt / sortedDate displays.',
      ),
    hostname: z
      .string()
      .optional()
      .describe(
        'Root URL of the live site, e.g. "https://www.example.com". Must start with http:// or https://.',
      ),
    permalink: z
      .string()
      .optional()
      .describe(
        'URL template applied to each post to form its public URL. Placeholders: {id} (post id), {slug} (post slug), {main-category} (first segment of the post\'s category path), {categories-path} (full category path), {type} (post type slug). At least {id} is required for uniqueness. Example: "{main-category}/{slug}-{id}.html".',
      ),
    custom: z
      .record(z.any())
      .optional()
      .describe(
        "Values for property-wide custom fields (target=general in /custom). Run list_custom_settings to see which keys are defined and their expected types.",
      ),
  },
  (input) => {
    const attributes = {};
    for (const k of [
      "title",
      "description",
      "locale",
      "timezone",
      "hostname",
      "permalink",
      "custom",
    ]) {
      if (input[k] !== undefined) attributes[k] = input[k];
    }
    return wrap(patch("/v1", { data: { attributes } }));
  },
);

server.tool(
  "get_property_context",
  "Snapshot of the property's taxonomy of content: available types, flags, taxonomies (with their terms), and top categories. Call this first so you can pick valid values before creating or updating a post.",
  {},
  async () => {
    const [types, flags, taxonomies, categories] = await Promise.all([
      get("/v1/types").catch(() => ({ data: [] })),
      get("/v1/flags").catch(() => ({ data: [] })),
      get("/v1/taxonomies").catch(() => ({ data: [] })),
      get("/v1/categories", { "page[size]": 100 }).catch(() => ({ data: [] })),
    ]);

    const taxList = taxonomies?.data || [];
    const termsByTax = await Promise.all(
      taxList.map((t) =>
        get(`/v1/taxonomies/${t.id}/relationships/terms`, { "page[size]": 100 })
          .then((res) => ({
            taxonomy: t.id,
            terms: (res.data || []).map((term) => term.id),
          }))
          .catch(() => ({ taxonomy: t.id, terms: [] })),
      ),
    );

    const snapshot = {
      types: (types.data || []).map((t) => ({
        slug: t.id,
        name: t.attributes?.name,
        description: t.attributes?.description,
        butterflyType: t.attributes?.butterflyType,
      })),
      flags: (flags.data || []).map((f) => ({
        slug: f.id,
        name: f.attributes?.name,
        description: f.attributes?.description,
      })),
      taxonomies: taxList.map((t) => ({
        slug: t.id,
        terms: termsByTax.find((x) => x.taxonomy === t.id)?.terms || [],
      })),
      categories: (categories.data || []).map((c) => ({
        id: c.id,
        name: c.attributes?.name,
        slug: c.attributes?.slug,
        path: c.attributes?.path,
      })),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
    };
  },
);

server.tool(
  "list_block_types",
  "Return the full butterfly post body grammar: every block type, its exact JSON shape, a concrete example, plus the inline-node sub-grammar. Call this whenever you are about to craft or review a body — block shapes differ subtly (e.g. quote flattens source into data, related unwraps to {type,id} pairs, images only carry mediaId + editorial fields).",
  {},
  () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { blocks: BLOCK_CATALOG, inlineNodes: INLINE_NODES },
          null,
          2,
        ),
      },
    ],
  }),
);

server.tool(
  "markdown_to_butterfly_body",
  "Convert a markdown string into a butterfly post body array, ready to pass to create_post / update_post. Handles paragraphs, headings (h2-h6), lists, code fences, blockquotes, horizontal rules, inline formatting (bold/italic/strike/code/links) and line breaks. Markdown images become image blocks with the markdown alt/title and, if image_media_ids matches, a mediaId; otherwise mediaId is left unset and _sourceUrl carries the original URL for a follow-up upload. Tables are kept as raw markdown blocks — promote them via list_block_types if you need structured tables.",
  {
    markdown: z.string().describe("The markdown source text."),
    image_media_ids: z
      .record(z.number().int())
      .optional()
      .describe(
        "Optional map { altText | url: propertymediaId } used to resolve markdown images to existing medias.",
      ),
  },
  ({ markdown, image_media_ids }) => {
    try {
      const body = markdownToButterfly(markdown, {
        imageMediaIds: image_media_ids || {},
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ body }, null, 2) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `conversion failed: ${err.message}` }],
      };
    }
  },
);

// ── Reads ───────────────────────────────────────────────────────────────

server.tool(
  "list_posts",
  "List posts. By default returns published content only, going through the edge cache. Set include_drafts: true (or ask for a non-published status) to see drafts / awaiting-approval / planned / deleted posts — that path uses the admin key and skips the cache.",
  {
    page_size: z.number().int().min(1).max(100).optional(),
    page_number: z.number().int().min(1).optional(),
    search: z.string().optional(),
    status: z
      .enum([
        "draft",
        "published",
        "planned",
        "deleted",
        "awaiting_approval",
        "approved",
      ])
      .optional(),
    category: z.string().optional(),
    author: z.string().optional(),
    type: z.string().optional(),
    flag: z.string().optional(),
    include_drafts: z
      .boolean()
      .optional()
      .describe(
        "Use the admin key to return posts regardless of status and attach the `status` attribute. Defaults to false (published only, cacheable).",
      ),
  },
  (input) => {
    const params = {};
    if (input.page_size) params["page[size]"] = input.page_size;
    if (input.page_number) params["page[number]"] = input.page_number;
    if (input.search) params["filter[query]"] = input.search;
    if (input.status) params["filter[status]"] = input.status;
    if (input.category) params["filter[categories]"] = input.category;
    if (input.author) params["filter[authors]"] = input.author;
    if (input.type) params["filter[types]"] = input.type;
    if (input.flag) params["filter[flags]"] = input.flag;
    const needsAdmin =
      input.include_drafts === true ||
      (input.status && input.status !== "published");
    return wrap(
      get("/v1/posts", params, { scope: needsAdmin ? "admin" : "public" }),
    );
  },
);

server.tool(
  "get_post",
  "Fetch a post by id (including its body). By default published-only via the public key. Set include_drafts: true to fetch any post (admin, cache-bypass).",
  {
    post_id: z.number().int(),
    include_drafts: z
      .boolean()
      .optional()
      .describe("Use the admin key to allow fetching unpublished posts."),
  },
  ({ post_id, include_drafts }) =>
    wrap(
      get(
        `/v1/posts/${post_id}`,
        {},
        { scope: include_drafts ? "admin" : "public" },
      ),
    ),
);

server.tool(
  "list_medias",
  "List medias. By default only those attached to a published post (cacheable). Set include_orphans: true to include medias not attached to any published post (admin, cache-bypass).",
  {
    page_size: z.number().int().min(1).max(100).optional(),
    page_number: z.number().int().min(1).optional(),
    search: z.string().optional(),
    type: z.enum(["image", "video", "audio"]).optional(),
  },
  (input) => {
    const params = {};
    if (input.page_size) params["page[size]"] = input.page_size;
    if (input.page_number) params["page[number]"] = input.page_number;
    if (input.search) params["filter[query]"] = input.search;
    if (input.type) params["filter[types]"] = input.type;
    return wrap(get("/v1/medias", params));
  },
);

server.tool(
  "list_categories",
  "List categories. Admin key includes categories with no attached posts.",
  { search: z.string().optional() },
  ({ search }) =>
    wrap(
      get("/v1/categories", search ? { "filter[query]": search } : {}, {
        scope: "admin",
      }),
    ),
);

server.tool(
  "list_authors",
  "List authors. Admin key includes authors with no attached posts.",
  {},
  () => wrap(get("/v1/authors")),
);

server.tool("list_taxonomies", "List taxonomies.", {}, () =>
  wrap(get("/v1/taxonomies")),
);

server.tool(
  "list_terms",
  "List terms in a taxonomy.",
  { taxonomy: z.string() },
  ({ taxonomy }) => wrap(get(`/v1/taxonomies/${taxonomy}/relationships/terms`)),
);

server.tool("list_types", "List content types (admin only).", {}, () =>
  wrap(get("/v1/types", {}, { scope: "admin" })),
);
server.tool("list_flags", "List flags (admin only).", {}, () =>
  wrap(get("/v1/flags", {}, { scope: "admin" })),
);
server.tool(
  "list_feeds",
  "List feeds. Admin key returns actual feeds.",
  {},
  () => wrap(get("/v1/feeds", {}, { scope: "admin" })),
);
server.tool(
  "list_custom_settings",
  "List custom settings definitions (admin only).",
  {},
  () => wrap(get("/v1/custom", {}, { scope: "admin" })),
);

// ── Writes — posts ──────────────────────────────────────────────────────

server.tool(
  "create_post",
  "Create a post. type is required (one per post). category is optional (zero or one). flags/authors/terms are all many-to-many. body is an optional butterfly block array — when provided the semantic editor document is seeded with it so humans can keep editing.",
  {
    title: z
      .string()
      .describe(
        "Post title. Required. The slug is generated from it and immutable.",
      ),
    resume: z
      .string()
      .optional()
      .describe("Short teaser / lede shown in listings."),
    type: z
      .string()
      .describe(
        'Content type — the post\'s *kind* (e.g. "article", "page"). Exactly one per post, required. Must match a type slug from list_types / get_property_context.',
      ),
    body: bodySchema
      .optional()
      .describe(
        "Ordered array of butterfly blocks. Block types include paragraph, heading, image, video, audio, gallery, quote, faq, related. Leave empty to create a blank draft a human will fill in via the semantic editor. Validated strictly against the butterfly grammar — call list_block_types if you need the exact shape for any block or inline node.",
      ),
    status: z
      .enum(["draft", "published", "planned", "awaiting_approval", "approved"])
      .optional()
      .describe(
        'Defaults to draft. "published" publishes immediately (publishedAt = now if omitted). "planned" schedules publication at published_at (must be in the future).',
      ),
    published_at: z
      .string()
      .datetime()
      .optional()
      .describe(
        "Publication timestamp (ISO 8601, UTC). Only meaningful for status=published or status=planned. Use a future value to schedule a `planned` post. Drives sortedDate / updatedAt on the post row and the public publish date shown to readers.",
      ),
    due_at: z
      .string()
      .datetime()
      .optional()
      .describe(
        "Internal delivery deadline (ISO 8601, UTC) for non-published statuses (draft / awaiting_approval / approved). Used by editorial listings; never shown publicly. Ignored for published/planned — those use published_at.",
      ),
    category: idOrSlug
      .optional()
      .describe(
        "Primary classification (a category id — numeric propertycategoryId). At most one category per post. Categories form a tree; pick the most specific one.",
      ),
    authors: z
      .array(z.string())
      .optional()
      .describe("Author slugs. Zero or many — co-authorship is fine."),
    flags: z
      .array(z.string())
      .optional()
      .describe(
        "Flag slugs (editorial badges: news, sponso, live, breaking, …). Zero or many per post.",
      ),
    terms: z
      .record(z.array(z.string()))
      .optional()
      .describe(
        "Taxonomy-scoped terms as { taxonomySlug: [termSlug, ...] }. Taxonomies are additional classification axes that complement the single category (e.g. tags, countries). Many terms per post, many taxonomies.",
      ),
    thumbnail_media_id: z
      .number()
      .int()
      .optional()
      .describe(
        "propertymediaId of the featured image. Upload via upload_media first.",
      ),
    canonical: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Canonical URL override. Use when the post is a republication of an external source.",
      ),
    hreflangs: z
      .record(z.string())
      .optional()
      .describe("Map of locale → URL for translations of this post."),
    custom: z
      .record(z.any())
      .optional()
      .describe(
        "Free-form key/value pairs constrained by the property's /custom definitions for target=post. Run list_custom_settings to see allowed keys.",
      ),
    private: z
      .boolean()
      .optional()
      .describe(
        "Members-only — requires the property's JWT plugin to be configured. Default false.",
      ),
    keyphrase: z
      .string()
      .optional()
      .describe(
        "Primary SEO phrase. Stored on the semantic editor's document so its readability/SEO algorithm scores against it. Not stored on the butterfly post row — only visible in the editor and in the fs document body.",
      ),
    keywords: z
      .array(z.string())
      .optional()
      .describe(
        "Supporting SEO keywords. Same storage as keyphrase (semantic document only).",
      ),
    questions: z
      .array(z.string())
      .optional()
      .describe(
        "FAQ-style questions the article is expected to answer. Fed to the semantic editor's algorithm alongside keyphrase/keywords. Semantic document only.",
      ),
    brief: z
      .string()
      .optional()
      .describe(
        "Briefing / recommendations for the writer. Shown in the semantic editor alongside the article. Can be an empty string to clear a previous brief. Semantic document only.",
      ),
    numbers: z
      .object({
        words: z.number().int().optional(),
        titles: z.number().int().optional(),
        paragraphs: z.number().int().optional(),
        internalLinks: z.number().int().optional(),
        externalLinks: z.number().int().optional(),
        images: z.number().int().optional(),
      })
      .optional()
      .describe(
        "Target counts the semantic editor grades the article against. Defaults to { words: 600, titles: 3, paragraphs: 6, internalLinks: 1, externalLinks: 2, images: 2 } when unset. Semantic document only.",
      ),
  },
  (input) => {
    const attributes = {
      title: input.title,
      resume: input.resume,
      type: input.type,
      status: input.status,
      canonical: input.canonical ?? undefined,
      hreflangs: input.hreflangs,
      custom: input.custom,
      private: input.private,
    };
    if (input.body) attributes.body = input.body;
    if (input.flags) attributes.flags = input.flags;
    if (input.published_at !== undefined) attributes.publishedAt = input.published_at;
    if (input.due_at !== undefined) attributes.dueAt = input.due_at;
    if (input.keyphrase !== undefined) attributes.keyphrase = input.keyphrase;
    if (input.keywords !== undefined) attributes.keywords = input.keywords;
    if (input.questions !== undefined) attributes.questions = input.questions;
    if (input.brief !== undefined) attributes.brief = input.brief;
    if (input.numbers !== undefined) attributes.numbers = input.numbers;

    const relationships = {};
    if (input.category)
      relationships.category = {
        data: { type: "category", id: input.category },
      };
    if (input.authors) {
      relationships.authors = {
        data: input.authors.map((slug) => ({ type: "author", id: slug })),
      };
    }
    if (input.terms) {
      relationships.terms = {
        data: Object.entries(input.terms).flatMap(([tax, slugs]) =>
          slugs.map((s) => ({ type: `term<${tax}>`, id: s })),
        ),
      };
    }
    if (input.thumbnail_media_id) {
      relationships.thumbnail = {
        data: { type: "media", id: input.thumbnail_media_id },
      };
    }

    return wrap(post("/v1/posts/", { data: { attributes, relationships } }));
  },
);

server.tool(
  "update_post",
  "Update a post. Send only the fields you want to change. Sending authors/flags/terms replaces the whole set (not append). Sending body pushes a new fs revision so the semantic editor sees the change.",
  {
    post_id: z.number().int(),
    title: z.string().optional(),
    resume: z.string().optional(),
    type: z
      .string()
      .optional()
      .describe(
        "Change the post's content type (by id). Omit to keep the current one.",
      ),
    body: bodySchema
      .optional()
      .describe(
        "Replaces the post body. Server converts to the semantic editor shape and pushes a new fs revision. Validated strictly against the butterfly grammar.",
      ),
    status: z
      .enum(["draft", "published", "planned", "awaiting_approval", "approved"])
      .optional(),
    published_at: z
      .string()
      .datetime()
      .nullable()
      .optional()
      .describe(
        "Publication timestamp (ISO 8601, UTC). Only meaningful for status=published or status=planned (future value = scheduled). Pass null to clear — useful when moving a post back to draft. Drives sortedDate / updatedAt and the public publish date.",
      ),
    due_at: z
      .string()
      .datetime()
      .nullable()
      .optional()
      .describe(
        "Internal delivery deadline (ISO 8601, UTC) for non-published statuses. Pass null to clear. Ignored for published/planned.",
      ),
    category: idOrSlug
      .nullable()
      .optional()
      .describe("Replaces the single category. Pass null to detach."),
    authors: z
      .array(z.string())
      .optional()
      .describe("Replaces the author list (not append)."),
    flags: z.array(z.string()).optional().describe("Replaces the flag list."),
    terms: z
      .record(z.array(z.string()))
      .optional()
      .describe(
        "Replaces the terms — only taxonomies listed in this object are touched.",
      ),
    thumbnail_media_id: z.number().int().nullable().optional(),
    canonical: z.string().nullable().optional(),
    hreflangs: z.record(z.string()).optional(),
    custom: z.record(z.any()).optional(),
    private: z.boolean().optional(),
    keyphrase: z
      .string()
      .optional()
      .describe("Primary SEO phrase. Semantic document only."),
    keywords: z
      .array(z.string())
      .optional()
      .describe("Supporting SEO keywords. Semantic document only."),
    questions: z
      .array(z.string())
      .optional()
      .describe(
        "FAQ-style questions the article is expected to answer. Semantic document only.",
      ),
    brief: z
      .string()
      .optional()
      .describe(
        "Briefing / writer recommendations shown in the editor. Semantic document only.",
      ),
    numbers: z
      .object({
        words: z.number().int().optional(),
        titles: z.number().int().optional(),
        paragraphs: z.number().int().optional(),
        internalLinks: z.number().int().optional(),
        externalLinks: z.number().int().optional(),
        images: z.number().int().optional(),
      })
      .optional()
      .describe(
        "Target counts the semantic editor grades against (words, titles, paragraphs, internalLinks, externalLinks, images). Semantic document only.",
      ),
  },
  (input) => {
    const attributes = {};
    for (const k of [
      "title",
      "resume",
      "type",
      "status",
      "hreflangs",
      "custom",
      "private",
      "keyphrase",
      "keywords",
      "questions",
      "brief",
      "numbers",
    ]) {
      if (input[k] !== undefined) attributes[k] = input[k];
    }
    if (input.flags !== undefined) attributes.flags = input.flags;
    if (input.canonical !== undefined) attributes.canonical = input.canonical;
    if (input.body !== undefined) attributes.body = input.body;
    if (input.published_at !== undefined) attributes.publishedAt = input.published_at;
    if (input.due_at !== undefined) attributes.dueAt = input.due_at;

    const relationships = {};
    if (input.category !== undefined) {
      relationships.category = {
        data: input.category ? { type: "category", id: input.category } : null,
      };
    }
    if (input.authors) {
      relationships.authors = {
        data: input.authors.map((slug) => ({ type: "author", id: slug })),
      };
    }
    if (input.terms) {
      relationships.terms = {
        data: Object.entries(input.terms).flatMap(([tax, slugs]) =>
          slugs.map((s) => ({ type: `term<${tax}>`, id: s })),
        ),
      };
    }
    if (input.thumbnail_media_id !== undefined) {
      relationships.thumbnail = {
        data: input.thumbnail_media_id
          ? { type: "media", id: input.thumbnail_media_id }
          : null,
      };
    }

    return wrap(
      patch(`/v1/posts/${input.post_id}`, {
        data: { attributes, relationships },
      }),
    );
  },
);

server.tool(
  "delete_post",
  'Soft-delete a post — flips its status to "deleted" and records how the Butterfly API should respond to subsequent GETs of its URL. The http_code you choose matters for SEO: 410 tells crawlers the page is permanently gone, 301 redirects to a replacement article, 451 indicates legal removal, 404 pretends it never existed, etc.',
  {
    post_id: z.number().int(),
    http_code: z
      .number()
      .int()
      .optional()
      .describe(
        "HTTP status served when the deleted post is fetched afterwards. Defaults to 410 (gone) when omitted. Common alternatives: 301 (permanent redirect), 451 (unavailable for legal reasons), 404.",
      ),
    detail: z
      .string()
      .optional()
      .describe(
        "For 3xx codes: the replacement URL to redirect to. For 4xx codes: an optional human-readable reason / comment surfaced alongside the error response.",
      ),
  },
  ({ post_id, http_code, detail }) => {
    const deleted = {};
    if (http_code !== undefined) deleted.httpCode = http_code;
    if (detail !== undefined) deleted.detail = detail;
    const body = Object.keys(deleted).length
      ? { data: { attributes: { deleted } } }
      : undefined;
    return wrap(del(`/v1/posts/${post_id}`, body));
  },
);

// ── Writes — medias ─────────────────────────────────────────────────────

server.tool(
  "upload_media",
  "Upload a new media (image, video, audio). Source is a local path OR URL OR base64.",
  {
    source_url: z.string().optional(),
    source_path: z.string().optional(),
    source_base64: z.string().optional(),
    filename: z.string().optional(),
    mimetype: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    credits: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    custom: z.record(z.any()).optional(),
  },
  (input) => {
    const fileSpec = input.source_path
      ? {
          path: input.source_path,
          filename: input.filename,
          mimetype: input.mimetype,
        }
      : input.source_url
        ? {
            url: input.source_url,
            filename: input.filename,
            mimetype: input.mimetype,
          }
        : input.source_base64
          ? {
              base64: input.source_base64,
              filename: input.filename,
              mimetype: input.mimetype,
            }
          : null;
    if (!fileSpec) {
      return Promise.resolve({
        isError: true,
        content: [
          {
            type: "text",
            text: "Provide one of source_url, source_path, source_base64",
          },
        ],
      });
    }
    const attributes = {
      name: input.name,
      description: input.description,
      credits: input.credits,
      keywords: input.keywords,
      custom: input.custom,
    };
    return wrap(uploadMedia(fileSpec, attributes));
  },
);

server.tool(
  "update_media",
  "Update media metadata (name/description/credits/keywords/custom).",
  {
    media_id: z.number().int(),
    name: z.string().optional(),
    description: z.string().optional(),
    credits: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    custom: z.record(z.any()).optional(),
  },
  (input) => {
    const attributes = {};
    for (const k of ["name", "description", "credits", "keywords", "custom"]) {
      if (input[k] !== undefined) attributes[k] = input[k];
    }
    return wrap(
      patch(`/v1/medias/${input.media_id}`, { data: { attributes } }),
    );
  },
);

server.tool(
  "delete_media",
  "Delete a media.",
  { media_id: z.number().int() },
  ({ media_id }) => wrap(del(`/v1/medias/${media_id}`)),
);

// ── Writes — structural ─────────────────────────────────────────────────

server.tool(
  "create_category",
  "Create a category. parent_category is a propertycategoryId.",
  {
    name: z.string(),
    description: z.string().optional(),
    parent_category: z.number().int().optional(),
    thumbnail_media_id: z.number().int().optional(),
    custom: z.record(z.any()).optional(),
  },
  (input) => {
    const data = {
      attributes: {
        name: input.name,
        description: input.description,
        custom: input.custom,
      },
    };
    const rel = {};
    if (input.parent_category)
      rel.parentCategory = {
        data: { type: "category", id: input.parent_category },
      };
    if (input.thumbnail_media_id)
      rel.thumbnail = { data: { type: "media", id: input.thumbnail_media_id } };
    if (Object.keys(rel).length) data.relationships = rel;
    return wrap(post("/v1/categories/", { data }));
  },
);

server.tool(
  "update_category",
  "Update a category. Pass restore=true to undo a prior soft-delete (brings the category back into the live list).",
  {
    category_id: z.number().int(),
    name: z.string().optional(),
    description: z.string().optional(),
    parent_category: z.number().int().nullable().optional(),
    thumbnail_media_id: z.number().int().nullable().optional(),
    custom: z.record(z.any()).optional(),
    restore: z
      .boolean()
      .optional()
      .describe(
        "If true, clears the soft-delete flag on the category so it reappears in listings. Leave unset to keep the current state.",
      ),
  },
  (input) => {
    const data = { attributes: {} };
    for (const k of ["name", "description", "custom"]) {
      if (input[k] !== undefined) data.attributes[k] = input[k];
    }
    if (input.restore === true) data.attributes.disable = false;
    const rel = {};
    if (input.parent_category !== undefined) {
      rel.parentCategory = {
        data: input.parent_category
          ? { type: "category", id: input.parent_category }
          : null,
      };
    }
    if (input.thumbnail_media_id !== undefined) {
      rel.thumbnail = {
        data: input.thumbnail_media_id
          ? { type: "media", id: input.thumbnail_media_id }
          : null,
      };
    }
    if (Object.keys(rel).length) data.relationships = rel;
    return wrap(patch(`/v1/categories/${input.category_id}`, { data }));
  },
);

server.tool(
  "delete_category",
  "Soft-delete a category (and record how subsequent GETs of its URL respond). Same http_code / detail contract as delete_post.",
  {
    category_id: z.number().int(),
    http_code: z
      .number()
      .int()
      .optional()
      .describe(
        "HTTP status returned on reads after delete. Defaults to 410. 301 to redirect, 451 for legal, etc.",
      ),
    detail: z
      .string()
      .optional()
      .describe("Replacement URL on 3xx, free-form reason on 4xx."),
  },
  ({ category_id, http_code, detail }) => {
    const deleted = {};
    if (http_code !== undefined) deleted.httpCode = http_code;
    if (detail !== undefined) deleted.detail = detail;
    const body = Object.keys(deleted).length
      ? { data: { attributes: { deleted } } }
      : undefined;
    return wrap(del(`/v1/categories/${category_id}`, body));
  },
);

server.tool(
  "create_author",
  "Create an author.",
  {
    name: z.string(),
    type: z.enum(["person", "organization"]).optional(),
    resume: z.string().optional(),
    jobTitle: z.string().optional(),
    url: z.string().optional(),
    email: z.string().optional(),
    telephone: z.string().optional(),
    thumbnail_media_id: z.number().int().optional(),
    custom: z
      .record(z.any())
      .optional()
      .describe(
        "Values for author-scoped custom fields (target=author in /custom). Run list_custom_settings to see allowed keys.",
      ),
  },
  (input) => {
    const data = {
      attributes: {
        name: input.name,
        type: input.type,
        resume: input.resume,
        jobTitle: input.jobTitle,
        url: input.url,
        email: input.email,
        telephone: input.telephone,
        custom: input.custom,
      },
    };
    if (input.thumbnail_media_id) {
      data.relationships = {
        thumbnail: { data: { type: "media", id: input.thumbnail_media_id } },
      };
    }
    return wrap(post("/v1/authors/", { data }));
  },
);

server.tool(
  "update_author",
  "Update an author by slug.",
  {
    author_slug: z.string(),
    name: z.string().optional(),
    resume: z.string().optional(),
    jobTitle: z.string().optional(),
    url: z.string().optional(),
    email: z.string().optional(),
    telephone: z.string().optional(),
    thumbnail_media_id: z.number().int().nullable().optional(),
    custom: z
      .record(z.any())
      .optional()
      .describe(
        "Values for author-scoped custom fields (target=author in /custom).",
      ),
  },
  (input) => {
    const data = { attributes: {} };
    for (const k of [
      "name",
      "resume",
      "jobTitle",
      "url",
      "email",
      "telephone",
      "custom",
    ]) {
      if (input[k] !== undefined) data.attributes[k] = input[k];
    }
    if (input.thumbnail_media_id !== undefined) {
      data.relationships = {
        thumbnail: {
          data: input.thumbnail_media_id
            ? { type: "media", id: input.thumbnail_media_id }
            : null,
        },
      };
    }
    return wrap(patch(`/v1/authors/${input.author_slug}`, { data }));
  },
);

server.tool(
  "delete_author",
  "Delete an author by slug.",
  { author_slug: z.string() },
  ({ author_slug }) => wrap(del(`/v1/authors/${author_slug}`)),
);

server.tool(
  "create_taxonomy",
  "Create a taxonomy.",
  {
    name: z.string(),
    description: z.string().optional(),
    editable: z.boolean().optional(),
  },
  (input) => wrap(post("/v1/taxonomies/", { data: { attributes: input } })),
);

server.tool(
  "update_taxonomy",
  "Update a taxonomy by slug.",
  {
    taxonomy_slug: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
  },
  (input) => {
    const data = { attributes: {} };
    if (input.name !== undefined) data.attributes.name = input.name;
    if (input.description !== undefined)
      data.attributes.description = input.description;
    return wrap(patch(`/v1/taxonomies/${input.taxonomy_slug}`, { data }));
  },
);

server.tool(
  "delete_taxonomy",
  "Delete a taxonomy by slug.",
  { taxonomy_slug: z.string() },
  ({ taxonomy_slug }) => wrap(del(`/v1/taxonomies/${taxonomy_slug}`)),
);

server.tool(
  "create_term",
  "Create a term in a taxonomy.",
  {
    taxonomy_slug: z.string(),
    name: z.string(),
    description: z.string().optional(),
    category: z.number().int().optional(),
    thumbnail_media_id: z.number().int().optional(),
    custom: z.record(z.any()).optional(),
    followed: z.boolean().optional(),
  },
  (input) => {
    const data = {
      attributes: {
        name: input.name,
        description: input.description,
        custom: input.custom,
        followed: input.followed,
      },
    };
    const rel = {};
    if (input.category)
      rel.category = { data: { type: "category", id: input.category } };
    if (input.thumbnail_media_id)
      rel.thumbnail = { data: { type: "media", id: input.thumbnail_media_id } };
    if (Object.keys(rel).length) data.relationships = rel;
    return wrap(
      post(`/v1/taxonomies/${input.taxonomy_slug}/relationships/terms/`, {
        data,
      }),
    );
  },
);

server.tool(
  "update_term",
  "Update a term by slug within a taxonomy.",
  {
    taxonomy_slug: z.string(),
    term_slug: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    category: z.number().int().nullable().optional(),
    thumbnail_media_id: z.number().int().nullable().optional(),
    custom: z.record(z.any()).optional(),
  },
  (input) => {
    const data = { attributes: {} };
    for (const k of ["name", "description", "custom"]) {
      if (input[k] !== undefined) data.attributes[k] = input[k];
    }
    const rel = {};
    if (input.category !== undefined) {
      rel.category = {
        data: input.category ? { type: "category", id: input.category } : null,
      };
    }
    if (input.thumbnail_media_id !== undefined) {
      rel.thumbnail = {
        data: input.thumbnail_media_id
          ? { type: "media", id: input.thumbnail_media_id }
          : null,
      };
    }
    if (Object.keys(rel).length) data.relationships = rel;
    return wrap(
      patch(
        `/v1/taxonomies/${input.taxonomy_slug}/relationships/terms/${input.term_slug}`,
        { data },
      ),
    );
  },
);

server.tool(
  "delete_term",
  "Soft-delete a term within a taxonomy (and record how subsequent GETs of its URL respond). Same http_code / detail contract as delete_post.",
  {
    taxonomy_slug: z.string(),
    term_slug: z.string(),
    http_code: z
      .number()
      .int()
      .optional()
      .describe(
        "HTTP status returned on reads after delete. Defaults to 410. 301 to redirect, 451 for legal, etc.",
      ),
    detail: z
      .string()
      .optional()
      .describe("Replacement URL on 3xx, free-form reason on 4xx."),
  },
  ({ taxonomy_slug, term_slug, http_code, detail }) => {
    const deleted = {};
    if (http_code !== undefined) deleted.httpCode = http_code;
    if (detail !== undefined) deleted.detail = detail;
    const body = Object.keys(deleted).length
      ? { data: { attributes: { deleted } } }
      : undefined;
    return wrap(
      del(
        `/v1/taxonomies/${taxonomy_slug}/relationships/terms/${term_slug}`,
        body,
      ),
    );
  },
);

server.tool(
  "create_type",
  "Create a content type.",
  {
    name: z.string(),
    description: z.string().optional(),
    butterflyType: z.string().optional(),
  },
  (input) => wrap(post("/v1/types/", { data: { attributes: input } })),
);

server.tool(
  "update_type",
  "Update a content type by id.",
  {
    type_id: z.string().describe("The type id (slug)."),
    name: z.string().optional(),
    description: z.string().optional(),
    butterflyType: z.string().optional(),
  },
  (input) => {
    const attributes = {};
    for (const k of ["name", "description", "butterflyType"]) {
      if (input[k] !== undefined) attributes[k] = input[k];
    }
    return wrap(patch(`/v1/types/${input.type_id}`, { data: { attributes } }));
  },
);

server.tool(
  "delete_type",
  "Delete a type by id.",
  { type_id: z.string() },
  ({ type_id }) => wrap(del(`/v1/types/${type_id}`)),
);

server.tool(
  "create_flag",
  "Create a flag.",
  { name: z.string(), description: z.string().optional() },
  (input) => wrap(post("/v1/flags/", { data: { attributes: input } })),
);

server.tool(
  "update_flag",
  "Update a flag by id.",
  {
    flag_id: z.string().describe("The flag id (slug)."),
    name: z.string().optional(),
    description: z.string().optional(),
  },
  (input) => {
    const attributes = {};
    for (const k of ["name", "description"]) {
      if (input[k] !== undefined) attributes[k] = input[k];
    }
    return wrap(patch(`/v1/flags/${input.flag_id}`, { data: { attributes } }));
  },
);

server.tool(
  "delete_flag",
  "Delete a flag by id.",
  { flag_id: z.string() },
  ({ flag_id }) => wrap(del(`/v1/flags/${flag_id}`)),
);

server.tool(
  "create_feed",
  "Create a feed with an ordered list of elements (post / category / term<tax>).",
  {
    name: z.string(),
    description: z.string().optional(),
    max: z.number().int().optional(),
    elements: z.array(z.object({ type: z.string(), id: idOrSlug })).optional(),
  },
  (input) => {
    const data = {
      attributes: {
        name: input.name,
        description: input.description,
        max: input.max,
      },
    };
    if (input.elements)
      data.relationships = { elements: { data: input.elements } };
    return wrap(post("/v1/feeds/", { data }));
  },
);

server.tool(
  "update_feed",
  "Update a feed by slug.",
  {
    feed_slug: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    max: z.number().int().optional(),
    elements: z.array(z.object({ type: z.string(), id: idOrSlug })).optional(),
  },
  (input) => {
    const data = { attributes: {} };
    for (const k of ["name", "description", "max"]) {
      if (input[k] !== undefined) data.attributes[k] = input[k];
    }
    if (input.elements)
      data.relationships = { elements: { data: input.elements } };
    return wrap(patch(`/v1/feeds/${input.feed_slug}`, { data }));
  },
);

server.tool(
  "delete_feed",
  "Delete a feed by slug.",
  { feed_slug: z.string() },
  ({ feed_slug }) => wrap(del(`/v1/feeds/${feed_slug}`)),
);

server.tool(
  "create_custom_setting",
  "Register a custom field that can be used in the `custom` object of posts / categories / terms / authors / medias / general.",
  {
    name: z.string(),
    target: z.enum(["general", "post", "term", "category", "author", "media"]),
    settings: z
      .record(z.any())
      .describe(
        'Field definition. Supported { type: "string" | "multiline" | "dropdown" | "multiplechoice" | "color" | "date" }. dropdown and multiplechoice require { choices: [...] }.',
      ),
    key: z
      .string()
      .optional()
      .describe(
        "Optional. Slugified from name if omitted. Immutable after creation.",
      ),
    description: z.string().optional(),
  },
  (input) => wrap(post("/v1/custom/", { data: { attributes: input } })),
);

server.tool(
  "update_custom_setting",
  "Update a custom setting by key. The key itself and the target resource are immutable — only name, description and the field definition can change.",
  {
    key: z.string().describe("The custom setting id (key)."),
    name: z.string().optional(),
    description: z.string().optional(),
    settings: z
      .record(z.any())
      .optional()
      .describe(
        'New field definition. Supported { type: "string" | "multiline" | "dropdown" | "multiplechoice" | "color" | "date" }; dropdown/multiplechoice require { choices: [...] }.',
      ),
  },
  (input) => {
    const attributes = {};
    for (const k of ["name", "description", "settings"]) {
      if (input[k] !== undefined) attributes[k] = input[k];
    }
    return wrap(
      patch(`/v1/custom/${encodeURIComponent(input.key)}`, {
        data: { attributes },
      }),
    );
  },
);

server.tool(
  "delete_custom_setting",
  "Delete a custom setting by key.",
  { key: z.string() },
  ({ key }) => wrap(del(`/v1/custom/${encodeURIComponent(key)}`)),
);

// ── Run ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
