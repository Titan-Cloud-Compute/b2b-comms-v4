import sanitizeHtml = require('sanitize-html');

/**
 * Rich-text allow-list for channel messages. Anything outside it (script,
 * style, iframe, event-handler attributes, javascript: URLs) is stripped
 * before body_html is stored, so nothing executes for other members.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'p', 'br', 'div', 'span',
    'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['class', 'data-mention', 'data-user-id'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
};

export function sanitizeMessageHtml(input: unknown): string {
  if (typeof input !== 'string') return '';
  return sanitizeHtml(input, OPTIONS).trim();
}

/** True when the sanitized HTML carries no visible text. */
export function isBlankHtml(html: string): boolean {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;|&#160;/g, ' ')
    .trim();
  return text.length === 0;
}
