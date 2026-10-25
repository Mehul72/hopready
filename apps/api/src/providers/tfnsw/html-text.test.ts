import { describe, expect, it } from 'vitest';

import { htmlToText } from './html-text';

describe('htmlToText', () => {
  it('removes tags and keeps paragraph and line breaks as new lines', () => {
    expect(
      htmlToText('<p>Lift 3 is <strong>out of service</strong>.</p><p>Ask staff.<br/>Thanks</p>'),
    ).toBe('Lift 3 is out of service.\nAsk staff.\nThanks');
  });

  it('decodes named, decimal and hexadecimal entities', () => {
    expect(htmlToText('Platforms 1 &amp; 2 &lt;north&gt; &quot;A&quot; &#39;B&#x27;')).toBe(
      'Platforms 1 & 2 <north> "A" \'B\'',
    );
  });

  it('turns non-breaking spaces and runs of spaces into single spaces', () => {
    expect(htmlToText('  every&nbsp;10 \t minutes  ')).toBe('every 10 minutes');
  });

  it('keeps entities it does not know, including ones named after object properties', () => {
    expect(htmlToText('&constructor; &toString; &unknown;')).toBe(
      '&constructor; &toString; &unknown;',
    );
  });

  it('keeps numeric entities that are not real characters', () => {
    expect(htmlToText('&#0; &#xD800; &#x110000;')).toBe('&#0; &#xD800; &#x110000;');
  });

  it('decodes an entity once, so escaped markup stays text', () => {
    expect(htmlToText('&amp;lt;b&amp;gt; and &lt;i&gt;')).toBe('&lt;b&gt; and <i>');
  });
});
