import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { frontendServer } from '../scripts/serve.mjs';
test('standalone assets serve scoped entries; private APIs and writes are never implemented here',async()=>{
 const server=frontendServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {const origin=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/','/report','/i/own-'+'a'.repeat(24)+'/','/i/own-'+'a'.repeat(24)+'/report']) assert.equal((await fetch(origin+path)).status,200);
 for(const path of ['/api/invoices','/internal/agreements','/.env','/i/unknown/']) assert.equal((await fetch(origin+path)).status,404);
 assert.equal((await fetch(origin+'/',{method:'POST'})).status,405);
 const html=await (await fetch(origin+'/')).text();assert.ok(html.includes('supplierBase + "/invoice-browser.js"'));assert.ok(!html.includes('AGENT_GRANT_TOKEN'));
 const manifest=JSON.parse(await readFile('dist/contract.json'));assert.ok(manifest.required.includes('supplier-compensation-v2'));
 }finally{await new Promise(r=>server.close(r));}
});
