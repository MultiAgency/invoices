import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
export default defineConfig({ plugins: [pluginReact()], source: { entry: { contributor: "./src/contributor.tsx" } }, html: { template: "./template.html", title: "Invoices | MultiAgency" }, output: { assetPrefix: "/invoice-ui/", distPath: { root: "../dist" } } });
