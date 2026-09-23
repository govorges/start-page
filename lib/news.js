// AP headlines (via a Google News search limited to apnews.com) and local RSS/Atom feeds.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) start-page';

const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘')
  .replace(/&#8220;/g, '“').replace(/&#8221;/g, '”').replace(/&#8211;/g, '–').replace(/&#8212;/g, '—')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const stripTags = s => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]).trim() : '';
};
const attr = (xml, name, a) => {
  const m = xml.match(new RegExp(`<${name}\\s[^>]*?${a}="([^"]+)"`));
  return m ? decode(m[1]) : '';
};

function itemImage(item) {
  return attr(item, 'media:content', 'url')
    || attr(item, 'media:thumbnail', 'url')
    || (/image/.test(attr(item, 'enclosure', 'type')) ? attr(item, 'enclosure', 'url') : '')
    || (decode(item).match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1]
    || '';
}

class FeedError extends Error {}

async function fetchFeed(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new FeedError('Couldn’t reach this address. Check it and your internet connection.');
  }
  if (res.status === 403 || res.status === 401) throw new FeedError('This site blocks feed readers, so it can’t be added.');
  if (res.status === 404) throw new FeedError('Nothing was found at this address. Check that you copied the whole feed address.');
  if (!res.ok) throw new FeedError(`The site answered with an error (${res.status}). Try again later.`);
  const xml = await res.text();
  const isRss = /<rss[\s>]|<rdf:RDF/i.test(xml), isAtom = /<feed[\s>]/i.test(xml);
  if (!isRss && !isAtom) throw new FeedError('This address is a web page, not an RSS or Atom feed. Look for a “RSS” link on the site, often ending in /feed.');

  const head = xml.split(/<item[\s>]|<entry[\s>]/)[0];
  const channelTitle = stripTags(tag(head, 'title'));
  const items = isRss
    ? [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)].map(m => ({
        title: stripTags(tag(m[1], 'title')),
        link: tag(m[1], 'link') || attr(m[1], 'link', 'href'),
        date: tag(m[1], 'pubDate') || tag(m[1], 'dc:date'),
        source: stripTags(tag(m[1], 'source')) || channelTitle,
        image: itemImage(m[1]),
      }))
    : [...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/g)].map(m => ({
        title: stripTags(tag(m[1], 'title')),
        link: attr(m[1], 'link', 'href'),
        date: tag(m[1], 'updated') || tag(m[1], 'published'),
        source: channelTitle,
        image: itemImage(m[1]),
      }));
  return { title: channelTitle, items: items.filter(i => i.title && /^https?:\/\//.test(i.link)) };
}

const googleNews = q => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

// The AP feed here has no categories, so headlines are tagged by keyword. First match wins.
const CATEGORIES = [
  ['Sports', /\b(nfl|nba|mlb|nhl|wnba|ncaa|soccer|football|baseball|basketball|hockey|tennis|golf|olympic|world cup|playoffs?|championship|coach|quarterback)\b/i],
  ['Business', /\b(stocks?|wall street|markets?|economy|economic|inflation|fed|tariffs?|earnings|ceo|jobs report|unemployment|shares|bank)\b/i],
  ['Science', /\b(nasa|space|astronaut|scientists?|study|researchers?|climate|species|fossil|telescope|asteroid|planet)\b/i],
  ['Health', /\b(health|hospital|vaccine|disease|virus|cancer|fda|drug|medical|doctors?|outbreak|covid|medicaid|medicare)\b/i],
  ['Technology', /\b(ai|artificial intelligence|tech|apple|google|microsoft|meta|openai|chip|software|cyber|hack|internet|tiktok)\b/i],
  ['Entertainment', /\b(film|movie|actor|actress|singer|album|concert|netflix|hollywood|emmys?|oscars?|grammys?|music|celebrity|box office)\b/i],
  ['Politics', /\b(trump|congress|senate|house|republican|democrat|election|white house|governor|supreme court|president|vote|lawmakers?|administration|campaign|gop)\b/i],
];
const categorize = t => (CATEGORIES.find(([, re]) => re.test(t)) || ['World'])[0];

async function ap() {
  const { items } = await fetchFeed(googleNews('site:apnews.com when:1d'));
  return items.slice(0, 8).map(i => {
    const title = i.title.replace(/\s+-\s+AP News$/i, '').replace(/\s+-\s+[^-]+$/, '');
    return { title, link: i.link, date: i.date, category: categorize(title) };
  });
}

async function local(feeds) {
  const results = await Promise.allSettled(feeds.map(f => fetchFeed(f.url).then(r => ({ ...r, name: f.name }))));
  const items = results.flatMap(r => (r.status === 'fulfilled'
    ? r.value.items.slice(0, 6).map(i => ({ ...i, source: r.value.name || i.source,
        title: /news\.google\.com/.test(i.link) ? i.title.replace(/\s+-\s+[^-]+$/, '') : i.title }))
    : []));
  items.sort((a, b) => (new Date(b.date) || 0) - (new Date(a.date) || 0));
  const errors = results.map((r, i) => (r.status === 'rejected' ? { url: feeds[i].url, error: r.reason.message } : null)).filter(Boolean);
  return { items: items.slice(0, 8), errors };
}

async function test(url) {
  if (!/^https?:\/\/[^\s]+$/i.test(url || '')) throw new FeedError('Enter a full web address starting with https://');
  const { title, items } = await fetchFeed(url);
  if (!items.length) throw new FeedError('This feed has no stories right now, so it can’t be checked.');
  return { name: title || new URL(url).hostname, count: items.length, latest: items[0].title, hasImages: items.some(i => i.image) };
}

// Sources known to have working feeds, by US state; everyone also gets a Google News search for their town.
const KNOWN = {
  'New Jersey': [{ name: 'NJ Spotlight News', url: 'https://www.njspotlightnews.org/feed/', desc: 'Nonprofit statewide newsroom · has images' }],
};
function suggestions(location) {
  if (!location) return [];
  const list = [...(KNOWN[location.region] || [])];
  if (location.city) {
    list.push({ name: `Google News: ${location.city}`, url: googleNews(`"${location.city}" ${location.region} when:3d`),
                desc: 'Stories that mention your town, from many outlets · no images' });
  }
  return list;
}

module.exports = { ap, local, test, suggestions, FeedError };
