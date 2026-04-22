import assert from "node:assert/strict";
import { test } from "node:test";
import { bodySchema, toInlineArray } from "./bodySchema.js";

// Recursive scan: walks every block/inline position the schema accepts
// and returns every offending value whose shape would crash semantic-app's
// for…of recursion (a bare string where an InlineNode[] is expected).
// Pass this the *normalized* body — it should always come back empty.
function findStringInlines(body) {
  const hits = [];
  const walkInline = (nodes, path) => {
    assert.ok(Array.isArray(nodes), `expected array at ${path}`);
    nodes.forEach((node, i) => {
      if (!node || typeof node !== "object") return;
      // text.value is a string leaf by design — skip.
      if (node.type === "text") return;
      if (node.value === undefined) return;
      if (typeof node.value === "string") {
        hits.push(`${path}[${i}].value = string`);
        return;
      }
      if (Array.isArray(node.value)) {
        walkInline(node.value, `${path}[${i}].value`);
      }
    });
  };
  const walkTableRows = (rows, path) => {
    if (!Array.isArray(rows)) return;
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (typeof cell.content === "string") {
          hits.push(`${path}[${r}][${c}].content = string`);
          return;
        }
        walkInline(cell.content, `${path}[${r}][${c}].content`);
      });
    });
  };
  body.forEach((block, b) => {
    const p = `[${b}]`;
    switch (block.type) {
      case "paragraph":
        if (typeof block.data === "string") hits.push(`${p}.data = string`);
        else walkInline(block.data, `${p}.data`);
        break;
      case "bulletList":
      case "orderedList":
      case "reversedList":
        block.data.forEach((item, i) => {
          if (typeof item === "string") hits.push(`${p}.data[${i}] = string`);
          else walkInline(item, `${p}.data[${i}]`);
        });
        break;
      case "quote":
        if (typeof block.data.value === "string")
          hits.push(`${p}.data.value = string`);
        else walkInline(block.data.value, `${p}.data.value`);
        break;
      case "faq":
        if (typeof block.data.value === "string")
          hits.push(`${p}.data.value = string`);
        else walkInline(block.data.value, `${p}.data.value`);
        break;
      case "table":
        walkTableRows(block.data.head, `${p}.data.head`);
        walkTableRows(block.data.body, `${p}.data.body`);
        walkTableRows(block.data.foot, `${p}.data.foot`);
        break;
      default:
        break;
    }
  });
  return hits;
}

test("toInlineArray: string → text node wrapper", () => {
  assert.deepEqual(toInlineArray("hello"), [{ type: "text", value: "hello" }]);
});

test("toInlineArray: array passes through", () => {
  const arr = [{ type: "text", value: "x" }];
  assert.equal(toInlineArray(arr), arr);
});

test("paragraph: string data is normalized to [{text}]", () => {
  const parsed = bodySchema.parse([{ type: "paragraph", data: "hello" }]);
  assert.deepEqual(parsed, [
    { type: "paragraph", data: [{ type: "text", value: "hello" }] },
  ]);
  assert.deepEqual(findStringInlines(parsed), []);
});

test("list items: each string item is normalized", () => {
  const parsed = bodySchema.parse([
    { type: "bulletList", data: ["first", "second"] },
    { type: "orderedList", data: ["a", [{ type: "text", value: "b" }]] },
    { type: "reversedList", data: ["solo"] },
  ]);
  assert.deepEqual(parsed[0].data, [
    [{ type: "text", value: "first" }],
    [{ type: "text", value: "second" }],
  ]);
  assert.deepEqual(parsed[1].data, [
    [{ type: "text", value: "a" }],
    [{ type: "text", value: "b" }],
  ]);
  assert.deepEqual(parsed[2].data, [[{ type: "text", value: "solo" }]]);
  assert.deepEqual(findStringInlines(parsed), []);
});

test("quote.data.value: string is normalized", () => {
  const parsed = bodySchema.parse([
    {
      type: "quote",
      data: { value: "Art is theft.", source: { author: "Picasso" } },
    },
  ]);
  assert.deepEqual(parsed[0].data.value, [
    { type: "text", value: "Art is theft." },
  ]);
  assert.deepEqual(findStringInlines(parsed), []);
});

test("faq.data.value: string is normalized", () => {
  const parsed = bodySchema.parse([
    { type: "faq", data: { question: "Q?", value: "A." } },
  ]);
  assert.deepEqual(parsed[0].data.value, [{ type: "text", value: "A." }]);
  assert.deepEqual(findStringInlines(parsed), []);
});

test("table: cell.content as string is normalized across head/body/foot", () => {
  const parsed = bodySchema.parse([
    {
      type: "table",
      data: {
        head: [[{ content: "Name" }, { content: "Score" }]],
        body: [[{ content: "Alice" }, { content: "12" }]],
        foot: [[{ content: "Total", colspan: 2, align: "right" }]],
      },
    },
  ]);
  assert.deepEqual(parsed[0].data.head[0][0].content, [
    { type: "text", value: "Name" },
  ]);
  assert.deepEqual(parsed[0].data.body[0][1].content, [
    { type: "text", value: "12" },
  ]);
  assert.deepEqual(parsed[0].data.foot[0][0].content, [
    { type: "text", value: "Total" },
  ]);
  assert.equal(parsed[0].data.foot[0][0].colspan, 2);
  assert.deepEqual(findStringInlines(parsed), []);
});

test("wrapper inline nodes: value as string is normalized recursively", () => {
  const parsed = bodySchema.parse([
    {
      type: "paragraph",
      data: [
        { type: "strong", value: "bold text" },
        { type: "emphasis", value: "italic" },
        { type: "underline", value: "u" },
        { type: "strikethrough", value: "s" },
        { type: "code", value: "inline code" },
        { type: "superscript", value: "sup" },
        { type: "subscript", value: "sub" },
        { type: "link", href: "https://x", value: "link text" },
        { type: "quote", cite: "src", value: "inline quote" },
        { type: "abbreviation", title: "World Health Org.", value: "WHO" },
      ],
    },
  ]);
  const inlines = parsed[0].data;
  for (const node of inlines) {
    if (node.type === "break") continue;
    assert.ok(
      Array.isArray(node.value),
      `${node.type}.value should be array after normalization`,
    );
    assert.equal(node.value[0].type, "text");
  }
  assert.deepEqual(findStringInlines(parsed), []);
});

test("deeply nested: string inside strong inside link is normalized", () => {
  const parsed = bodySchema.parse([
    {
      type: "paragraph",
      data: [
        {
          type: "link",
          href: "https://x",
          value: [{ type: "strong", value: "deep" }],
        },
      ],
    },
  ]);
  assert.deepEqual(parsed[0].data[0].value[0].value, [
    { type: "text", value: "deep" },
  ]);
  assert.deepEqual(findStringInlines(parsed), []);
});

test("reproduction: update_post body from the bug report parses & normalizes", () => {
  const parsed = bodySchema.parse([{ type: "paragraph", data: "hello" }]);
  assert.deepEqual(parsed, [
    { type: "paragraph", data: [{ type: "text", value: "hello" }] },
  ]);
});

test("regression: ProseMirror-style marks on text is rejected", () => {
  const result = bodySchema.safeParse([
    {
      type: "paragraph",
      data: [
        { type: "text", marks: [{ type: "bold" }], value: "Ficus lyrata" },
      ],
    },
  ]);
  assert.equal(result.success, false);
  const msg = result.error.issues.map((i) => i.message).join(" | ");
  assert.match(msg, /Unrecognized key|marks/);
});

test("array form already-correct bodies pass through unchanged", () => {
  const source = [
    { type: "title2", data: "Section" },
    {
      type: "paragraph",
      data: [
        { type: "text", value: "Hello " },
        { type: "strong", value: [{ type: "text", value: "world" }] },
      ],
    },
    { type: "image", data: { mediaId: 87, credits: "AFP" } },
    { type: "gallery", data: [{ mediaId: 1 }, { mediaId: 2 }] },
    { type: "pagebreak" },
    {
      type: "related",
      title: "Read more",
      data: [{ type: "post", id: 1017 }],
    },
  ];
  const parsed = bodySchema.parse(source);
  assert.deepEqual(parsed, source);
  assert.deepEqual(findStringInlines(parsed), []);
});
