import { marked } from 'marked';

// Convert a markdown string into a butterfly post body (array of blocks).
//
// Covers the 90% case: paragraphs, headings, lists, code fences, block
// quotes, horizontal rules, inline formatting (bold/italic/strikethrough/
// inline-code/links), images (produce image blocks with description/caption
// only — mediaId must be resolved separately by the caller), line breaks.
//
// What this does NOT handle:
//   - embeds (iframes, oEmbed): use the `embed` / `iframe` / `youtube` /
//     etc. blocks directly.
//   - galleries, FAQs, related: those are structural, not markdown.
//
// `options.imageMediaIds` is an optional `{ [altOrUrl]: propertymediaId }`
// map. When present, images whose alt text or URL matches a key get a
// concrete mediaId on the resulting block; images that don't match stay
// with mediaId=null and a sensible description/caption so the caller
// (or an LLM) can resolve them in a second pass.

export function markdownToButterfly(markdown, options = {}) {
  const tokens = marked.lexer(markdown || '');
  const blocks = [];

  for (const token of tokens) {
    const converted = convertBlockToken(token, options);
    if (!converted) continue;
    if (Array.isArray(converted)) {
      blocks.push(...converted);
    } else {
      blocks.push(converted);
    }
  }

  return blocks;
}

function convertBlockToken(token, options) {
  switch (token.type) {
    case 'heading': {
      const level = Math.min(Math.max(token.depth, 2), 6);
      return { type: `title${level}`, data: token.text };
    }

    case 'paragraph': {
      // Marked emits isolated images as a paragraph with a single image
      // token — extract them into real image blocks rather than keeping
      // them inside a paragraph.
      const onlyImages = (token.tokens || []).every(
        (t) => t.type === 'image' || (t.type === 'text' && /^\s*$/.test(t.raw)),
      );
      if (onlyImages && (token.tokens || []).some((t) => t.type === 'image')) {
        return token.tokens.filter((t) => t.type === 'image').map((t) => imageBlock(t, options));
      }
      return { type: 'paragraph', data: convertInlineTokens(token.tokens || []) };
    }

    case 'list': {
      const itemNodes = token.items.map((item) => convertInlineTokens(flattenItemTokens(item.tokens)));
      if (token.ordered) {
        return { type: 'orderedList', data: itemNodes };
      }
      return { type: 'bulletList', data: itemNodes };
    }

    case 'code': {
      return {
        type: 'code',
        data: {
          value: token.text,
          ...(token.lang ? { language: token.lang } : {}),
        },
      };
    }

    case 'blockquote': {
      // Flatten quoted blocks into a single inline list. Most quoted
      // content in markdown is a paragraph or two; nested block structures
      // are rare and we keep the output simple.
      const value = (token.tokens || [])
        .flatMap((inner) => {
          if (inner.type === 'paragraph') return convertInlineTokens(inner.tokens || []);
          if (inner.type === 'text') return convertInlineTokens(inner.tokens || [{ type: 'text', text: inner.text }]);
          return [];
        });
      return { type: 'quote', data: { value } };
    }

    case 'hr':
      return { type: 'pagebreak' };

    case 'space':
      return null;

    case 'html':
      return { type: 'embed', data: token.text || token.raw || '' };

    case 'table':
      return tableBlock(token);

    default:
      return null;
  }
}

function flattenItemTokens(tokens) {
  // marked's list items contain text/paragraph tokens; we unwrap them
  // back to inline tokens so the item becomes an InlineNode[].
  return tokens.flatMap((t) => {
    if (t.type === 'text' && Array.isArray(t.tokens)) return t.tokens;
    if (t.type === 'paragraph' && Array.isArray(t.tokens)) return t.tokens;
    return [t];
  });
}

// Convert a marked `table` token into a structured butterfly table block.
// marked gives us header (array of cells) + rows (array of arrays of cells)
// + align (array like ['left', 'center', 'right' | null]). Each cell's
// content is itself a token list we can push through the inline pipeline
// so bold / links / inline code inside cells survive.
function tableBlock(token) {
  const align = token.align || [];
  const toAlign = (idx) => (align[idx] === 'left' || align[idx] === 'center' || align[idx] === 'right' ? align[idx] : undefined);

  const mapRow = (cells) =>
    cells.map((cell, idx) => {
      const content = convertInlineTokens(cell.tokens || []);
      const a = toAlign(idx);
      return a ? { content, align: a } : { content };
    });

  const head = token.header && token.header.length ? [mapRow(token.header)] : undefined;
  const body = (token.rows || []).map(mapRow);

  return { type: 'table', data: { ...(head ? { head } : {}), body } };
}

function imageBlock(token, options) {
  const mediaIds = options.imageMediaIds || {};
  const fromAlt = mediaIds[token.text];
  const fromUrl = mediaIds[token.href];
  const mediaId = (typeof fromAlt === 'number' ? fromAlt : null)
    ?? (typeof fromUrl === 'number' ? fromUrl : null)
    ?? null;

  const data = {};
  if (mediaId != null) data.mediaId = mediaId;
  if (token.text) data.description = token.text;
  if (token.title) data.caption = token.title;
  if (mediaId == null) data._sourceUrl = token.href; // hint for a follow-up upload step
  return { type: 'image', data };
}

// ── Inline conversion ──

function convertInlineTokens(tokens) {
  const out = [];
  for (const token of tokens) {
    const node = convertInlineToken(token);
    if (!node) continue;
    if (Array.isArray(node)) {
      out.push(...node);
    } else {
      out.push(node);
    }
  }
  return out;
}

function convertInlineToken(token) {
  switch (token.type) {
    case 'text':
      if (token.tokens && token.tokens.length) return convertInlineTokens(token.tokens);
      return { type: 'text', value: token.text };

    case 'escape':
      return { type: 'text', value: token.text };

    case 'strong':
      return { type: 'strong', value: convertInlineTokens(token.tokens || []) };

    case 'em':
      return { type: 'emphasis', value: convertInlineTokens(token.tokens || []) };

    case 'del':
      return { type: 'strikethrough', value: convertInlineTokens(token.tokens || []) };

    case 'codespan':
      return { type: 'code', value: [{ type: 'text', value: token.text }] };

    case 'link':
      return {
        type: 'link',
        href: token.href,
        ...(token.title ? { title: token.title } : {}),
        value: convertInlineTokens(token.tokens || []),
      };

    case 'br':
      return { type: 'break' };

    case 'image':
      // An image inside inline content (not a standalone paragraph) is
      // unusual. We still surface it as a `text` node with the alt so
      // content isn't lost; the caller can promote it to an image block
      // afterwards if needed.
      return { type: 'text', value: token.text || '' };

    case 'html':
      // Inline HTML isn't representable as an InlineNode — fall back to
      // plain text so nothing is silently dropped.
      return { type: 'text', value: token.text || '' };

    default:
      return null;
  }
}
