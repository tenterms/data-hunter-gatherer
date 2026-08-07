import * as cheerio from 'cheerio';
import type { PageContentRow } from '../types';
import { proxyAwareFetch } from './httpClient';
import {
  buildSolutionUrl,
  findChallengeRedirect,
  parseSiteGroundChallenge,
  solveSiteGroundChallenge,
} from './challenge';

// Present as a mainstream desktop browser. Some hosts serve a bot-challenge
// page (or nothing) to non-browser agents, which left us reading empty pages.
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
};

// Pass cookies earned by solving a site's bot challenge, kept per host so we
// solve once and reuse it for every other page fetched from the same site.
const passCookies = new Map<string, string>();

function hostKey(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function headersFor(url: string): Record<string, string> {
  const cookie = passCookies.get(hostKey(url));
  return cookie ? { ...BROWSER_HEADERS, Cookie: cookie } : { ...BROWSER_HEADERS };
}

function looksLikeChallenge(status: number, sgCaptcha: string | null, body: string): boolean {
  if (sgCaptcha === 'challenge') return true;
  if ((status === 202 || status === 403 || status === 503) && /sgcaptcha|sgchallenge/i.test(body)) return true;
  return false;
}

/**
 * Solve a site's proof-of-work bot challenge and return the pass cookie, or
 * null if it cannot be solved. The cookie is cached per host by the caller.
 */
async function solveChallenge(
  url: string,
  challengeBody: string,
  timeoutMs: number,
  log?: (m: string) => void,
): Promise<string | null> {
  // The first response is usually a stub that meta-refreshes to the real
  // challenge page; follow it once. If the challenge is inline, use it directly.
  let challengeHtml = challengeBody;
  if (!parseSiteGroundChallenge(challengeHtml)) {
    const redirect = findChallengeRedirect(challengeBody);
    if (!redirect) return null;
    const challengeUrl = new URL(redirect, url).toString();
    const res = await proxyAwareFetch(challengeUrl, {
      headers: { ...headersFor(url), Referer: url },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    challengeHtml = await res.text();
  }

  const challenge = parseSiteGroundChallenge(challengeHtml);
  if (!challenge) return null;

  const startedAt = Date.now();
  const solved = solveSiteGroundChallenge(challenge.sgchallenge);
  if (!solved) {
    log?.(`Could not solve bot challenge for ${hostKey(url)} within the hash budget.`);
    return null;
  }
  const elapsedMs = Date.now() - startedAt;

  const solutionUrl = buildSolutionUrl(challenge.submitUrl, url, solved, elapsedMs);
  const submitRes = await proxyAwareFetch(solutionUrl, {
    headers: { ...headersFor(url), Referer: url },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const setCookies = submitRes.headers.getSetCookie?.() ?? [];
  const cookie = setCookies
    .map((c) => c.split(';')[0])
    .filter((c) => c && !/=;?$/.test(c) && !/=\s*$/.test(c))
    .join('; ');
  if (!cookie) {
    log?.(`Solved bot challenge for ${hostKey(url)} but no pass cookie was issued.`);
    return null;
  }
  log?.(`Cleared bot challenge for ${hostKey(url)} in ${solved.hashes} hashes (${elapsedMs}ms).`);
  return cookie;
}

/** Fetch a live page and extract the structured content used for analysis. */
export async function fetchPageContent(
  url: string,
  timeoutMs = 20000,
  log?: (m: string) => void,
): Promise<PageContentRow> {
  const lastFetched = new Date().toISOString();
  try {
    let res = await proxyAwareFetch(url, {
      headers: headersFor(url),
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    let html = await res.text();

    if (looksLikeChallenge(res.status, res.headers.get('sg-captcha'), html)) {
      const cookie = await solveChallenge(url, html, timeoutMs, log);
      if (cookie) {
        passCookies.set(hostKey(url), cookie);
        res = await proxyAwareFetch(url, {
          headers: headersFor(url),
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        html = await res.text();
      }
    }

    // Only trust a body that actually came back as a real page. A challenge
    // stub or an error page must not be parsed into content, or the analysis
    // downstream will treat missing content as genuine gaps.
    const usable = res.ok && !looksLikeChallenge(res.status, res.headers.get('sg-captcha'), html);
    const parsed = parseHtml(usable ? html : '');
    return { url, httpStatus: res.status, lastFetched, ...parsed };
  } catch (err) {
    return {
      url,
      httpStatus: 0,
      canonicalUrl: '',
      titleTag: '',
      metaDescription: '',
      h1: '',
      h2s: [],
      bodyText: `FETCH ERROR: ${(err as Error).message}`,
      wordCount: 0,
      lastFetched,
    };
  }
}

export function parseHtml(html: string): Omit<PageContentRow, 'url' | 'httpStatus' | 'lastFetched'> {
  if (!html) {
    return {
      canonicalUrl: '',
      titleTag: '',
      metaDescription: '',
      h1: '',
      h2s: [],
      bodyText: '',
      wordCount: 0,
    };
  }
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe').remove();

  const titleTag = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? '';
  const canonicalUrl = $('link[rel="canonical"]').attr('href')?.trim() ?? '';
  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const h2s = $('h2')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean);

  // Prefer main content containers; fall back to body.
  const mainEl = $('main, article, [role="main"]').first();
  const container = mainEl.length ? mainEl : $('body');
  container.find('nav, header, footer, aside').remove();
  const bodyText = container.text().replace(/\s+/g, ' ').trim();

  return {
    canonicalUrl,
    titleTag,
    metaDescription,
    h1,
    h2s,
    bodyText,
    wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
  };
}
