import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, RegisteredCommand } from "@mariozechner/pi-coding-agent";
import btwExtension from "../extensions/btw";

const { streamSimpleMock, completeSimpleMock } = vi.hoisted(() => ({
  streamSimpleMock: vi.fn(),
  completeSimpleMock: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", async () => {
  const actual = await vi.importActual<typeof import("@mariozechner/pi-ai")>("@mariozechner/pi-ai");
  return {
    ...actual,
    streamSimple: streamSimpleMock,
    completeSimple: completeSimpleMock,
  };
});

type CustomEntry = { type: "custom"; customType: string; data?: unknown };

type SessionEntry = CustomEntry;

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

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

type Harness = ReturnType<typeof createHarness>;

function createHarness() {
  const commands = new Map<string, RegisteredCommand>();
  const handlers = new Map<string, Function[]>();
  const entries: SessionEntry[] = [];
  const notifications: Array<{ message: string; type?: string }> = [];
  const widgets: Array<{ key: string; content?: unknown; options?: unknown }> = [];
  const sentMessages: Array<{ message: unknown; options?: unknown }> = [];
  const sentUserMessages: Array<{ content: unknown; options?: unknown }> = [];
  const overlayHandles: FakeOverlayHandle[] = [];
  const overlays: Array<{ factoryOptions?: unknown; done?: (result: unknown) => void; component?: any }> = [];
  const tui = { requestRender: vi.fn() };
  const theme = {
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
      const donePromise = new Promise((resolve) => {
        done = (result: unknown) => resolve(result);
      });
      const handle = new FakeOverlayHandle();
      overlayHandles.push(handle);
      options?.onHandle?.(handle);
      const component = await factory(tui as any, theme as any, keybindings as any, done);
      overlays.push({ factoryOptions: options, done, component });
      return undefined;
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

  async function runSessionStart() {
    const list = handlers.get("session_start") ?? [];
    for (const handler of list) {
      await handler({}, baseCtx);
    }
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
    runSessionStart,
    command,
    latestOverlayComponent,
    latestWidgetFactory,
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
    streamSimpleMock.mockReset();
    completeSimpleMock.mockReset();
  });

  it("keeps the thread after Escape dismissal and restores it on reopen", async () => {
    const harness = createHarness();
    streamSimpleMock.mockImplementation(() => streamAnswer("First answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    expect(harness.entries.filter((entry) => entry.customType === "btw-thread-entry")).toHaveLength(1);
    expect(harness.overlayHandles).toHaveLength(1);

    const overlay = harness.latestOverlayComponent();
    overlay.input.onEscape?.();
    await flushAsyncWork();

    await harness.command("btw", "");
    expect(harness.overlayHandles).toHaveLength(2);

    const reopened = harness.latestOverlayComponent();
    reopened.refresh();
    const transcriptLines = reopened.transcript.children.map((child: any) => child.text);
    expect(transcriptLines.join("\n")).toContain("You  first question");
    expect(transcriptLines.join("\n")).toContain("Assistant");
    expect(transcriptLines.join("\n")).toContain("First answer");
    expect(reopened.statusText.text).toContain("Ready for a follow-up");
  });

  it("supports an in-place follow-up and preserves both turns in one thread", async () => {
    const harness = createHarness();
    streamSimpleMock
      .mockImplementationOnce(() => streamAnswer("First answer"))
      .mockImplementationOnce(() => streamAnswer("Second answer"));

    await harness.runSessionStart();
    await harness.command("btw", "first question");

    const overlay = harness.latestOverlayComponent();
    overlay.input.onSubmit?.("follow-up question");
    await flushAsyncWork();

    const threadEntries = harness.entries.filter((entry) => entry.customType === "btw-thread-entry");
    expect(threadEntries).toHaveLength(2);

    overlay.refresh();
    const transcript = overlay.transcript.children.map((child: any) => child.text).join("\n");
    expect(transcript).toContain("You  first question");
    expect(transcript).toContain("First answer");
    expect(transcript).toContain("You  follow-up question");
    expect(transcript).toContain("Second answer");
    expect(overlay.statusText.text).toContain("Ready for a follow-up");
  });

  it("surfaces missing credentials as an explicit error without creating a thread entry", async () => {
    const harness = createHarness();
    harness.setCredentials(false);

    await harness.runSessionStart();
    await harness.command("btw", "why did this fail?");

    expect(harness.entries.filter((entry) => entry.customType === "btw-thread-entry")).toHaveLength(0);
    const overlay = harness.latestOverlayComponent();
    overlay.refresh();
    expect(overlay.statusText.text).toContain("No credentials available for test-provider/test-model.");
    expect(harness.notifications.at(-1)).toEqual({
      message: "No credentials available for test-provider/test-model.",
      type: "error",
    });
  });

  it("keeps the main session visible by rendering BTW as an overlay, not a replacement widget", async () => {
    const harness = createHarness();
    streamSimpleMock.mockImplementation(() => streamAnswer("Overlay answer"));

    await harness.runSessionStart();
    await harness.command("btw", "overlay question");

    expect(harness.overlays.at(-1)?.factoryOptions).toMatchObject({ overlay: true });
    const widgetFactory = harness.latestWidgetFactory();
    expect(widgetFactory).toBeTypeOf("function");
  });
});
