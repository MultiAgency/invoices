import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
// A minimal host app standing in for the dashboard: it loads Invoices as a federated remote from its own origin (/remote/).
export default defineConfig({
  plugins: [pluginReact(), pluginModuleFederation({
    name: "host", dts: false,
    remotes: { invoices: "invoices@/remote/remoteEntry.js" },
    shared: { react: { singleton: true, requiredVersion: false }, "react-dom": { singleton: true, requiredVersion: false } },
  })],
  source: { entry: { index: "./src/index.tsx" } },
  html: { title: "Test host" },
  output: { distPath: { root: "../../.test-artifacts/remote-host" }, cleanDistPath: true },
});
