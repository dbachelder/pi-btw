import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DefaultPackageManager,
  DefaultResourceLoader,
  SettingsManager,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

/** Resolve local paths relative to the config that owns them, not process.cwd(). */
function resolveSource(source: string, configPath: string): string {
  if (source.startsWith("npm:") || source.startsWith("git:")) return source;
  if (source.startsWith("~/")) return join(homedir(), source.slice(2));
  return resolve(dirname(configPath), source);
}

type BtwConfig = { extensions?: string[]; workspace?: "local" | "ssh" };

async function readConfig(path: string, includeExtensions = true): Promise<BtwConfig | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Cannot read BTW config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    throw new Error(`Invalid BTW config ${path}: expected JSON.`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Invalid BTW config ${path}: expected an object.`);
  }
  const fields = Object.keys(config);
  if (fields.some((field) => field !== "extensions" && field !== "workspace")) {
    throw new Error(`Invalid BTW config ${path}: only "extensions" and "workspace" keys are supported.`);
  }
  if ("workspace" in config && config.workspace !== "local" && config.workspace !== "ssh") {
    throw new Error(`Invalid BTW config ${path}: "workspace" must be "local" or "ssh".`);
  }
  if (includeExtensions && "extensions" in config && (!Array.isArray(config.extensions) || config.extensions.some((source) => typeof source !== "string" || !source.trim()))) {
    throw new Error(`Invalid BTW config ${path}: "extensions" must be an array of nonempty source strings.`);
  }
  return {
    ...(includeExtensions && "extensions" in config && Array.isArray(config.extensions) ? { extensions: [...new Set(config.extensions.map((source: string) => resolveSource(source.trim(), path)))] } : {}),
    ...("workspace" in config ? { workspace: config.workspace as "local" | "ssh" } : {}),
  };
}

/** Project lists replace global lists, including an explicit empty list. */
export async function readBtwExtensionSources(options: {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
}): Promise<string[]> {
  const globalSources = await readConfig(join(options.agentDir, "btw.json"));
  const projectSources = options.projectTrusted
    ? await readConfig(join(options.cwd, ".pi", "btw.json"))
    : undefined;
  return projectSources?.extensions ?? globalSources?.extensions ?? [];
}

/** Workspace selection is independent of extension tool loading, including ask mode. */
export async function readBtwWorkspaceMode(options: {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
}): Promise<"local" | "ssh"> {
  const globalConfig = await readConfig(join(options.agentDir, "btw.json"), false);
  const projectConfig = options.projectTrusted ? await readConfig(join(options.cwd, ".pi", "btw.json"), false) : undefined;
  return projectConfig?.workspace ?? globalConfig?.workspace ?? "local";
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Resolve the allowlist before running any extension factories. Remote packages
 * have a BTW-owned install root so Pi's factory cache cannot reuse the parent's
 * module globals. Local sources already loaded by the parent are rejected.
 */
export async function loadBtwExtensionResources(options: {
  cwd: string;
  agentDir: string;
  sources: string[];
  parentExtensionPaths: string[];
}): Promise<ResourceLoader> {
  const agentDir = join(options.agentDir, "btw");
  const settingsManager = SettingsManager.inMemory();
  const packages = new DefaultPackageManager({ cwd: options.cwd, agentDir, settingsManager });
  const selectedPaths = new Set<string>();
  for (const source of options.sources) {
    const resolved = await packages.resolveExtensionSources([source], { temporary: true });
    const paths = resolved.extensions.filter((resource) => resource.enabled).map((resource) => resource.path);
    if (paths.length === 0) throw new Error(`BTW source ${source} did not resolve to any extensions.`);
    for (const path of paths) selectedPaths.add(path);
  }
  const paths = [...selectedPaths];
  const parentPaths = new Set(await Promise.all(options.parentExtensionPaths.map(canonicalPath)));
  for (const path of paths) {
    if (parentPaths.has(await canonicalPath(path))) {
      throw new Error(
        `BTW cannot reload the parent's extension ${path}: Pi can share its module state. Use an npm: or git: source for a separate BTW install.`,
      );
    }
  }
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: paths,
  });
  await loader.reload();
  return loader;
}
