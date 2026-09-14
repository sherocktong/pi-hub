import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";

let tmpDir: string;
let shimOutFile: string;
let origPath: string | undefined;

function setup() {
  vi.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-hub-runner-test-"));
  process.env.PI_HUB_PI_DIR = tmpDir;
  process.env.PI_HUB_PROFILES_FILE = path.join(tmpDir, "profiles.json");
  process.env.PI_HUB_DIR = path.join(tmpDir, "pi-hub");
  process.env.PI_CODING_AGENT_DIR = path.join(tmpDir, "agent");
  fs.mkdirSync(path.join(tmpDir, "agent"), { recursive: true });

  // Fake `pi` binary on PATH that dumps env + argv as JSON for assertions
  const binDir = path.join(tmpDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  shimOutFile = path.join(tmpDir, "shim-out.json");
  const shim = path.join(binDir, "pi");
  fs.writeFileSync(
    shim,
    `#!/bin/sh
printf '{"pi_coding_agent_dir":"%s","argv":"' "\${PI_CODING_AGENT_DIR-}" > "${shimOutFile}"
printf '%s' "$*" >> "${shimOutFile}"
printf '"}\n' >> "${shimOutFile}"
exit 0
`
  );
  fs.chmodSync(shim, 0o755);
  origPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${origPath}`;
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.PI_HUB_PI_DIR;
  delete process.env.PI_HUB_PROFILES_FILE;
  delete process.env.PI_HUB_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  process.env.PATH = origPath;
}

async function runCommand(cmd: Command, args: string[]) {
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
    throw new Error(`process.exit(${code})`);
  });
  try {
    cmd.parse(["node", "pi-hub", ...args]);
  } catch {
    // process.exit throw is expected
  } finally {
    exitSpy.mockRestore();
  }
}

async function getRunCommand() {
  const mod = await import("../../src/profiles/index.js");
  return mod.runCommand();
}

async function addProfile(name: string, extra: string[] = []) {
  const mod = await import("../../src/profiles/index.js");
  const cmd = mod.profileCommand();
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    cmd.parse(["node", "pi-hub", "add", name, ...extra]);
  } catch {
    // ignore
  } finally {
    exitSpy.mockRestore();
  }
}

function readShimOutput(): { pi_coding_agent_dir: string; argv: string } {
  return JSON.parse(fs.readFileSync(shimOutFile, "utf-8"));
}

describe("run", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("exits with code 1 when no default is set and no profile given", async () => {
    const cmd = await getRunCommand();
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...a) => errors.push(a.join(" "));
    let exitCode = 0;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      exitCode = typeof code === "number" ? code : 1;
      throw new Error("process.exit");
    });
    try {
      cmd.parse(["node", "pi-hub", "-p", "hi"]);
    } catch {
      // expected
    } finally {
      exitSpy.mockRestore();
      console.error = origError;
    }
    expect(exitCode).toBe(1);
    expect(errors.some((e) => e.includes("No default profile set"))).toBe(true);
  });

  it("launches pi with PI_CODING_AGENT_DIR pointing at the materialized profile dir", async () => {
    await addProfile("work", ["-p", "kimi-coding", "-m", "kimi-for-coding", "-t", "tok"]);
    const cmd = await getRunCommand();
    await runCommand(cmd, ["work"]);

    const out = readShimOutput();
    expect(out.pi_coding_agent_dir).toBe(path.join(tmpDir, "pi-hub", "profiles", "work"));
    const auth = JSON.parse(fs.readFileSync(path.join(out.pi_coding_agent_dir, "auth.json"), "utf-8"));
    expect(auth["kimi-coding"]).toEqual({ type: "api_key", key: "tok" });
  });

  it("passes extra args through to pi", async () => {
    await addProfile("work", ["-m", "m"]);
    const cmd = await getRunCommand();
    await runCommand(cmd, ["work", "-p", "hello world", "--offline"]);
    expect(readShimOutput().argv).toBe("-p hello world --offline");
  });

  it("falls back to the default profile when the first arg is not a profile name", async () => {
    await addProfile("work", ["-m", "m"]);
    const useCmd = (await import("../../src/profiles/index.js")).useCommand();
    await runCommand(useCmd, ["work"]);

    const cmd = await getRunCommand();
    await runCommand(cmd, ["-p", "hi"]);
    const out = readShimOutput();
    expect(out.pi_coding_agent_dir).toBe(path.join(tmpDir, "pi-hub", "profiles", "work"));
    expect(out.argv).toBe("-p hi");
  });

  it("treats all args as pi args when no profiles exist and none match", async () => {
    const cmd = await getRunCommand();
    let error = "";
    const origError = console.error;
    console.error = (...a) => {
      error = a.join(" ");
    };
    try {
      cmd.parse(["node", "pi-hub", "--list-models"]);
    } catch {
      // expected: no default set
    } finally {
      console.error = origError;
    }
    expect(error).toContain("No default profile set");
  });

  it("launches plain pi without PI_CODING_AGENT_DIR for --built-in", async () => {
    await addProfile("work", ["-m", "m"]);
    const cmd = await getRunCommand();
    await runCommand(cmd, ["--built-in", "-p", "hi"]);
    const out = readShimOutput();
    expect(out.pi_coding_agent_dir).toBe("");
    expect(out.argv).toBe("-p hi");
  });

  it("launches plain pi when the default is the built-in sentinel", async () => {
    await addProfile("work", ["-m", "m"]);
    const useCmd = (await import("../../src/profiles/index.js")).useCommand();
    await runCommand(useCmd, ["--built-in"]);

    const cmd = await getRunCommand();
    await runCommand(cmd, ["-p", "hi"]);
    expect(readShimOutput().pi_coding_agent_dir).toBe("");
  });

  it("generates models.json with baseUrl for url profiles", async () => {
    await addProfile("px", ["-p", "kimi-coding", "-m", "m", "-t", "tok", "-u", "https://proxy.example.com"]);
    const cmd = await getRunCommand();
    await runCommand(cmd, ["px"]);
    const out = readShimOutput();
    const models = JSON.parse(fs.readFileSync(path.join(out.pi_coding_agent_dir, "models.json"), "utf-8"));
    expect(models.providers["kimi-coding"].baseUrl).toBe("https://proxy.example.com");
  });
});
