import { sanitizeMessageHtml, isBlankHtml } from './message-sanitizer';

describe('sanitizeMessageHtml', () => {
  it('strips <script> tags and their full content', () => {
    const result = sanitizeMessageHtml('<script>alert(1)</script><b>hi</b>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert(1)');
    expect(result).toContain('<b>hi</b>');
  });

  it('strips event-handler attributes (onerror, onclick, etc.)', () => {
    const result = sanitizeMessageHtml('<img src="x" onerror="alert(1)"><b>hi</b>');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('<img');
    expect(result).toContain('<b>hi</b>');
  });

  it('strips <img> entirely — not in the allowlist', () => {
    const result = sanitizeMessageHtml('<img src="x" alt="test">');
    expect(result).not.toContain('<img');
  });

  it('strips javascript: href', () => {
    const result = sanitizeMessageHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });

  it('strips data: href', () => {
    const result = sanitizeMessageHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(result).not.toContain('data:');
  });

  it('preserves allowlisted inline tags', () => {
    const html = '<strong>bold</strong><em>italic</em><u>under</u><s>strike</s>';
    expect(sanitizeMessageHtml(html)).toBe(html);
  });

  it('preserves list tags', () => {
    const html = '<ul><li>a</li><li>b</li></ul>';
    expect(sanitizeMessageHtml(html)).toBe(html);
  });

  it('preserves ordered list tags', () => {
    const html = '<ol><li>one</li></ol>';
    expect(sanitizeMessageHtml(html)).toBe(html);
  });

  it('preserves safe https link with rel and target enforced', () => {
    const result = sanitizeMessageHtml('<a href="https://example.com">link</a>');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });

  it('preserves http and mailto hrefs', () => {
    expect(sanitizeMessageHtml('<a href="http://a.com">a</a>')).toContain('href="http://a.com"');
    expect(sanitizeMessageHtml('<a href="mailto:a@b.com">a</a>')).toContain('href="mailto:a@b.com"');
  });

  it('preserves mention spans with data-mention-user-id and class="mention"', () => {
    const html = '<span data-mention-user-id="user-1" class="mention">@Alice</span>';
    const result = sanitizeMessageHtml(html);
    expect(result).toContain('data-mention-user-id="user-1"');
    expect(result).toContain('class="mention"');
  });

  it('handles the combined XSS payload from the spec', () => {
    const html = '<script>alert(1)</script><img src=x onerror=alert(1)><b>hi</b>';
    const result = sanitizeMessageHtml(html);
    expect(result).not.toContain('<script');
    expect(result).not.toContain('onerror');
    expect(result).toContain('<b>hi</b>');
  });

  it('preserves text outside tags', () => {
    const result = sanitizeMessageHtml('Hello <b>world</b>!');
    expect(result).toBe('Hello <b>world</b>!');
  });

  it('handles unclosed tags gracefully — keeps text', () => {
    const result = sanitizeMessageHtml('<b>bold without close');
    expect(result).toContain('bold without close');
  });

  it('strips unknown tags but keeps their inner text', () => {
    const result = sanitizeMessageHtml('<div>text inside</div>');
    expect(result).not.toContain('<div');
    expect(result).toContain('text inside');
  });
});

describe('isBlankHtml', () => {
  it('returns true for empty string', () => expect(isBlankHtml('')).toBe(true));
  it('returns true for whitespace only', () => expect(isBlankHtml('   ')).toBe(true));
  it('returns true for empty paragraph', () => expect(isBlankHtml('<p></p>')).toBe(true));
  it('returns true for &nbsp; only', () => expect(isBlankHtml('&nbsp;')).toBe(true));
  it('returns true for &nbsp; inside tags', () => expect(isBlankHtml('<p>&nbsp;</p>')).toBe(true));
  it('returns false when there is real text', () => expect(isBlankHtml('<p>hello</p>')).toBe(false));
  it('returns false for bold text', () => expect(isBlankHtml('<strong>hi</strong>')).toBe(false));
});
