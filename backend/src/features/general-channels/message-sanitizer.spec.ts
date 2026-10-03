import { sanitizeMessageHtml, isBlankHtml } from './message-sanitizer';

describe('sanitizeMessageHtml', () => {
  it('strips <script> tags and their content', () => {
    const result = sanitizeMessageHtml('<script>alert(1)</script><b>hi</b>');
    expect(result).not.toMatch(/<script/i);
    expect(result).not.toMatch(/alert/);
    expect(result).toContain('<b>hi</b>');
  });

  it('strips onerror and other event-handler attributes', () => {
    const result = sanitizeMessageHtml('<img src="x" onerror="alert(1)"><b>safe</b>');
    expect(result).not.toMatch(/onerror/i);
    expect(result).not.toMatch(/<img/i);
    expect(result).toContain('<b>safe</b>');
  });

  it('strips javascript: href', () => {
    const result = sanitizeMessageHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toMatch(/javascript:/i);
  });

  it('preserves strong, em, ul, ol, li', () => {
    const html = '<strong>bold</strong><em>italic</em><ul><li>item</li></ul>';
    const result = sanitizeMessageHtml(html);
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
    expect(result).toContain('<li>item</li>');
  });

  it('preserves anchor with http href and adds rel/target', () => {
    const result = sanitizeMessageHtml('<a href="https://example.com">link</a>');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });

  it('preserves mention spans with data-mention-user-id', () => {
    const result = sanitizeMessageHtml(
      '<span class="mention" data-mention-user-id="u-1">@alice</span>',
    );
    expect(result).toContain('data-mention-user-id="u-1"');
    expect(result).toContain('class="mention"');
    expect(result).toContain('@alice');
  });

  it('handles the XSS payload from done_when', () => {
    const payload = '<script>alert(1)</script><img src=x onerror=alert(1)><b>hi</b>';
    const result = sanitizeMessageHtml(payload);
    expect(result).not.toMatch(/<script/i);
    expect(result).not.toMatch(/onerror/i);
    expect(result).toContain('<b>hi</b>');
  });

  it('strips unclosed tags safely', () => {
    const result = sanitizeMessageHtml('<b>bold without close');
    expect(result).not.toMatch(/<script/i);
    expect(result).toContain('bold without close');
  });

  it('drops <style> and <iframe>', () => {
    const result = sanitizeMessageHtml('<style>body{display:none}</style><iframe src="evil.html"></iframe>text');
    expect(result).not.toMatch(/<style/i);
    expect(result).not.toMatch(/<iframe/i);
    expect(result).toContain('text');
  });
});

describe('isBlankHtml', () => {
  it('returns true for empty string', () => {
    expect(isBlankHtml('')).toBe(true);
  });

  it('returns true for whitespace only', () => {
    expect(isBlankHtml('   ')).toBe(true);
  });

  it('returns true for tags with no text', () => {
    expect(isBlankHtml('<p><br></p>')).toBe(true);
  });

  it('returns false when there is visible text', () => {
    expect(isBlankHtml('<p>hello</p>')).toBe(false);
  });

  it('returns false for bold text', () => {
    expect(isBlankHtml('<strong>x</strong>')).toBe(false);
  });
});
