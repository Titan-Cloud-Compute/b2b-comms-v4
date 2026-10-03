import { sanitizeMessageHtml, isBlankHtml } from './message-sanitizer';

describe('sanitizeMessageHtml', () => {
  it('strips <script> tags entirely', () => {
    const out = sanitizeMessageHtml('<script>alert(1)</script><b>hi</b>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('<b>hi</b>');
  });

  it('strips onerror and other event-handler attributes from img', () => {
    const out = sanitizeMessageHtml('<img src="x" onerror="alert(1)">hi');
    expect(out).not.toMatch(/onerror/i);
    expect(out).toContain('hi');
  });

  it('strips javascript: href', () => {
    const out = sanitizeMessageHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it('keeps strong, em, ul, ol, li, a with safe href', () => {
    const html = '<ul><li><strong>bold</strong></li><li><em>italic</em></li></ul><a href="https://example.com">link</a>';
    const out = sanitizeMessageHtml(html);
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>');
    expect(out).toContain('<a href="https://example.com"');
    expect(out).toContain('link</a>');
  });

  it('keeps mention spans with data-mention-user-id', () => {
    const html = '<span class="mention" data-mention-user-id="u1">@Alice</span>';
    const out = sanitizeMessageHtml(html);
    expect(out).toContain('data-mention-user-id="u1"');
    expect(out).toContain('@Alice');
  });

  it('forces rel=noopener noreferrer and target=_blank on all links', () => {
    const out = sanitizeMessageHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('handles unclosed tags without throwing', () => {
    expect(() => sanitizeMessageHtml('<b>unclosed')).not.toThrow();
  });

  it('combined XSS input: no script, no onerror, b tag survives', () => {
    const input = '<script>alert(1)</script><img src=x onerror=alert(1)><b>hi</b>';
    const out = sanitizeMessageHtml(input);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onerror/i);
    expect(out).toContain('<b>hi</b>');
  });
});

describe('isBlankHtml', () => {
  it('returns true for empty string', () => {
    expect(isBlankHtml('')).toBe(true);
  });

  it('returns true for whitespace-only string', () => {
    expect(isBlankHtml('   ')).toBe(true);
  });

  it('returns true for tags with no text', () => {
    expect(isBlankHtml('<p><br></p>')).toBe(true);
  });

  it('returns true for &nbsp; only', () => {
    expect(isBlankHtml('<p>&nbsp;</p>')).toBe(true);
  });

  it('returns false when there is visible text', () => {
    expect(isBlankHtml('<p>hello</p>')).toBe(false);
  });
});
