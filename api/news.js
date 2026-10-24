// The Car Scout — live automotive news (Vercel Serverless Function)
// Place this file at:  api/news.js  (in an "api" folder at the repo root, next to index.html)
// No API key required. The browser calls /api/news (same-origin), so nothing is exposed.
// Vercel caches the response at the edge (Cache-Control below) so it refreshes automatically
// without hammering the source. Runs on Vercel's default Node runtime (18+), which has fetch.

var FEEDS = [
  'https://www.motor1.com/rss/news/all/',
  'https://www.autoblog.com/rss.xml',
  'https://www.carscoops.com/feed/',
  'https://news.google.com/rss/search?q=automotive%20industry%20when:7d&hl=en-US&gl=US&ceid=US:en'
];

function decode(s){
  if(!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&#x27;/gi,"'")
    .replace(/&#8217;/g,'’').replace(/&#8216;/g,'‘').replace(/&nbsp;/g,' ')
    .replace(/\s+/g,' ').trim();
}
function tagText(block, name){
  var m = new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>', 'i').exec(block);
  return m ? m[1] : '';
}
function attrOf(block, name, at){
  var m = new RegExp('<'+name+'\\b[^>]*?\\b'+at+'=["\\\']([^"\\\']+)["\\\']', 'i').exec(block);
  return m ? m[1] : '';
}
function imageFrom(block){
  var direct = attrOf(block,'media:content','url') || attrOf(block,'media:thumbnail','url') || attrOf(block,'enclosure','url');
  if (direct) return direct;
  var html = tagText(block,'content:encoded') + tagText(block,'description');
  var im = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return im ? im[1] : '';
}
function parse(xml){
  var items = [], re = /<item\b[\s\S]*?<\/item>/gi, m;
  while ((m = re.exec(xml)) && items.length < 12){
    var b = m[0];
    var title = decode(tagText(b,'title'));
    var link = decode(tagText(b,'link'));
    if (!link){ var lm = /<link[^>]*href=["']([^"']+)["']/i.exec(b); if (lm) link = lm[1]; } // Atom
    if (!title || !link) continue;
    items.push({
      title: title,
      link: link,
      pubDate: decode(tagText(b,'pubDate')) || decode(tagText(b,'updated')) || decode(tagText(b,'dc:date')),
      image: imageFrom(b),
      source: decode(tagText(b,'source'))
    });
  }
  return items;
}
async function fetchFeed(url){
  var ctrl = new AbortController();
  var t = setTimeout(function(){ ctrl.abort(); }, 8000);
  try{
    var r = await fetch(url, { headers:{ 'User-Agent':'TheCarScout/1.0 (+https://thecarscout.app)', 'Accept':'application/rss+xml, application/xml, text/xml, */*' }, signal: ctrl.signal });
    if(!r.ok) return null;
    return await r.text();
  } catch(e){ return null; }
  finally { clearTimeout(t); }
}

module.exports = async function handler(req, res){
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (var i=0; i<FEEDS.length; i++){
    var xml = await fetchFeed(FEEDS[i]);
    if (!xml) continue;
    var items = parse(xml);
    if (items.length){
      var ct = decode((/<channel[\s\S]*?<title>([\s\S]*?)<\/title>/i.exec(xml) || [])[1] || '');
      res.status(200).json({ ok:true, source: ct || FEEDS[i], items: items });
      return;
    }
  }
  res.status(200).json({ ok:false, items: [] });
};
module.exports._parse = parse; // for local testing only
