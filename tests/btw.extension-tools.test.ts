import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { loadBtwExtensionResources, readBtwExtensionSources } from "../extensions/btw-extension-tools";

const roots: string[] = [];
const sessions: AgentSession[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.abort();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-btw-extensions-test-"));
  roots.push(root);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  return { root, cwd, agentDir, projectTrusted: true };
}

async function write(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function createSession(options: { cwd: string; agentDir: string; loader: ResourceLoader }) {
  const modelRuntime = await ModelRuntime.create({
    authPath: join(options.agentDir, "auth.json"),
    modelsPath: join(options.agentDir, "models.json"),
    allowModelNetwork: false,
  });
  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime,
    resourceLoader: options.loader,
    settingsManager: SettingsManager.inMemory(),
    sessionManager: SessionManager.inMemory(options.cwd),
    noTools: "builtin",
  });
  sessions.push(session);
  return session;
}

describe("BTW extension config", () => {
  it("defaults to no extensions", async () => {
    expect(await readBtwExtensionSources(await fixture())).toEqual([]);
  });

  it("resolves and deduplicates local paths relative to their owning config", async () => {
    const options = await fixture();
    await write(join(options.agentDir, "btw.json"), JSON.stringify({ extensions: ["./web.ts", "./web.ts", "npm:pi-web-access@0.35.0"] }));
    expect(await readBtwExtensionSources(options)).toEqual([
      join(options.agentDir, "web.ts"), "npm:pi-web-access@0.35.0",
    ]);
    await write(join(options.cwd, ".pi", "btw.json"), JSON.stringify({ extensions: ["./project.ts"] }));
    expect(await readBtwExtensionSources(options)).toEqual([join(options.cwd, ".pi", "project.ts")]);
  });

  it("allows a project to disable global extensions with an empty list", async () => {
    const options = await fixture();
    await write(join(options.agentDir, "btw.json"), '{"extensions":["npm:pi-web-access"]}');
    await write(join(options.cwd, ".pi", "btw.json"), '{"extensions":[]}');
    expect(await readBtwExtensionSources(options)).toEqual([]);
    await write(join(options.cwd, ".pi", "btw.json"), '{}');
    expect(await readBtwExtensionSources(options)).toEqual(["npm:pi-web-access"]);
  });

  it("does not read untrusted project configuration", async () => {
    const options = await fixture();
    await write(join(options.agentDir, "btw.json"), '{"extensions":["npm:pi-web-access"]}');
    await write(join(options.cwd, ".pi", "btw.json"), 'invalid project config');
    expect(await readBtwExtensionSources({ ...options, projectTrusted: false })).toEqual(["npm:pi-web-access"]);
  });

  it.each(['{', '[]', 'null', '{"extensions":"web"}', '{"extensions":[4]}', '{"extensions":[" "]}', '{"askExtensions":[]}'])(
    "rejects invalid configuration %s with the filename", async (config) => {
      const options = await fixture();
      const path = join(options.agentDir, "btw.json");
      await write(path, config);
      await expect(readBtwExtensionSources(options)).rejects.toThrow(`Invalid BTW config ${path}`);
    },
  );
});

describe("BTW extension SDK integration", () => {
  it("loads only selected extensions and runs startup, real tools, and shutdown headlessly", async () => {
    const options = await fixture();
    const selected = join(options.root, "selected.ts");
    const marker = join(options.root, "lifecycle.txt");
    await write(selected, `
      import { appendFileSync } from 'node:fs';
      export default function(pi) {
        let started = false;
        pi.on('session_start', (_event, ctx) => {
          started = true;
          appendFileSync(${JSON.stringify(marker)}, 'start\\n');
          pi.registerTool({name:'startup_tool',label:'Startup',description:'Startup',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'registered at startup'}],details:{}})});
        });
        pi.on('session_shutdown', () => appendFileSync(${JSON.stringify(marker)}, 'stop\\n'));
        pi.registerTool({name:'web_search',label:'Search',description:'Search',parameters:{type:'object',properties:{}},execute:async(_id,_args,_signal,_update,ctx)=>({content:[{type:'text',text:JSON.stringify({started,hasUI:ctx.hasUI,cwd:ctx.cwd})}],details:{}})});
      }
    `);
    const excluded = "export default function() { throw new Error('Excluded factory executed'); }";
    await write(join(options.agentDir, "extensions", "excluded.ts"), excluded);
    await write(join(options.agentDir, "btw", "extensions", "excluded.ts"), excluded);
    await write(join(options.cwd, ".pi", "extensions", "excluded.ts"), excluded);
    const loader = await loadBtwExtensionResources({ ...options, sources: [selected], parentExtensionPaths: [] });
    expect(loader.getExtensions().errors).toEqual([]);
    expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual([selected]);
    expect(loader.getSkills().skills).toEqual([]);
    const session = await createSession({ ...options, loader });
    await session.bindExtensions({});
    expect(session.getActiveToolNames()).toContain("startup_tool");
    const search = session.agent.state.tools.find((tool) => tool.name === "web_search")!;
    const result = await search.execute("search", {});
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ started: true, hasUI: false, cwd: options.cwd });
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    expect(await readFile(marker, "utf8")).toBe("start\nstop\n");
    // Already emitted shutdown; afterEach should only clean up the other sessions.
    sessions.splice(sessions.indexOf(session), 1);
    session.dispose();
  });

  it("rejects an already-loaded parent path and symlink before its factory runs", async () => {
    const options = await fixture();
    const selected = join(options.root, "parent.ts");
    const alias = join(options.root, "alias.ts");
    const marker = join(options.root, "should-not-exist.txt");
    await write(selected, `import { writeFileSync } from 'node:fs'; export default function() { writeFileSync(${JSON.stringify(marker)}, 'ran'); }`);
    await symlink(selected, alias);
    await expect(loadBtwExtensionResources({ ...options, sources: [alias], parentExtensionPaths: [selected] })).rejects.toThrow("cannot reload the parent's extension");
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an unresolved source even when another source is valid", async () => {
    const options = await fixture();
    const selected = join(options.root, "selected.ts");
    await write(selected, "export default function() {};");
    await expect(loadBtwExtensionResources({ ...options, sources: [selected, join(options.root, "missing.ts")], parentExtensionPaths: [] })).rejects.toThrow("did not resolve to any extensions");
  });

  it("keeps parent module state intact when a separate child package starts and stops", async () => {
    const options = await fixture();
    const source = `let active = false; export default function(pi) {
      pi.on('session_start', () => { active = true; });
      pi.on('session_shutdown', () => { active = false; });
      pi.registerTool({name:'web_search',label:'Search',description:'Search',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:String(active)}],details:{}})});
    }`;
    const parentPath = join(options.agentDir, "npm", "web", "index.ts");
    const childPath = join(options.agentDir, "btw", "web", "index.ts");
    await write(parentPath, source);
    await write(childPath, source);
    const parentLoader = new DefaultResourceLoader({ cwd: options.cwd, agentDir: options.agentDir, settingsManager: SettingsManager.inMemory(), noExtensions: true, additionalExtensionPaths: [parentPath], noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true });
    await parentLoader.reload();
    const parent = await createSession({ ...options, loader: parentLoader });
    await parent.bindExtensions({});
    const childLoader = await loadBtwExtensionResources({ ...options, sources: [childPath], parentExtensionPaths: [parentPath] });
    const child = await createSession({ ...options, loader: childLoader });
    await child.bindExtensions({});
    await child.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    const result = await parent.agent.state.tools.find((tool) => tool.name === "web_search")!.execute("parent", {});
    expect(result.content[0]).toEqual({ type: "text", text: "true" });
  });
});
