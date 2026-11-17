import { describe, expect, it } from 'vitest';
import { challengeFor, handoffCode } from '../../src/platform/appSignIn';
import { appName } from '../../src/platform/platform';

const CODE = 'a'.repeat(64);

describe('app sign-in handoff', () => {
  it('reads the one-time code only from an astir://auth link', () => {
    expect(handoffCode(`astir://auth?code=${CODE}`)).toBe(CODE);
    expect(handoffCode(`astir://auth/?code=${CODE}`)).toBe(CODE);
    expect(handoffCode(`astir://other?code=${CODE}`)).toBeNull();
    expect(handoffCode(`https://auth/?code=${CODE}`)).toBeNull();
    expect(handoffCode('astir://auth?code=short')).toBeNull();
    expect(handoffCode('astir://auth')).toBeNull();
    expect(handoffCode('not a link')).toBeNull();
  });

  it('makes the RFC 7636 S256 challenge, as the server checks it', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    // RFC 7636, appendix B.
    expect(await challengeFor(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('names the app for the devices list', () => {
    expect(appName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/140')).toBe('Astir for Windows');
    expect(appName('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('Astir for Mac');
    expect(appName('')).toBe('Astir app');
  });
});
