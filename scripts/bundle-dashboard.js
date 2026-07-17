import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, "../packages/dashboard/dist");
const dest = path.resolve(__dirname, "../packages/cli/dashboard-dist");

if (!fs.existsSync(src)) {
  console.error("Dashboard build not found at " + src + " — run `npm run build:dashboard` first.");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log("Copied dashboard build -> " + dest);
