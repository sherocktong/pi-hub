import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Profile } from "../../src/types.js";

let tmpDir: string;
let agentDir: string;
let mat: typeof import("../../src/profiles/materializer.js");

function setup() {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-hub-mat-test-"));
  process.env.PI_HUB_PI_DIR = tmpDir;
  process.env.PI_HUB_PROFILES_FILE = path.join(tmpDir, "profiles.json");
  process.env.PI_HUB_DIR = path.join(tmpDir, "pi-hub");
  process.env.PI_CODING_AGENT_DIR = path.join(tmpDir, "agent");
  agentDir = path.join(tmpDir, "agent");
  fs.mkdirSync(agentDir, { recursive: true });
}

async function load() {
  mat = await import("../../src/profiles/materializer.js");
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.PI_HUB_PI_DIR;
  delete process.env.PI_HUB_PROFILES_FILE;
  delete process.env.PI_HUB_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
}

const baseProfile: Profile = {
  provider: "kimi-coding",
  model: "kimi-for-coding",
  models: ["kimi-for-coding"],
  thinking: "high",
  token: "sk-test-token-1234567890",
  url: "https://proxy.example.com/coding",
};

describe("materializeProfile", () => {
  beforeEach(async () => {
    setup();
    await load();
  });
  afterEach(teardown);

  it("creates the profile dir and returns its path", () => {
    const dir = mat.materializeProfile("work", baseProfile);
    expect(dir).toBe(path.join(tmpDir, "pi-hub", "profiles", "work"));
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("writes auth.json with an api_key entry for the profile provider (0600)", () => {
    const dir = mat.materializeProfile("work", baseProfile);
    const auth = JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf-8"));
    expect(auth["kimi-coding"]).toEqual({ type: "api_key", key: "sk-test-token-1234567890" });
    const mode = fs.statSync(path.join(dir, "auth.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("omits auth.json when the profile has no token", () => {
    const dir = mat.materializeProfile("oauth", { provider: "kimi-coding" });
    expect(fs.existsSync(path.join(dir, "auth.json"))).toBe(false);
  });

  it("keys auth.json under the agent defaultProvider when the profile has no provider", () => {
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ defaultProvider: "kimi-coding" })
    );
    const dir = mat.materializeProfile("implicit", { model: "kimi-k2.7", token: "tok-123" });
    const auth = JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf-8"));
    expect(auth["kimi-coding"]).toEqual({ type: "api_key", key: "tok-123" });
  });

  it("keys auth.json under the provider/model id prefix when present", () => {
    const dir = mat.materializeProfile("prefixed", { model: "openai/gpt-4o", token: "tok-123" });
    const auth = JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf-8"));
    expect(auth["openai"]).toEqual({ type: "api_key", key: "tok-123" });
  });

  it("warns and skips auth.json when no provider can be determined", () => {
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...a) => errors.push(a.join(" "));
    try {
      const dir = mat.materializeProfile("noprovider", { model: "m", token: "tok-123" });
      expect(fs.existsSync(path.join(dir, "auth.json"))).toBe(false);
      expect(errors.some((e) => e.includes("no provider could be determined"))).toBe(true);
    } finally {
      console.error = origError;
    }
  });

  it("writes models.json under the agent defaultProvider when the profile has no provider", () => {
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ defaultProvider: "kimi-coding" })
    );
    const dir = mat.materializeProfile("implicit-url", { model: "kimi-k2.7", url: "https://api.kimi.com/coding/" });
    const models = JSON.parse(fs.readFileSync(path.join(dir, "models.json"), "utf-8"));
    expect(models).toEqual({ providers: { "kimi-coding": { baseUrl: "https://api.kimi.com/coding/" } } });
  });

  it("writes settings.json with provider/model/thinking defaults", () => {
    const dir = mat.materializeProfile("work", baseProfile);
    const settings = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf-8"));
    expect(settings.defaultProvider).toBe("kimi-coding");
    expect(settings.defaultModel).toBe("kimi-for-coding");
    expect(settings.defaultThinkingLevel).toBe("high");
  });

  it("preserves existing agent settings keys while overriding defaults", () => {
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ theme: "dark", defaultProvider: "google", someHook: { x: 1 } })
    );
    const dir = mat.materializeProfile("work", baseProfile);
    const settings = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf-8"));
    expect(settings.theme).toBe("dark");
    expect(settings.someHook).toEqual({ x: 1 });
    expect(settings.defaultProvider).toBe("kimi-coding");
  });

  it("carries the outer ~/.pi settings.json skills key when agent settings lack it", () => {
    fs.writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({ skills: ["~/.claude/skills"] })
    );
    const dir = mat.materializeProfile("work", baseProfile);
    const settings = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf-8"));
    expect(settings.skills).toEqual(["~/.claude/skills"]);
  });

  it("writes models.json with a baseUrl override for the profile provider", () => {
    const dir = mat.materializeProfile("work", baseProfile);
    const models = JSON.parse(fs.readFileSync(path.join(dir, "models.json"), "utf-8"));
    expect(models).toEqual({ providers: { "kimi-coding": { baseUrl: "https://proxy.example.com/coding" } } });
  });

  it("removes a stale models.json when the profile url is removed", () => {
    const dir = mat.materializeProfile("work", baseProfile);
    expect(fs.existsSync(path.join(dir, "models.json"))).toBe(true);
    mat.writeModelsFile(dir, { provider: "kimi-coding", token: "t" });
    expect(fs.existsSync(path.join(dir, "models.json"))).toBe(false);
  });

  it("symlinks shared agent dirs and files into the profile dir", () => {
    fs.mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
    fs.mkdirSync(path.join(agentDir, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "AGENTS.md"), "# agents");
    const dir = mat.materializeProfile("work", baseProfile);

    for (const name of ["extensions", "sessions", "AGENTS.md"]) {
      const link = path.join(dir, name);
      expect(fs.existsSync(link)).toBe(true);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(link)).toBe(fs.realpathSync(path.join(agentDir, name)));
    }
  });

  it("refreshes stale symlinks on re-materialization", () => {
    fs.mkdirSync(path.join(agentDir, "sessions"), { recursive: true });
    const dir = mat.materializeProfile("work", baseProfile);
    // Simulate a stale symlink pointing at a moved location
    const sessionsLink = path.join(dir, "sessions");
    fs.rmSync(sessionsLink);
    fs.symlinkSync("/nonexistent-old-path", sessionsLink, "junction");

    mat.refreshSharedLinks(dir);
    expect(fs.realpathSync(sessionsLink)).toBe(fs.realpathSync(path.join(agentDir, "sessions")));
  });

  it("is idempotent", () => {
    mat.materializeProfile("work", baseProfile);
    const dir = mat.materializeProfile("work", baseProfile);
    expect(fs.existsSync(path.join(dir, "auth.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "settings.json"))).toBe(true);
  });
});

describe("removeProfileDir", () => {
  beforeEach(async () => {
    setup();
    await load();
  });
  afterEach(teardown);

  it("removes the profile dir without following symlinks", () => {
    fs.mkdirSync(path.join(agentDir, "sessions"), { recursive: true });
    const dir = mat.materializeProfile("work", baseProfile);
    expect(fs.existsSync(path.join(agentDir, "sessions"))).toBe(true);

    mat.removeProfileDir("work");
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(path.join(agentDir, "sessions"))).toBe(true);
  });

  it("is a no-op for a missing profile dir", () => {
    expect(() => mat.removeProfileDir("ghost")).not.toThrow();
  });
});
