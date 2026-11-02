import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDuration,
  formatSize,
  isAllowedPbsUrl,
  isAllowedTwimgUrl,
  normalizeTweet,
  parseDimensionsFromUrl,
  parseTweetInput,
  resolutionLabel,
} from '../lib.js';

test('parseTweetInput accepts canonical and alternate post URLs', () => {
  assert.deepEqual(parseTweetInput('https://x.com/NASA/status/2115476295169814978'), {
    id: '2115476295169814978',
  });
  assert.deepEqual(parseTweetInput('https://twitter.com/i/status/20?s=20'), { id: '20' });
  assert.deepEqual(parseTweetInput('https://mobile.twitter.com/foo/status/123/video/1'), {
    id: '123',
  });
  assert.deepEqual(parseTweetInput('https://m.twitter.com/foo/status/456/'), { id: '456' });
  assert.deepEqual(parseTweetInput('https://x.com/i/web/status/789'), { id: '789' });
  assert.deepEqual(parseTweetInput('x.com/foo/status/321'), { id: '321' });
});

test('parseTweetInput accepts bare IDs and text containing a URL', () => {
  assert.deepEqual(parseTweetInput(' 1234567890 '), { id: '1234567890' });
  assert.deepEqual(
    parseTweetInput('Check this out: https://x.com/foo/status/1234567890?t=abc.'),
    { id: '1234567890' },
  );
  assert.deepEqual(parseTweetInput('look at x.com/foo/status/999'), { id: '999' });
  assert.deepEqual(parseTweetInput('look at mobile.x.com/foo/status/1000'), { id: '1000' });
});

test('parseTweetInput gives useful errors', () => {
  assert.deepEqual(parseTweetInput(''), { error: 'empty' });
  assert.deepEqual(parseTweetInput('   '), { error: 'empty' });
  assert.deepEqual(parseTweetInput('https://t.co/abc'), { error: 'tco' });
  assert.deepEqual(parseTweetInput('look at https://t.co/abc'), { error: 'tco' });
  assert.deepEqual(parseTweetInput('https://example.com/foo'), { error: 'invalid' });
  assert.deepEqual(parseTweetInput('https://x.com.evil.com/foo/status/123'), {
    error: 'invalid',
  });
  assert.deepEqual(parseTweetInput('https://notx.com/foo/status/123'), { error: 'invalid' });
  assert.deepEqual(parseTweetInput('https://x.com/foo/status/not-a-number'), {
    error: 'invalid',
  });
  assert.deepEqual(parseTweetInput('not a link'), { error: 'invalid' });
});

test('URL allowlists only accept exact HTTPS hosts', () => {
  assert.equal(
    isAllowedTwimgUrl('https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/a.mp4'),
    true,
  );
  assert.equal(isAllowedTwimgUrl('http://video.twimg.com/a.mp4'), false);
  assert.equal(isAllowedTwimgUrl('https://video.twimg.com.evil.com/a.mp4'), false);
  assert.equal(isAllowedTwimgUrl('https://evil.com/video.twimg.com/a.mp4'), false);

  assert.equal(isAllowedPbsUrl('https://pbs.twimg.com/profile_images/1/a.jpg'), true);
  assert.equal(isAllowedPbsUrl('http://pbs.twimg.com/a.jpg'), false);
  assert.equal(isAllowedPbsUrl('https://pbs.twimg.com.evil.com/a.jpg'), false);
});

test('parseDimensionsFromUrl reads the twimg resolution segment', () => {
  assert.deepEqual(
    parseDimensionsFromUrl(
      'https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/a.mp4?tag=29',
    ),
    { width: 1280, height: 720 },
  );
  assert.equal(parseDimensionsFromUrl('https://video.twimg.com/a.mp4'), null);
});

const SAMPLE_TWEET = {
  id: '100',
  text: 'A launch video',
  author: {
    name: 'NASA',
    screen_name: 'NASA',
    avatar_url: 'https://pbs.twimg.com/profile_images/1/a.jpg',
  },
  media: {
    videos: [
      {
        id: 'v1',
        type: 'video',
        duration: 77.327,
        width: 1920,
        height: 1080,
        thumbnail_url: 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg',
        formats: [
          {
            url: 'https://video.twimg.com/amplify_video/1/pl/a.m3u8?tag=29',
            container: 'm3u8',
          },
          {
            url: 'https://video.twimg.com/amplify_video/1/vid/avc1/480x270/a.mp4?tag=29',
            bitrate: 256000,
            container: 'mp4',
          },
          {
            url: 'https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/b.mp4?tag=29',
            bitrate: 2176000,
            container: 'mp4',
          },
          {
            url: 'https://video.twimg.com/amplify_video/1/vid/avc1/1280x720/c.mp4?tag=29',
            bitrate: 3000000,
            container: 'mp4',
          },
          {
            url: 'https://video.twimg.com/amplify_video/1/vid/avc1/1920x1080/d.mp4?tag=29',
            bitrate: 10368000,
            container: 'mp4',
          },
        ],
      },
      {
        id: 'v2',
        type: 'gif',
        duration: 7.766,
        width: 1080,
        height: 1350,
        thumbnail_url: 'https://pbs.twimg.com/amplify_video_thumb/2/img/b.jpg',
        formats: [
          {
            url: 'https://video.twimg.com/amplify_video/2/vid/avc1/720x900/e.mp4?tag=29',
            bitrate: 2176000,
            container: 'mp4',
          },
          {
            url: 'https://video.twimg.com/amplify_video/2/vid/avc1/1080x1350/f.mp4?tag=29',
            bitrate: 10368000,
            container: 'mp4',
          },
        ],
      },
    ],
    all: [
      { id: 'v1', type: 'video' },
      { id: 'v2', type: 'gif' },
    ],
  },
};

test('normalizeTweet produces sorted, deduplicated MP4 variants', () => {
  const post = normalizeTweet(SAMPLE_TWEET);

  assert.equal(post.id, '100');
  assert.equal(post.text, 'A launch video');
  assert.equal(post.author.name, 'NASA');
  assert.equal(post.author.screenName, 'NASA');
  assert.equal(post.videos.length, 2);

  const [landscape, portrait] = post.videos;

  assert.equal(landscape.variants.length, 3);
  assert.deepEqual(
    landscape.variants.map((variant) => variant.label),
    ['1080p', '720p', '270p'],
  );
  assert.equal(landscape.variants[0].dimensions, '1920×1080');
  assert.equal(landscape.variants[1].bitrate, 3000000);
  assert.equal(landscape.variants[0].sizeLabel, '~95.6 MB');

  assert.equal(portrait.type, 'gif');
  assert.deepEqual(
    portrait.variants.map((variant) => variant.label),
    ['1080p', '720p'],
  );
  assert.equal(portrait.variants[0].dimensions, '1080×1350');
});

test('normalizeTweet falls back to media.all and a single best URL', () => {
  const post = normalizeTweet(
    {
      id: '200',
      author: { name: 'Test', screen_name: 'test' },
      media: {
        all: [
          {
            id: 'v3',
            type: 'video',
            duration: 10,
            width: 1280,
            height: 720,
            url: 'https://video.twimg.com/amplify_video/3/vid/avc1/1280x720/high.mp4?tag=29',
            formats: [
              {
                url: 'https://video.twimg.com/amplify_video/3/pl/hls.m3u8?tag=29',
                container: 'm3u8',
              },
            ],
          },
        ],
      },
    },
    '200',
  );

  assert.equal(post.videos.length, 1);
  assert.equal(post.videos[0].variants.length, 1);
  assert.equal(post.videos[0].variants[0].label, '720p');
  assert.equal(post.videos[0].variants[0].url.includes('high.mp4'), true);
});

test('normalizeTweet keeps videos with no downloadable MP4 variants', () => {
  const post = normalizeTweet({
    id: '300',
    media: {
      videos: [
        {
          id: 'v4',
          type: 'video',
          duration: 10,
          formats: [
            {
              url: 'https://video.twimg.com/amplify_video/4/pl/hls.m3u8?tag=29',
              container: 'm3u8',
            },
          ],
        },
      ],
    },
  });

  assert.equal(post.videos.length, 1);
  assert.equal(post.videos[0].variants.length, 0);
});

test('normalizeTweet drops untrusted media URLs', () => {
  const post = normalizeTweet({
    id: '400',
    media: {
      videos: [
        {
          id: 'v5',
          type: 'video',
          duration: 10,
          formats: [
            { url: 'https://evil.com/a.mp4', bitrate: 1000, container: 'mp4' },
            { url: 'https://video.twimg.com/a.mp4', bitrate: 1000, container: 'm3u8' },
          ],
          url: 'https://evil.com/b.mp4',
        },
      ],
    },
  });

  assert.equal(post.videos[0].variants.length, 0);
});

test('formatting helpers handle normal and edge values', () => {
  assert.equal(formatSize(100215792), '~95.6 MB');
  assert.equal(formatSize(1024 * 1024 * 1024), '~1.00 GB');
  assert.equal(formatSize(0), '');
  assert.equal(formatSize(null), '');

  assert.equal(formatDuration(77.327), '1:17');
  assert.equal(formatDuration(7.766), '0:08');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(0), '');

  assert.equal(resolutionLabel(2160), '4K');
  assert.equal(resolutionLabel(1080), '1080p');
  assert.equal(resolutionLabel(720), '720p');
  assert.equal(resolutionLabel(270), '270p');
  assert.equal(resolutionLabel(0), 'MP4');
});
