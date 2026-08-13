const TIMEOUT = 15000;

export async function steamStoreArtworkCandidates(appid) {
  if (!Number.isFinite(Number(appid))) return [];
  try {
    const response = await fetch(`https://store.steampowered.com/app/${Number(appid)}/?cc=us&l=english`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {
        'user-agent': 'Mozilla/5.0 IgropoiskReleaseArtwork/1.0',
        'accept-language': 'en-US,en;q=0.9'
      }
    });
    if (!response.ok) return [];
    const html = await response.text();
    const urls = [];
    for (const match of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)) urls.push(match[1]);
    for (const match of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/gi)) urls.push(match[1]);
    return [...new Set(urls.map(url => String(url).replace(/&amp;/g, '&').trim()).filter(Boolean))];
  } catch {
    return [];
  }
}
