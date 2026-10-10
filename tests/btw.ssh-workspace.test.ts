import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createBtwSshWorkspace, type BtwSshWorkspace } from "../extensions/btw-ssh-workspace";

const roots: string[] = [];
const workspaces: BtwSshWorkspace[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-btw-ssh-test-"));
  roots.push(root);
  const source = join(root, "ssh-backend.mjs");
  await writeFile(source, `
    import { posix } from 'node:path';
    export const files = new Map([['/srv/project/src/main.ts', Buffer.from('first line\nremote-only sentinel\nlast line\n')]]);
    export const calls = [];
    export let failure;
    export let disconnect;
    export function setFailure(value) { failure = value; }
    export function findSshEnvironmentState(entries) {
      const entry = entries.filter(e => e.type === 'custom' && ['pi-ssh-remote-state', 'pi-ssh-local-state'].includes(e.customType)).at(-1);
      return !entry ? undefined : entry.customType === 'pi-ssh-local-state' ? {mode:'local'} : {mode:'remote',session:entry.data};
    }
    export function createSshTransportClient(options, settings) {
      calls.push(['connect', options, settings]);
      if (failure === 'factory') throw new Error('transport unavailable');
      return {
        dispose: async () => calls.push(['dispose']),
        onDisconnect(fn) { disconnect = fn; return () => { disconnect = undefined; }; },
      };
    }
    const decode = path => path.replace('/__remote__', '');
    export async function selectRemoteAdapter(client, options) {
      if (failure === 'connect') throw new Error('connection refused');
      const workspace = {cwd:options.requestedCwd,home:'/home/test',platform:'unix',shell:'bash'};
      const record = (name, path) => { calls.push([name, decode(path)]); if (failure === 'operation') throw new Error('remote unavailable'); };
      return {workspace, adapter: {
        toToolPath: (path, ws) => '/__remote__' + posix.resolve(ws.cwd, path.startsWith('~/') ? '/home/test/' + path.slice(2) : path),
        mapCwd: (path, localCwd, ws) => path === localCwd ? ws.cwd : posix.resolve(ws.cwd,path),
        access: async path => { record('access',path); if (!files.has(decode(path))) throw new Error('remote file not found'); },
        readFile: async path => { record('read',path); if (!files.has(decode(path))) throw new Error('remote file not found'); return files.get(decode(path)); },
        detectImageMimeType: async () => null,
        mkdir: async path => record('mkdir',path),
        writeFile: async (path, value) => { record('write',path); files.set(decode(path),Buffer.from(value)); },
        runShell: async (command,cwd,options) => { calls.push(['shell',command,cwd]); options.onStdout(Buffer.from('remote shell sentinel')); return 0; },
        listDirectory: async path => { record('ls',path); return [{name:'src',isDirectory:true}]; },
        findEntries: async (path,pattern,count) => { record('find',path); return [{path:'src/main.ts',isDirectory:false}]; },
        grep: async (path,pattern,options) => { record('grep',path); return [{path:'src/main.ts',toolPath:'/__remote__/srv/project/src/main.ts',lineNumber:2,line:'remote-only sentinel'}]; },
      }};
    }
    export default function() { throw new Error('Parent extension factory must not run in BTW'); }
  `.replace('first line\nremote-only sentinel\nlast line\n', 'first line\\nremote-only sentinel\\nlast line\\n'));
  const backend = await import(/* @vite-ignore */ pathToFileURL(source).href);
  const state = { version: 2, target: "test-host", port: 2222, configFile: "/test/ssh-config", remotePlatform: "unix", remoteShell: "bash", remoteCwd: "/srv/project", remoteHome: "/home/test" };
  const entries = [{ type: "custom", customType: "pi-ssh-remote-state", data: state }];
  const listeners = new Set<(event: unknown) => void>();
  const pi = {
    getAllTools: () => [{ name: "read", sourceInfo: { path: source } }],
    events: { on: (_name: string, callback: (event: unknown) => void) => { listeners.add(callback); return () => listeners.delete(callback); } },
  };
  const ctx = { cwd: root, sessionManager: { getBranch: () => entries } };
  const create = async (readonly = false) => {
    const workspace = await createBtwSshWorkspace(pi as never, ctx as never, readonly);
    workspaces.push(workspace);
    return workspace;
  };
  const execute = (workspace: BtwSshWorkspace, name: string, args: unknown) => {
    const tool = workspace.tools.find((tool) => tool.name === name)!;
    return tool.execute("fixture", tool.prepareArguments?.(args) ?? args, undefined, undefined, ctx as never);
  };
  return { root, backend, entries, state, listeners, create, execute, pi, ctx };
}

describe("BTW SSH workspace backend", () => {
  it("reads, writes, edits, and runs shells through a separate remote backend", async () => {
    const { create, execute, backend } = await fixture();
    const workspace = await create();
    expect(workspace.tools.map((tool) => tool.name)).toEqual(["read", "write", "edit", "bash"]);
    expect(workspace.label).toBe("SSH test-host:2222:/srv/project");
    expect(backend.calls[0]).toEqual(["connect", expect.objectContaining({ target: "test-host", port: 2222, batchMode: true }), expect.objectContaining({ preference: "auto" })]);
    expect((await execute(workspace, "read", { path: "src/main.ts" })).content[0]).toMatchObject({ text: expect.stringContaining("remote-only sentinel") });
    await execute(workspace, "write", { path: "notes.txt", content: "remote note" });
    expect(backend.files.get("/srv/project/notes.txt").toString()).toBe("remote note");
    await execute(workspace, "edit", { path: "notes.txt", oldText: "remote note", newText: "edited note" });
    expect(backend.files.get("/srv/project/notes.txt").toString()).toBe("edited note");
    await execute(workspace, "bash", { command: "pwd" });
    expect(backend.calls).toContainEqual(["shell", "pwd", "/srv/project"]);
    await workspace.dispose();
    await workspace.dispose();
    expect(backend.calls.filter((call: unknown[]) => call[0] === "dispose")).toHaveLength(1);
  });

  it("preserves literal remote paths in file contents and edit diffs", async () => {
    const { create, execute, backend } = await fixture();
    const workspace = await create();
    const path = "/__remote__/srv/project/notes.txt";
    const content = `source=${path}\n`;
    backend.files.set("/srv/project/notes.txt", Buffer.from(content));
    expect((await execute(workspace, "read", { path: "notes.txt" })).content[0]).toMatchObject({ text: content });
    const result = await execute(workspace, "edit", { path: "notes.txt", oldText: content, newText: `updated=${path}\n` });
    expect(JSON.stringify(result.details)).toContain(path);
    expect(backend.files.get("/srv/project/notes.txt").toString()).toBe(`updated=${path}\n`);
  });

  it("ask mode exposes only remote read, grep, find, and ls tools", async () => {
    const { create, execute, backend } = await fixture();
    const workspace = await create(true);
    expect(workspace.tools.map((tool) => tool.name).sort()).toEqual(["find", "grep", "ls", "read"]);
    await execute(workspace, "read", { path: "src/main.ts", offset: 2, limit: 1 });
    expect((await execute(workspace, "grep", { pattern: "sentinel", context: 1 })).content[0]).toMatchObject({ text: expect.stringContaining("src/main.ts:2: remote-only sentinel") });
    await execute(workspace, "find", { pattern: "*.ts" });
    await execute(workspace, "ls", {});
    expect(backend.calls).toContainEqual(["grep", "/srv/project"]);
    expect(backend.calls).toContainEqual(["find", "/srv/project"]);
    expect(backend.calls).toContainEqual(["ls", "/srv/project"]);
    expect(backend.calls.some((call: unknown[]) => ["write", "shell"].includes(String(call[0])))).toBe(false);
  });

  it.each(["connect", "factory"])("cleans up a failed %s without local fallback", async (failure) => {
    const { create, backend, listeners } = await fixture();
    backend.setFailure(failure);
    await expect(create()).rejects.toThrow(/transport unavailable|connection refused/);
    expect(listeners.size).toBe(0);
    expect(backend.calls.filter((call: unknown[]) => call[0] === "dispose")).toHaveLength(failure === "factory" ? 0 : 1);
  });

  it("propagates remote operation failures without reading a same-named local file", async () => {
    const { create, execute, backend, root } = await fixture();
    await writeFile(join(root, "main.ts"), "local sentinel");
    const workspace = await create(true);
    backend.setFailure("operation");
    await expect(execute(workspace, "read", { path: "main.ts" })).rejects.toThrow("remote unavailable");
  });

  it.each(["host", "cwd", "exit", "event", "disconnect"])("requires clear after a parent %s change", async (change) => {
    const { create, execute, backend, entries, state, listeners } = await fixture();
    const workspace = await create();
    if (change === "host") entries[0].data = { ...state, target: "other-host" };
    if (change === "cwd") entries[0].data = { ...state, remoteCwd: "/other-project" };
    if (change === "exit") entries.push({ type: "custom", customType: "pi-ssh-local-state", data: { version: 1 } } as never);
    if (change === "event") for (const listener of listeners) listener({ status: "started" });
    if (change === "disconnect") backend.disconnect(new Error("connection reset"));
    const before = backend.calls.length;
    await expect(execute(workspace, "write", { path: "notes.txt", content: "must not write" })).rejects.toThrow("/btw:clear");
    expect(backend.calls).toHaveLength(before);
    expect(() => workspace.assertCurrent()).toThrow("/btw:clear");
  });

  it("rejects missing parent SSH state rather than returning local tools", async () => {
    const { create, entries } = await fixture();
    entries.length = 0;
    await expect(create()).rejects.toThrow("No active parent SSH workspace");
  });
});
