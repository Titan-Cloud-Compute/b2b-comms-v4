import { sanitizeMessageHtml, isBlankHtml } from './message-sanitizer';

describe('sanitizeMessageHtml', () => {
  it('strips script tags', () => {
    const result = sanitizeMessageHtml('<script>alert(1)</script><b>ok</b>');
    expect(result).not.toContain('<script');
    expect(result).toContain('<b>ok</b>');
  });

  it('strips onerror attributes', () => {
    const result = sanitizeMessageHtml('<img src=x onerror=alert(1)>');
    expect(result).not.toContain('onerror');
  });

  it('strips javascript: href', () => {
    const result = sanitizeMessageHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });

  it('handles unclosed tags gracefully', () => {
    const result = sanitizeMessageHtml('<b>unclosed');
    expect(result).toContain('unclosed');
  });

  it('keeps strong, em, ul, ol, li, a, span[data-mention-user-id]', () => {
    const html = '<strong>s</strong><em>e</em><ul><li>x</li></ul><ol><li>y</li></ol><a href="https://x.com">link</a><span class="mention" data-mention-user-id="u1">@u</span>';
    const result = sanitizeMessageHtml(html);
    expect(result).toContain('<strong>s</strong>');
    expect(result).toContain('<em>e</em>');
    expect(result).toContain('<ul>');
    expect(result).toContain('<ol>');
    expect(result).toContain('<li>');
    expect(result).toContain('href="https://x.com"');
    expect(result).toContain('data-mention-user-id="u1"');
  });

  it('forces rel and target on a tags', () => {
    const result = sanitizeMessageHtml('<a href="https://example.com">link</a>');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });
});

describe('isBlankHtml', () => {
  it('returns true for empty string', () => {
    expect(isBlankHtml('')).toBe(true);
  });

  it('returns true for whitespace only', () => {
    expect(isBlankHtml('   ')).toBe(true);
  });

  it('returns true for script-only (stripped to blank)', () => {
    expect(isBlankHtml('<script>alert(1)</script>')).toBe(true);
  });

  it('returns false for text content', () => {
    expect(isBlankHtml('<b>hello</b>')).toBe(false);
  });

  it('returns false for mention span', () => {
    expect(isBlankHtml('<span class="mention">@Alice</span>')).toBe(false);
  });
});
