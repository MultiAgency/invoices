const { mkdirSync, writeFileSync } = require('node:fs');
const { basename, join, resolve } = require('node:path');
const { chromium } = require('./browser.cjs');

const FAILURES = resolve('.test-artifacts/browser-failures');

/**
 * Keeps what a failed scenario leaves behind: its name and error, every page's console and page errors, and a
 * screenshot of each page still open. Returns the directory.
 */
function keepFailure(task, scenario, error, pages) {
  const dir = join(FAILURES, `${new Date().toISOString().replace(/[:.]/g, '-')}-${task}-${scenario}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'error.txt'), `${task} › ${scenario}\n\n${error?.stack ?? error}\n`);
  return Promise.all(pages.map(async ({ page, log }, i) => {
    writeFileSync(join(dir, `page-${i}.log`), `${page.url()}\n${log.join('\n')}\n`);
    if (!page.isClosed()) await page.screenshot({ path: join(dir, `page-${i}.png`), fullPage: true }).catch(() => {});
  })).then(() => dir);
}

/** One browser per task; fresh contexts, diagnostics and failures remain isolated per scenario. */
async function runTask(scenarios) {
  const root = resolve(process.argv[2] || 'dist'), task = basename(process.argv[1], '.cjs');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
  // Every page a scenario opens records its console and page errors, so a failure can be traced afterwards.
  let pages = [];
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async options => {
    const page = await newPage(options), log = [];
    page.on('console', message => log.push(`[${message.type()}] ${message.text()}`));
    page.on('pageerror', error => log.push(`[pageerror] ${error.stack ?? error.message}`));
    page.on('requestfailed', request => log.push(`[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
    pages.push({ page, log });
    return page;
  };
  try {
    for (const scenario of scenarios) {
      console.log(`Scenario: ${scenario.name}`);
      pages = [];
      try { await scenario(browser, root); }
      catch (error) {
        console.error(error); process.exitCode = 1;
        console.error(`Kept failure diagnostics for ${scenario.name}: ${await keepFailure(task, scenario.name, error, pages)}`);
      }
      finally { for (const context of browser.contexts()) await context.close(); }
    }
  } finally { await browser.close(); }
}
module.exports = { keepFailure, runTask: scenarios => runTask(scenarios).catch(error => { console.error(error); process.exitCode = 1; }) };
