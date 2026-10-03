import { sanitizeMessageHtml, isBlankHtml } from './message-sanitizer';

describe('sanitizeMessageHtml', () => {
  it('strips script tags', () => {
    const out = sanitizeMessageHtml('<script>alert(1)</script><b>hi</b>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<b>hi</b>');
  });

  it('strips onerror attributes', () => {
    const out = sanitizeMessageHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain('onerror');
  });

  it('strips javascript: hrefs', () => {
    const out = sanitizeMessageHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
  });

  it('keeps strong, em, ul, li, a, mention spans', () => {
    const html = '<strong>bold</strong><em>italic</em><ul><li>item</li></ul>' +
      '<a href="https://example.com">link</a>' +
      '<span class="mention" data-mention-user-id="u1">@User</span>';
    const out = sanitizeMessageHtml(html);
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>item</li>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('data-mention-user-id="u1"');
  });

  it('adds rel and target to anchor tags', () => {
    const out = sanitizeMessageHtml('<a href="https://example.com">link</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });
});

describe('isBlankHtml', () => {
  it('returns true for empty string', () => {
    expect(isBlankHtml('')).toBe(true);
  });

  it('returns true for whitespace-only', () => {
    expect(isBlankHtml('   ')).toBe(true);
  });

  it('returns true for tags with no text', () => {
    expect(isBlankHtml('<p><br></p>')).toBe(true);
  });

  it('returns true for &nbsp; only', () => {
    expect(isBlankHtml('&nbsp;')).toBe(true);
  });

  it('returns false when there is text content', () => {
    expect(isBlankHtml('<p>hello</p>')).toBe(false);
  });
});
