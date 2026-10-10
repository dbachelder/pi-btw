import { pathToFileURL } from "node:url";
import {
  createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition,
  createBashToolDefinition, createGrepToolDefinition, createFindToolDefinition,
  createLsToolDefinition, defineTool, truncateHead, truncateLine,
  type ExtensionAPI, type ExtensionCommandContext, type ToolDefinition,
  type AgentToolResult, type BashOperations,
} from "@earendil-works/pi-coding-agent";

type SshState = {
  target: string; port?: number; configFile?: string; remoteCwd: string;
  remoteHome: string; remotePlatform: string; remoteShell: string;
};
type Workspace = { cwd: string; home: string; platform: string; shell: string };
type Entry = { path: string; isDirectory: boolean };
type Match = { path: string; toolPath: string; lineNumber: number; line: string };

// The published SSH extension exposes these backend APIs independently of its
// default extension factory. Importing them does not start or stop the parent.
type Adapter = {
  toToolPath(path: string, workspace: Workspace): string;
  mapCwd(path: string, localCwd: string, workspace: Workspace): string;
  readFile(path: string, signal?: AbortSignal): Promise<Buffer>;
  access(path: string, mode: "read" | "write", signal?: AbortSignal): Promise<void>;
  detectImageMimeType(path: string, signal?: AbortSignal): Promise<string | null>;
  mkdir(path: string, signal?: AbortSignal): Promise<void>;
  writeFile(path: string, data: Buffer | string, signal?: AbortSignal): Promise<void>;
  runShell(command: string, cwd: string, options: {
    signal?: AbortSignal; timeoutSeconds?: number; env?: NodeJS.ProcessEnv;
    captureOutput: boolean; onStdout: (data: Buffer) => void; onStderr: (data: Buffer) => void;
  }): Promise<number | null>;
  listDirectory(path: string, signal?: AbortSignal): Promise<Array<{ name: string; isDirectory: boolean }>>;
  findEntries(path: string, pattern: string, limit: number, signal?: AbortSignal): Promise<Entry[]>;
  grep(path: string, pattern: string, options: {
    glob?: string; ignoreCase?: boolean; literal?: boolean; limit: number;
  }, signal?: AbortSignal): Promise<Match[]>;
};
type Client = { dispose(): Promise<void>; onDisconnect?(handler: (error: Error) => void): () => void };
type SshApi = {
  findSshEnvironmentState(entries: readonly unknown[]): { mode: "local" } | { mode: "remote"; session: SshState } | undefined;
  createSshTransportClient(options: {
    target: string; port?: number; configFile?: string; batchMode: boolean; connectTimeoutSeconds: number;
  }, settings: { platform: NodeJS.Platform; preference: "auto" }): Client;
  selectRemoteAdapter(client: Client, options: {
    localPlatform: NodeJS.Platform; preference: string; expectedPlatform: string;
    expectedShell: string; requestedCwd: string;
  }): Promise<{ adapter: Adapter; workspace: Workspace }>;
};

export type BtwSshWorkspace = {
  label: string;
  identity: string;
  tools: ToolDefinition[];
  assertCurrent(): void;
  dispose(): Promise<void>;
};

function limit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error("Limit must be a positive finite number.");
  return Math.max(1, Math.floor(value));
}

type SearchDetails = {
  truncation?: ReturnType<typeof truncateHead>; entryLimitReached?: number;
  resultLimitReached?: number; matchLimitReached?: number;
};

function textResult(text: string, details: SearchDetails = {}): AgentToolResult<SearchDetails> {
  const truncation = truncateHead(text, { maxLines: Number.MAX_SAFE_INTEGER });
  if (truncation.truncated) details.truncation = truncation;
  const notices = Object.entries(details).filter(([key]) => key.endsWith("LimitReached"))
    .map(([, value]) => `${value} results limit reached; increase limit or narrow the search.`);
  if (truncation.truncated) notices.push("Output truncated; narrow the search.");
  return {
    content: [{ type: "text", text: truncation.content + (notices.length ? `\n\n[${notices.join(" ")}]` : "") }],
    details,
  };
}

async function displayFilePath<T extends AgentToolResult<unknown>>(
  displayPath: string, toolPath: string, run: () => Promise<T>,
): Promise<T> {
  try {
    const result = await run();
    return { ...result, content: result.content.map((item) => item.type === "text"
      ? { ...item, text: item.text.replaceAll(toolPath, displayPath) } : item) };
  } catch (error) {
    throw new Error((error instanceof Error ? error.message : String(error)).replaceAll(toolPath, displayPath));
  }
}

export async function createBtwSshWorkspace(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  readonly: boolean,
): Promise<BtwSshWorkspace> {
  const source = pi.getAllTools().find((tool) => tool.name === "read")?.sourceInfo.path;
  if (!source || source.startsWith("<")) {
    throw new Error('workspace: "ssh" requires the parent pi-ssh-remote extension (0.6.2 or newer).');
  }
  const api = await import(/* @vite-ignore */ pathToFileURL(source).href) as Partial<SshApi>;
  if (!api.findSshEnvironmentState || !api.createSshTransportClient || !api.selectRemoteAdapter) {
    throw new Error("The parent read backend does not expose the supported pi-ssh-remote APIs.");
  }
  const getState = () => api.findSshEnvironmentState!(ctx.sessionManager.getBranch());
  const environment = getState();
  if (environment?.mode !== "remote") {
    throw new Error('No active parent SSH workspace. Connect SSH first, or select workspace: "local".');
  }
  const state = environment.session;
  const signature = JSON.stringify(state);
  let unavailable: string | undefined;
  let disposed = false;
  const assertCurrent = () => {
    const current = getState();
    if (disposed || unavailable || current?.mode !== "remote" || JSON.stringify(current.session) !== signature) {
      throw new Error(`${unavailable ?? "Parent SSH workspace changed."} Run /btw:clear before continuing.`);
    }
  };
  const unsubscribe = pi.events.on("ssh-remote:environment", () => {
    unavailable = "Parent SSH workspace changed.";
  });
  let client: Client | undefined;
  let removeDisconnectListener: (() => void) | undefined;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    removeDisconnectListener?.();
    await client?.dispose();
  };

  try {
    client = api.createSshTransportClient({
      target: state.target, port: state.port, configFile: state.configFile,
      batchMode: true, connectTimeoutSeconds: 10,
    }, { platform: process.platform, preference: "auto" });
    const { adapter, workspace } = await api.selectRemoteAdapter(client, {
      localPlatform: process.platform, preference: state.remoteShell,
      expectedPlatform: state.remotePlatform, expectedShell: state.remoteShell, requestedCwd: state.remoteCwd,
    });
    removeDisconnectListener = client.onDisconnect?.((error) => { unavailable = `BTW SSH disconnected: ${error.message}`; });
    assertCurrent();
    const cwd = adapter.toToolPath(workspace.cwd, workspace);
    const filePath = (path: string) => adapter.toToolPath(path, workspace);
    const searchPath = (path?: string) => adapter.toToolPath(adapter.mapCwd(path || ".", ctx.cwd, workspace), workspace);
    const read = createReadToolDefinition(cwd);
    const tools: ToolDefinition[] = [defineTool({
      ...read,
      async execute(id, args, signal, onUpdate, toolCtx) {
        assertCurrent();
        const path = filePath(args.path);
        return displayFilePath(args.path, path, () => createReadToolDefinition(cwd, { operations: {
          readFile: (path) => adapter.readFile(path, signal),
          access: (path) => adapter.access(path, "read", signal),
          detectImageMimeType: (path) => adapter.detectImageMimeType(path, signal),
        } }).execute(id, { ...args, path }, signal, onUpdate, toolCtx));
      },
    })];

    if (readonly) {
      tools.push(defineTool({
        ...createLsToolDefinition(cwd),
        async execute(_id, args, signal) {
          assertCurrent();
          const count = limit(args.limit, 500);
          const entries = (await adapter.listDirectory(searchPath(args.path), signal))
            .sort((a, b) => a.name.localeCompare(b.name));
          return textResult(entries.slice(0, count).map((entry) => entry.name + (entry.isDirectory ? "/" : "")).join("\n") || "(empty directory)",
            entries.length > count ? { entryLimitReached: count } : {});
        },
      }), defineTool({
        ...createFindToolDefinition(cwd),
        async execute(_id, args, signal) {
          assertCurrent();
          const count = limit(args.limit, 1000);
          const entries = await adapter.findEntries(searchPath(args.path), args.pattern, count + 1, signal);
          return textResult(entries.slice(0, count).map((entry) => entry.path + (entry.isDirectory ? "/" : "")).join("\n") || "No files found matching pattern",
            entries.length > count ? { resultLimitReached: count } : {});
        },
      }), defineTool({
        ...createGrepToolDefinition(cwd),
        async execute(_id, args, signal) {
          assertCurrent();
          const count = limit(args.limit, 100);
          const matches = await adapter.grep(searchPath(args.path), args.pattern, {
            glob: args.glob, ignoreCase: args.ignoreCase, literal: args.literal, limit: count + 1,
          }, signal);
          const context = args.context === undefined ? 0 : Math.max(0, Math.floor(args.context));
          if (!Number.isFinite(context)) throw new Error("Context must be a finite number.");
          const lines: string[] = [];
          const files = new Map<string, string[]>();
          for (const match of matches.slice(0, count)) {
            signal?.throwIfAborted();
            if (!context) {
              lines.push(`${match.path}:${match.lineNumber}: ${truncateLine(match.line).text}`);
              continue;
            }
            let content = files.get(match.toolPath);
            if (!content) {
              content = (await adapter.readFile(match.toolPath, signal)).toString("utf8").replace(/\r\n/g, "\n").split("\n");
              files.set(match.toolPath, content);
            }
            for (let line = Math.max(1, match.lineNumber - context); line <= Math.min(content.length, match.lineNumber + context); line++) {
              const separator = line === match.lineNumber ? ":" : "-";
              lines.push(`${match.path}${separator}${line}${separator} ${truncateLine(content[line - 1]).text}`);
            }
          }
          return textResult(lines.join("\n") || "No matches found", matches.length > count ? { matchLimitReached: count } : {});
        },
      }));
    } else {
      tools.push(defineTool({
        ...createWriteToolDefinition(cwd),
        async execute(id, args, signal, onUpdate, toolCtx) {
          assertCurrent();
          const path = filePath(args.path);
          return displayFilePath(args.path, path, () => createWriteToolDefinition(cwd, { operations: {
            mkdir: (path) => adapter.mkdir(path, signal),
            writeFile: (path, data) => adapter.writeFile(path, data, signal),
          } }).execute(id, { ...args, path }, signal, onUpdate, toolCtx));
        },
      }), defineTool({
        ...createEditToolDefinition(cwd),
        async execute(id, args, signal, onUpdate, toolCtx) {
          assertCurrent();
          const path = filePath(args.path);
          return displayFilePath(args.path, path, () => createEditToolDefinition(cwd, { operations: {
            readFile: (path) => adapter.readFile(path, signal),
            access: (path) => adapter.access(path, "write", signal),
            writeFile: (path, data) => adapter.writeFile(path, data, signal),
          } }).execute(id, { ...args, path }, signal, onUpdate, toolCtx));
        },
      }), defineTool({
        ...createBashToolDefinition(cwd),
        async execute(id, args, signal, onUpdate, toolCtx) {
          assertCurrent();
          const operations: BashOperations = {
            exec: async (command, _cwd, options) => ({ exitCode: await adapter.runShell(command, workspace.cwd, {
              signal: options.signal, timeoutSeconds: options.timeout,
              captureOutput: false, onStdout: options.onData, onStderr: options.onData,
            }) }),
          };
          return createBashToolDefinition(cwd, { operations, exposeSessionEnvironment: false }).execute(id, args, signal, onUpdate, toolCtx);
        },
      }));
    }
    return { label: `SSH ${state.target}${state.port ? `:${state.port}` : ""}:${workspace.cwd}`, identity: `ssh:${signature}`, tools, assertCurrent, dispose };
  } catch (error) {
    await dispose();
    throw new Error(`Could not connect BTW SSH workspace: ${error instanceof Error ? error.message : String(error)}`);
  }
}
