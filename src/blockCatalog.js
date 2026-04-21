// Butterfly body block catalog — the grammar that posts.body uses.
//
// Shape reference: semantic-app/src/lib/editor/types.ts (the canonical
// definition), filtered through semantic-app's buildButterflyBody() to
// match what the Butterfly API stores (media blocks stripped of fs-specific
// fields, quote/faq with their source/question flattened into data, etc.).
//
// When the Butterfly API receives a post body it converts these blocks
// back to the semantic revision shape on the fly, so both sides stay in
// sync. Everything here is therefore the *butterfly* flavor.

export const INLINE_NODES = [
  { type: 'text', shape: '{ type: "text", value: string }' },
  { type: 'strong', shape: '{ type: "strong", value: InlineNode[] }' },
  { type: 'emphasis', shape: '{ type: "emphasis", value: InlineNode[] }' },
  { type: 'underline', shape: '{ type: "underline", value: InlineNode[] }' },
  { type: 'strikethrough', shape: '{ type: "strikethrough", value: InlineNode[] }' },
  { type: 'code', shape: '{ type: "code", value: InlineNode[] }' },
  { type: 'superscript', shape: '{ type: "superscript", value: InlineNode[] }' },
  { type: 'subscript', shape: '{ type: "subscript", value: InlineNode[] }' },
  { type: 'link', shape: '{ type: "link", href: string, title?: string, sponsored?: string, value: InlineNode[] }' },
  { type: 'quote', shape: '{ type: "quote", cite?: string, value: InlineNode[] }' },
  { type: 'abbreviation', shape: '{ type: "abbreviation", title: string, value: InlineNode[] }' },
  { type: 'break', shape: '{ type: "break" }' },
];

export const BLOCK_CATALOG = [
  {
    type: 'paragraph',
    description: 'Plain paragraph with inline formatting.',
    shape: '{ type: "paragraph", data: InlineNode[] }',
    example: { type: 'paragraph', data: [{ type: 'text', value: 'Hello ' }, { type: 'strong', value: [{ type: 'text', value: 'world' }] }] },
  },
  {
    type: 'title2',
    description: 'Heading level 2 (main article sections). Plain string, no inline formatting.',
    shape: '{ type: "title2", data: string }',
    example: { type: 'title2', data: 'Section title' },
  },
  { type: 'title3', description: 'Heading level 3.', shape: '{ type: "title3", data: string }', example: { type: 'title3', data: 'Sub section' } },
  { type: 'title4', description: 'Heading level 4.', shape: '{ type: "title4", data: string }', example: { type: 'title4', data: '...' } },
  { type: 'title5', description: 'Heading level 5.', shape: '{ type: "title5", data: string }', example: { type: 'title5', data: '...' } },
  { type: 'title6', description: 'Heading level 6.', shape: '{ type: "title6", data: string }', example: { type: 'title6', data: '...' } },
  {
    type: 'bulletList',
    description: 'Unordered list. Each item is an InlineNode[] (inline formatting supported).',
    shape: '{ type: "bulletList", data: InlineNode[][] }',
    example: { type: 'bulletList', data: [[{ type: 'text', value: 'First' }], [{ type: 'text', value: 'Second' }]] },
  },
  {
    type: 'orderedList',
    description: 'Ordered list, ascending (1, 2, 3…).',
    shape: '{ type: "orderedList", data: InlineNode[][] }',
    example: { type: 'orderedList', data: [[{ type: 'text', value: 'First' }], [{ type: 'text', value: 'Second' }]] },
  },
  {
    type: 'reversedList',
    description: 'Ordered list, descending (useful for "top N" countdowns).',
    shape: '{ type: "reversedList", data: InlineNode[][] }',
    example: { type: 'reversedList', data: [[{ type: 'text', value: 'Best' }], [{ type: 'text', value: 'Runner-up' }]] },
  },
  {
    type: 'quote',
    description: 'Pull quote. Butterfly shape flattens the source into `data.source`.',
    shape: '{ type: "quote", data: { value: InlineNode[], source?: { author?: string, title?: string, url?: string } } }',
    example: {
      type: 'quote',
      data: {
        value: [{ type: 'text', value: 'Art is theft.' }],
        source: { author: 'Pablo Picasso' },
      },
    },
  },
  {
    type: 'code',
    description: 'Code block.',
    shape: '{ type: "code", data: { value: string, language?: string } }',
    example: { type: 'code', data: { value: 'console.log("hi")', language: 'javascript' } },
  },
  {
    type: 'markdown',
    description: 'Raw markdown escape hatch. Rendered verbatim.',
    shape: '{ type: "markdown", data: string }',
    example: { type: 'markdown', data: '# Raw markdown' },
  },
  {
    type: 'embed',
    description: 'Arbitrary HTML embed (iframe / widget / tracking pixel).',
    shape: '{ type: "embed", data: string }',
    example: { type: 'embed', data: '<iframe src="..." width="..." height="..."></iframe>' },
  },
  {
    type: 'pagebreak',
    description: 'Visual page / section separator. No data.',
    shape: '{ type: "pagebreak" }',
    example: { type: 'pagebreak' },
  },
  {
    type: 'image',
    description: 'Image block. Butterfly shape carries only mediaId + editorial fields; upload binary via upload_media first to get the id.',
    shape: '{ type: "image", data: { mediaId: number, credits?: string, description?: string, caption?: string } }',
    example: { type: 'image', data: { mediaId: 87, credits: 'AFP', description: 'A cat' } },
  },
  {
    type: 'video',
    description: 'Video block. Same shape as image.',
    shape: '{ type: "video", data: { mediaId: number, credits?: string, description?: string, caption?: string } }',
    example: { type: 'video', data: { mediaId: 92, caption: 'Match highlights' } },
  },
  {
    type: 'audio',
    description: 'Audio block.',
    shape: '{ type: "audio", data: { mediaId: number, credits?: string, description?: string, caption?: string } }',
    example: { type: 'audio', data: { mediaId: 104 } },
  },
  {
    type: 'gallery',
    description: 'Ordered set of medias. `data` is an array; each item is the same shape as an image block\'s data.',
    shape: '{ type: "gallery", data: Array<{ mediaId: number, credits?: string, description?: string, caption?: string }> }',
    example: { type: 'gallery', data: [{ mediaId: 87 }, { mediaId: 92 }] },
  },
  {
    type: 'faq',
    description: 'Frequently-asked-question pair. Butterfly shape flattens question into `data.question`.',
    shape: '{ type: "faq", data: { question: string, value: InlineNode[] } }',
    example: {
      type: 'faq',
      data: {
        question: 'What is the meaning of life?',
        value: [{ type: 'text', value: '42.' }],
      },
    },
  },
  {
    type: 'iframe',
    description: 'Inline iframe (e.g. map, chart). Prefer iframe over embed when you control the URL.',
    shape: '{ type: "iframe", data: { src: string, width?: number, height?: number, title?: string } }',
    example: { type: 'iframe', data: { src: 'https://example.com/widget', width: 600, height: 400 } },
  },
  {
    type: 'youtube',
    description: 'YouTube embed. Use the OEmbed payload shape.',
    shape: '{ type: "youtube", data: { url: string, oembed: object } }',
    example: { type: 'youtube', data: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', oembed: {} } },
  },
  {
    type: 'dailymotion',
    description: 'Dailymotion embed.',
    shape: '{ type: "dailymotion", data: { url: string, oembed: object } }',
    example: { type: 'dailymotion', data: { url: 'https://www.dailymotion.com/video/x7tgad0', oembed: {} } },
  },
  {
    type: 'vimeo',
    description: 'Vimeo embed.',
    shape: '{ type: "vimeo", data: { url: string, oembed: object } }',
    example: { type: 'vimeo', data: { url: 'https://vimeo.com/123', oembed: {} } },
  },
  {
    type: 'x',
    description: 'X / Twitter embed.',
    shape: '{ type: "x", data: { url: string, oembed: object } }',
    example: { type: 'x', data: { url: 'https://x.com/handle/status/123', oembed: {} } },
  },
  {
    type: 'tiktok',
    description: 'TikTok embed.',
    shape: '{ type: "tiktok", data: { url: string, oembed: object } }',
    example: { type: 'tiktok', data: { url: 'https://www.tiktok.com/@user/video/123', oembed: {} } },
  },
  {
    type: 'facebook',
    description: 'Facebook embed (post or video).',
    shape: '{ type: "facebook", data: { url: string, oembed: object } }',
    example: { type: 'facebook', data: { url: 'https://www.facebook.com/user/posts/123', oembed: {} } },
  },
  {
    type: 'instagram',
    description: 'Instagram embed.',
    shape: '{ type: "instagram", data: { url: string, oembed: object } }',
    example: { type: 'instagram', data: { url: 'https://www.instagram.com/p/ABCDEF/', oembed: {} } },
  },
  {
    type: 'table',
    description: 'Tabular data. head/body/foot are rows of cells; each cell carries InlineNode[] content plus optional alignment and span.',
    shape: '{ type: "table", data: { caption?: string, head?: TableCell[][], body: TableCell[][], foot?: TableCell[][] } }',
    example: {
      type: 'table',
      data: {
        head: [[{ content: [{ type: 'text', value: 'Name' }] }, { content: [{ type: 'text', value: 'Score' }] }]],
        body: [[{ content: [{ type: 'text', value: 'Alice' }] }, { content: [{ type: 'text', value: '12' }] }]],
      },
    },
  },
  {
    type: 'related',
    description: 'Related-posts widget. Butterfly shape: data is an array of { type: "post", id: <propertypostId> }.',
    shape: '{ type: "related", title?: string, data: Array<{ type: "post", id: number }> }',
    example: { type: 'related', title: 'Read more', data: [{ type: 'post', id: 1017 }, { type: 'post', id: 1023 }] },
  },
];

export const BODY_SHAPE_SUMMARY = `A butterfly post body is an **array of blocks**, each with a \`type\` discriminator. 27 block types available:

- Text: paragraph, title2-6, bulletList, orderedList, reversedList, quote, code, markdown, embed, pagebreak
- Media: image, video, audio, gallery (all reference a butterfly mediaId — upload first with upload_media)
- Structured: faq, table, related
- oEmbed: iframe, youtube, dailymotion, vimeo, x, tiktok, facebook, instagram

Inline formatting inside text blocks uses InlineNode[] — a recursive tree of: text, strong, emphasis, underline, strikethrough, code, superscript, subscript, link (href required), quote (cite optional), abbreviation (title required), break.

Ids referenced from the body: image/video/audio/gallery → \`propertymediaId\` (upload via upload_media). related → \`propertypostId\`.

Call list_block_types for the full catalogue with examples. Use markdown_to_butterfly_body when you want the server to convert raw markdown — it handles the tedious inline-node reshape for you.`;
