export function parseMedia(input) {
  if (!input || typeof input !== 'string') return { error: 'Paste a link first.' };
  const raw = input.trim();
  if (raw.length > 2000) return { error: 'That link is too long.' };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'Enter a full link, including https://' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Only http and https links work.' };
  }

  const href = url.toString();
  const netflix = href.match(/netflix\.com\/(?:watch|title)\/(\d+)/i);
  if (netflix) {
    return {
      media: {
        kind: 'link',
        url: `https://www.netflix.com/title/${netflix[1]}`,
        youtubeId: ''
      }
    };
  }
  const youtube = href.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (youtube) {
    return { media: { kind: 'youtube', url: href, youtubeId: youtube[1] } };
  }
  if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(href)) {
    return { media: { kind: 'file', url: href, youtubeId: '' } };
  }
  return { media: { kind: 'link', url: href, youtubeId: '' } };
}
