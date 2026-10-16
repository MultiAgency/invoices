import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
export function frontendServer(directory = 'dist') {
 const root = resolve(directory);
 return createServer(async (req,res) => {
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('cache-control','no-store');
  res.setHeader('referrer-policy','no-referrer');
  res.setHeader('x-frame-options','DENY');
  const url = new URL(req.url,'http://frontend');
  if (!['GET','HEAD'].includes(req.method)) return res.writeHead(405).end();
  let path = url.pathname.replace(/^\/i\/own-[a-f0-9]{24}(?=\/|$)/,'') || '/';
  if (path.startsWith('/invoice-ui/static/')) path = path.slice('/invoice-ui'.length);
  if (path === '/health') return res.writeHead(200,{'content-type':'application/json'}).end('{"ok":true,"product":"invoices"}');
  if (['/','/submit','/submit/'].includes(path)) path='/index.html';
  if (['/report','/report/'].includes(path)) path='/contributor.html';
  if (!['/index.html','/contributor.html','/invoice-browser.js','/contract.json'].includes(path) && !/^\/static\/[a-zA-Z0-9_./-]+$/.test(path)) return res.writeHead(404).end('Not found');
  if (path.split('/').includes('..')) return res.writeHead(404).end();
  try {
   const bytes = await readFile(root+path);
   const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml'};
   res.writeHead(200,{'content-type':types[extname(path)] || 'application/octet-stream'}).end(req.method==='HEAD'?undefined:bytes);
  } catch {res.writeHead(404).end('Not found');}
 });
}
if (import.meta.url===pathToFileURL(process.argv[1]).href) frontendServer(process.env.FRONTEND_DIST || 'dist').listen(Number(process.env.PORT || 3011),process.env.HOST || '127.0.0.1',()=>console.log('Invoices asset server ready'));
