import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildSolutionUrl,
  findChallengeRedirect,
  parseSiteGroundChallenge,
  solveSiteGroundChallenge,
} from './challenge';

describe('parseSiteGroundChallenge', () => {
  it('extracts the challenge string and submit URL', () => {
    const html = `<script>const sgchallenge="21:1786122106:5ab055e2:deadbeef:";
const sgsubmit_url="/.well-known/sgcaptcha/?r=%2F";const sgfallback_url="/x";</script>`;
    const parsed = parseSiteGroundChallenge(html);
    expect(parsed).toEqual({
      sgchallenge: '21:1786122106:5ab055e2:deadbeef:',
      submitUrl: '/.well-known/sgcaptcha/?r=%2F',
    });
  });

  it('returns null when the page is not a challenge', () => {
    expect(parseSiteGroundChallenge('<html><body>real page</body></html>')).toBeNull();
  });
});

describe('findChallengeRedirect', () => {
  it('follows the meta refresh to the sgcaptcha page', () => {
    const stub = `<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F&amp;y=ipr:1.2.3.4"></meta>`;
    expect(findChallengeRedirect(stub)).toBe('/.well-known/sgcaptcha/?r=%2F&y=ipr:1.2.3.4');
  });

  it('ignores unrelated refreshes', () => {
    expect(findChallengeRedirect('<meta http-equiv="refresh" content="5;/home">')).toBeNull();
  });
});

describe('solveSiteGroundChallenge', () => {
  it('finds a message whose SHA1 has the required leading zero bits', () => {
    // Use a low complexity so the test is fast and deterministic in effort.
    const challenge = '10:1786122106:5ab055e2:deadbeef:';
    const solved = solveSiteGroundChallenge(challenge, 5_000_000);
    expect(solved).not.toBeNull();
    const message = Buffer.from(solved!.sol, 'base64');
    expect(message.subarray(0, challenge.length).toString('utf8')).toBe(challenge);
    const first = createHash('sha1').update(message).digest().readUInt32BE(0);
    expect(first >>> (32 - 10)).toBe(0);
  });

  it('rejects malformed complexity', () => {
    expect(solveSiteGroundChallenge('notanumber:x:y')).toBeNull();
  });
});

describe('buildSolutionUrl', () => {
  it('appends the solution and timing to the submit URL', () => {
    const url = buildSolutionUrl(
      '/.well-known/sgcaptcha/?r=%2F',
      'https://aag-it.com/',
      { sol: 'AA+/', hashes: 100 },
      250,
    );
    expect(url).toBe('https://aag-it.com/.well-known/sgcaptcha/?r=%2F&sol=AA%2B%2F&s=250:100');
  });
});
