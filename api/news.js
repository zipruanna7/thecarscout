// The Car Scout — Automotive News feed (Vercel Serverless Function)
// Place at:  api/news.js   (an "api" folder at the repo root, next to index.html)
// No API key required. The browser calls /api/news?cat=<category> (same-origin); nothing is exposed.
//
// We aggregate the PUBLIC RSS feeds of reputable automotive publications, which carry the real
// headline, publisher, publication date, article image and a real summary. We return ONLY what
// the sources publish — we never fabricate headlines, photos, dates or summaries, and every item
// links back to the original publisher. Edge-cached so the feed refreshes automatically.
// Vercel default Node runtime (18+) has global fetch.

// Reputable automotive sources. Each publishes a public RSS feed with images + summaries.
// (Automotive News / Reuters do not offer a reliable public image RSS, so we surface them via
//  the aggregate where they appear and never invent imagery for them.)
var FEEDS = [
  { src:'Motor1',         url:'https://www.motor1.com/rss/news/all/' },
  { src:'Autoblog',       url:'https://www.autoblog.com/rss.xml' },
  { src:'Car and Driver', url:'https://www.caranddriver.com/rss/all.xml/' },
  { src:'MotorTrend',     url:'https://www.motortrend.com/feed/' },
  { src:'Road & Track',   url:'https://www.roadandtrack.com/rss/all.xml/' },
  { src:'The Drive',      url:'https://www.thedrive.com/feed' },
  { src:'Carscoops',      url:'https://www.carscoops.com/feed/' }
];

// Category keyword filters (matched case-insensitively against title + summary).
// 'all' returns everything. We never relabel: an item only appears under a tab it actually matches.
var CAT_RULES = {
  'all'       : null,
  'new-models': /\b(reveal|unveil|debut|first look|all-new|redesign|refresh|concept|teaser|teased|spied|spy shot|next-gen|introduc|launch)/i,
  'industry'  : /\b(sales|recall|plant|factor|earnings|lawsuit|tariff|uaw|union|merger|acqui|ceo|layoff|production|market share|dealership|supplier|strike|bankrupt|profit|revenue)/i,
  'ev'        : /\b(electric|ev\b|evs\b|battery|charging|charger|plug-?in|phev|bev|kwh|range|hybrid)/i,
  'reviews'   : /\b(review|first drive|road test|tested|driven|comparison|compared|\bvs\.?\b|long-term|we drove)/i
};
var CAT_TITLES = { 'all':'Automotive News','new-models':'New Models','industry':'Industry News','ev':'Electric Vehicles','reviews':'Reviews' };

function decode(s){
  if(!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/&#0?39;/g,"'").replace(/&#x27;/gi,"'").replace(/&#8217;/g,'’').replace(/&#8216;/g,'‘')
    .replace(/&#8230;/g,'…').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}
function tagText(b,n){ var m=new RegExp('<'+n+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+n+'>','i').exec(b); return m?m[1]:''; }
function attrOf(b,n,a){ var m=new RegExp('<'+n+'\\b[^>]*?\\b'+a+'=["\\\']([^"\\\']+)["\\\']','i').exec(b); return m?m[1]:''; }
function imageFrom(b){
  var d=attrOf(b,'media:content','url')||attrOf(b,'media:thumbnail','url')||attrOf(b,'enclosure','url');
  if(d) return d;
  var im=/<img[^>]+src=["']([^"']+)["']/i.exec(tagText(b,'content:encoded')+tagText(b,'description'));
  return im?im[1]:'';
}
function summaryFrom(b, title){
  var raw=decode(tagText(b,'description')) || decode(tagText(b,'summary'));
  if(!raw) return '';
  // drop boilerplate and anything that's just the headline echoed back
  if(/^(read more|continue reading|the post|appeared first)/i.test(raw)) return '';
  if(title && raw.toLowerCase().indexOf(title.toLowerCase())===0 && raw.length < title.length+20) return '';
  if(raw.length < 50) return '';
  if(raw.length > 240){ raw = raw.slice(0,240).replace(/\s+\S*$/,'') + '…'; }
  return raw;
}
function cleanTitle(t, src){
  if(!t) return t;
  // publisher feeds sometimes append " - Publisher" / " | Publisher"
  if(src){ var re=new RegExp('\\s*[\\-|\\|]\\s*'+src.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$','i'); t=t.replace(re,''); }
  return t.trim();
}
function parse(xml, feedSrc){
  var items=[], re=/<item\b[\s\S]*?<\/item>/gi, m;
  while((m=re.exec(xml)) && items.length<25){
    var b=m[0];
    var title=decode(tagText(b,'title'));
    var link=decode(tagText(b,'link'));
    if(!link){ var lm=/<link[^>]*href=["']([^"']+)["']/i.exec(b); if(lm) link=lm[1]; }
    if(!title||!link) continue;
    var src=decode(tagText(b,'source')) || feedSrc || '';
    items.push({
      title: cleanTitle(title, src),
      link: link,
      source: src,
      pubDate: decode(tagText(b,'pubDate'))||decode(tagText(b,'updated'))||decode(tagText(b,'dc:date')),
      image: imageFrom(b),
      summary: summaryFrom(b, title)
    });
  }
  return items;
}
async function fetchFeed(url){
  var ctrl=new AbortController(), t=setTimeout(function(){ctrl.abort();},6000);
  try{
    var r=await fetch(url,{headers:{'User-Agent':'TheCarScout/1.0 (+news aggregator)','Accept':'application/rss+xml, application/xml, text/xml, */*'},signal:ctrl.signal});
    if(!r.ok) return null; return await r.text();
  }catch(e){ return null; } finally{ clearTimeout(t); }
}
function newest(items){ var t=0; items.forEach(function(it){ var d=Date.parse(it.pubDate); if(!isNaN(d)&&d>t) t=d; }); return t?new Date(t).toISOString():''; }
function matchesCat(it, cat){
  var rule=CAT_RULES[cat]; if(!rule) return true;
  return rule.test((it.title||'')+' '+(it.summary||''));
}

module.exports = async function handler(req, res){
  res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=10800');
  res.setHeader('Content-Type','application/json; charset=utf-8');

  var cat = (req.query && req.query.cat) || '';
  if(!cat && req.url){ var qm=/[?&]cat=([^&]+)/.exec(req.url); if(qm) cat=decodeURIComponent(qm[1]); }
  if(!CAT_RULES.hasOwnProperty(cat)) cat='all';

  // Fetch all reputable feeds in parallel, skip any that fail.
  var results = await Promise.all(FEEDS.map(function(f){
    return fetchFeed(f.url).then(function(xml){ return xml ? parse(xml, f.src) : []; });
  }));

  // Merge + de-duplicate by link, keep real items only.
  var seen={}, all=[];
  results.forEach(function(list){ list.forEach(function(it){
    var key=(it.link||'').split('#')[0].split('?')[0];
    if(!key || seen[key]) return; seen[key]=1; all.push(it);
  }); });

  // Newest first.
  all.sort(function(a,b){ var da=Date.parse(a.pubDate)||0, db=Date.parse(b.pubDate)||0; return db-da; });

  // Filter to the requested category.
  var items = all.filter(function(it){ return matchesCat(it, cat); }).slice(0, 18);

  return res.status(200).json({
    ok: items.length>0,
    category: cat,
    title: CAT_TITLES[cat] || 'Automotive News',
    updated: newest(items),
    count: items.length,
    items: items
  });
};

// exported for offline unit testing
module.exports._parse = parse;
module.exports._matchesCat = matchesCat;
module.exports._CAT_RULES = CAT_RULES;
module.exports._FEEDS = FEEDS;
