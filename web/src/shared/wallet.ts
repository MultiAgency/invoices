import { NearConnector } from "@fastnear/near-connect";

/**
 * near-connect's wallet list, pinned to a reviewed commit. Each wallet's own code still loads from the URL
 * the list names, so that code can change under the same URL: wallets run sandboxed and every signature is
 * verified by Proto, so the remaining risk is a wallet that phishes for keys. Bump only after reviewing it.
 */
const WALLET_MANIFEST = "https://cdn.jsdelivr.net/gh/fastnear/near-connect@d277b41263a8ea0a6892236b22824d46c2c3c377/repository/manifest.json";
export const connector = new NearConnector({ network: "mainnet", features: { signMessage: true }, manifest: WALLET_MANIFEST });
