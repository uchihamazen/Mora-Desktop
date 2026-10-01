// Shared dev-runtime lookup for smoke scripts. Prefers normally installed
// packages, then falls back to a shared runtime folder without hardcoding
// any username. Override with MUSE_RUNTIME_PACKAGES when your shared
// runtime lives elsewhere.
const path = require('node:path');
const { homedir } = require('node:os');

function runtimePackages() {
  return process.env.MUSE_RUNTIME_PACKAGES
    || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
}

function runtimeRequire(name) {
  try {
    return require(name);
  } catch {
    try {
      return require(path.join(runtimePackages(), name));
    } catch {
      throw new Error(`Cannot find "${name}". Install it or set MUSE_RUNTIME_PACKAGES to a node_modules folder containing it.`);
    }
  }
}

module.exports = { runtimePackages, runtimeRequire };
