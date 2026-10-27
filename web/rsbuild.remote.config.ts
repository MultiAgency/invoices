import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
// The Module Federation build: exposes `./Invoices` (src/remote.tsx) from remoteEntry.js for a host app. It is a second,
// separate target in dist-remote/: the standalone release in dist/ and its digest, freeze and rollback are untouched.
// React is a singleton the host provides.
export default defineConfig({
  plugins: [pluginReact(), pluginModuleFederation({
    name: "invoices", filename: "remoteEntry.js", dts: false,
    exposes: { "./Invoices": "./src/remote.tsx" },
    shared: { react: { singleton: true, requiredVersion: false }, "react-dom": { singleton: true, requiredVersion: false } },
  })],
  source: { entry: { index: "./src/remote-entry.ts" } },
  tools: { htmlPlugin: false },
  output: { assetPrefix: "auto", distPath: { root: "../dist-remote" }, cleanDistPath: true },
});
