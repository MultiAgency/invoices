import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
// One app, one release: every supplier entry (/, /submit, /report) is this index.html. scripts/build.mjs cleans dist/.
export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./src/main.tsx" } },
  html: { template: "./template.html", title: "Invoices | MultiAgency" },
  output: { assetPrefix: "/invoice-ui/", distPath: { root: "../dist" }, cleanDistPath: false },
});
