import { z } from "zod";

// Zod validators for the butterfly post body grammar. Source of truth:
// @enodo/butterfly-ts/src/post.ts (canonical interfaces) cross-checked
// against blockCatalog.js.
//
// Wired into create_post / update_post so bad shapes are rejected at the
// MCP boundary — the LLM gets a precise zod error and can self-correct on
// the next turn. Objects are strict (unknown keys rejected) so cases like a
// stray ProseMirror-style `marks` array on a text node surface clearly.
//
// butterfly-ts types every inline field as `string | BodyInlineNode[]`
// (paragraph.data, list items, quote/faq value, table-cell content, wrapper
// node `.value`). The array form is the only one semantic-app can render —
// a bare string crashes store.svelte.ts's `for…of` recursion. So the schema
// accepts both at the boundary and *normalizes* string → [{type:'text',
// value:str}] via a zod transform, before the body is forwarded to the
// public API. Downstream sees only the array form.

export function toInlineArray(v) {
  if (typeof v === "string") return [{ type: "text", value: v }];
  return v;
}

// Accepts `string | InlineNode[]`, outputs `InlineNode[]`. Used at every
// inline-accepting position. z.lazy so the recursive reference to
// `inlineNode` resolves at parse time.
const inlineField = z.lazy(() =>
  z.union([z.string().transform(toInlineArray), z.array(inlineNode)]),
);

// Recursive inline-node union. text keeps its `value: string` leaf (the
// one inline shape where a bare string *is* canonical); every wrapper
// (strong/emphasis/.../link/quote/abbreviation) takes `inlineField` so its
// value can be a string that gets normalized, an empty array, or nested
// nodes.
const inlineNode = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("text"), value: z.string() }).strict(),
    z.object({ type: z.literal("strong"), value: inlineField }).strict(),
    z.object({ type: z.literal("emphasis"), value: inlineField }).strict(),
    z.object({ type: z.literal("underline"), value: inlineField }).strict(),
    z
      .object({ type: z.literal("strikethrough"), value: inlineField })
      .strict(),
    z.object({ type: z.literal("code"), value: inlineField }).strict(),
    z.object({ type: z.literal("superscript"), value: inlineField }).strict(),
    z.object({ type: z.literal("subscript"), value: inlineField }).strict(),
    z
      .object({
        type: z.literal("link"),
        href: z.string(),
        title: z.string().optional(),
        sponsored: z.string().optional(),
        value: inlineField,
      })
      .strict(),
    z
      .object({
        type: z.literal("quote"),
        cite: z.string().optional(),
        value: inlineField,
      })
      .strict(),
    z
      .object({
        type: z.literal("abbreviation"),
        title: z.string(),
        value: inlineField,
      })
      .strict(),
    z
      .object({
        type: z.literal("customstyle"),
        key: z.string().min(1),
        value: inlineField,
      })
      .strict(),
    z.object({ type: z.literal("break") }).strict(),
  ]),
);

const mediaData = z
  .object({
    mediaId: z.number().int(),
    credits: z.string().optional(),
    description: z.string().optional(),
    caption: z.string().optional(),
  })
  .strict();

const oembedData = z
  .object({
    url: z.string(),
    oembed: z.record(z.any()),
  })
  .strict();

// butterfly-ts TableCell uses snake-case colspan/rowspan, free-form string
// align/valign. Content is inline (string or InlineNode[]).
const tableCell = z
  .object({
    content: inlineField,
    colspan: z.number().int().optional(),
    rowspan: z.number().int().optional(),
    align: z.string().optional(),
    valign: z.string().optional(),
  })
  .strict();

const tableRows = z.array(z.array(tableCell));

// Optional block-level template slug available on any block that admits a
// blocktemplate annotation. Unknown / orphaned slugs are accepted at the
// schema layer and rejected (or silently dropped at render time) by the API
// and the editor. Custom styles are inline marks now, applied at the inline
// level via the `customstyle` wrapper node — see `inlineNode` below.
const stylableFields = {
  template: z.string().optional(),
};

const heading = (level) =>
  z.object({ type: z.literal(level), data: z.string(), ...stylableFields }).strict();

// BulletList/OrderedList/ReversedList.data = (string | InlineNode[])[] —
// each list item is normalized to InlineNode[].
const list = (level) =>
  z
    .object({
      type: z.literal(level),
      data: z.array(inlineField),
      ...stylableFields,
    })
    .strict();

const blockNode = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("paragraph"), data: inlineField, ...stylableFields })
    .strict(),
  heading("title2"),
  heading("title3"),
  heading("title4"),
  heading("title5"),
  heading("title6"),
  list("bulletList"),
  list("orderedList"),
  list("reversedList"),
  z
    .object({
      type: z.literal("quote"),
      data: z
        .object({
          value: inlineField,
          source: z
            .object({
              author: z.string().optional(),
              title: z.string().optional(),
              url: z.string().optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
      ...stylableFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("code"),
      data: z
        .object({
          value: z.string(),
          language: z.string().optional(),
        })
        .strict(),
      ...stylableFields,
    })
    .strict(),
  z
    .object({ type: z.literal("markdown"), data: z.string(), ...stylableFields })
    .strict(),
  z.object({ type: z.literal("embed"), data: z.string() }).strict(),
  z.object({ type: z.literal("pagebreak"), ...stylableFields }).strict(),
  z
    .object({ type: z.literal("image"), data: mediaData, ...stylableFields })
    .strict(),
  z
    .object({ type: z.literal("video"), data: mediaData, ...stylableFields })
    .strict(),
  z
    .object({ type: z.literal("audio"), data: mediaData, ...stylableFields })
    .strict(),
  z
    .object({
      type: z.literal("gallery"),
      data: z.array(mediaData),
      ...stylableFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("faq"),
      data: z
        .object({
          question: z.string(),
          value: inlineField,
        })
        .strict(),
      ...stylableFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("iframe"),
      data: z
        .object({
          src: z.string(),
          width: z.number().int().optional(),
          height: z.number().int().optional(),
          title: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal("youtube"), data: oembedData }).strict(),
  z.object({ type: z.literal("dailymotion"), data: oembedData }).strict(),
  z.object({ type: z.literal("vimeo"), data: oembedData }).strict(),
  z.object({ type: z.literal("x"), data: oembedData }).strict(),
  z.object({ type: z.literal("tiktok"), data: oembedData }).strict(),
  z.object({ type: z.literal("facebook"), data: oembedData }).strict(),
  z.object({ type: z.literal("instagram"), data: oembedData }).strict(),
  z
    .object({
      type: z.literal("table"),
      data: z
        .object({
          caption: z.string().optional(),
          head: tableRows.optional(),
          body: tableRows,
          foot: tableRows.optional(),
        })
        .strict(),
      ...stylableFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("related"),
      title: z.string().nullable().optional(),
      data: z.array(
        z
          .object({
            type: z.literal("post"),
            id: z.number().int(),
          })
          .strict(),
      ),
      ...stylableFields,
    })
    .strict(),
]);

export const bodySchema = z.array(blockNode);
