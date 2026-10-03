/**
 * HTML sanitizer for message bodies.
 * Keeps a safe subset of formatting tags; strips all scripts, event handlers,
 * and any other potentially dangerous content.
 */
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'span',
];

const ALLOWED_ATTR: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'rel', 'target'],
  span: ['class', 'data-mention-user-id'],
};

const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];

export function sanitizeMessageHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTR,
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: {},
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (_tagName, attribs) => ({
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
 * Returns true if the HTML is effectively blank after sanitization —
 * i.e. contains no visible text or media.
 */
export function isBlankHtml(html: string): boolean {
  const sanitized = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  // Remove &nbsp; entities and whitespace
  const text = sanitized
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, '');
  return text.length === 0;
}
