import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, RegisteredCommand } from "@mariozechner/pi-coding-agent";
import btwExtension from "../extensions/btw";

const { promptStreamMock, createAgentSessionMock, sessionManagerInMemoryMock, subSessionRecords } = vi.hoisted(() => ({
  promptStreamMock: vi.fn(),
  createAgentSessionMock: vi.fn(),
  sessionManagerInMemoryMock: vi.fn(() => ({ type: "in-memory-session" })),
  subSessionRecords: [] as Array<{
    options: any;
    session: any;
    seedMessages: any[];
    promptCalls: Array<{ text: string; context: StreamContext }>;
    emit: (event: any) => void;
    getListenerCount: () => number;
    getIsStreaming: () => boolean;
  }>,
}));

vi.mock("@mariozechner/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@mariozechner/pi-coding-agent")>("@mariozechner/pi-coding-agent");
  return {
    ...actual,
    createAgentSession: createAgentSessionMock,
    SessionManager: {
      ...actual.SessionManager,
      inMemory: sessionManagerInMemoryMock,
    },
  };
});

type CustomEntry = { type: "custom"; customType: string; data?: unknown };
type SessionEntry = CustomEntry | { type: string; role?: string; customType?: string; content?: unknown; [key: string]: unknown };

type StreamContext = {
  systemPrompt: string;
  messages: Array<{ role: string; content: Array<{ type: string; text?: string; thinking?: string }> }>;
};

type PromptStreamEvent =
  | { type: "thinking_delta"; delta: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_execution_start"; toolName: string; args?: unknown }
  | { type: "tool_execution_end"; toolName: string; result?: unknown; isError?: boolean }
  | { type: "done"; message: ReturnType<typeof makeAssistantMessage> }
  | { type: "error"; error: ReturnType<typeof makeAssistantMessage> };

class FakeOverlayHandle {
  hidden = false;
  focused = false;
  hideCalls = 0;
  setHidden(hidden: boolean) {
    this.hidden = hidden;
  }
  isHidden() {
    return this.hidden;
  }
  focus() {
    this.focused = true;
  }
  unfocus() {
    this.focused = false;
  }
  isFocused() {
    return this.focused;
  }
  hide() {
    this.hideCalls += 1;
    this.hidden = true;
    this.focused = false;
  }
}

const tuiMocks = vi.hoisted(() => {
  class FakeInput {
    value = "";
    focused = false;
    onSubmit?: (value: string) => void;
    onEscape?: () => void;
    setValue(value: string) {
      this.value = value;
    }
    getValue() {
      return this.value;
    }
    render(_width: number) {
      return [`> ${this.value}`];
    }
    handleInput(_data: string) {}
  }

  class FakeContainer {
    children: unknown[] = [];
    addChild(child: unknown) {
      this.children.push(child);
    }
    clear() {
      this.children = [];
    }
  }

  class FakeText {
    constructor(public text: string) {}
    setText(text: string) {
      this.text = text;
    }
  }

  class FakeSpacer {}
  class FakeBox extends FakeContainer {}

  return { FakeInput, FakeContainer, FakeText, FakeSpacer, FakeBox };
});

vi.mock("@mariozechner/pi-tui", async () => {
  const actual = await vi.importActual<typeof import("@mariozechner/pi-tui")>("@mariozechner/pi-tui");
  return {
    ...actual,
    Container: tuiMocks.FakeContainer,
    Text: tuiMocks.FakeText,
    Input: tuiMocks.FakeInput,
    Spacer: tuiMocks.FakeSpacer,
    Box: tuiMocks.FakeBox,
  };
});

function makeAssistantMessage(answer: string) {
  return {
    role: "assistant",
    content: [{ type: "text" as const, text: answer }],
    provider: "test-provider",
    model: "test-model",
    api: "openai-responses" as const,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

async function* streamAnswer(answer: string) {
  yield { type: "text_delta" as const, delta: answer.slice(0, Math.max(1, Math.floor(answer.length / 2))) };
  yield { type: "text_delta" as const, delta: answer.slice(Math.max(1, Math.floor(answer.length / 2))) };
  yield { type: "done" as const, message: makeAssistantMessage(answer) };
}

function createBlockingToolStream() {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    release,
    stream: async function* () {
      yield { type: "tool_execution_start" as const, toolName: "read", args: { path: "package.json" } };
      await blocked;
      yield {
        type: "error" as const,
        error: {
          ...makeAssistantMessage(""),
          stopReason: "aborted" as const,
        },
      };
    },
  };
}

function createBlockingSuccessStream(answer: string) {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    release,
    stream: async function* () {
      yield { type: "thinking_delta" as const, delta: "Inspecting package.json" };
      yield { type: "tool_execution_start" as const, toolName: "read", args: { path: "package.json" } };
      await blocked;
      yield {
        type: "tool_execution_end" as const,
        toolName: "read",
        result: { content: [{ type: "text", text: '{"name":"pi-btw"}' }] },
      };
      yield { type: "text_delta" as const, delta: answer };
      yield {
        type: "done" as const,
        message: {
          ...makeAssistantMessage(answer),
          content: buildAssistantContent("Inspecting package.json", answer),
        },
      };
    },
  };
}

function createStreamingFailureStream() {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    release,
    stream: async function* () {
      yield { type: "thinking_delta" as const, delta: "Inspecting package.json" };
      yield { type: "tool_execution_start" as const, toolName: "read", args: { path: "package.json" } };
      await blocked;
      yield {
        type: "tool_execution_end" as const,
        toolName: "read",
        result: { content: [{ type: "text", text: '{"name":"pi-btw"}' }] },
      };
      yield {
        type: "error" as const,
        error: {
          ...makeAssistantMessage(""),
          stopReason: "error" as const,
          errorMessage: "Sub-session prompt exploded",
        },
      };
    },
  };
}

function createBlockingAnswerStream(answer: string) {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const firstChunkLength = Math.max(1, Math.floor(answer.length / 2));

  return {
    release,
    stream: async function* () {
      yield { type: "text_delta" as const, delta: answer.slice(0, firstChunkLength) };
      await blocked;
      yield { type: "text_delta" as const, delta: answer.slice(firstChunkLength) };
      yield {
        type: "done" as const,
        message: makeAssistantMessage(answer),
      };
    },
  };
}

function buildAssistantContent(thinking: string, answer: string) {
  const content: Array<{ type: "thinking"; thinking: string } | { type: "text"; text: string }> = [];
  if (thinking) {
    content.push({ type: "thinking", thinking });
  }
  if (answer) {
    content.push({ type: "text", text: answer });
  }
  return content;
}

function buildMockSystemPrompt(options: any): string {
  const systemPrompt = options.resourceLoader?.getSystemPrompt?.();
  const appendSystemPrompt = options.resourceLoader?.getAppendSystemPrompt?.() ?? [];
  return [systemPrompt, ...appendSystemPrompt].filter(Boolean).join("\n\n");
}

function createMockAgentSession(options: any) {
  const listeners = new Set<(event: any) => void>();
  let seedMessages: any[] = [];
  let stateMessages: any[] = [];
  let isStreaming = false;

  const emit = (event: any) => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const record = {
    options,
    seedMessages,
    promptCalls: [] as Array<{ text: string; context: StreamContext }>,
    emit,
    getListenerCount: () => listeners.size,
    getIsStreaming: () => isStreaming,
    session: null as any,
  };

  const session = {
    agent: {
      replaceMessages: vi.fn((messages: any[]) => {
        seedMessages = messages.map((message) => structuredClone(message));
        stateMessages = seedMessages.map((message) => structuredClone(message));
        record.seedMessages = seedMessages;
      }),
    },
    state: {
      get messages() {
        return stateMessages;
      },
      model: options.model,
      tools: (options.tools ?? []).map((tool: any) => ({ name: tool.name })),
    },
    get model() {
      return options.model;
    },
    get isStreaming() {
      return isStreaming;
    },
    subscribe: vi.fn((listener: (event: any) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    prompt: vi.fn(async (text: string) => {
      const userMessage = {
        role: "user",
        content: [{ type: "text" as const, text }],
        timestamp: Date.now(),
      };
      const context: StreamContext = {
        systemPrompt: buildMockSystemPrompt(options),
        messages: [...stateMessages.map((message) => structuredClone(message)), userMessage],
      };
      record.promptCalls.push({ text, context });

      emit({ type: "turn_start" });
      emit({ type: "message_start", message: userMessage });
      emit({ type: "message_end", message: userMessage });

      const stream = promptStreamMock(record, text, context) as AsyncIterable<PromptStreamEvent>;
      let assistantStarted = false;
      let thinking = "";
      let answer = "";
      let finalMessage: ReturnType<typeof makeAssistantMessage> | null = null;
      const toolResults: Array<{ toolName: string; result: unknown; isError: boolean }> = [];

      const emitAssistantUpdate = (assistantMessageEvent: PromptStreamEvent) => {
        const assistantMessage = {
          ...makeAssistantMessage(answer),
          content: buildAssistantContent(thinking, answer),
        };

        if (!assistantStarted) {
          assistantStarted = true;
          emit({ type: "message_start", message: assistantMessage });
        }

        emit({ type: "message_update", message: assistantMessage, assistantMessageEvent });
      };

      isStreaming = true;
      for await (const event of stream) {
        if (event.type === "thinking_delta") {
          thinking += event.delta;
          emitAssistantUpdate(event);
          continue;
        }

        if (event.type === "text_delta") {
          answer += event.delta;
          emitAssistantUpdate(event);
          continue;
        }

        if (event.type === "tool_execution_start") {
          emit({ type: "tool_execution_start", toolCallId: `call-${record.promptCalls.length}`, toolName: event.toolName, args: event.args ?? {} });
          continue;
        }

        if (event.type === "tool_execution_end") {
          toolResults.push({ toolName: event.toolName, result: event.result, isError: event.isError ?? false });
          emit({
            type: "tool_execution_end",
            toolCallId: `call-${record.promptCalls.length}`,
            toolName: event.toolName,
            result: event.result,
            isError: event.isError ?? false,
          });
          continue;
        }

        finalMessage = event.type === "done" ? event.message : event.error;
      }
      isStreaming = false;

      if (!finalMessage) {
        finalMessage = makeAssistantMessage(answer);
      }

      if (!assistantStarted) {
        emit({ type: "message_start", message: finalMessage });
      }
      emit({ type: "message_end", message: finalMessage });
      emit({ type: "turn_end", message: finalMessage, toolResults });
      stateMessages = [...context.messages.map((message) => structuredClone(message)), structuredClone(finalMessage)];
    }),
    abort: vi.fn(async () => {
      isStreaming = false;
    }),
    dispose: vi.fn(() => {
      listeners.clear();
    }),
    bindExtensions: vi.fn(),
    getActiveToolNames: vi.fn(() => (options.tools ?? []).map((tool: any) => tool.name)),
  };

  record.session = session;
  subSessionRecords.push(record);
  return { session, extensionsResult: { extensions: [], errors: [], runtime: {} } };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getCustomEntries(entries: SessionEntry[], customType: string): CustomEntry[] {
  return entries.filter((entry): entry is CustomEntry => entry.type === "custom" && entry.customType === customType);
}

function transcriptText(overlay: any): string {
  overlay.refresh();
  return overlay.transcript.children.map((child: any) => child.text).join("\n");
}

function transcriptEntries(overlay: any) {
  overlay.refresh();
  return overlay.getTranscriptEntries();
}

function findLatest<T>(items: T[], predicate: (item: T) => boolean): T {
  const match = [...items].reverse().find(predicate);
  if (!match) throw new Error("Expected matching item");
  return match;
}

function createHarness(
  initialEntries: SessionEntry[] = [],
  options: {
    theme?: {
      fg: (name: string, text: string) => string;
      bg: (name: string, text: string) => string;
      italic: (text: string) => string;
      bold: (text: string) => string;
    };
  } = {},
) {
  const commands = new Map<string, RegisteredCommand>();
  const handlers = new Map<string, Function[]>();
  const entries: SessionEntry[] = [...initialEntries];
  const notifications: Array<{ message: string; type?: string }> = [];
  const widgets: Array<{ key: string; content?: unknown; options?: unknown }> = [];
  const sentMessages: Array<{ message: unknown; options?: unknown }> = [];
  const sentUserMessages: Array<{ content: unknown; options?: unknown }> = [];
  const overlayHandles: FakeOverlayHandle[] = [];
  const overlays: Array<{ factoryOptions?: unknown; done?: (result: unknown) => void; component?: any }> = [];
  const tui = { requestRender: vi.fn() };
  const theme = options.theme ?? {
    fg: (_name: string, text: string) => text,
    bg: (_name: string, text: string) => text,
    italic: (text: string) => text,
    bold: (text: string) => text,
  };
  const keybindings = {
    matches: (_data: string, _id: string) => false,
  };

  const sessionManager = {
    getEntries: () => entries,
    getLeafId: () => "leaf",
    getBranch: () => entries,
  };

  const model = { provider: "test-provider", id: "test-model", api: "openai-responses" };
  let idle = true;
  let hasCredentials = true;
  const mainSessionInputs: string[] = [];

  const ui = {
    theme,
    notify: (message: string, type?: "info" | "warning" | "error") => {
      notifications.push({ message, type });
    },
    setWidget: (key: string, content: unknown, options?: unknown) => {
      widgets.push({ key, content, options });
    },
    custom: async (factory: any, options?: any) => {
      let done!: (result: unknown) => void;
      const resultPromise = new Promise((resolve) => {
        done = (result: unknown) => resolve(result);
      });
      const handle = new FakeOverlayHandle();
      overlayHandles.push(handle);
      options?.onHandle?.(handle);
      const component = await factory(tui as any, theme as any, keybindings as any, done);
      overlays.push({ factoryOptions: options, done, component });
      return resultPromise;
    },
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => "",
    editor: async () => undefined,
    setEditorComponent: () => {},
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: true }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
  };

  const api: ExtensionAPI = {
    on: ((event: string, handler: Function) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }) as any,
    registerTool: vi.fn() as any,
    registerCommand: ((name: string, options: any) => {
      commands.set(name, { name, ...options } as RegisteredCommand);
    }) as any,
    registerShortcut: vi.fn() as any,
    registerFlag: vi.fn() as any,
    getFlag: vi.fn() as any,
    registerMessageRenderer: vi.fn() as any,
    sendMessage: ((message: unknown, options?: unknown) => sentMessages.push({ message, options })) as any,
    sendUserMessage: ((content: unknown, options?: unknown) => sentUserMessages.push({ content, options })) as any,
    appendEntry: ((customType: string, data?: unknown) => entries.push({ type: "custom", customType, data })) as any,
    setSessionName: vi.fn() as any,
    getSessionName: vi.fn() as any,
    setLabel: vi.fn() as any,
    exec: vi.fn() as any,
    getActiveTools: vi.fn(() => []) as any,
    getAllTools: vi.fn(() => []) as any,
    setActiveTools: vi.fn() as any,
    getCommands: vi.fn(() => Array.from(commands.values())) as any,
    setModel: vi.fn(async () => true) as any,
    getThinkingLevel: vi.fn(() => "off") as any,
    setThinkingLevel: vi.fn() as any,
    registerProvider: vi.fn() as any,
  } as unknown as ExtensionAPI;

  btwExtension(api);

  const baseCtx = {
    hasUI: true,
    ui: ui as any,
    sessionManager: sessionManager as any,
    modelRegistry: {
      getApiKey: vi.fn(async () => (hasCredentials ? "test-key" : undefined)),
    },
    model,
    getSystemPrompt: () => "system",
    isIdle: () => idle,
  };

  async function runEvent(name: string, event: unknown = {}, ctx: ExtensionContext | ExtensionCommandContext = baseCtx as any) {
    const list = handlers.get(name) ?? [];
    const results = [];
    for (const handler of list) {
      results.push(await handler(event, ctx));
    }
    return results;
  }

  async function runSessionStart() {
    await runEvent("session_start");
  }

  async function command(name: string, args = "") {
    const cmd = commands.get(name);
    if (!cmd) throw new Error(`Missing command: ${name}`);
    await cmd.handler(args, baseCtx as unknown as ExtensionCommandContext);
  }

  function latestOverlayComponent() {
    const overlay = overlays.at(-1)?.component;
    if (!overlay) throw new Error("Overlay not created");
    return overlay;
  }

  function latestWidgetFactory() {
    const widget = [...widgets].reverse().find((entry) => entry.key === "btw" && typeof entry.content === "function");
    if (!widget) throw new Error("Widget not rendered");
    return widget.content as (tui: unknown, theme: typeof theme) => any;
  }

  function startMainSessionInput(text: string) {
    mainSessionInputs.push(text);
    idle = false;

    return {
      finish() {
        idle = true;
      },
    };
  }

  return {
    api,
    entries,
    notifications,
    widgets,
    sentMessages,
    sentUserMessages,
    overlayHandles,
    overlays,
    baseCtx,
    mainSessionInputs,
    runSessionStart,
    runEvent,
    command,
    latestOverlayComponent,
    latestWidgetFactory,
    startMainSessionInput,
    setIdle(value: boolean) {
      idle = value;
    },
    setCredentials(value: boolean) {
      hasCredentials = value;
    },
  };
}

describe("btw runtime behavior", () => {
  beforeEach(() => {
    promptStreamMock.mockReset();
    createAgentSessionMock.mockReset();
    sessionManagerInMemoryMock.mockClear();
    subSessionRecords.length = 0;

    createAgentSessionMock.mockImplementation(async (options: any) => createMockAgentSession(options));
    promptStreamMock.mockImplementation((_record: unknown, _text: string, context: StreamContext) => {
      return streamAnswer(`default:${(context.messages.at(-1)?.content[0] as any)?.text ?? ""}`);
    });
  });

  it("creates a BTW sub-session with an in-memory session manager, coding tools, and BTW system prompt", async () => {
    const harness = createHarness();

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(sessionManagerInMemoryMock).toHaveBeenCalledTimes(1);

    const options = createAgentSessionMock.mock.calls[0][0];
    expect(options.model).toBe(harness.baseCtx.model);
    expect(options.modelRegistry).toBe(harness.baseCtx.modelRegistry);
    expect(options.tools.map((tool: any) => tool.name)).toEqual(["read", "bash", "edit", "write"]);
    expect(options.resourceLoader.getAppendSystemPrompt()[0]).toContain(
      "You are having an aside conversation with the user, separate from their main working session.",
    );

    const subSession = subSessionRecords[0]?.session;
    expect(subSession).toBeDefined();
    expect(subSession.bindExtensions).not.toHaveBeenCalled();
    expect(subSession.getActiveToolNames()).toEqual(["read", "bash", "edit", "write"]);
    expect(subSession.prompt).toHaveBeenCalledWith("first question", { source: "extension" });
  });

  it("contextual BTW seeds the sub-session with main-session messages but excludes visible BTW notes", async () => {
    const harness = createHarness([
      {
        type: "custom",
        role: "custom",
        customType: "btw-note",
        content: "saved btw note",
      } as SessionEntry,
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "main session task" }],
        timestamp: Date.now(),
      } as SessionEntry,
      {
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "main session answer" }],
        timestamp: Date.now(),
      } as SessionEntry,
    ]);

    await harness.runSessionStart();
    await harness.command("btw", "contextual start");

    const seedTexts = subSessionRecords[0].seedMessages.map((message) => (message.content[0] as any)?.text ?? "");
    expect(seedTexts).toContain("main session task");
    expect(seedTexts).toContain("main session answer");
    expect(seedTexts).not.toContain("saved btw note");
  });

  it("switching to tangent recreates the sub-session without inherited main-session context", async () => {
    const harness = createHarness([
      {
        type: "message",
        role: "user",
        content: [{ type: "text", text: "main session task" }],
        timestamp: Date.now(),
      } as SessionEntry,
    ]);

    await harness.runSessionStart();
    await harness.command("btw", "contextual start");
    const contextualRecord = subSessionRecords[0];
    expect(contextualRecord.seedMessages.map((message) => (message.content[0] as any)?.text ?? "")).toContain(
      "main session task",
    );

    await harness.command("btw:tangent", "tangent start");

    const tangentRecord = subSessionRecords[1];
    expect(tangentRecord.session).not.toBe(contextualRecord.session);
    expect(contextualRecord.session.abort).toHaveBeenCalledTimes(1);
    expect(contextualRecord.session.dispose).toHaveBeenCalledTimes(1);
    expect(tangentRecord.seedMessages.map((message) => (message.content[0] as any)?.text ?? "")).not.toContain(
      "main session task",
    );
  });

  it("preserves BTW overlay recoverability after agent prompt failure", async () => {
    const harness = createHarness();
    promptStreamMock
      .mockImplementationOnce(async function* () {
        yield {
          type: "error" as const,
          error: {
            ...makeAssistantMessage(""),
            stopReason: "error" as const,
            errorMessage: "Sub-session prompt exploded",
          },
        };
      })
      .mockImplementationOnce(() => streamAnswer("Recovered answer"));

    await harness.runSessionStart();
    await harness.command("btw", "broken question");

    const overlay = harness.latestOverlayComponent();
    expect(overlay.statusText.text).toContain("Request failed. Thread preserved for retry or follow-up.");
    expect(transcriptText(overlay)).toContain("❌ Sub-session prompt exploded");
    expect(harness.notifications.at(-1)).toEqual({
      message: "Sub-session prompt exploded",
      type: "error",
    });
    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(0);

    overlay.input.onSubmit?.("retry question");
    await flushAsyncWork();

    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(1);
    expect(transcriptText(overlay)).toContain("Recovered answer");
    expect(overlay.statusText.text).toContain("Ready for a follow-up. Hidden BTW thread updated.");
  });

  it("subscribes to the BTW sub-session as soon as the overlay opens", async () => {
    const harness = createHarness();

    await harness.runSessionStart();
    await harness.command("btw", "");

    const record = subSessionRecords[0];
    expect(record).toBeDefined();
    expect(record.getListenerCount()).toBe(1);
    expect(record.session.prompt).not.toHaveBeenCalled();
  });

  it("aborts, disposes, and unsubscribes the active BTW sub-session when Escape dismisses mid-stream", async () => {
    const harness = createHarness();
    const blocking = createBlockingToolStream();
    promptStreamMock.mockImplementation(() => blocking.stream());

    await harness.runSessionStart();
    const pendingCommand = harness.command("btw", "first question");
    await flushAsyncWork();

    const overlay = harness.latestOverlayComponent();
    expect(overlay.statusText.text).toContain("running tool: read");

    const firstRecord = subSessionRecords[0];
    expect(firstRecord).toBeDefined();
    expect(firstRecord.getIsStreaming()).toBe(true);
    expect(firstRecord.getListenerCount()).toBe(1);

    overlay.input.onEscape?.();
    await flushAsyncWork();

    expect(firstRecord.session.abort).toHaveBeenCalledTimes(1);
    expect(firstRecord.session.dispose).toHaveBeenCalledTimes(1);
    expect(firstRecord.getIsStreaming()).toBe(false);
    expect(firstRecord.getListenerCount()).toBe(0);
    expect(harness.overlayHandles.at(-1)?.hideCalls).toBe(1);

    blocking.release();
    await pendingCommand;
  });

  it("allows main-session input to proceed while the BTW sub-session is streaming", async () => {
    const harness = createHarness();
    const blocking = createBlockingSuccessStream("Long-running answer");
    promptStreamMock.mockImplementation(() => blocking.stream());

    await harness.runSessionStart();
    await harness.command("btw", "");

    const overlay = harness.latestOverlayComponent();
    const submitResult = overlay.input.onSubmit?.("inspect package metadata");
    expect(submitResult).toBeUndefined();

    await flushAsyncWork();

    const record = subSessionRecords[0];
    expect(record.getIsStreaming()).toBe(true);
    expect(overlay.statusText.text).toContain("running tool: read");
    expect(harness.baseCtx.isIdle()).toBe(true);

    const mainTurn = harness.startMainSessionInput("continue the main task");
    expect(harness.mainSessionInputs).toEqual(["continue the main task"]);
    expect(harness.baseCtx.isIdle()).toBe(false);
    expect(record.getIsStreaming()).toBe(true);
    expect(findLatest(transcriptEntries(overlay), (entry: any) => entry.type === "tool-call")).toMatchObject({
      toolName: "read",
      args: "package.json",
    });

    blocking.release();
    await flushAsyncWork();

    expect(record.getIsStreaming()).toBe(false);
    expect(overlay.statusText.text).toContain("Ready for a follow-up");
    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(1);
    expect(transcriptText(overlay)).toContain("Long-running answer");

    mainTurn.finish();
    expect(harness.baseCtx.isIdle()).toBe(true);
  });

  it("ignores late session events after overlay dismissal disposes the sub-session", async () => {
    const harness = createHarness();

    await harness.runSessionStart();
    await harness.command("btw", "");

    const overlay = harness.latestOverlayComponent();
    const firstRecord = subSessionRecords[0];
    expect(firstRecord.getListenerCount()).toBe(1);

    overlay.input.onEscape?.();
    await flushAsyncWork();

    expect(firstRecord.session.abort).toHaveBeenCalledTimes(1);
    expect(firstRecord.session.dispose).toHaveBeenCalledTimes(1);
    expect(firstRecord.getListenerCount()).toBe(0);

    firstRecord.emit({ type: "turn_start" });

    expect(overlay.getTranscriptEntries()).toEqual([]);

    await harness.command("btw", "");
    const reopened = harness.latestOverlayComponent();
    expect(transcriptEntries(reopened)).toEqual([]);
    expect(transcriptText(reopened)).toContain("No BTW thread yet. Ask a side question to start one.");
  });

  it("keeps the thread after Escape dismissal and restores it on reopen", async () => {
    const harness = createHarness();
    promptStreamMock.mockImplementation(() => streamAnswer("First answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(1);
    expect(harness.overlayHandles).toHaveLength(1);

    const firstRecord = subSessionRecords[0];
    const overlay = harness.latestOverlayComponent();
    overlay.input.onEscape?.();
    await flushAsyncWork();

    expect(firstRecord.session.abort).toHaveBeenCalledTimes(1);
    expect(firstRecord.session.dispose).toHaveBeenCalledTimes(1);
    expect(firstRecord.getListenerCount()).toBe(0);

    await harness.command("btw", "");
    expect(harness.overlayHandles).toHaveLength(2);

    const reopened = harness.latestOverlayComponent();
    const transcript = transcriptText(reopened);
    expect(transcript).toContain("You  first question");
    expect(transcript).toContain("Assistant");
    expect(transcript).toContain("First answer");
    expect(reopened.statusText.text).toContain("Ready for a follow-up");
  });

  it("supports an in-place follow-up and preserves both turns in one thread", async () => {
    const harness = createHarness();
    promptStreamMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(() => streamAnswer("Second answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    overlay.input.onSubmit?.("follow-up question");
    await flushAsyncWork();

    const threadEntries = getCustomEntries(harness.entries, "btw-thread-entry");
    expect(threadEntries).toHaveLength(2);

    const transcript = transcriptText(overlay);
    expect(transcript).toContain("You  first question");
    expect(transcript).toContain("First answer");
    expect(transcript).toContain("You  follow-up question");
    expect(transcript).toContain("Second answer");
    expect(overlay.statusText.text).toContain("Ready for a follow-up");
  });

  it("maps turn, tool, thinking, and assistant events into transcript entries", async () => {
    const harness = createHarness();
    promptStreamMock.mockImplementation(async function* () {
      yield { type: "thinking_delta" as const, delta: "Inspecting package.json" };
      yield { type: "tool_execution_start" as const, toolName: "read", args: { path: "package.json" } };
      yield {
        type: "tool_execution_end" as const,
        toolName: "read",
        result: { content: [{ type: "text", text: '{"name":"pi-btw"}' }] },
      };
      yield { type: "text_delta" as const, delta: "The package is pi-btw." };
      yield {
        type: "done" as const,
        message: {
          ...makeAssistantMessage("The package is pi-btw."),
          content: buildAssistantContent("Inspecting package.json", "The package is pi-btw."),
        },
      };
    });

    await harness.runSessionStart();
    await harness.command("btw", "read package metadata");

    const overlay = harness.latestOverlayComponent();
    const entries = transcriptEntries(overlay);

    expect(entries.map((entry: any) => entry.type)).toEqual([
      "turn-boundary",
      "user-message",
      "thinking",
      "tool-call",
      "tool-result",
      "assistant-text",
      "turn-boundary",
    ]);
    expect(entries[0]).toMatchObject({ type: "turn-boundary", phase: "start" });
    expect(entries[1]).toMatchObject({ type: "user-message", text: "read package metadata" });
    expect(entries[2]).toMatchObject({ type: "thinking", text: "Inspecting package.json", streaming: false });
    expect(entries[3]).toMatchObject({ type: "tool-call", toolName: "read", args: "package.json" });
    expect(entries[4]).toMatchObject({
      type: "tool-result",
      toolName: "read",
      content: '{"name":"pi-btw"}',
      truncated: false,
      isError: false,
      streaming: false,
    });
    expect(entries[5]).toMatchObject({ type: "assistant-text", text: "The package is pi-btw.", streaming: false });
    expect(entries[6]).toMatchObject({ type: "turn-boundary", phase: "end" });
  });

  it("renders tool, thinking, result, and turn-separator rows in the overlay transcript", async () => {
    const harness = createHarness([], {
      theme: {
        fg: (name: string, text: string) => `<fg:${name}>${text}</fg:${name}>`,
        bg: (name: string, text: string) => `<bg:${name}>${text}</bg:${name}>`,
        italic: (text: string) => `<italic>${text}</italic>`,
        bold: (text: string) => `<bold>${text}</bold>`,
      },
    });
    const longToolResult = ["line 1", "line 2", "x".repeat(420)].join("\n");

    promptStreamMock
      .mockImplementationOnce(async function* () {
        yield { type: "thinking_delta" as const, delta: "Inspecting package.json" };
        yield { type: "tool_execution_start" as const, toolName: "read", args: { path: "package.json" } };
        yield {
          type: "tool_execution_end" as const,
          toolName: "read",
          result: { content: [{ type: "text", text: longToolResult }] },
        };
        yield { type: "text_delta" as const, delta: "The package is pi-btw." };
        yield {
          type: "done" as const,
          message: {
            ...makeAssistantMessage("The package is pi-btw."),
            content: buildAssistantContent("Inspecting package.json", "The package is pi-btw."),
          },
        };
      })
      .mockImplementationOnce(() => streamAnswer("Second answer"));

    await harness.runSessionStart();
    await harness.command("btw", "read package metadata");

    const overlay = harness.latestOverlayComponent();
    overlay.input.onSubmit?.("second question");
    await flushAsyncWork();

    const transcript = transcriptText(overlay);
    expect(transcript).toContain("<bg:toolPendingBg>");
    expect(transcript).toContain("<italic>Inspecting package.json</italic>");
    expect(transcript).toContain("<bold>read</bold>");
    expect(transcript).toContain("package.json");
    expect(transcript).toContain("↳ result");
    expect(transcript).toContain("(truncated)");
    expect(transcript).toContain("line 1");
    expect(transcript).toContain("    <fg:dim>line 1</fg:dim>");
    expect(transcript).toContain("────────────────");
    expect(transcript).toContain("second question");
    expect(transcript).toContain("Second answer");
    expect(transcript.indexOf("↳ result")).toBeGreaterThan(transcript.indexOf("<bold>read</bold>"));
    expect(transcript.indexOf("second question")).toBeGreaterThan(transcript.indexOf("────────────────"));
  });

  it("transcript inspection exposes streaming and failure state", async () => {
    const harness = createHarness();
    const failing = createStreamingFailureStream();
    promptStreamMock.mockImplementation(() => failing.stream());

    await harness.runSessionStart();
    const pendingCommand = harness.command("btw", "read package metadata");
    await flushAsyncWork();

    const overlay = harness.latestOverlayComponent();
    let entries = transcriptEntries(overlay);
    expect(findLatest(entries, (entry: any) => entry.type === "thinking")).toMatchObject({
      text: "Inspecting package.json",
      streaming: true,
    });
    expect(findLatest(entries, (entry: any) => entry.type === "tool-call")).toMatchObject({
      toolName: "read",
      args: "package.json",
    });
    expect(entries.some((entry: any) => entry.type === "tool-result")).toBe(false);

    failing.release();
    await pendingCommand;

    entries = transcriptEntries(overlay);
    expect(findLatest(entries, (entry: any) => entry.type === "tool-result")).toMatchObject({
      toolName: "read",
      content: '{"name":"pi-btw"}',
      truncated: false,
      isError: false,
      streaming: false,
    });
    expect(findLatest(entries, (entry: any) => entry.type === "assistant-text")).toMatchObject({
      text: "❌ Sub-session prompt exploded",
      streaming: false,
    });
    expect(overlay.statusText.text).toContain("Request failed. Thread preserved for retry or follow-up.");
  });

  it("updates assistant transcript text incrementally while the BTW response streams", async () => {
    const harness = createHarness();
    const blocking = createBlockingAnswerStream("Partial answer");
    promptStreamMock.mockImplementation(() => blocking.stream());

    await harness.runSessionStart();
    const pendingCommand = harness.command("btw", "stream it");
    await flushAsyncWork();

    const overlay = harness.latestOverlayComponent();
    expect(findLatest(transcriptEntries(overlay), (entry: any) => entry.type === "assistant-text")).toMatchObject({
      text: "Partial",
      streaming: true,
    });
    expect(overlay.statusText.text).toContain("streaming");

    blocking.release();
    await pendingCommand;

    expect(findLatest(transcriptEntries(overlay), (entry: any) => entry.type === "assistant-text")).toMatchObject({
      text: "Partial answer",
      streaming: false,
    });
    expect(overlay.statusText.text).toContain("Ready for a follow-up");
  });

  it("clears the modal composer after a follow-up is submitted", async () => {
    const harness = createHarness();
    promptStreamMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(() => streamAnswer("Second answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    overlay.input.setValue("follow-up question");
    overlay.input.onSubmit?.("follow-up question");
    await flushAsyncWork();

    expect(overlay.getDraft()).toBe("");
  });

  it("applies distinct theme treatment to user and assistant transcript rows", async () => {
    const harness = createHarness([], {
      theme: {
        fg: (name: string, text: string) => `<fg:${name}>${text}</fg:${name}>`,
        bg: (name: string, text: string) => `<bg:${name}>${text}</bg:${name}>`,
        italic: (text: string) => `<italic>${text}</italic>`,
        bold: (text: string) => `<bold>${text}</bold>`,
      },
    });
    promptStreamMock.mockImplementation(() => streamAnswer("First answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const transcript = transcriptText(harness.latestOverlayComponent());
    expect(transcript).toContain("<bg:userMessageBg>");
    expect(transcript).toContain("<fg:accent>");
    expect(transcript).toContain("<bg:customMessageBg>");
    expect(transcript).toContain("<fg:success>");
  });

  it("surfaces missing credentials as an explicit error without creating a thread entry", async () => {
    const harness = createHarness();
    harness.setCredentials(false);

    await harness.runSessionStart();
    await harness.command("btw", "why did this fail?");

    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(0);
    const overlay = harness.latestOverlayComponent();
    overlay.refresh();
    expect(overlay.statusText.text).toContain("No credentials available for test-provider/test-model.");
    expect(harness.notifications.at(-1)).toEqual({
      message: "No credentials available for test-provider/test-model.",
      type: "error",
    });
  });

  it("keeps BTW in an overlay and does not leave a persistent widget above the main input", async () => {
    const harness = createHarness();
    promptStreamMock.mockImplementation(() => streamAnswer("Overlay answer"));

    await harness.runSessionStart();
    await harness.command("btw", "overlay question");

    expect(harness.overlays.at(-1)?.factoryOptions).toMatchObject({ overlay: true });
    expect(harness.widgets.some((entry) => entry.key === "btw" && typeof entry.content === "function")).toBe(false);
  });

  it("marks the overlay input focused when BTW opens so the cursor stays in the composer", async () => {
    const harness = createHarness();

    await harness.runSessionStart();
    await harness.command("btw", "");

    const overlay = harness.latestOverlayComponent();
    expect(harness.overlayHandles.at(-1)?.isFocused()).toBe(true);
    expect(overlay.focused).toBe(true);
    expect(overlay.input.focused).toBe(true);
  });

  it("forwards terminal input from the focused overlay to the embedded BTW input", async () => {
    const harness = createHarness();

    await harness.runSessionStart();
    await harness.command("btw", "");

    const overlay = harness.latestOverlayComponent();
    const inputHandleSpy = vi.spyOn(overlay.input, "handleInput");

    overlay.handleInput("abc");

    expect(inputHandleSpy).toHaveBeenCalledWith("abc");
  });

  it("renders BTW as a bordered dialog with an internal transcript viewport", async () => {
    const harness = createHarness();
    const longAnswer = Array.from({ length: 24 }, (_, index) => `line ${index + 1} of a long answer`).join("\n");

    promptStreamMock
      .mockImplementationOnce(() => streamAnswer(longAnswer))
      .mockImplementationOnce(() => streamAnswer(longAnswer));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    const firstRender = overlay.render(80);

    overlay.input.onSubmit?.("second question");
    await flushAsyncWork();

    const secondRender = overlay.render(80);

    expect(firstRender[0]).toContain("┌");
    expect(firstRender.at(-1)).toContain("└");
    expect(secondRender[0]).toContain("┌");
    expect(secondRender.at(-1)).toContain("└");
    expect(firstRender.length).toBe(secondRender.length);
  });

  it("keeps the BTW modal at a fixed reading height, uses one frame color, and preserves stacked body indentation", async () => {
    const harness = createHarness([], {
      theme: {
        fg: (name: string, text: string) => `<fg:${name}>${text}</fg:${name}>`,
        bg: (name: string, text: string) => `<bg:${name}>${text}</bg:${name}>`,
        italic: (text: string) => `<italic>${text}</italic>`,
        bold: (text: string) => `<bold>${text}</bold>`,
      },
    });
    promptStreamMock.mockImplementationOnce(() => streamAnswer("First answer"));

    await harness.runSessionStart();
    await harness.command("btw", "");

    const overlay = harness.latestOverlayComponent();
    const emptyLines = overlay.render(80);

    overlay.input.onSubmit?.("first question");
    await flushAsyncWork();

    const populatedLines = overlay.render(80);
    const emptyStateLine = emptyLines.find((line: string) => line.includes("No BTW thread yet."));
    const inputLine = populatedLines.at(-3);
    const assistantBodyLine = populatedLines.find((line: string) => line.includes("First answer"));

    expect(emptyLines.length).toBe(populatedLines.length);
    expect(emptyLines[0]).toContain("<fg:borderMuted>┌");
    expect(emptyLines[0]).not.toContain("<fg:accent>┌");
    expect(emptyLines.at(-1)).toContain("<fg:borderMuted>└");
    expect(emptyLines.at(-1)).not.toContain("<fg:accent>└");
    expect(emptyStateLine).toContain("<fg:borderMuted>│</fg:borderMuted><fg:dim>No BTW thread yet.");
    expect(emptyStateLine).not.toContain("<fg:borderMuted>│</fg:borderMuted> <fg:dim>No BTW thread yet.");
    expect(assistantBodyLine).toContain("<fg:borderMuted>│</fg:borderMuted>    First answer");
    expect(inputLine).toContain("<fg:borderMuted>│</fg:borderMuted>> ");
    expect(inputLine).not.toContain("\x1b_pi:c\x07");
  });

  it("/btw:new appends a reset marker, disposes the old sub-session, clears prior hidden thread state, stays contextual, and reopens a fresh thread", async () => {
    const harness = createHarness();
    promptStreamMock
      .mockImplementationOnce((_record: unknown, _text: string, context: StreamContext) => {
        expect(context.messages.map((message) => (message.content[0] as any)?.text ?? "")).toContain("first question");
        return streamAnswer("First answer");
      })
      .mockImplementationOnce((_record: unknown, _text: string, context: StreamContext) => {
        const texts = context.messages.map((message) => (message.content[0] as any)?.text ?? "");
        expect(texts).not.toContain("first question");
        expect(texts).not.toContain("First answer");
        expect(texts).toContain("replacement question");
        return streamAnswer("Replacement answer");
      });

    await harness.runSessionStart();
    await harness.command("btw", "first question");
    const firstRecord = subSessionRecords[0];

    await harness.command("btw:new", "replacement question");

    expect(firstRecord.session.abort).toHaveBeenCalledTimes(1);
    expect(firstRecord.session.dispose).toHaveBeenCalledTimes(1);
    expect(firstRecord.getListenerCount()).toBe(0);
    expect(subSessionRecords[1]?.session).not.toBe(firstRecord.session);

    const postResetOverlay = harness.latestOverlayComponent();
    const postResetTranscript = transcriptText(postResetOverlay);
    expect(postResetTranscript).not.toContain("You  first question");
    expect(postResetTranscript).not.toContain("First answer");
    expect(postResetTranscript).toContain("You  replacement question");
    expect(postResetTranscript).toContain("Replacement answer");

    await harness.command("btw:new", "");

    const resets = getCustomEntries(harness.entries, "btw-thread-reset");
    expect(resets).toHaveLength(2);
    expect(resets.at(-1)?.data).toMatchObject({ mode: "contextual" });

    const threadEntries = getCustomEntries(harness.entries, "btw-thread-entry");
    expect(threadEntries).toHaveLength(2);

    const overlay = harness.latestOverlayComponent();
    const transcript = transcriptText(overlay);
    expect(transcript).toContain("No BTW thread yet. Ask a side question to start one.");
    expect(overlay.statusText.text).toContain("Started a fresh BTW thread.");
  });

  it("switching between /btw:tangent and /btw appends reset markers and tangent requests omit inherited main-session conversation", async () => {
    const mainVisibleNote = {
      type: "custom",
      role: "custom",
      customType: "btw-note",
      content: "saved btw note",
    } as SessionEntry;
    const mainRegularUser = {
      type: "message",
      role: "user",
      content: [{ type: "text", text: "main session task" }],
      timestamp: Date.now(),
    } as SessionEntry;
    const harness = createHarness([mainVisibleNote, mainRegularUser]);

    await harness.runSessionStart();
    await harness.command("btw", "contextual start");
    await harness.command("btw:tangent", "tangent start");
    await harness.command("btw", "contextual again");

    const resets = getCustomEntries(harness.entries, "btw-thread-reset");
    expect(resets).toHaveLength(2);
    expect(resets.map((entry) => (entry.data as any)?.mode)).toEqual(["tangent", "contextual"]);

    const streamCalls = promptStreamMock.mock.calls as Array<[unknown, string, StreamContext]>;
    expect(streamCalls.length).toBeGreaterThanOrEqual(2);

    const callTexts = streamCalls.map((call) => call[2].messages.map((message) => (message.content[0] as any)?.text ?? ""));
    const tangentTexts = callTexts.find((texts) => texts.at(-1) === "tangent start");
    expect(tangentTexts).toBeDefined();
    expect(tangentTexts).not.toContain("main session task");
    expect(tangentTexts).not.toContain("saved btw note");

    const contextualTexts = callTexts.find((texts) => texts.at(-1) === "contextual start");
    if (contextualTexts) {
      expect(contextualTexts).not.toContain("saved btw note");
    }

    const overlay = harness.latestOverlayComponent();
    const transcript = transcriptText(overlay);
    expect(transcript).toContain("You  contextual again");
    expect(transcript).toContain("default:contextual again");
    expect(transcript).not.toContain("You  tangent start");
    expect(transcript).not.toContain("default:tangent start");
  });

  it("/btw:clear dismisses the overlay, disposes the active sub-session, appends a reset marker, and restore only rehydrates entries after the last reset", async () => {
    const seedEntries: SessionEntry[] = [
      { type: "custom", customType: "btw-thread-entry", data: { question: "old q", thinking: "", answer: "old a", provider: "p", model: "m", thinkingLevel: "off", timestamp: 1 } },
      { type: "custom", customType: "btw-thread-reset", data: { timestamp: 2, mode: "tangent" } },
      { type: "custom", customType: "btw-thread-entry", data: { question: "new q", thinking: "", answer: "new a", provider: "p", model: "m", thinkingLevel: "off", timestamp: 3 } },
    ];
    const harness = createHarness(seedEntries);

    await harness.runEvent("session_start");
    await harness.command("btw", "");
    let overlay = harness.latestOverlayComponent();
    expect(transcriptText(overlay)).toContain("You  new q");
    expect(transcriptText(overlay)).not.toContain("You  old q");

    await harness.command("btw", "restore-visible");
    expect(harness.overlayHandles).toHaveLength(1);

    const activeRecord = subSessionRecords[0];
    const resetCountBeforeClear = getCustomEntries(harness.entries, "btw-thread-reset").length;
    await harness.command("btw:clear", "");

    expect(activeRecord.session.abort).toHaveBeenCalledTimes(1);
    expect(activeRecord.session.dispose).toHaveBeenCalledTimes(1);
    expect(activeRecord.getListenerCount()).toBe(0);

    const resets = getCustomEntries(harness.entries, "btw-thread-reset");
    expect(resets).toHaveLength(resetCountBeforeClear + 1);
    expect(resets.at(-1)?.data).toMatchObject({ mode: "contextual" });
    expect(harness.notifications.at(-1)).toEqual({ message: "Cleared BTW thread.", type: "info" });

    await harness.runEvent("session_switch");
    await harness.command("btw", "");
    overlay = harness.latestOverlayComponent();
    expect(transcriptText(overlay)).toContain("No BTW thread yet. Ask a side question to start one.");

    harness.entries.push({
      type: "custom",
      customType: "btw-thread-entry",
      data: { question: "post-clear q", thinking: "", answer: "post-clear a", provider: "p", model: "m", thinkingLevel: "off", timestamp: 4 },
    });

    await harness.runEvent("session_tree");
    await harness.command("btw", "");
    overlay = harness.latestOverlayComponent();
    const transcript = transcriptText(overlay);
    expect(transcript).toContain("You  post-clear q");
    expect(transcript).toContain("post-clear a");
    expect(transcript).not.toContain("You  new q");
  });

  it("/btw:clear during active tool execution aborts the prompt, disposes the sub-session, and leaves no partial thread", async () => {
    const harness = createHarness();
    const blocking = createBlockingToolStream();
    promptStreamMock.mockImplementation(() => blocking.stream());

    await harness.runSessionStart();
    const pendingCommand = harness.command("btw", "long running tool");
    await flushAsyncWork();

    const overlay = harness.latestOverlayComponent();
    const overlayHandle = harness.overlayHandles.at(-1);
    const activeRecord = subSessionRecords[0];
    expect(overlay.statusText.text).toContain("running tool: read");
    expect(activeRecord.getIsStreaming()).toBe(true);

    await harness.command("btw:clear", "");
    await flushAsyncWork();

    expect(activeRecord.session.abort).toHaveBeenCalledTimes(1);
    expect(activeRecord.session.dispose).toHaveBeenCalledTimes(1);
    expect(activeRecord.getListenerCount()).toBe(0);
    expect(activeRecord.getIsStreaming()).toBe(false);
    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(0);
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(1);
    expect(harness.notifications.at(-1)).toEqual({ message: "Cleared BTW thread.", type: "info" });
    expect(overlayHandle?.hideCalls).toBe(1);

    blocking.release();
    await pendingCommand;

    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(0);

    await harness.command("btw", "");
    expect(transcriptText(harness.latestOverlayComponent())).toContain("No BTW thread yet. Ask a side question to start one.");
  });

  it("restore behavior is consistent across session_start, session_switch, and session_tree", async () => {
    const entries: SessionEntry[] = [
      { type: "custom", customType: "btw-thread-reset", data: { timestamp: 1, mode: "tangent" } },
      { type: "custom", customType: "btw-thread-entry", data: { question: "restored q", thinking: "", answer: "restored a", provider: "p", model: "m", thinkingLevel: "off", timestamp: 2 } },
    ];

    for (const eventName of ["session_start", "session_switch", "session_tree"]) {
      const harness = createHarness(entries);
      await harness.runEvent(eventName);
      await harness.command("btw", "");
      const overlay = harness.latestOverlayComponent();
      const transcript = transcriptText(overlay);
      expect(transcript).toContain("You  restored q");
      expect(transcript).toContain("restored a");
      expect(overlay['modeText'].text).toContain("BTW tangent");
    }
  });

  it("/btw:inject success extracts the active sub-session thread, disposes it, dismisses the overlay, and reopens fresh", async () => {
    const harness = createHarness();
    promptStreamMock.mockImplementation(() => streamAnswer("First answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlayHandle = harness.overlayHandles.at(-1);
    const record = subSessionRecords[0];
    expect(overlayHandle).toBeDefined();
    expect(overlayHandle?.isHidden()).toBe(false);

    record.session.state.messages.push(
      {
        role: "user",
        content: [{ type: "text", text: "second question" }],
        timestamp: Date.now(),
      },
      makeAssistantMessage("Second answer"),
    );

    await harness.command("btw:inject", "Use this as supporting context.");

    expect(harness.sentUserMessages).toHaveLength(1);
    expect(harness.sentUserMessages[0]).toEqual({
      content:
        "Here is a side conversation I had. Use this as supporting context.\n\nUser: first question\nAssistant: First answer\n\n---\n\nUser: second question\nAssistant: Second answer",
      options: undefined,
    });
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(1);
    expect(record.session.dispose).toHaveBeenCalledTimes(1);
    expect(overlayHandle?.hideCalls).toBe(1);
    expect(harness.notifications.at(-1)).toEqual({
      message: "Injected BTW thread (2 exchanges).",
      type: "info",
    });

    await harness.command("btw", "");
    const reopened = harness.latestOverlayComponent();
    expect(transcriptText(reopened)).toContain("No BTW thread yet. Ask a side question to start one.");
  });

  it("/btw:inject while the main session is busy delivers to the main session as a follow-up", async () => {
    const harness = createHarness();
    promptStreamMock.mockImplementation(() => streamAnswer("Busy answer"));

    await harness.runSessionStart();
    await harness.command("btw", "busy question");
    harness.setIdle(false);

    await harness.command("btw:inject", "Queue this behind the active turn.");

    expect(harness.sentUserMessages).toHaveLength(1);
    expect(harness.sentUserMessages[0]).toEqual({
      content: "Here is a side conversation I had. Queue this behind the active turn.\n\nUser: busy question\nAssistant: Busy answer",
      options: { deliverAs: "followUp" },
    });
  });

  it("/btw:inject with an empty sub-session warns without disposing the ready BTW session", async () => {
    const harness = createHarness();

    await harness.runSessionStart();
    await harness.command("btw", "");

    const overlay = harness.latestOverlayComponent();
    const overlayHandle = harness.overlayHandles.at(-1);
    const record = subSessionRecords[0];

    await harness.command("btw:inject", "");

    expect(harness.sentUserMessages).toHaveLength(0);
    expect(record.session.dispose).not.toHaveBeenCalled();
    expect(record.session.abort).not.toHaveBeenCalled();
    expect(record.getListenerCount()).toBe(1);
    expect(overlayHandle?.isHidden()).toBe(false);
    expect(overlay.statusText.text).toContain("Ready. Enter submits; Escape dismisses without clearing.");
    expect(transcriptText(overlay)).toContain("No BTW thread yet. Ask a side question to start one.");
    expect(harness.notifications.at(-1)).toEqual({
      message: "No BTW thread to inject.",
      type: "warning",
    });
  });

  it("/btw:summarize success summarizes the active sub-session thread, disposes it, dismisses the overlay, and reopens fresh", async () => {
    const harness = createHarness();
    promptStreamMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce((_record: unknown, text: string) => {
        expect(text).toBe(
          "User: first question\nAssistant: First answer\n\n---\n\nUser: second question\nAssistant: Second answer",
        );
        return streamAnswer("Short summary");
      });

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlayHandle = harness.overlayHandles.at(-1);
    const record = subSessionRecords[0];
    expect(overlayHandle).toBeDefined();

    record.session.state.messages.push(
      {
        role: "user",
        content: [{ type: "text", text: "second question" }],
        timestamp: Date.now(),
      },
      makeAssistantMessage("Second answer"),
    );

    await harness.command("btw:summarize", "Hand this to the main agent.");

    expect(createAgentSessionMock).toHaveBeenCalledTimes(2);
    const summaryRecord = subSessionRecords[1];
    expect(summaryRecord).toBeDefined();
    expect(summaryRecord.options.tools).toEqual([]);
    expect(summaryRecord.promptCalls[0]?.text).toBe(
      "User: first question\nAssistant: First answer\n\n---\n\nUser: second question\nAssistant: Second answer",
    );
    expect(harness.sentUserMessages).toHaveLength(1);
    expect(harness.sentUserMessages[0]).toEqual({
      content: "Here is a summary of a side conversation I had. Hand this to the main agent.\n\nShort summary",
      options: undefined,
    });
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(1);
    expect(record.session.dispose).toHaveBeenCalledTimes(1);
    expect(summaryRecord.session.dispose).toHaveBeenCalledTimes(1);
    expect(overlayHandle?.hideCalls).toBe(1);
    expect(harness.notifications.at(-1)).toEqual({
      message: "Injected BTW summary (2 exchanges).",
      type: "info",
    });

    await harness.command("btw", "");
    const reopened = harness.latestOverlayComponent();
    expect(transcriptText(reopened)).toContain("No BTW thread yet. Ask a side question to start one.");
  });

  it("summarize failure preserves BTW thread state and keeps the overlay recoverable", async () => {
    const harness = createHarness();
    promptStreamMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(async function* () {
        yield {
          type: "error" as const,
          error: {
            ...makeAssistantMessage(""),
            stopReason: "error" as const,
            errorMessage: "Summary model exploded",
          },
        };
      });

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlayHandle = harness.overlayHandles.at(-1);
    await harness.command("btw:summarize", "retry later");

    expect(harness.sentUserMessages).toHaveLength(0);
    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(1);
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(0);
    expect(overlayHandle?.isHidden()).toBe(false);
    expect(subSessionRecords[1]?.session.dispose).toHaveBeenCalledTimes(1);

    const overlay = harness.latestOverlayComponent();
    overlay.refresh();
    expect(overlay.statusText.text).toContain("Summarize failed. Thread preserved for retry or injection.");
    expect(transcriptText(overlay)).toContain("You  first question");
    expect(transcriptText(overlay)).toContain("First answer");
    expect(harness.notifications.at(-1)).toEqual({
      message: "Summary model exploded",
      type: "error",
    });
  });

  it("in-modal /btw:new reuses command semantics by resetting the thread and reopening contextual mode", async () => {
    const harness = createHarness();
    promptStreamMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(() => streamAnswer("Replacement answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    overlay.input.onSubmit?.("/btw:new replacement question");
    await flushAsyncWork();

    const resets = getCustomEntries(harness.entries, "btw-thread-reset");
    expect(resets).toHaveLength(1);
    expect(resets.at(-1)?.data).toMatchObject({ mode: "contextual" });

    const transcript = transcriptText(overlay);
    expect(transcript).not.toContain("You  first question");
    expect(transcript).not.toContain("First answer");
    expect(transcript).toContain("You  replacement question");
    expect(transcript).toContain("Replacement answer");
    expect(overlay['modeText'].text).toContain("BTW");
  });

  it("in-modal /btw:tangent reuses command semantics by switching modes and dropping inherited main-session context", async () => {
    const mainRegularUser = {
      type: "message",
      role: "user",
      content: [{ type: "text", text: "main session task" }],
      timestamp: Date.now(),
    } as SessionEntry;
    const harness = createHarness([mainRegularUser]);

    await harness.runSessionStart();
    await harness.command("btw", "contextual start");

    const overlay = harness.latestOverlayComponent();
    overlay.input.onSubmit?.("/btw:tangent tangent start");
    await flushAsyncWork();

    const resets = getCustomEntries(harness.entries, "btw-thread-reset");
    expect(resets).toHaveLength(1);
    expect(resets.at(-1)?.data).toMatchObject({ mode: "tangent" });

    const streamCalls = promptStreamMock.mock.calls as Array<[unknown, string, StreamContext]>;
    const tangentCall = [...streamCalls].reverse().find((call) => {
      const texts = call[2].messages.map((message) => (message.content[0] as any)?.text ?? "");
      return texts.at(-1) === "tangent start";
    });
    expect(tangentCall).toBeDefined();
    const tangentTexts = tangentCall![2].messages.map((message) => (message.content[0] as any)?.text ?? "");
    expect(tangentTexts).not.toContain("main session task");

    const transcript = transcriptText(overlay);
    expect(transcript).toContain("You  tangent start");
    expect(transcript).toContain("default:tangent start");
    expect(transcript).not.toContain("You  contextual start");
    expect(overlay['modeText'].text).toContain("BTW tangent");
  });

  it("in-modal /btw:inject reuses command semantics by handing off to the main session and dismissing the overlay", async () => {
    const harness = createHarness();
    promptStreamMock.mockImplementation(() => streamAnswer("First answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    const overlayHandle = harness.overlayHandles.at(-1);
    overlay.input.onSubmit?.("/btw:inject Use this in the main run.");
    await flushAsyncWork();

    expect(harness.sentUserMessages).toHaveLength(1);
    expect(harness.sentUserMessages[0]).toEqual({
      content: "Here is a side conversation I had. Use this in the main run.\n\nUser: first question\nAssistant: First answer",
      options: undefined,
    });
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(1);
    expect(overlayHandle?.hideCalls).toBe(1);
  });

  it("routes non-BTW slash input in the modal through the BTW sub-session prompt without fallback warnings", async () => {
    const harness = createHarness();
    promptStreamMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(() => streamAnswer("Slash answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    const record = subSessionRecords[0];
    const sentUserMessagesBefore = harness.sentUserMessages.length;
    const resetCountBefore = getCustomEntries(harness.entries, "btw-thread-reset").length;

    overlay.input.onSubmit?.("/plan do something else");
    await flushAsyncWork();

    expect(record.session.prompt).toHaveBeenLastCalledWith("/plan do something else", { source: "extension" });
    expect(record.promptCalls.at(-1)?.text).toBe("/plan do something else");
    expect(((record.promptCalls.at(-1)?.context.messages.at(-1)?.content[0] as any)?.text) ?? "").toBe(
      "/plan do something else",
    );
    expect(promptStreamMock.mock.calls).toHaveLength(2);
    expect(harness.sentUserMessages).toHaveLength(sentUserMessagesBefore);
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(resetCountBefore);
    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(2);
    expect(harness.notifications.some((entry) => entry.message.includes("Unsupported slash input in BTW"))).toBe(false);
    expect(overlay.statusText.text).toContain("Ready for a follow-up");
    expect(transcriptText(overlay)).toContain("You  /plan do something else");
    expect(transcriptText(overlay)).toContain("Slash answer");
  });

  it("preserves the BTW thread and recoverability when routed slash input fails", async () => {
    const harness = createHarness();
    promptStreamMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(async function* () {
        yield {
          type: "error" as const,
          error: {
            ...makeAssistantMessage(""),
            stopReason: "error" as const,
            errorMessage: "Slash dispatch exploded",
          },
        };
      });

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    const record = subSessionRecords[0];
    overlay.input.onSubmit?.("/plan fail loudly");
    await flushAsyncWork();

    expect(record.session.prompt).toHaveBeenLastCalledWith("/plan fail loudly", { source: "extension" });
    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(1);
    expect(getCustomEntries(harness.entries, "btw-thread-reset")).toHaveLength(0);
    expect(harness.sentUserMessages).toHaveLength(0);
    expect(overlay.statusText.text).toContain("Request failed. Thread preserved for retry or follow-up.");
    expect(transcriptText(overlay)).toContain("You  first question");
    expect(transcriptText(overlay)).toContain("First answer");
    expect(transcriptText(overlay)).toContain("You  /plan fail loudly");
    expect(transcriptText(overlay)).toContain("❌ Slash dispatch exploded");
    expect(harness.notifications.at(-1)).toEqual({
      message: "Slash dispatch exploded",
      type: "error",
    });
  });

  it("ordinary BTW follow-up submit and Escape dismissal do not send content to the main session", async () => {
    const harness = createHarness();
    promptStreamMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(() => streamAnswer("Second answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    overlay.input.onSubmit?.("follow-up question");
    await flushAsyncWork();
    overlay.input.onEscape?.();
    await flushAsyncWork();

    expect(harness.sentUserMessages).toHaveLength(0);
    expect(getCustomEntries(harness.entries, "btw-thread-entry")).toHaveLength(2);
    expect(harness.overlayHandles.at(-1)?.hideCalls).toBe(1);
  });

  it("context filtering excludes BTW notes from main-session context while leaving non-BTW messages intact", async () => {
    const harness = createHarness();
    const results = await harness.runEvent("context", {
      messages: [
        { role: "user", content: [{ type: "text", text: "keep me" }] },
        { role: "custom", customType: "btw-note", content: "drop me" },
        { role: "assistant", content: [{ type: "text", text: "keep assistant" }] },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      messages: [
        { role: "user", content: [{ type: "text", text: "keep me" }] },
        { role: "assistant", content: [{ type: "text", text: "keep assistant" }] },
      ],
    });
  });
});
