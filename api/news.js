// The Car Scout — Automotive Rankings & Buying Guide feed (Vercel Serverless Function)
// Place at:  api/news.js  (an "api" folder at the repo root, next to index.html)
// No API key required. The browser calls /api/news?cat=<key> (same-origin); nothing is exposed.
// Each category runs a metric-correct query against Google News (reliable, links to the original
// source). We surface real, dated, published rankings/research — we never fabricate figures.
// Edge-cached so it refreshes automatically. Vercel default Node runtime (18+) has fetch.

var YEAR = 2026;

// metric: 'fastest' = days-to-sell, 'best' = sales volume, 'reliable' = reliability studies
var CATS = {
  'fastest-cars'   : { group:'General', metric:'fastest',  title:'Fastest-Selling Cars',           q:'fastest selling cars '+YEAR+' days to sell iseecars' },
  'reliable-cars'  : { group:'General', metric:'reliable', title:'Most Reliable Cars of '+YEAR,     q:'most reliable cars '+YEAR+' consumer reports jd power reliability' },
  'best-small'     : { group:'General', metric:'best',     title:'Best-Selling Small Cars',         q:'best selling compact small cars '+YEAR+' sales numbers' },
  'best-midsize'   : { group:'General', metric:'best',     title:'Best-Selling Midsize Cars',       q:'best selling midsize sedans '+YEAR+' sales numbers' },
  'best-midsuv'    : { group:'General', metric:'best',     title:'Best-Selling Midsize SUVs',       q:'best selling midsize suvs '+YEAR+' sales numbers' },
  'best-fullsuv'   : { group:'General', metric:'best',     title:'Best-Selling Full-Size SUVs',     q:'best selling full-size large suvs '+YEAR+' sales numbers' },
  'best-smalltruck': { group:'General', metric:'best',     title:'Best-Selling Small/Midsize Trucks', q:'best selling midsize pickup trucks '+YEAR+' sales numbers' },
  'best-fulltruck' : { group:'General', metric:'best',     title:'Best-Selling Full-Size Trucks',   q:'best selling full-size pickup trucks '+YEAR+' sales numbers' },
  'lux-fastest'    : { group:'Luxury',  metric:'fastest',  title:'Fastest-Selling Luxury Cars',     q:'fastest selling luxury cars '+YEAR+' days to sell' },
  'lux-reliable'   : { group:'Luxury',  metric:'reliable', title:'Most Reliable Luxury Cars of '+YEAR, q:'most reliable luxury cars '+YEAR+' reliability study' },
  'lux-small'      : { group:'Luxury',  metric:'best',     title:'Best-Selling Luxury Small Cars',  q:'best selling luxury compact cars '+YEAR+' sales' },
  'lux-midsize'    : { group:'Luxury',  metric:'best',     title:'Best-Selling Luxury Midsize Cars',q:'best selling luxury midsize sedans '+YEAR+' sales' },
  'lux-midsuv'     : { group:'Luxury',  metric:'best',     title:'Best-Selling Luxury Midsize SUVs',q:'best selling luxury midsize suvs '+YEAR+' sales' },
  'lux-fullsuv'    : { group:'Luxury',  metric:'best',     title:'Best-Selling Luxury Full-Size SUVs', q:'best selling luxury full-size suvs '+YEAR+' sales' },
  'lux-smalltruck' : { group:'Luxury',  metric:'best',     title:'Best-Selling Luxury Small/Midsize Trucks', q:'best selling luxury midsize pickup trucks '+YEAR+' sales' },
  'lux-fulltruck'  : { group:'Luxury',  metric:'best',     title:'Best-Selling Luxury Full-Size Trucks', q:'best selling luxury full-size pickup trucks '+YEAR+' sales' }
};
function gnews(q){ return 'https://news.google.com/rss/search?q='+encodeURIComponent(q)+'&hl=en-US&gl=US&ceid=US:en'; }
var GENERAL_FEEDS = ['https://www.motor1.com/rss/news/all/','https://www.autoblog.com/rss.xml', gnews('new car releases recalls '+YEAR)];

function decode(s){
  if(!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
    .replace(/&#0?39;/g,"'").replace(/&#x27;/gi,"'").replace(/&#8217;/g,'’').replace(/&#8216;/g,'‘')
    .replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}
function tagText(b,n){ var m=new RegExp('<'+n+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+n+'>','i').exec(b); return m?m[1]:''; }
function attrOf(b,n,a){ var m=new RegExp('<'+n+'\\b[^>]*?\\b'+a+'=["\\\']([^"\\\']+)["\\\']','i').exec(b); return m?m[1]:''; }
function imageFrom(b){
  var d=attrOf(b,'media:content','url')||attrOf(b,'media:thumbnail','url')||attrOf(b,'enclosure','url');
  if(d) return d;
  var im=/<img[^>]+src=["']([^"']+)["']/i.exec(tagText(b,'content:encoded')+tagText(b,'description'));
  return im?im[1]:'';
}
function parse(xml){
  var items=[], re=/<item\b[\s\S]*?<\/item>/gi, m;
  while((m=re.exec(xml)) && items.length<12){
    var b=m[0], title=decode(tagText(b,'title')), link=decode(tagText(b,'link'));
    if(!link){ var lm=/<link[^>]*href=["']([^"']+)["']/i.exec(b); if(lm) link=lm[1]; }
    if(!title||!link) continue;
    items.push({ title:title, link:link, pubDate:decode(tagText(b,'pubDate'))||decode(tagText(b,'updated'))||decode(tagText(b,'dc:date')), image:imageFrom(b), source:decode(tagText(b,'source')) });
  }
  return items;
}
async function fetchFeed(url){
  var ctrl=new AbortController(), t=setTimeout(function(){ctrl.abort();},8000);
  try{ var r=await fetch(url,{headers:{'User-Agent':'TheCarScout/1.0','Accept':'application/rss+xml, application/xml, text/xml, */*'},signal:ctrl.signal}); if(!r.ok) return null; return await r.text(); }
  catch(e){ return null; } finally{ clearTimeout(t); }
}
function newest(items){ var t=0; items.forEach(function(it){ var d=Date.parse(it.pubDate); if(!isNaN(d)&&d>t) t=d; }); return t?new Date(t).toISOString():''; }

module.exports = async function handler(req, res){
  res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=21600');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  var cat = (req.query && req.query.cat) || '';
  if(!cat && req.url){ var qm=/[?&]cat=([^&]+)/.exec(req.url); if(qm) cat=decodeURIComponent(qm[1]); }

  if(cat && CATS[cat]){
    var c=CATS[cat];
    var xml=await fetchFeed(gnews(c.q));
    var items=xml?parse(xml):[];
    return res.status(200).json({ ok: items.length>0, category: cat, title: c.title, group: c.group, metric: c.metric, year: YEAR, updated: newest(items), items: items });
  }
  // default: general auto news
  for(var i=0;i<GENERAL_FEEDS.length;i++){
    var gx=await fetchFeed(GENERAL_FEEDS[i]);
    if(!gx) continue;
    var git=parse(gx);
    if(git.length){ var ct=decode((/<channel[\s\S]*?<title>([\s\S]*?)<\/title>/i.exec(gx)||[])[1]||''); return res.status(200).json({ ok:true, source:ct||GENERAL_FEEDS[i], year:YEAR, updated:newest(git), items:git }); }
  }
  return res.status(200).json({ ok:false, items:[] });
};
module.exports._parse = parse;
module.exports._CATS = CATS;
