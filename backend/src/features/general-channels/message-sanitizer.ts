/**
 * HTML sanitizer for message bodies.
 *
 * Allowed tags: p, br, strong, b, em, i, u, s, ul, ol, li, a, blockquote,
 *               code, pre, span (only when it carries the data-mention-user-id
 *               attribute or the "mention" class).
 *
 * Everything else — script, style, iframe, on* attributes, javascript: hrefs
 * — is stripped.
 */
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'span',
];

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'rel', 'target'],
    span: ['class', 'data-mention-user-id'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {},
  disallowedTagsMode: 'discard',
  // Force safe link attributes.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    }),
  },
};

/** Sanitize raw HTML input, removing all unsafe tags and attributes. */
export function sanitizeMessageHtml(html: string): string {
  return sanitizeHtml(html, sanitizeOptions);
}

/**
 * Returns true when the sanitized content is effectively blank —
 * all tags removed, &nbsp; and whitespace stripped.
 */
export function isBlankHtml(html: string): boolean {
  const sanitized = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  const text = sanitized
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, '');
  return text.length === 0;
}
