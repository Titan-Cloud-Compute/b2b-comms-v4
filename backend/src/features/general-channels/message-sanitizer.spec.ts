import { isBlankHtml, sanitizeMessageHtml } from './message-sanitizer';

describe('sanitizeMessageHtml', () => {
  it('keeps bold, italic, lists and links', () => {
    const out = sanitizeMessageHtml(
      '<b>bold</b> <i>it</i><ul><li>one</li></ul><a href="https://example.com">x</a>',
    );
    expect(out).toContain('<b>bold</b>');
    expect(out).toContain('<i>it</i>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('href="https://example.com"');
  });

  it('strips script elements and their content', () => {
    const out = sanitizeMessageHtml('hi<script>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('hi');
  });

  it('strips event-handler attributes and javascript: urls', () => {
    const out = sanitizeMessageHtml(
      '<b onclick="evil()">x</b><img src=x onerror="evil()"><a href="javascript:evil()">y</a>',
    );
    expect(out).not.toMatch(/on\w+=/i);
    expect(out).not.toMatch(/javascript:/i);
  });

  it('tolerates malformed html', () => {
    const out = sanitizeMessageHtml('<b>open <i>nested</b> <scr<script>ipt>x');
    expect(out).not.toMatch(/<script/i);
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeMessageHtml(undefined)).toBe('');
    expect(sanitizeMessageHtml(42)).toBe('');
  });
});

describe('isBlankHtml', () => {
  it('treats whitespace-only markup as blank', () => {
    expect(isBlankHtml('')).toBe(true);
    expect(isBlankHtml('<p> &nbsp; </p><br>')).toBe(true);
  });
  it('treats text as non-blank', () => {
    expect(isBlankHtml('<p>hello</p>')).toBe(false);
  });
});
