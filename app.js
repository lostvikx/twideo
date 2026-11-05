import {
  formatDuration,
  isAllowedPbsUrl,
  isAllowedTwimgUrl,
  normalizeTweet,
  parseTweetInput,
} from './lib.js';

const API_BASE = 'https://api.fxtwitter.com/2/status/';
const RECENT_KEY = 'twideo.recent.v1';
const RECENT_LIMIT = 5;
const REQUEST_TIMEOUT = 15000;

const form = document.querySelector('#lookup-form');
const input = document.querySelector('#tweet-input');
const clearBtn = document.querySelector('#clear-btn');
const submitBtn = document.querySelector('#submit-btn');
const statusEl = document.querySelector('#status');
const resultsEl = document.querySelector('#results');
const resultsCount = document.querySelector('#results-count');
const postList = document.querySelector('#post-list');
const recentEl = document.querySelector('#recent');
const recentList = document.querySelector('#recent-list');
const clearRecentBtn = document.querySelector('#clear-recent');
const yearEl = document.querySelector('#year');

const postTemplate = document.querySelector('#post-template');
const videoTemplate = document.querySelector('#video-template');
const variantTemplate = document.querySelector('#variant-template');
const recentTemplate = document.querySelector('#recent-template');

let loading = false;
let recent = [];

const PARSE_ERRORS = {
  empty: 'Paste an X or Twitter post link first.',
  tco: 'Short t.co links are not supported. Open the link, then copy the full x.com URL.',
  invalid:
    'That does not look like an X or Twitter post link. Try a full x.com/.../status/... URL or the numeric post ID.',
};

function cloneTemplate(template) {
  return template.content.firstElementChild.cloneNode(true);
}

function xStatusUrl(id) {
  return `https://x.com/i/status/${encodeURIComponent(id)}`;
}

function setLoading(isLoading) {
  loading = isLoading;
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle('is-loading', isLoading);
  submitBtn.setAttribute('aria-busy', String(isLoading));
  submitBtn.querySelector('.btn-label').textContent = isLoading ? 'Looking up…' : 'Get links';
}

function clearStatus() {
  statusEl.className = 'status';
  statusEl.replaceChildren();
  input.removeAttribute('aria-invalid');
}

function showStatus(message) {
  statusEl.className = 'status';
  statusEl.textContent = message;
  input.removeAttribute('aria-invalid');
}

function showError(message, retryId = '') {
  statusEl.className = 'status is-error';
  statusEl.replaceChildren();

  const text = document.createElement('span');
  text.textContent = message;
  statusEl.append(text);

  if (retryId) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'status-action';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => lookup(retryId));
    statusEl.append(retry);
  }
}

function clearResults() {
  postList.replaceChildren();
  resultsCount.textContent = '';
  resultsEl.hidden = true;
}

function scrollToResults() {
  if (resultsEl.hidden) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => {
    resultsEl.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  });
}

async function fetchTweet(id, signal) {
  const response = await fetch(`${API_BASE}${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
    signal,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The response was not JSON. The status code below is still useful.
  }

  const apiCode = Number(payload?.code) || response.status;
  const status = payload?.status || payload?.tweet;

  if (!response.ok || (payload?.code && Number(payload.code) !== 200) || !status) {
    const error = new Error(payload?.message || `Lookup failed with ${response.status}`);
    error.status = apiCode;
    throw error;
  }

  return status;
}

function describeError(error) {
  if (error?.name === 'AbortError') {
    return {
      message: 'The lookup timed out. Check your connection and try again.',
      retry: true,
    };
  }

  if (error?.status === 404) {
    return {
      message:
        'That post was not found. It may have been deleted, made private, or the link may be incomplete.',
      retry: false,
    };
  }

  if (error?.status === 429) {
    return {
      message: 'Too many lookups right now. Wait a minute, then try again.',
      retry: true,
    };
  }

  if (error?.status >= 500) {
    return {
      message: 'The lookup service is having trouble. Try again in a moment.',
      retry: true,
    };
  }

  if (error instanceof TypeError) {
    return {
      message: 'Could not reach the lookup service. Check your connection and try again.',
      retry: true,
    };
  }

  return {
    message: 'Something went wrong while looking up that post. Try again in a moment.',
    retry: true,
  };
}

async function lookup(id) {
  if (loading || !id) return;

  clearStatus();
  clearResults();
  setLoading(true);
  showStatus('Fetching video links…');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const status = await fetchTweet(id, controller.signal);
    const post = normalizeTweet(status, id);

    if (!post.videos.length) {
      showError(
        'No video was found in that post. Make sure the link points to a post with a native video or GIF.',
      );
      return;
    }

    if (!post.videos.some((video) => video.variants.length)) {
      showError(
        'A video was found, but X is not exposing any downloadable MP4 versions for it. Try a different post.',
      );
      return;
    }

    clearStatus();
    renderResults(post);
    showStatus(
      `Found ${post.videos.length} video${post.videos.length === 1 ? '' : 's'} in this post.`,
    );
    addRecent(post);
    scrollToResults();
  } catch (error) {
    const info = describeError(error);
    showError(info.message, info.retry ? id : '');
  } finally {
    clearTimeout(timeout);
    setLoading(false);
  }
}

function renderResults(post) {
  const card = cloneTemplate(postTemplate);
  const displayName = post.author.name || post.author.screenName || 'Unknown author';

  card.querySelector('.author-name').textContent = displayName;

  const handle = card.querySelector('.author-handle');
  if (post.author.screenName) {
    handle.textContent = `@${post.author.screenName}`;
  } else {
    handle.hidden = true;
  }

  const avatar = card.querySelector('.avatar');
  const avatarFallback = card.querySelector('.avatar-fallback');
  avatarFallback.textContent = displayName.trim().charAt(0).toUpperCase() || '?';

  if (isAllowedPbsUrl(post.author.avatarUrl)) {
    avatar.src = post.author.avatarUrl;
    avatar.addEventListener('error', () => {
      avatar.hidden = true;
    });
  } else {
    avatar.hidden = true;
  }

  const postLink = card.querySelector('.post-link');
  postLink.href = xStatusUrl(post.id);

  const postText = card.querySelector('.post-text');
  if (post.text) {
    postText.textContent = post.text;
    postText.title = post.text;
  } else {
    postText.hidden = true;
  }

  const videoList = card.querySelector('.video-list');

  for (const [index, video] of post.videos.entries()) {
    const videoNode = cloneTemplate(videoTemplate);
    const variantCount = video.variants.length;

    videoNode.querySelector('.video-title').textContent =
      post.videos.length > 1
        ? `Video ${index + 1} of ${post.videos.length}`
        : video.type === 'gif'
          ? 'GIF'
          : 'Video';

    videoNode.querySelector('.video-sub').textContent = variantCount
      ? `${variantCount} resolution${variantCount === 1 ? '' : 's'} available`
      : 'No MP4 links available';

    const thumb = videoNode.querySelector('.thumb');
    if (isAllowedPbsUrl(video.thumbnailUrl)) {
      thumb.src = video.thumbnailUrl;
      thumb.alt = post.author.screenName
        ? `Video thumbnail from @${post.author.screenName}`
        : 'Video thumbnail';
      thumb.addEventListener('error', () => {
        thumb.hidden = true;
      });
    } else {
      thumb.hidden = true;
    }

    const duration = videoNode.querySelector('.duration');
    const durationLabel = formatDuration(video.duration);
    if (durationLabel) {
      duration.textContent = durationLabel;
    } else {
      duration.hidden = true;
    }

    const badge = videoNode.querySelector('.media-badge');
    if (video.type === 'gif') {
      badge.textContent = 'GIF';
    } else {
      badge.hidden = true;
    }

    const variantList = videoNode.querySelector('.variant-list');

    if (!variantCount) {
      const empty = document.createElement('p');
      empty.className = 'no-variants';
      empty.textContent = 'No downloadable MP4 was found for this video.';
      variantList.append(empty);
    } else {
      const variants = document.createDocumentFragment();

      for (const [variantIndex, variant] of video.variants.entries()) {
        if (!isAllowedTwimgUrl(variant.url)) continue;

        const variantNode = cloneTemplate(variantTemplate);
        variantNode.href = variant.url;
        variantNode.setAttribute('aria-label', variantAriaLabel(variant));

        variantNode.querySelector('.variant-res').textContent = variant.label;

        const dimensions = variantNode.querySelector('.variant-dims');
        if (variant.dimensions) {
          dimensions.textContent = variant.dimensions;
        } else {
          dimensions.hidden = true;
        }

        const size = variantNode.querySelector('.variant-size');
        if (variant.sizeLabel) {
          size.textContent = variant.sizeLabel;
        } else {
          size.hidden = true;
        }

        const best = variantNode.querySelector('.best-badge');
        best.hidden = !(variantIndex === 0 && variantCount > 1);

        variants.append(variantNode);
      }

      variantList.append(variants);
    }

    videoList.append(videoNode);
  }

  const estimateNote = card.querySelector('.estimate-note');
  estimateNote.hidden = !post.videos.some((video) =>
    video.variants.some((variant) => variant.sizeLabel),
  );

  postList.replaceChildren(card);
  resultsCount.textContent = `${post.videos.length} video${post.videos.length === 1 ? '' : 's'}`;
  resultsEl.hidden = false;
}

function variantAriaLabel(variant) {
  const size = variant.sizeLabel
    ? `, ${variant.sizeLabel.replace('~', 'approximately ')}`
    : '';
  const dimensions = variant.dimensions ? `, ${variant.dimensions}` : '';

  return `${variant.label}${dimensions}${size}. Opens the MP4 on twimg in a new tab.`;
}

function isValidRecent(entry) {
  return Boolean(
    entry &&
      typeof entry === 'object' &&
      /^\d{1,25}$/.test(String(entry.id || '')) &&
      Number.isFinite(Number(entry.videoCount)) &&
      Number(entry.videoCount) > 0,
  );
}

function sanitizeRecent(entry) {
  return {
    id: String(entry.id),
    handle: typeof entry.handle === 'string' ? entry.handle.slice(0, 30) : '',
    name: typeof entry.name === 'string' ? entry.name.slice(0, 80) : '',
    videoCount: Math.floor(Number(entry.videoCount)),
    at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : 0,
  };
}

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    recent = parsed.filter(isValidRecent).map(sanitizeRecent).slice(0, RECENT_LIMIT);
  } catch {
    recent = [];
  }
}

function persistRecent() {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Storage can be unavailable or full. Recent lookups are optional.
  }
}

function addRecent(post) {
  if (!/^\d{1,25}$/.test(post.id)) return;

  const entry = {
    id: post.id,
    handle: post.author.screenName,
    name: post.author.name,
    videoCount: post.videos.length,
    at: Date.now(),
  };

  recent = [entry, ...recent.filter((item) => item.id !== entry.id)].slice(0, RECENT_LIMIT);
  persistRecent();
  renderRecent();
}

function timeAgo(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';

  const difference = Date.now() - timestamp;
  if (difference < 60000) return 'just now';

  const minutes = Math.floor(difference / 60000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return '';
}

function renderRecent() {
  recentEl.hidden = recent.length === 0;

  if (!recent.length) {
    recentList.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const entry of recent) {
    const chip = cloneTemplate(recentTemplate);
    const label = entry.handle ? `@${entry.handle}` : entry.name || 'Post';
    const time = timeAgo(entry.at);

    chip.querySelector('.recent-handle').textContent = label;
    chip.querySelector('.recent-meta').textContent =
      `${entry.videoCount} video${entry.videoCount === 1 ? '' : 's'}${time ? ` · ${time}` : ''}`;
    chip.setAttribute('aria-label', `Look up ${label} again`);

    chip.addEventListener('click', () => {
      if (loading) return;
      input.value = xStatusUrl(entry.id);
      clearStatus();
      lookup(entry.id);
    });

    fragment.append(chip);
  }

  recentList.replaceChildren(fragment);
}

function clearRecent() {
  recent = [];

  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // Ignore unavailable storage.
  }

  renderRecent();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (loading) return;

  const parsed = parseTweetInput(input.value);

  if (parsed.error) {
    clearResults();
    showError(PARSE_ERRORS[parsed.error]);
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }

  input.removeAttribute('aria-invalid');
  await lookup(parsed.id);
}

function handleClear() {
  input.value = '';
  clearStatus();
  input.focus();
}

yearEl.textContent = String(new Date().getFullYear());
loadRecent();
renderRecent();

form.addEventListener('submit', handleSubmit);
clearBtn.addEventListener('click', handleClear);
clearRecentBtn.addEventListener('click', clearRecent);

input.addEventListener('input', () => {
  input.removeAttribute('aria-invalid');
  if (!loading) clearStatus();
});
