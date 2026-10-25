import { readApiBaseUrl, readSupportLinks } from './config';

describe('readApiBaseUrl', () => {
  it('reads the address and drops trailing slashes', () => {
    expect(readApiBaseUrl({ apiBaseUrl: 'https://api.hopready.test/' })).toBe(
      'https://api.hopready.test',
    );
    expect(readApiBaseUrl({ apiBaseUrl: 'http://localhost:8787' })).toBe('http://localhost:8787');
  });

  it.each([
    ['an extra section without an address', {}],
    ['a null address', { apiBaseUrl: null }],
    // Expo's config pipeline turns a null in app.config.ts into an empty object.
    ['the empty object Expo writes for null', { apiBaseUrl: {} }],
    ['an empty string', { apiBaseUrl: '   ' }],
  ])('treats %s as not configured', (_, extra) => {
    expect(readApiBaseUrl(extra)).toBeNull();
  });

  it('refuses an address that is not http(s), and says so in the log', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readApiBaseUrl({ apiBaseUrl: 'localhost:8787' })).toBeNull();
    expect(readApiBaseUrl({ apiBaseUrl: 'ftp://api.hopready.test' })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('readSupportLinks', () => {
  it('reads the https privacy and support pages', () => {
    expect(
      readSupportLinks({
        privacyPolicyUrl: 'https://mehul72.github.io/hopready/privacy/',
        supportUrl: 'https://mehul72.github.io/hopready/support/',
      }),
    ).toEqual({
      privacyPolicyUrl: 'https://mehul72.github.io/hopready/privacy/',
      supportUrl: 'https://mehul72.github.io/hopready/support/',
    });
  });

  it('leaves out a link that is missing or not https, keeping the other', () => {
    expect(
      readSupportLinks({ privacyPolicyUrl: 'http://example.com/privacy', supportUrl: 42 }),
    ).toEqual({ privacyPolicyUrl: null, supportUrl: null });
    expect(readSupportLinks({ supportUrl: 'https://example.com/help' })).toEqual({
      privacyPolicyUrl: null,
      supportUrl: 'https://example.com/help',
    });
  });
});
