import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as piAI from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Tool } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import btwExtension from "../extensions/btw";

const roots: string[] = [];
const sessions: AgentSession[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.abort();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(withExtension = false, withToolHistory = false) {
  const root = await mkdtemp(join(tmpdir(), "pi-btw-sdk-test-"));
  roots.push(root);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  const marker = join(root, "lifecycle.txt");
  if (withExtension) {
    const extension = join(root, "lookup.ts");
    await writeFile(extension, `
      import { appendFileSync } from 'node:fs';
      export default function(pi) {
        pi.on('session_start', () => appendFileSync(${JSON.stringify(marker)}, 'start\\n'));
        pi.on('session_shutdown', () => appendFileSync(${JSON.stringify(marker)}, 'stop\\n'));
        pi.registerTool({name:'lookup_fact',label:'Lookup',description:'Look up a fact',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'fixture fact'}],details:{}})});
      }
    `);
    await writeFile(join(agentDir, "btw.json"), JSON.stringify({ extensions: [extension] }));
  }

  const requests: Array<{ prompt: string; messages: Context["messages"]; tools: string[] }> = [];
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), allowModelNetwork: false,
  });
  modelRuntime.registerProvider("btw-test", {
    baseUrl: "http://unused.invalid",
    api: "btw-test-api",
    apiKey: "fixture-key",
    models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 }],
    streamSimple(model, context) {
      // Pi 0.99 embeds the prompt and tool updates in system messages. Older
      // supported SDKs pass them as separate fields on Context.
      const compat = piAI as typeof piAI & {
        getCurrentSystemPrompt?: (messages: Context["messages"]) => string;
        getCurrentTools?: (messages: Context["messages"]) => Tool[];
      };
      const legacy = context as Context;
      const prompt = compat.getCurrentSystemPrompt?.(context.messages) ?? legacy.systemPrompt ?? "";
      const tools = compat.getCurrentTools?.(context.messages) ?? legacy.tools ?? [];
      requests.push({ prompt, messages: structuredClone(context.messages), tools: tools.map((tool) => tool.name) });
      const last = context.messages.at(-1);
      const callTool = tools.some((tool) => tool.name === "lookup_fact") && last?.role === "user" && JSON.stringify(last.content).includes("use lookup");
      const stopReason = callTool ? "toolUse" : "stop";
      const message: AssistantMessage = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: callTool ? [{ type: "toolCall", id: "lookup-1", name: "lookup_fact", arguments: {} }] : [{ type: "text", text: "fixture answer" }],
        stopReason, timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      const stream = piAI.createAssistantMessageEventStream();
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: stopReason, message });
      stream.end();
      return stream;
    },
  });
  await modelRuntime.refresh({ allowNetwork: false });
  const sessionManager = SessionManager.inMemory(cwd);
  if (withToolHistory) {
    sessionManager.appendMessage({
      role: "system", content: "Initial parent prompt sentinel",
      sections: { "parent-instructions": "Preserved parent instruction sentinel" },
      toolsAdded: [{ name: "unavailable_parent_tool", description: "Parent-only fixture", parameters: piAI.Type.Object({}) }],
      timestamp: Date.now(),
    });
  }
  sessionManager.appendMessage({ role: "user", content: "parent context sentinel", timestamp: Date.now() });
  const settingsManager = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noThemes: true,
    noPromptTemplates: true, noContextFiles: true,
    extensionFactories: [btwExtension, (pi) => pi.registerTool({
      name: "unavailable_parent_tool", label: "Parent tool", description: "Parent-only fixture",
      parameters: piAI.Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: "parent-only fact" }], details: {} }),
    })],
    systemPrompt: "Project instruction sentinel. Parent can use unavailable_parent_tool.",
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime, sessionManager, settingsManager, resourceLoader: loader,
    model: modelRuntime.getModel("btw-test", "fixture")!, thinkingLevel: "off",
  });
  sessions.push(session);
  const errors: unknown[] = [];
  await session.bindExtensions({ onError: (error) => errors.push(error) });
  // Exercise a populated parent history, including Pi's persisted system/tool
  // messages on newer releases, before creating any child session.
  await session.prompt("parent request sentinel");
  expect(requests.at(-1)!.tools).toContain("unavailable_parent_tool");
  requests.length = 0;
  if (withToolHistory) {
    sessionManager.appendMessage({
      role: "system", content: "Parent tool update sentinel",
      sections: { "parent-update": "Preserved parent update sentinel" },
      toolsAdded: [{ name: "retired_parent_tool", description: "Retired fixture", parameters: piAI.Type.Object({}) }],
      timestamp: Date.now(),
    });
    sessionManager.appendMessage({
      role: "system", content: "Parent tool removal sentinel",
      toolsRemoved: [{ name: "retired_parent_tool" }], timestamp: Date.now(),
    });
  }
  const parentAnswers = sessionManager.buildSessionContext().messages.filter((message) => message.role === "assistant");
  const command = async (name: string, args: string) => {
    const registered = session.extensionRunner.getCommand(name);
    expect(registered, `registered command ${name}`).toBeDefined();
    await registered!.handler(args, session.extensionRunner.createCommandContext());
    expect(errors).toEqual([]);
  };
  return { sessionManager, requests, command, marker, parentAnswers };
}

describe("BTW commands with the real Pi SDK", () => {
  it.each([
    { command: "btw", inheritsContext: true, tools: ["read", "bash", "edit", "write"] },
    { command: "btw:tangent", inheritsContext: false, tools: ["read", "bash", "edit", "write"] },
    { command: "btw:ask", inheritsContext: true, tools: ["read", "grep", "find", "ls"] },
  ])("$command sends the correct context, capabilities, and tool surface", async (mode) => {
    const { command, requests, sessionManager, parentAnswers } = await fixture();
    await command(mode.command, "child question sentinel");
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.tools.sort()).toEqual([...mode.tools].sort());
    expect(request.prompt).toContain("Project instruction sentinel");
    expect(request.prompt).toContain("<btw_capabilities>");
    expect(request.prompt).toContain(`Available tools in this BTW session: ${mode.tools.join(", ")}.`);
    expect(JSON.stringify(request.messages).includes("parent context sentinel")).toBe(mode.inheritsContext);
    expect(JSON.stringify(request.messages)).toContain("child question sentinel");
    expect(sessionManager.getEntries().some((entry) => entry.type === "custom" && entry.customType === "btw-thread-entry")).toBe(true);
    // A child response must never become an assistant response in the parent.
    expect(sessionManager.buildSessionContext().messages.filter((message) => message.role === "assistant")).toEqual(parentAnswers);
  });

  it.skipIf(!("createInitialSystemMessage" in piAI)).each([
    { command: "btw", tools: ["read", "bash", "edit", "write"] },
    { command: "btw:ask", tools: ["read", "grep", "find", "ls"] },
  ])("$command does not replay parent tool declarations in Anthropic requests", async (mode) => {
    const { command, requests, sessionManager } = await fixture(false, true);
    const parentBefore = structuredClone(sessionManager.buildSessionContext().messages);

    await command(mode.command, "child question sentinel");

    const request = requests[0];
    const systemMessages = request.messages.filter((message) => message.role === "system");
    const declarations = systemMessages.flatMap((message) => [
      ...(message.toolsAdded ?? []), ...(message.toolsRemoved ?? []),
    ]).map((tool) => tool.name);
    expect(declarations).not.toContain("unavailable_parent_tool");
    expect(declarations).not.toContain("retired_parent_tool");
    expect(JSON.stringify(systemMessages)).toContain("Initial parent prompt sentinel");
    expect(JSON.stringify(systemMessages)).toContain("Preserved parent instruction sentinel");
    expect(JSON.stringify(systemMessages)).toContain("Preserved parent update sentinel");
    expect(sessionManager.buildSessionContext().messages.slice(0, parentBefore.length)).toEqual(parentBefore);

    // Use the real serializer, but stop before any HTTP request. Older Pi SDKs
    // do not have transcript tools, so this regression is skipped on those SDKs.
    const { stream } = await import("@earendil-works/pi-ai/api/anthropic-messages");
    let payload: { tools?: Array<{ name: string }>; messages: Array<{ content: unknown }> } | undefined;
    const fetch = vi.fn(async () => { throw new Error("Unexpected network request"); });
    const serialized = stream({
      id: "fixture-anthropic", name: "Fixture", provider: "anthropic", api: "anthropic-messages",
      baseUrl: "http://unused.invalid", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024,
      compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true },
    }, { messages: request.messages }, {
      apiKey: "fixture-key", fetch,
      onPayload(value) {
        payload = value as typeof payload;
        throw new Error("Fixture stops after payload capture");
      },
    });
    await serialized.result();
    expect(fetch).not.toHaveBeenCalled();
    expect(payload).toBeDefined();
    expect(payload!.tools?.map((tool) => tool.name).sort()).toEqual([...mode.tools].sort());
    const blocks = payload!.messages.flatMap((message) => Array.isArray(message.content) ? message.content : []);
    expect(blocks.filter((block) => block.type === "tool_addition" || block.type === "tool_removal")).toEqual([]);
  });

  it("keeps follow-ups in the child and summarizes with no tools", async () => {
    const { command, requests } = await fixture();
    await command("side", "first child question");
    await command("btw", "follow-up question");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1].messages)).toContain("first child question");
    expect(requests[1].messages.some((message) => message.role === "assistant")).toBe(true);
    await command("btw:summarize", "");
    expect(requests).toHaveLength(3);
    expect(requests[2].tools).toEqual([]);
    expect(requests[2].prompt).toContain("No tools are available in this BTW session.");
    expect(JSON.stringify(requests[2].messages)).toContain("follow-up question");
  });

  it("executes an opted-in tool and excludes it from read-only and summary sessions", async () => {
    const { command, requests, marker } = await fixture(true);
    await command("btw", "use lookup");
    expect(requests).toHaveLength(2);
    expect(requests[0].tools).toContain("lookup_fact");
    expect(requests[0].prompt).toContain("write, lookup_fact.");
    expect(requests[1].messages.some((message) => message.role === "toolResult" && JSON.stringify(message.content).includes("fixture fact"))).toBe(true);
    expect(await readFile(marker, "utf8")).toBe("start\n");
    await command("btw:ask", "read-only question");
    expect(requests.at(-1)!.tools.sort()).toEqual(["find", "grep", "ls", "read"]);
    expect(await readFile(marker, "utf8")).toBe("start\nstop\n");
    await command("btw:summarize", "");
    expect(requests.at(-1)!.tools).toEqual([]);
    expect(await readFile(marker, "utf8")).toBe("start\nstop\n");
  });
});
