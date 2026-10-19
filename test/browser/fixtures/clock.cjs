/**
 * Five minutes pass on the page's installed fake clock, then real time lets any request a timer started reach
 * the fixture routes, so a count taken afterwards includes it.
 */
async function elapse(page, ms = 5 * 60_000) {
  await page.clock.runFor(ms);
  await new Promise(resolve => setTimeout(resolve, 1500));
}
module.exports = { elapse };
