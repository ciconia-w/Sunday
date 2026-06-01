import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptDir, "..");

async function isExecutable(path) {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function firstExistingExecutable(candidates) {
  for (const candidate of candidates) {
    if (candidate && (await isExecutable(candidate))) {
      return candidate;
    }
  }
  return null;
}

export async function resolveHostBinary(binaryName = "personal-agent-host") {
  const directEnv =
    binaryName === "personal-agent-host"
      ? process.env.PERSONAL_AGENT_HOST_BIN
      : binaryName === "personal-agent-filechannel-smoke"
        ? process.env.PERSONAL_AGENT_FILECHANNEL_SMOKE_BIN
        : process.env.PERSONAL_AGENT_SYSTEMCHANNEL_SMOKE_BIN;

  const buildDir = process.env.PERSONAL_AGENT_HOST_BUILD_DIR;

  return await firstExistingExecutable([
    directEnv,
    buildDir ? join(buildDir, binaryName) : null,
    join(repoRoot, ".build", "host-qt", binaryName),
  ]);
}

export function getWebDistDir() {
  return join(repoRoot, "web-client", "dist");
}

export function getSidecarDir() {
  return join(repoRoot, "pi-sidecar");
}

export function getBuiltBundlePath() {
  return join(getWebDistDir(), "assets", "RootWindow-legacy.js");
}
