const X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'm.twitter.com',
]);

const TCO_HOSTS = new Set(['t.co', 'www.t.co']);
const STATUS_PATH = /\/(?:status|statuses)\/(\d{1,25})(?:\/|$)/;
const URL_LIKE =
  /(?:^|[^\w.-])((?:https?:\/\/)?(?:www\.|mobile\.|m\.)?(?:x\.com|twitter\.com|t\.co)\/[^\s<>"']+)/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * Extract a tweet ID from raw user input.
 *
 * Accepts full X/Twitter URLs, URLs without a scheme, bare numeric IDs, and
 * text containing an X/Twitter URL. Returns `{ id }` or `{ error }` where
 * error is one of "empty", "tco", or "invalid".
 */
export function parseTweetInput(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { error: 'empty' };

  if (/^\d{1,25}$/.test(value)) return { id: value };

  const candidates = [...value.matchAll(URL_LIKE)].map((match) => match[1]);
  let sawTco = false;

  for (const candidate of candidates) {
    const parsed = parseUrlCandidate(candidate.replace(TRAILING_PUNCTUATION, ''));
    if (parsed.id) return parsed;
    if (parsed.error === 'tco') sawTco = true;
  }

  return { error: sawTco ? 'tco' : 'invalid' };
}

function parseUrlCandidate(candidate) {
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    return { error: 'invalid' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'invalid' };
  }

  const host = url.hostname.toLowerCase();
  if (TCO_HOSTS.has(host)) return { error: 'tco' };
  if (!X_HOSTS.has(host)) return { error: 'invalid' };

  const match = url.pathname.match(STATUS_PATH);
  if (!match) return { error: 'invalid' };

  return { id: match[1] };
}

export function isAllowedTwimgUrl(value) {
  return isHttpsHost(value, 'video.twimg.com');
}

export function isAllowedPbsUrl(value) {
  return isHttpsHost(value, 'pbs.twimg.com');
}

function isHttpsHost(value, host) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === host;
  } catch {
    return false;
  }
}

export function parseDimensionsFromUrl(value) {
  try {
    const path = new URL(value).pathname;
    const match = path.match(/\/(\d{2,5})x(\d{2,5})\//);
    if (!match) return null;

    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }

    return { width, height };
  } catch {
    return null;
  }
}

/**
 * Convert an API status object into the small shape the UI needs.
 * Pure and defensive: everything read from the API is normalized or dropped.
 */
export function normalizeTweet(status, fallbackId = '') {
  const author = status?.author || {};
  const fromVideos = Array.isArray(status?.media?.videos) ? status.media.videos : [];
  const fromAll = Array.isArray(status?.media?.all)
    ? status.media.all.filter((item) => item && (item.type === 'video' || item.type === 'gif'))
    : [];

  const rawVideos = [...fromVideos];
  for (const video of fromAll) {
    const duplicate = rawVideos.some(
      (item) => item && video && item.id && video.id && String(item.id) === String(video.id),
    );
    if (!duplicate) rawVideos.push(video);
  }

  return {
    id: String(status?.id || fallbackId || ''),
    text: String(status?.text || status?.raw_text?.text || '').trim(),
    author: {
      name: String(author.name || '').trim(),
      screenName: String(author.screen_name || '').trim(),
      avatarUrl: String(author.avatar_url || '').trim(),
    },
    videos: rawVideos.map(normalizeVideo).filter(Boolean),
  };
}

function normalizeVideo(video) {
  if (!video) return null;

  const rawDuration = Number(video.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
  const fallbackDimensions = normalizeDimensions(video.width, video.height);

  return {
    id: String(video.id || ''),
    type: video.type === 'gif' ? 'gif' : 'video',
    duration,
    thumbnailUrl: String(video.thumbnail_url || '').trim(),
    width: fallbackDimensions?.width || 0,
    height: fallbackDimensions?.height || 0,
    variants: buildVariants(video, duration, fallbackDimensions),
  };
}

function normalizeDimensions(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}

function buildVariants(video, duration, fallbackDimensions) {
  const formats = getFormatCandidates(video).filter(
    (format) =>
      isMp4Container(format.container) &&
      isAllowedTwimgUrl(format.url) &&
      !/\.m3u8(\?|$)/i.test(format.url),
  );

  const byDimensions = new Map();

  for (const format of formats) {
    const variant = buildVariant(format, duration, fallbackDimensions);
    const key = variant.dimensions || `url:${variant.url}`;
    const existing = byDimensions.get(key);

    if (!existing || (variant.bitrate || 0) > (existing.bitrate || 0)) {
      byDimensions.set(key, variant);
    }
  }

  let variants = [...byDimensions.values()];

  // Fallback for responses that only expose the best MP4 URL.
  if (!variants.length && isAllowedTwimgUrl(video.url) && !/\.m3u8(\?|$)/i.test(video.url)) {
    variants = [buildVariant({ url: video.url, bitrate: null }, duration, fallbackDimensions)];
  }

  variants.sort(
    (a, b) => b.shortSide - a.shortSide || (b.bitrate || 0) - (a.bitrate || 0),
  );

  return variants;
}

function getFormatCandidates(video) {
  if (Array.isArray(video.formats) && video.formats.length) {
    return video.formats.map((format) => ({
      url: String(format?.url || ''),
      bitrate: format?.bitrate,
      container: String(format?.container || ''),
    }));
  }

  if (Array.isArray(video.variants) && video.variants.length) {
    return video.variants.map((variant) => ({
      url: String(variant?.url || ''),
      bitrate: variant?.bitrate,
      container: String(variant?.content_type || ''),
    }));
  }

  if (video.url) {
    return [{ url: String(video.url), bitrate: null, container: 'mp4' }];
  }

  return [];
}

function buildVariant(format, duration, fallbackDimensions) {
  const dimensions = parseDimensionsFromUrl(format.url) || fallbackDimensions;
  const width = dimensions?.width || 0;
  const height = dimensions?.height || 0;
  const shortSide = width && height ? Math.min(width, height) : 0;

  const rawBitrate = Number(format.bitrate);
  const bitrate = Number.isFinite(rawBitrate) && rawBitrate > 0 ? rawBitrate : 0;
  const sizeBytes = bitrate && duration > 0 ? (bitrate * duration) / 8 : 0;

  return {
    url: format.url,
    width,
    height,
    shortSide,
    label: resolutionLabel(shortSide),
    dimensions: width && height ? `${width}×${height}` : '',
    bitrate: bitrate || null,
    sizeBytes: sizeBytes || null,
    sizeLabel: formatSize(sizeBytes),
  };
}

function isMp4Container(container) {
  const value = String(container || '').toLowerCase();
  return value === 'mp4' || value.includes('mp4');
}

export function resolutionLabel(shortSide) {
  const value = Number(shortSide);
  if (!Number.isFinite(value) || value <= 0) return 'MP4';
  if (value >= 2000) return '4K';
  if (value >= 1400) return '1440p';
  if (value >= 1000) return '1080p';
  if (value >= 700) return '720p';
  if (value >= 450) return '480p';
  if (value >= 350) return '360p';
  if (value >= 250) return '270p';
  if (value >= 230) return '240p';
  return `${Math.round(value)}p`;
}

export function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';

  const megabytes = value / (1024 * 1024);
  if (megabytes >= 1024) return `~${(megabytes / 1024).toFixed(2)} GB`;
  if (megabytes >= 100) return `~${Math.round(megabytes)} MB`;
  return `~${megabytes.toFixed(1)} MB`;
}

export function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '';

  const total = Math.round(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}
