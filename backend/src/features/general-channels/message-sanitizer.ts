/**
 * HTML sanitizer for chat messages.
 * Allowlist: formatting tags, lists, links (forced safe attrs), and mention spans.
 * Everything else (script, style, on*, iframe, etc.) is discarded.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sanitizeHtml = require('sanitize-html') as (html: string, options?: Record<string, unknown>) => string;

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'a',
  'blockquote', 'code', 'pre',
  'span',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href'],
  span: ['data-mention-user-id', 'class'],
};

const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];

export function sanitizeMessageHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
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
 * Returns true when the sanitized HTML has no visible text/content and no
 * attachments are referenced. Used to reject empty messages.
 */
export function isBlankHtml(html: string): boolean {
  const sanitized = sanitizeMessageHtml(html);
  // Strip all tags, collapse &nbsp; and whitespace
  const text = sanitized
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return text.length === 0;
}
