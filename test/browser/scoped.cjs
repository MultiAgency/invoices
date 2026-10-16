const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {runTask} = require('./fixtures/task.cjs');
const {assertResponsive} = require('./fixtures/layout.cjs');
async function scopedSupplier(browser,root) {
 for(const trailing of ['', '/']) {
 const base='/i/own-'+'a'.repeat(24), page=await browser.newPage({viewport:{width:390,height:844}}), calls=[];
 await page.route('**/*', route=>{
 const url=new URL(route.request().url());
 if(url.hostname==='cdn.jsdelivr.net') return route.fulfill({contentType:'text/javascript',body:'export class NearConnector {}'});
 if(url.hostname!=='invoice.test')return route.abort();
 const p=url.pathname;
 if(p===base+trailing)return route.fulfill({contentType:'text/html',body:readFileSync(join(root,'index.html'),'utf8')});
 if(p===base+'/invoice-browser.js')return route.fulfill({contentType:'text/javascript',body:readFileSync(join(root,'invoice-browser.js'),'utf8')});
 calls.push(p);
 if(p===base+'/api/session')return route.fulfill({json:{account:'supplier.near',agreed:true}});
 if(p===base+'/api/invoices')return route.fulfill({json:{invoices:[],agreements:[],agreed:true}});
 if(p===base+'/api/work-orders')return route.fulfill({json:{orders:[]}});
 return route.abort();
 });
 await page.goto('https://invoice.test'+base+trailing);
 await page.getByRole('button',{name:'Submit invoice',exact:true}).waitFor();
 assert.equal(await page.locator('#report-link').getAttribute('href'),base+'/report');
 await page.getByRole('button',{name:'Check work orders',exact:true}).click();
 await page.getByText('No work orders for this signed-in account.').waitFor();
 assert.ok(calls.every(p=>p.startsWith(base+'/api/')));
 await assertResponsive(page,'scoped standalone invoices');
 assert.match(await page.locator('body').ariaSnapshot(),/Describe the work/);
 await page.close();
 }
}
runTask([scopedSupplier]);
