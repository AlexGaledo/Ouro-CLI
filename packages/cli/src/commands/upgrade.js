import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import chalk from "chalk";

// `ouro --upgrade` — pull the newest published ouro without making the user
// remember the package name or the -g install incantation. Read our own name
// and version out of package.json so this keeps working if the package is ever
// renamed or forked.

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

const REGISTRY = "https://registry.npmjs.org";

async function latestVersion(name) {
  // Scoped names (@scope/pkg) need the slash percent-encoded for the registry.
  const res = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}/latest`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`registry returned ${res.status}`);
  return (await res.json()).version;
}

// Numeric-aware semver compare, enough for the "is latest newer than ours"
// question. Prerelease tags are ignored — the registry `latest` dist-tag never
// points at one, so we'd never see them here.
function isNewer(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

function runInstall(spec) {
  return new Promise((resolve, reject) => {
    // npm is a .cmd shim on Windows — spawn without a shell needs the real name.
    const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const proc = spawn(cmd, ["install", "-g", spec], { stdio: "inherit", windowsHide: true });
    proc.on("error", reject);
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npm exited with code ${code}`))));
  });
}

export async function upgradeCommand() {
  const name = pkg.name;
  const current = pkg.version;

  console.log("");
  console.log(chalk.gray(`  current  ${current}`));

  let latest;
  try {
    latest = await latestVersion(name);
  } catch (err) {
    console.log(chalk.red(`  ! couldn't reach the npm registry: ${err.message}`));
    console.log(chalk.gray(`    Try manually: `) + chalk.cyan(`npm install -g ${name}@latest`));
    console.log("");
    return;
  }

  console.log(chalk.gray(`  latest   ${latest}`));

  if (!isNewer(latest, current)) {
    console.log("");
    console.log(chalk.green(`  ✓ already on the latest version`));
    console.log("");
    return;
  }

  console.log("");
  console.log(chalk.cyan(`  Updating ${name} → ${latest} …`));
  console.log("");

  try {
    await runInstall(`${name}@latest`);
    console.log("");
    console.log(chalk.green(`  ✓ upgraded to ${latest}`) + chalk.gray(` — restart running services with `) + chalk.cyan("ouro restart"));
  } catch (err) {
    console.log("");
    console.log(chalk.red(`  ! upgrade failed: ${err.message}`));
    console.log(chalk.gray(`    Try manually: `) + chalk.cyan(`npm install -g ${name}@latest`));
  }
  console.log("");
}
