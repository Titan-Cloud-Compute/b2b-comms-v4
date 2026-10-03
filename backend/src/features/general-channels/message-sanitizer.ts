/**
 * Sanitizes rich-text HTML for safe storage and rendering.
 *
 * Allowed subset:
 *   p, br, strong, b, em, i, u, s, ul, ol, li, a (http/https/mailto only),
 *   blockquote, code, pre, span[class|data-mention-user-id]
 *
 * Everything else — including <script>, <style>, <iframe>, on* attributes —
 * is stripped.
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const sanitizeHtml: (html: string, opts?: Record<string, any>) => string = require('sanitize-html');

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'span',
];

const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ['href', 'rel', 'target'],
  span: ['class', 'data-mention-user-id'],
};

export function sanitizeMessageHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (_tagName: string, attribs: Record<string, string>) => ({
        tagName: 'a',
        attribs: {
          ...attribs,
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    },
  });
}

/**
 * Returns true when the sanitized HTML is visually empty
 * (no text content after stripping all tags and &nbsp; / whitespace).
 */
export function isBlankHtml(html: string): boolean {
  const text = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  });
  return text.replace(/&nbsp;/g, ' ').trim() === '';
}
