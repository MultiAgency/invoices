/**
 * An injected NEAR wallet behind near-connect's real interface, as in Proto's E2E wallet boundary. It signs
 * with fixture values (the payee API is a fixture too) and the chooser is answered when it appears.
 */
async function installWallet(page, account = 'payee.near') {
  await page.addInitScript(account => {
    const accounts = [{ accountId: account, publicKey: 'ed25519:fixture' }];
    const wallet = { manifest: { id: 'local-test-wallet', name: 'Local test wallet', type: 'injected', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', features: { signMessage: true } },
      signIn: async () => accounts, getAccounts: async () => accounts, signOut: async () => {},
      signMessage: async () => ({ accountId: account, publicKey: 'ed25519:fixture', signature: 'fixture' }) };
    window.addEventListener('near-selector-ready', () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: wallet })));
    localStorage.setItem('selected-wallet:mainnet', 'local-test-wallet');
  }, account);
  await page.addLocatorHandler(page.getByText('Local test wallet', { exact: true }), chooser => chooser.click({ timeout: 2000 }).catch(() => {}), { noWaitAfter: true });
}
/** Lets the page finish handling answers already delivered (React renders, promise continuations). */
async function settled(page) {
  for (let i = 0; i < 3; i++) await page.evaluate(() => new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => resolve(); channel.port2.postMessage(0); }));
}
module.exports = { installWallet, settled };
