/**
 * HTML sanitizer for user-generated message content.
 * Allows a safe subset of tags and attributes while stripping
 * script injection vectors and any other potentially dangerous content.
 *
 * No external dependencies — pure regex-based processing so Jest
 * can run this file without any ESM transform configuration.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'span',
]);

/**
 * Sanitize an HTML message body.
 * - Strips <script>, <style>, <iframe> blocks (including their content).
 * - Removes all tags not in the allowlist (keeps their text content).
 * - On allowed tags strips all attributes except a safe subset per tag.
 * - Forces safe href schemes (http/https/mailto) and rel/target on <a>.
 * - Allows data-mention-user-id and class="mention" on <span>.
 */
export function sanitizeMessageHtml(html: string): string {
  if (!html) return '';

  // Step 1: Remove entire dangerous block-level elements with their inner content.
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '');

  // Step 2: Rewrite every tag, allowing only the allowlisted set with safe attrs.
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_match, slash, rawTag, attrs) => {
    const tag = rawTag.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      // Strip the tag; text content (outside the tag) is preserved.
      return '';
    }

    // Closing tags need no attributes.
    if (slash) {
      return `</${tag}>`;
    }

    // Build a clean attribute string per tag.
    let cleanAttrs = '';

    if (tag === 'a') {
      const hrefM = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i);
      if (hrefM) {
        const href = (hrefM[1] ?? hrefM[2] ?? hrefM[3] ?? '').trim();
        if (/^(https?:\/\/|mailto:)/i.test(href)) {
          cleanAttrs = ` href="${href}" rel="noopener noreferrer" target="_blank"`;
        }
      }
    } else if (tag === 'span') {
      const mentionM = attrs.match(
        /\bdata-mention-user-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i,
      );
      const classM = attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i);
      const mentionId = mentionM ? (mentionM[1] ?? mentionM[2] ?? mentionM[3] ?? '') : null;
      const cls = classM ? (classM[1] ?? classM[2] ?? classM[3] ?? '') : null;
      if (mentionId) cleanAttrs += ` data-mention-user-id="${mentionId}"`;
      if (cls === 'mention') cleanAttrs += ` class="${cls}"`;
    }
    // All other allowed tags: no attributes permitted.

    return `<${tag}${cleanAttrs}>`;
  });

  return out;
}

/**
 * Returns true when the HTML contains no visible text content after
 * sanitization — i.e. it is whitespace, empty tags, or &nbsp; only.
 */
export function isBlankHtml(html: string): boolean {
  if (!html) return true;
  const sanitized = sanitizeMessageHtml(html);
  const text = sanitized
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return text.length === 0;
}
