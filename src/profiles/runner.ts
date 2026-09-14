import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Profile } from "../types.js";
import { materializeProfile } from "./materializer.js";
import * as logger from "../logger.js";

export const BUILT_IN_DEFAULT = "__builtin__";

const WIN_PI = process.platform === "win32" ? "pi.cmd" : "pi";

/** Find the `pi` binary on PATH; throws with an install hint if missing. */
export function resolvePiBinary(): string {
  const pathEnv = process.env.PATH || "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, WIN_PI);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep searching
    }
  }
  throw new Error(
    "Could not find the 'pi' binary on PATH. Install pi first: https://pi.dev (npm i -g @earendil-works/pi-coding-agent)"
  );
}

export function execPiBuiltIn(extraArgs: string[]): void {
  const binary = resolvePiBinary();
  const cmd = [binary, ...extraArgs];

  // No PI_CODING_AGENT_DIR override: run against whatever the user already has.
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.PI_CODING_AGENT_DIR;

  logger.info(`Launching pi with built-in config: binary=${binary}`);

  const result = spawnSync(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  process.exit(result.status ?? 1);
}

export function execPi(profileName: string, p: Profile, extraArgs: string[]): void {
  const dir = materializeProfile(profileName, p);
  const binary = resolvePiBinary();
  const cmd = [binary, ...extraArgs];

  const env: Record<string, string | undefined> = {
    ...process.env,
    PI_CODING_AGENT_DIR: dir,
  };

  const models = p.models || (p.model ? [p.model] : []);
  logger.info(
    `Launching pi with profile '${profileName}': provider=${p.provider || "(default)"} model=${models[0] || "(default)"} thinking=${p.thinking || "(default)"} url=${p.url || "(default)"} dir=${dir} binary=${binary}`
  );

  const result = spawnSync(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  process.exit(result.status ?? 1);
}
