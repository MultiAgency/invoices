const assert = require('node:assert/strict');

/** What the page says when access ends: an expired session (401) and a refused account (403) never read alike. */
const ACCESS_WORDS = { 401: /Your session expired/, 403: /This account may not access these records here/ };

/** Waits for the wording for `status` and asserts the other access wording is absent. */
async function assertAccessWords(page, status) {
  await page.getByText(ACCESS_WORDS[status]).waitFor();
  const other = ACCESS_WORDS[status === 401 ? 403 : 401];
  assert.equal(await page.getByText(other).count(), 0, `${status}: the ${status === 401 ? '403' : '401'} wording is absent`);
}
module.exports = { ACCESS_WORDS, assertAccessWords };
