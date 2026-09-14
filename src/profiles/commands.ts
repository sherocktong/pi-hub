import { Command } from "commander";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  PROFILES_FILE,
  ensureProfilesFile,
  readJson,
  writeJson,
} from "../config.js";
import type { ProfilesData, Profile } from "../types.js";
import { PI_PROVIDERS, THINKING_LEVELS } from "../types.js";
import { BUILT_IN_DEFAULT, execPi, execPiBuiltIn, resolvePiBinary } from "./runner.js";
import { profileDirFor, removeProfileDir } from "./materializer.js";
import { safeAction } from "../logger.js";
import * as logger from "../logger.js";

function maskToken(token: string): string {
  if (!token) return "(unset)";
  if (token.length <= 12) return token;
  return token.slice(0, 8) + "..." + token.slice(-4);
}

function formatModels(p: Profile): string {
  const models = p.models || (p.model ? [p.model] : []);
  if (models.length === 0) return "(unset)";
  const joined = models.join(", ");
  if (joined.length > 28) {
    return models[0] + ", +" + (models.length - 1) + " more";
  }
  return joined;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function warnUnknownProvider(provider?: string): void {
  if (provider && !PI_PROVIDERS.includes(provider)) {
    console.error(`Warning: '${provider}' is not a known pi provider id. Continuing anyway.`);
  }
}

function validateThinking(thinking?: string): void {
  if (thinking && !THINKING_LEVELS.includes(thinking)) {
    throw new Error(
      `Invalid thinking level '${thinking}'. Valid levels: ${THINKING_LEVELS.join(", ")}.`
    );
  }
}

function warnMissingProvider(p: Profile): void {
  if ((p.token || p.url) && !p.provider) {
    console.error(
      "Warning: no provider set (-p). At run time the token/url will be keyed under " +
        "your default pi provider (or the provider/model id prefix), which may not be what you intend."
    );
  }
}

/**
 * Returns the models (of the given list) that pi's catalog does not know.
 * Unknown models fail at request time with a confusing auth error, so warn early.
 * Returns an empty list (silently) when the pi binary can't be queried.
 */
export function findUnknownModels(models: string[]): string[] {
  let binary: string;
  try {
    binary = resolvePiBinary();
  } catch {
    return [];
  }
  const result = spawnSync(binary, ["--list-models"], { encoding: "utf-8" });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }
  const known = new Set<string>();
  for (const line of result.stdout.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length >= 2 && cols[0] && cols[1]) {
      known.add(cols[1]);
      known.add(`${cols[0]}/${cols[1]}`);
    }
  }
  return models.filter(m => m && !known.has(m));
}

function warnUnknownModels(models: string[]): void {
  const unknown = findUnknownModels(models);
  if (unknown.length > 0) {
    console.error(
      `Warning: ${unknown.length === 1 ? "model" : "models"} not in pi's catalog: ${unknown.join(", ")}. ` +
        "Requests for unknown models may fail with a misleading auth error."
    );
  }
}

interface ProfileOptions {
  model?: string[];
  deleteModel?: string[];
  token?: string;
  url?: string;
  provider?: string;
  thinking?: string;
}

function applyProfileOptions(p: Profile, opts: ProfileOptions): void {
  if (opts.token) p.token = opts.token;
  if (opts.url) p.url = opts.url;
  if (opts.provider) {
    warnUnknownProvider(opts.provider);
    p.provider = opts.provider;
  }
  if (opts.thinking) {
    validateThinking(opts.thinking);
    p.thinking = opts.thinking;
  }
}

const MODEL_OPTION = "-m, --model <model>";
const TOKEN_OPTION = "-t, --token <token>";
const URL_OPTION = "-u, --url <url>";
const PROVIDER_OPTION = "-p, --provider <id>";
const THINKING_OPTION = "--thinking <level>";

export function profileCommand(): Command {
  const profile = new Command("profile")
    .description("Manage pi agent profiles");

  // --- add ---
  profile
    .command("add")
    .description("Add or update a profile")
    .argument("<name>", "Profile name")
    .option(MODEL_OPTION, "Model ID - can be used multiple times (max 3)", collect, [])
    .option(TOKEN_OPTION, "API key / token")
    .option(URL_OPTION, "Base URL (works for any provider via models.json override)")
    .option(PROVIDER_OPTION, "pi provider id (e.g. kimi-coding, anthropic, openai)")
    .option(THINKING_OPTION, `Thinking level: ${THINKING_LEVELS.join("|")}`)
    .action(safeAction((name: string, opts: ProfileOptions) => {
      const models = opts.model && opts.model.length > 0 ? opts.model : undefined;
      if (models && models.length > 3) {
        throw new Error("Error: A profile can have at most 3 models.");
      }
      validateThinking(opts.thinking);
      warnUnknownProvider(opts.provider);

      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      const profile = data.profiles[name] || {};

      if (models) {
        profile.models = models;
        profile.model = models[0];
        warnUnknownModels(models);
      }
      applyProfileOptions(profile, opts);
      warnMissingProvider(profile);

      data.profiles[name] = profile;
      writeJson(PROFILES_FILE, data, 0o600);
      fs.chmodSync(PROFILES_FILE, 0o600);
      logger.debug(`profile add: wrote ${PROFILES_FILE}`);
      console.log(`Profile '${name}' saved.`);
    }));

  // --- update ---
  profile
    .command("update")
    .description("Update fields of an existing profile")
    .argument("<name>", "Profile name (must already exist)")
    .option(MODEL_OPTION, "Model ID - can be used multiple times", collect, [])
    .option("-d, --delete-model <model>", "Remove model ID - can be used multiple times", collect, [])
    .option(TOKEN_OPTION, "API key / token")
    .option(URL_OPTION, "Base URL")
    .option(PROVIDER_OPTION, "pi provider id")
    .option(THINKING_OPTION, `Thinking level: ${THINKING_LEVELS.join("|")}`)
    .action(safeAction((name: string, opts: ProfileOptions) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[name]) {
        throw new Error(`Profile '${name}' not found. Use 'profile add' to create it.`);
      }
      const p = data.profiles[name];

      const providedModels = opts.model && opts.model.length > 0 ? opts.model : undefined;
      const modelsToDelete = opts.deleteModel && opts.deleteModel.length > 0 ? opts.deleteModel : undefined;

      if (modelsToDelete) {
        const toRemove = new Set(modelsToDelete);
        const currentModels = p.models || (p.model ? [p.model] : []);
        const newModels = currentModels.filter(m => !toRemove.has(m));
        const removedCount = currentModels.length - newModels.length;

        if (removedCount === 0) {
          console.log(`No matching models to remove from profile '${name}'.`);
        } else if (newModels.length === 0) {
          delete p.models;
          delete p.model;
          console.log(`Removed all models from profile '${name}'.`);
        } else {
          p.models = newModels;
          p.model = newModels[0];
          console.log(`Removed ${removedCount} model(s) from profile '${name}'.`);
        }
      }

      if (providedModels) {
        if (providedModels.length === 1) {
          const modelToSet = providedModels[0];
          const currentModels = p.models || (p.model ? [p.model] : []);
          const existingIndex = currentModels.indexOf(modelToSet);

          if (existingIndex !== -1) {
            currentModels.splice(existingIndex, 1);
            currentModels.unshift(modelToSet);
            p.models = currentModels;
            p.model = modelToSet;
            console.log(`Selected existing model '${modelToSet}' (position ${existingIndex + 1} -> 1).`);
          } else {
            currentModels.unshift(modelToSet);
            p.models = currentModels;
            p.model = modelToSet;
            console.log(`Added and selected new model '${modelToSet}'.`);
          }
        } else {
          p.models = providedModels;
          p.model = providedModels[0];
        }
      }

      const finalModels = p.models || (p.model ? [p.model] : []);
      if (finalModels.length > 3) {
        throw new Error("Error: A profile can have at most 3 models.");
      }

      applyProfileOptions(p, opts);
      warnMissingProvider(p);
      if (providedModels || modelsToDelete) {
        warnUnknownModels(p.models || (p.model ? [p.model] : []));
      }

      writeJson(PROFILES_FILE, data, 0o600);
      fs.chmodSync(PROFILES_FILE, 0o600);
      logger.debug(`profile update: wrote ${PROFILES_FILE}`);
      console.log(`Profile '${name}' updated.`);
    }));

  // --- list ---
  profile
    .command("list")
    .description("List all profiles")
    .action(safeAction(() => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      const profiles = data.profiles;
      const names = Object.keys(profiles);
      if (names.length === 0) {
        console.log("No profiles defined. Use 'profile add' to create one.");
        return;
      }
      const def = data.default || "";
      const fmt = (marker: string, name: string, model: string, provider: string, thinking: string, token: string, url: string) =>
        `${marker.padEnd(2)}  ${name.padEnd(20)}  ${model.padEnd(30)}  ${provider.padEnd(22)}  ${thinking.padEnd(10)}  ${token.padEnd(20)}  ${url}`;

      console.log(fmt("", "NAME", "MODEL(S)", "PROVIDER", "THINKING", "TOKEN", "URL"));
      console.log(fmt("", "----", "--------", "--------", "---------", "-----", "---"));
      for (const name of names) {
        const p = profiles[name];
        const marker = name === def ? "* " : "  ";
        console.log(fmt(
          marker,
          name,
          formatModels(p),
          p.provider || "(default)",
          p.thinking || "(default)",
          maskToken(p.token || ""),
          p.url || "(default)",
        ));
      }
    }));

  // --- view ---
  profile
    .command("view")
    .description("View full details of a profile (token unmasked)")
    .argument("<name>", "Profile name")
    .option("-j, --json", "Output as JSON")
    .action(safeAction((name: string, opts: { json?: boolean }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);

      if (name === BUILT_IN_DEFAULT) {
        throw new Error(`'${BUILT_IN_DEFAULT}' is not a stored profile. Use 'pi-hub run --built-in' or 'pi-hub use --built-in' to run pi with your existing config.`);
      }

      const p = data.profiles[name];
      if (!p) {
        throw new Error(`Profile '${name}' not found.`);
      }
      if (opts.json) {
        console.log(JSON.stringify({ name, ...p }, null, 2));
      } else {
        console.log(`Name:     ${name}`);
        console.log(`Provider: ${p.provider || "(default)"}`);
        console.log(`Model:    ${p.model || "(unset)"}`);
        if (p.models && p.models.length > 0) {
          console.log(`Models:`);
          for (const m of p.models) {
            console.log(`  - ${m}`);
          }
        }
        console.log(`Thinking: ${p.thinking || "(default)"}`);
        console.log(`Token:    ${p.token || "(unset)"}`);
        console.log(`URL:      ${p.url || "(default)"}`);
      }
    }));

  // --- remove ---
  profile
    .command("remove")
    .description("Remove a profile")
    .argument("<name>", "Profile name")
    .action(safeAction((name: string) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[name]) {
        throw new Error(`Profile '${name}' not found.`);
      }
      delete data.profiles[name];
      if (data.default === name) {
        delete data.default;
      }
      writeJson(PROFILES_FILE, data, 0o600);
      fs.chmodSync(PROFILES_FILE, 0o600);
      removeProfileDir(name);
      logger.debug(`profile remove: wrote ${PROFILES_FILE}`);
      console.log(`Profile '${name}' removed.`);
    }));

  // --- rename ---
  profile
    .command("rename")
    .description("Rename a profile")
    .argument("<oldName>", "Current profile name")
    .argument("<newName>", "New profile name")
    .action(safeAction((oldName: string, newName: string) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);
      if (!data.profiles[oldName]) {
        throw new Error(`Profile '${oldName}' not found.`);
      }
      if (data.profiles[newName]) {
        throw new Error(`Profile '${newName}' already exists. Choose a different name.`);
      }
      data.profiles[newName] = data.profiles[oldName];
      delete data.profiles[oldName];
      if (data.default === oldName) {
        data.default = newName;
      }
      writeJson(PROFILES_FILE, data, 0o600);
      fs.chmodSync(PROFILES_FILE, 0o600);

      const oldDir = profileDirFor(oldName);
      if (fs.existsSync(oldDir)) {
        removeProfileDir(newName);
        fs.renameSync(oldDir, profileDirFor(newName));
      }

      console.log(`Profile '${oldName}' renamed to '${newName}'.`);
    }));

  // --- default ---
  profile
    .command("default")
    .description("Set the default profile")
    .option("--built-in", "Use your existing pi config as default (no profile)")
    .argument("[name]", "Profile name to set as default (required unless --built-in)")
    .action(safeAction((name: string | undefined, opts: { builtIn?: boolean }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);

      if (opts.builtIn) {
        data.default = BUILT_IN_DEFAULT;
        writeJson(PROFILES_FILE, data, 0o600);
        fs.chmodSync(PROFILES_FILE, 0o600);
        logger.debug(`profile default: wrote ${PROFILES_FILE}`);
        console.log("Default set to built-in (your existing pi config).");
        return;
      }

      if (!name) {
        throw new Error("Profile name is required. Use --built-in to run pi with your existing config.");
      }

      if (!data.profiles[name]) {
        throw new Error(`Profile '${name}' not found.`);
      }
      data.default = name;
      writeJson(PROFILES_FILE, data, 0o600);
      fs.chmodSync(PROFILES_FILE, 0o600);
      logger.debug(`profile default: wrote ${PROFILES_FILE}`);
      console.log(`Default profile set to '${name}'.`);
    }));

  return profile;
}

export function useCommand(): Command {
  return new Command("use")
    .description("Set a profile as the default")
    .option("--built-in", "Use your existing pi config as default (no profile)")
    .argument("[name]", "Profile name (required unless --built-in)")
    .action(safeAction((name: string | undefined, opts: { builtIn?: boolean }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);

      if (opts.builtIn) {
        data.default = BUILT_IN_DEFAULT;
        writeJson(PROFILES_FILE, data, 0o600);
        fs.chmodSync(PROFILES_FILE, 0o600);
        logger.debug(`use: wrote ${PROFILES_FILE}`);
        console.log("Default set to built-in (your existing pi config).");
        return;
      }

      if (!name) {
        throw new Error("Profile name is required. Use --built-in to run pi with your existing config.");
      }

      if (!data.profiles[name]) {
        throw new Error(`Profile '${name}' not found.`);
      }

      data.default = name;
      writeJson(PROFILES_FILE, data, 0o600);
      fs.chmodSync(PROFILES_FILE, 0o600);
      logger.debug(`use: wrote ${PROFILES_FILE}`);
      console.log(`Default profile set to '${name}'.`);
    }));
}

export function runCommand(): Command {
  return new Command("run")
    .description("Launch pi using the default or a specified profile")
    .option("--built-in", "Use your existing pi config (no profile)")
    .allowUnknownOption()
    .argument("[args...]", "Optional profile name followed by extra arguments passed to pi")
    .action(safeAction((args: string[], opts: { builtIn?: boolean }) => {
      ensureProfilesFile();
      const data = readJson<ProfilesData>(PROFILES_FILE);

      if (opts.builtIn) {
        execPiBuiltIn(args);
        return;
      }

      let profileName = "";
      let piArgs: string[];

      if (args.length > 0 && data.profiles[args[0]]) {
        profileName = args[0];
        piArgs = args.slice(1);
      } else {
        profileName = data.default || "";
        piArgs = args;
      }

      if (profileName === BUILT_IN_DEFAULT) {
        execPiBuiltIn(piArgs);
        return;
      }

      if (!profileName) {
        throw new Error("No default profile set. Use 'pi-hub use <name>' or 'pi-hub use --built-in' first.");
      }

      const p = data.profiles[profileName];
      logger.debug(`run: launching pi with profile '${profileName}', args=[${piArgs.join(", ")}]`);
      execPi(profileName, p, piArgs);
    }));
}
