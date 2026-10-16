import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { invoicePage } from '../src/invoice-page.ts';
await mkdir('dist', { recursive: true });
let html = invoicePage('Invoices');

await writeFile('dist/index.html', html);
await copyFile('src/invoice-browser.js', 'dist/invoice-browser.js');
await writeFile('dist/contract.json', JSON.stringify({version:1, product:'invoices', required:['supplier-session-v1','supplier-invoices-v1','supplier-work-orders-v1','supplier-work-order-requests-v1','supplier-compensation-v2']},null,2));
