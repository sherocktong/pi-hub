import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as logger from "./logger.js";

export const PI_DIR = process.env.PI_HUB_PI_DIR || path.join(os.homedir(), ".pi");
export const PROFILES_FILE = process.env.PI_HUB_PROFILES_FILE || path.join(PI_DIR, "profiles.json");
// Source agent dir: pi itself honours PI_CODING_AGENT_DIR, so pi-hub does too
export const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(PI_DIR, "agent");
export const PI_HUB_DIR = process.env.PI_HUB_DIR || path.join(PI_DIR, "pi-hub");
export const PROFILE_DIRS_DIR = path.join(PI_HUB_DIR, "profiles");
export const AGENT_SETTINGS_FILE = path.join(AGENT_DIR, "settings.json");
export const AGENT_AUTH_FILE = path.join(AGENT_DIR, "auth.json");
// pi also reads an outer ~/.pi/settings.json; pi-hub copies its "skills" key into
// generated profile settings as insurance when PI_CODING_AGENT_DIR isolation hides it
export const PI_SETTINGS_FILE = path.join(PI_DIR, "settings.json");

export function ensureFile(filePath: string, defaultContent: string): void {
  if (!fs.existsSync(filePath)) {
    logger.debug(`ensureFile: creating ${filePath}`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, defaultContent, "utf-8");
  }
}

export function readJson<T = unknown>(filePath: string): T {
  logger.debug(`readJson: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

export function writeJson(filePath: string, data: unknown, mode?: number): void {
  logger.debug(`writeJson: ${filePath}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", { mode });
}

export function ensureProfilesFile(): void {
  ensureFile(PROFILES_FILE, '{"profiles":{}}\n');
}
