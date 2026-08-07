import { createHash } from 'node:crypto';

/**
 * Some client sites sit behind SiteGround's "Robot Challenge Screen", a
 * proof-of-work gate that returns HTTP 202 with an `sg-captcha: challenge`
 * header and a tiny meta-refresh page instead of the real content. A real
 * browser solves it by running a bundled script that hashes SHA1(challenge +
 * counter) until the first 32-bit word of the digest has `complexity` leading
 * zero bits, then submits the winning message to get a pass cookie.
 *
 * We replicate that maths here so the page fetcher can read protected pages
 * without a headless browser. It is deliberately self-contained: if the gate
 * ever changes shape, detection simply fails and the fetcher reports the page
 * as unreadable rather than inventing content.
 */

export interface SiteGroundChallenge {
  sgchallenge: string;
  submitUrl: string;
}

/** Pull the challenge parameters out of a SiteGround challenge page's HTML. */
export function parseSiteGroundChallenge(html: string): SiteGroundChallenge | null {
  const challenge = html.match(/const sgchallenge\s*=\s*"([^"]+)"/);
  const submit = html.match(/const sgsubmit_url\s*=\s*"([^"]+)"/);
  if (!challenge || !submit) return null;
  return { sgchallenge: challenge[1]!, submitUrl: submit[1]! };
}

/**
 * Find the URL of the challenge page from a meta-refresh stub, e.g.
 * `<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F&y=...">`.
 */
export function findChallengeRedirect(html: string): string | null {
  const meta = html.match(/http-equiv=["']refresh["'][^>]*content=["']\s*\d+\s*;\s*(?:url=)?([^"']+)["']/i);
  if (meta && /sgcaptcha/i.test(meta[1]!)) return meta[1]!.replace(/&amp;/g, '&').trim();
  return null;
}

function counterBytes(value: number): Buffer {
  let len = 1;
  if (value > 16777215) len = 4;
  else if (value > 65535) len = 3;
  else if (value > 255) len = 2;
  const bytes = Buffer.alloc(len);
  let v = value;
  for (let n = len - 1; n >= 0; n--) {
    bytes[n] = v & 0xff;
    v = v >>> 8;
  }
  return bytes;
}

export interface SolvedChallenge {
  /** Base64 of the winning message, submitted as the `sol` parameter. */
  sol: string;
  /** Number of hashes tried, submitted as part of the `s` parameter. */
  hashes: number;
}

/**
 * Solve a SiteGround proof-of-work challenge. Returns null if no solution is
 * found within `maxHashes` (keeps a runaway gate from blocking a run).
 */
export function solveSiteGroundChallenge(sgchallenge: string, maxHashes = 12_000_000): SolvedChallenge | null {
  const complexity = Number.parseInt(sgchallenge.split(':', 1)[0] ?? '', 10);
  if (!Number.isFinite(complexity) || complexity < 1 || complexity > 32) return null;
  const shift = 32 - complexity;
  const challengeBytes = Buffer.from(sgchallenge, 'utf8');
  let counter = Math.round(Math.random() * 5_000_000);
  for (let hashes = 1; hashes <= maxHashes; hashes++) {
    const message = Buffer.concat([challengeBytes, counterBytes(counter)]);
    const first = createHash('sha1').update(message).digest().readUInt32BE(0);
    if (first >>> shift === 0) {
      return { sol: message.toString('base64'), hashes };
    }
    counter++;
  }
  return null;
}

/** Build the URL that submits a solved challenge for a pass cookie. */
export function buildSolutionUrl(submitUrl: string, base: string, solved: SolvedChallenge, elapsedMs: number): string {
  const sep = submitUrl.indexOf('?') > -1 ? '&' : '?';
  const query = `sol=${encodeURIComponent(solved.sol)}&s=${elapsedMs}:${solved.hashes}`;
  return new URL(submitUrl + sep + query, base).toString();
}
