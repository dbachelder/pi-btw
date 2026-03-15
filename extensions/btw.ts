import {
  buildSessionContext,
  createAgentSession,
  createExtensionRuntime,
  codingTools,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import {
  completeSimple,
  type AssistantMessage,
  type Message,
  type ThinkingLevel as AiThinkingLevel,
} from "@mariozechner/pi-ai";
import {
  Box,
  Container,
  Input,
  Key,
  Text,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Focusable,
  type KeybindingsManager,
  type OverlayHandle,
  type TUI,
} from "@mariozechner/pi-tui";

const BTW_MESSAGE_TYPE = "btw-note";
const BTW_ENTRY_TYPE = "btw-thread-entry";
const BTW_RESET_TYPE = "btw-thread-reset";

const BTW_SYSTEM_PROMPT = [
  "You are having an aside conversation with the user, separate from their main working session.",
  "If main session messages are provided, they are for context only — that work is being handled by another agent.",
  "If no main session messages are provided, treat this as a fully contextless tangent thread and rely only on the user's words plus your general instructions.",
  "Focus on answering the user's side questions, helping them think through ideas, or planning next steps.",
  "Do not act as if you need to continue unfinished work from the main session unless the user explicitly asks you to prepare something for injection back to it.",
].join(" ");

type SessionThinkingLevel = "off" | AiThinkingLevel;
type BtwThreadMode = "contextual" | "tangent";

type BtwDetails = {
  question: string;
  thinking: string;
  answer: string;
  provider: string;
  model: string;
  thinkingLevel: SessionThinkingLevel;
  timestamp: number;
  usage?: AssistantMessage["usage"];
};

type ParsedBtwArgs = {
  question: string;
  save: boolean;
};

type SaveState = "not-saved" | "saved" | "queued";

type BtwResetDetails = {
  timestamp: number;
  mode?: BtwThreadMode;
};

type BtwSlot = {
  question: string;
  modelLabel: string;
  thinking: string;
  toolActivity: string[];
  answer: string;
  done: boolean;
};

type BtwSessionRuntime = {
  session: AgentSession;
  mode: BtwThreadMode;
  subscriptions: Set<() => void>;
};

type OverlayRuntime = {
  handle?: OverlayHandle;
  refresh?: () => void;
  close?: () => void;
  finish?: () => void;
  setDraft?: (value: string) => void;
  closed?: boolean;
};

function isVisibleBtwMessage(message: { role: string; customType?: string }): boolean {
  return message.role === "custom" && message.customType === BTW_MESSAGE_TYPE;
}

function isCustomEntry(entry: unknown, customType: string): entry is { type: "custom"; customType: string; data?: unknown } {
  return !!entry && typeof entry === "object" && (entry as { type?: string }).type === "custom" && (entry as { customType?: string }).customType === customType;
}

function stripDynamicSystemPromptFooter(systemPrompt: string): string {
  return systemPrompt
    .replace(/\nCurrent date and time:[^\n]*(?:\nCurrent working directory:[^\n]*)?$/u, "")
    .replace(/\nCurrent working directory:[^\n]*$/u, "")
    .trim();
}

function createBtwResourceLoader(ctx: ExtensionCommandContext): ResourceLoader {
  const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  const systemPrompt = stripDynamicSystemPromptFooter(ctx.getSystemPrompt());

  return {
    getExtensions: () => extensionsResult,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [BTW_SYSTEM_PROMPT],
    getPathMetadata: () => new Map(),
    extendResources: () => {},
    reload: async () => {},
  };
}

function extractText(parts: AssistantMessage["content"], type: "text" | "thinking"): string {
  const chunks: string[] = [];

  for (const part of parts) {
    if (type === "text" && part.type === "text") {
      chunks.push(part.text);
    } else if (type === "thinking" && part.type === "thinking") {
      chunks.push(part.thinking);
    }
  }

  return chunks.join("\n").trim();
}

function extractAnswer(message: AssistantMessage): string {
  return extractText(message.content, "text") || "(No text response)";
}

function extractThinking(message: AssistantMessage): string {
  return extractText(message.content, "thinking");
}

function parseBtwArgs(args: string): ParsedBtwArgs {
  const save = /(?:^|\s)(?:--save|-s)(?=\s|$)/.test(args);
  const question = args.replace(/(?:^|\s)(?:--save|-s)(?=\s|$)/g, " ").trim();
  return { question, save };
}

function buildMainMessages(ctx: ExtensionCommandContext): Message[] {
  try {
    const sessionContext = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
    return sessionContext.messages.filter((message) => !isVisibleBtwMessage(message));
  } catch {
    return ctx.sessionManager
      .getEntries()
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }

        const message = entry as Partial<Message> & { role?: string; customType?: string; content?: unknown };
        if (typeof message.role !== "string" || !Array.isArray(message.content)) {
          return [];
        }

        return isVisibleBtwMessage({ role: message.role, customType: message.customType }) ? [] : [message as Message];
      });
  }
}

function buildBtwSeedMessages(
  ctx: ExtensionCommandContext,
  thread: BtwDetails[],
  mode: BtwThreadMode,
): Message[] {
  const messages: Message[] = mode === "contextual" ? [...buildMainMessages(ctx)] : [];

  if (thread.length > 0) {
    messages.push(
      {
        role: "user",
        content: [{ type: "text", text: "[The following is a separate side conversation. Continue this thread.]" }],
        timestamp: Date.now(),
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Understood, continuing our side conversation." }],
        provider: ctx.model?.provider ?? "unknown",
        model: ctx.model?.id ?? "unknown",
        api: ctx.model?.api ?? "openai-responses",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    );

    for (const entry of thread) {
      messages.push(
        {
          role: "user",
          content: [{ type: "text", text: entry.question }],
          timestamp: entry.timestamp,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: entry.answer }],
          provider: entry.provider,
          model: entry.model,
          api: ctx.model?.api ?? "openai-responses",
          usage:
            entry.usage ?? {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          stopReason: "stop",
          timestamp: entry.timestamp,
        },
      );
    }
  }

  return messages;
}

function formatToolPreview(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  try {
    const preview = JSON.stringify(value);
    if (!preview || preview === "{}") {
      return "";
    }
    return preview.length > 120 ? `${preview.slice(0, 117)}...` : preview;
  } catch {
    return "";
  }
}

function appendToolActivity(slot: BtwSlot, line: string): void {
  if (!line) {
    return;
  }

  if (slot.toolActivity.at(-1) === line) {
    return;
  }

  slot.toolActivity.push(line);
}

function applyAssistantMessageToSlot(slot: BtwSlot, message: AgentSessionEvent extends { message: infer T } ? T : never): void {
  if (!message || typeof message !== "object" || (message as { role?: string }).role !== "assistant") {
    return;
  }

  const assistantMessage = message as AssistantMessage;
  const thinking = extractThinking(assistantMessage);
  const answer = extractAnswer(assistantMessage);

  if (thinking) {
    slot.thinking = thinking;
  }

  if (answer && answer !== "(No text response)") {
    slot.answer = answer;
  }
}

function getLastAssistantMessage(session: AgentSession): AssistantMessage | null {
  for (let i = session.state.messages.length - 1; i >= 0; i--) {
    const message = session.state.messages[i];
    if (message.role === "assistant") {
      return message as AssistantMessage;
    }
  }

  return null;
}

function buildBtwMessageContent(question: string, answer: string): string {
  return `Q: ${question}\n\nA: ${answer}`;
}

function formatThread(thread: BtwDetails[]): string {
  return thread.map((entry) => `User: ${entry.question.trim()}\nAssistant: ${entry.answer.trim()}`).join("\n\n---\n\n");
}

function saveVisibleBtwNote(
  pi: ExtensionAPI,
  details: BtwDetails,
  saveRequested: boolean,
  wasBusy: boolean,
): SaveState {
  if (!saveRequested) {
    return "not-saved";
  }

  const message = {
    customType: BTW_MESSAGE_TYPE,
    content: buildBtwMessageContent(details.question, details.answer),
    display: true,
    details,
  };

  if (wasBusy) {
    pi.sendMessage(message, { deliverAs: "followUp" });
    return "queued";
  }

  pi.sendMessage(message);
  return "saved";
}

function notify(ctx: ExtensionContext | ExtensionCommandContext, message: string, level: "info" | "warning" | "error"): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  }
}

function getOverlayTitle(mode: BtwThreadMode): string {
  return mode === "tangent" ? "BTW tangent" : "BTW";
}

function buildTranscriptBadge(
  theme: ExtensionContext["ui"]["theme"],
  label: string,
  background: string,
  foreground: string,
): string {
  return theme.bg(background, theme.fg(foreground, theme.bold(` ${label} `)));
}

function buildOverlayTranscript(slots: BtwSlot[], theme: ExtensionContext["ui"]["theme"]): string[] {
  if (slots.length === 0) {
    return [theme.fg("dim", "No BTW thread yet. Ask a side question to start one.")];
  }

  const lines: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (i > 0) {
      lines.push("", theme.fg("borderMuted", "────────────────────────────────────────"));
    }

    const userBadge = buildTranscriptBadge(theme, "You", "userMessageBg", "accent");
    const thinkingBadge = buildTranscriptBadge(theme, "Thinking", "toolPendingBg", "warning");
    const assistantBadge = buildTranscriptBadge(theme, "Assistant", "customMessageBg", "success");

    lines.push(`${userBadge} ${slot.question}`);

    if (slot.thinking) {
      lines.push(
        "",
        !slot.done && !slot.answer ? `${thinkingBadge} ${theme.fg("warning", "streaming")}` : thinkingBadge,
        theme.fg("warning", slot.thinking),
      );
    }

    if (slot.toolActivity.length > 0) {
      const toolBadge = buildTranscriptBadge(theme, "Tool", "toolPendingBg", "warning");
      lines.push("", toolBadge, ...slot.toolActivity.map((line) => theme.fg("warning", line)));
    }

    if (slot.answer) {
      lines.push("", !slot.done ? `${assistantBadge} ${theme.fg("warning", "▍")}` : assistantBadge, slot.answer);
    } else if (!slot.done) {
      lines.push("", assistantBadge, theme.fg("warning", "⏳ thinking..."));
    }

    lines.push("", theme.fg("dim", `model: ${slot.modelLabel}`));
  }

  return lines;
}

class BtwOverlayComponent extends Container implements Focusable {
  private readonly input: Input;
  private readonly transcript: Container;
  private readonly statusText: Text;
  private readonly modeText: Text;
  private readonly summaryText: Text;
  private readonly hintsText: Text;
  private readonly getSlots: () => BtwSlot[];
  private readonly getStatus: () => string | null;
  private readonly getMode: () => BtwThreadMode;
  private readonly onSubmitCallback: (value: string) => void;
  private readonly onDismissCallback: () => void;
  private readonly tui: TUI;
  private readonly theme: ExtensionContext["ui"]["theme"];
  private transcriptLines: string[] = [];
  private transcriptScrollOffset = 0;
  private transcriptViewportHeight = 8;
  private followTranscript = true;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(
    tui: TUI,
    theme: ExtensionContext["ui"]["theme"],
    keybindings: KeybindingsManager,
    getSlots: () => BtwSlot[],
    getStatus: () => string | null,
    getMode: () => BtwThreadMode,
    onSubmit: (value: string) => void,
    onDismiss: () => void,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.getSlots = getSlots;
    this.getStatus = getStatus;
    this.getMode = getMode;
    this.onSubmitCallback = onSubmit;
    this.onDismissCallback = onDismiss;

    this.modeText = new Text("", 1, 0);
    this.summaryText = new Text("", 1, 0);
    this.transcript = new Container();
    this.statusText = new Text("", 1, 0);

    this.input = new Input();
    this.input.onSubmit = (value) => {
      this.followTranscript = true;
      this.onSubmitCallback(value);
    };
    this.input.onEscape = () => {
      this.onDismissCallback();
    };

    this.hintsText = new Text("", 1, 0);

    const originalHandleInput = this.input.handleInput.bind(this.input);
    this.input.handleInput = (data: string) => {
      if (keybindings.matches(data, "selectCancel")) {
        this.onDismissCallback();
        return;
      }
      originalHandleInput(data);
    };

    this.refresh();
  }

  private frameLine(content: string, innerWidth: number): string {
    const truncated = truncateToWidth(content, innerWidth, "");
    const padding = Math.max(0, innerWidth - visibleWidth(truncated));
    return `${this.theme.fg("borderMuted", "│")} ${truncated}${" ".repeat(padding)} ${this.theme.fg("borderMuted", "│")}`;
  }

  private ruleLine(innerWidth: number): string {
    return this.theme.fg("borderMuted", `├${"─".repeat(innerWidth + 2)}┤`);
  }

  private wrapTranscript(innerWidth: number): string[] {
    const wrapped: string[] = [];
    for (const line of this.transcriptLines) {
      if (!line) {
        wrapped.push("");
        continue;
      }
      wrapped.push(...wrapTextWithAnsi(line, Math.max(1, innerWidth)));
    }
    return wrapped;
  }

  private getDialogHeight(): number {
    const terminalRows = process.stdout.rows ?? 30;
    return Math.max(16, Math.min(24, Math.floor(terminalRows * 0.7)));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.pageUp)) {
      this.followTranscript = false;
      this.transcriptScrollOffset = Math.max(0, this.transcriptScrollOffset - Math.max(1, this.transcriptViewportHeight - 1));
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.pageDown)) {
      this.transcriptScrollOffset += Math.max(1, this.transcriptViewportHeight - 1);
      this.tui.requestRender();
      return;
    }

    this.input.handleInput(data);
  }

  override render(width: number): string[] {
    const dialogWidth = Math.max(24, width);
    const innerWidth = Math.max(20, dialogWidth - 4);
    const dialogHeight = this.getDialogHeight();
    const transcriptHeight = Math.max(6, dialogHeight - 8);
    this.transcriptViewportHeight = transcriptHeight;

    const transcriptLines = this.wrapTranscript(innerWidth);
    const maxScroll = Math.max(0, transcriptLines.length - transcriptHeight);
    if (this.followTranscript) {
      this.transcriptScrollOffset = maxScroll;
    } else {
      this.transcriptScrollOffset = Math.max(0, Math.min(this.transcriptScrollOffset, maxScroll));
      if (this.transcriptScrollOffset >= maxScroll) {
        this.followTranscript = true;
      }
    }

    const visibleTranscript = transcriptLines.slice(
      this.transcriptScrollOffset,
      this.transcriptScrollOffset + transcriptHeight,
    );
    const transcriptPadCount = Math.max(0, transcriptHeight - visibleTranscript.length);
    const hiddenAbove = this.transcriptScrollOffset;
    const hiddenBelow = Math.max(0, maxScroll - this.transcriptScrollOffset);
    const summary =
      hiddenAbove || hiddenBelow
        ? `${this.summaryText.text.trim()} · ↑${hiddenAbove} ↓${hiddenBelow}`
        : this.summaryText.text.trim();

    const inputLine = this.input.render(innerWidth)[0] ?? "";
    const lines = [this.theme.fg("accent", `┌${"─".repeat(innerWidth + 2)}┐`)];

    lines.push(this.frameLine(this.theme.fg("accent", this.theme.bold(this.modeText.text.trim())), innerWidth));
    lines.push(this.frameLine(this.theme.fg("dim", summary), innerWidth));
    lines.push(this.ruleLine(innerWidth));

    for (const line of visibleTranscript) {
      lines.push(this.frameLine(line, innerWidth));
    }
    for (let i = 0; i < transcriptPadCount; i++) {
      lines.push(this.frameLine("", innerWidth));
    }

    lines.push(this.ruleLine(innerWidth));
    lines.push(this.frameLine(this.theme.fg("warning", this.statusText.text.trim()), innerWidth));
    lines.push(this.frameLine(inputLine, innerWidth));
    lines.push(this.frameLine(this.theme.fg("dim", this.hintsText.text.trim()), innerWidth));
    lines.push(this.theme.fg("accent", `└${"─".repeat(innerWidth + 2)}┘`));

    return lines;
  }

  setDraft(value: string): void {
    this.input.setValue(value);
    this.tui.requestRender();
  }

  getDraft(): string {
    return this.input.getValue();
  }

  refresh(): void {
    this.modeText.setText(`${getOverlayTitle(this.getMode())} · hidden thread preserved`);
    const slots = this.getSlots();
    const exchanges = slots.filter((slot) => slot.done).length;
    const active = slots.some((slot) => !slot.done) ? " · streaming" : " · idle";
    this.summaryText.setText(`${exchanges} exchange${exchanges === 1 ? "" : "s"}${active}`);

    this.transcriptLines = buildOverlayTranscript(slots, this.theme);
    this.transcript.clear();
    for (const line of this.transcriptLines) {
      this.transcript.addChild(new Text(line, 1, 0));
    }

    const status = this.getStatus() ?? "Ready. Enter submits; Escape dismisses without clearing.";
    this.statusText.setText(status);
    this.hintsText.setText("Enter submit · Escape dismiss · PgUp/PgDn scroll · /btw:clear resets thread");
    this.tui.requestRender();
  }
}

export default function (pi: ExtensionAPI) {
  let pendingThread: BtwDetails[] = [];
  let pendingMode: BtwThreadMode = "contextual";
  let slots: BtwSlot[] = [];
  let overlayStatus: string | null = null;
  let overlayDraft = "";
  let overlayRuntime: OverlayRuntime | null = null;
  let lastUiContext: ExtensionContext | ExtensionCommandContext | null = null;
  let activeBtwSession: BtwSessionRuntime | null = null;

  function syncUi(ctx?: ExtensionContext | ExtensionCommandContext): void {
    const activeCtx = ctx ?? lastUiContext;
    if (activeCtx?.hasUI) {
      activeCtx.ui.setWidget("btw", undefined);
      overlayRuntime?.refresh?.();
    }
  }

  function setOverlayStatus(status: string | null, ctx?: ExtensionContext | ExtensionCommandContext): void {
    overlayStatus = status;
    syncUi(ctx);
  }

  function setOverlayDraft(value: string): void {
    overlayDraft = value;
    overlayRuntime?.setDraft?.(value);
  }

  function dismissOverlay(): void {
    overlayRuntime?.close?.();
    overlayRuntime = null;
  }

  async function disposeBtwSession(): Promise<void> {
    const current = activeBtwSession;
    activeBtwSession = null;
    if (!current) {
      return;
    }

    for (const unsubscribe of [...current.subscriptions]) {
      try {
        unsubscribe();
      } catch {
        // Ignore unsubscribe errors during BTW session replacement/shutdown.
      }
    }
    current.subscriptions.clear();

    try {
      await current.session.abort();
    } catch {
      // Ignore abort errors during BTW session replacement/shutdown.
    }

    current.session.dispose();
  }

  async function dismissOverlaySession(): Promise<void> {
    dismissOverlay();
    await disposeBtwSession();
  }

  async function createBtwSubSession(ctx: ExtensionCommandContext, mode: BtwThreadMode): Promise<BtwSessionRuntime> {
    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model: ctx.model,
      modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
      thinkingLevel: pi.getThinkingLevel() as SessionThinkingLevel,
      tools: codingTools,
      resourceLoader: createBtwResourceLoader(ctx),
    });

    const seedMessages = buildBtwSeedMessages(ctx, pendingThread, mode);
    if (seedMessages.length > 0) {
      session.agent.replaceMessages(seedMessages as typeof session.state.messages);
    }

    return { session, mode, subscriptions: new Set() };
  }

  async function ensureBtwSession(ctx: ExtensionCommandContext, mode: BtwThreadMode): Promise<BtwSessionRuntime | null> {
    if (!ctx.model) {
      return null;
    }

    if (activeBtwSession?.mode === mode) {
      return activeBtwSession;
    }

    await disposeBtwSession();
    activeBtwSession = await createBtwSubSession(ctx, mode);
    return activeBtwSession;
  }

  async function ensureOverlay(ctx: ExtensionCommandContext | ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      return;
    }
    lastUiContext = ctx;

    if (overlayRuntime?.handle) {
      overlayRuntime.handle.setHidden(false);
      overlayRuntime.handle.focus();
      overlayRuntime.refresh?.();
      return;
    }

    const runtime: OverlayRuntime = {};
    const closeRuntime = () => {
      if (runtime.closed) {
        return;
      }
      runtime.closed = true;
      runtime.handle?.hide();
      if (overlayRuntime === runtime) {
        overlayRuntime = null;
      }
      runtime.finish?.();
    };

    runtime.close = closeRuntime;
    overlayRuntime = runtime;

    void ctx.ui
      .custom<void>(
        async (tui, theme, keybindings, done) => {
          runtime.finish = () => {
            done();
          };

          const overlay = new BtwOverlayComponent(
            tui,
            theme,
            keybindings,
            () => slots,
            () => overlayStatus,
            () => pendingMode,
            (value) => {
              void submitFromOverlay(ctx, value);
            },
            () => {
              void dismissOverlaySession();
            },
          );

          overlay.setDraft(overlayDraft);
          runtime.setDraft = (value) => {
            overlay.setDraft(value);
          };
          runtime.refresh = () => {
            overlay.refresh();
            if (!runtime.handle?.isFocused()) {
              overlay.focused = false;
            }
          };
          runtime.close = () => {
            overlayDraft = overlay.getDraft();
            closeRuntime();
          };

          if (runtime.closed) {
            done();
          }

          return overlay;
        },
        {
          overlay: true,
          overlayOptions: {
            width: "78%",
            minWidth: 72,
            maxHeight: "78%",
            anchor: "center",
            margin: 1,
          },
          onHandle: (handle) => {
            runtime.handle = handle;
            handle.focus();
            if (runtime.closed) {
              closeRuntime();
            }
          },
        },
      )
      .catch((error) => {
        if (overlayRuntime === runtime) {
          overlayRuntime = null;
        }
        notify(ctx, error instanceof Error ? error.message : String(error), "error");
      });
  }

  async function dispatchBtwCommand(name: string, args: string, ctx: ExtensionCommandContext): Promise<boolean> {
    const trimmedArgs = args.trim();

    if (name === "btw") {
      const { question, save } = parseBtwArgs(trimmedArgs);
      if (!question) {
        await ensureBtwSession(ctx, pendingMode);
        await ensureOverlay(ctx);
        return true;
      }

      if (pendingMode !== "contextual") {
        await resetThread(ctx, true, "contextual");
      }

      await runBtw(ctx, question, save, "contextual");
      return true;
    }

    if (name === "btw:tangent") {
      const { question, save } = parseBtwArgs(trimmedArgs);
      if (pendingMode !== "tangent") {
        await resetThread(ctx, true, "tangent");
      }

      if (!question) {
        await ensureBtwSession(ctx, "tangent");
        await ensureOverlay(ctx);
        return true;
      }

      await runBtw(ctx, question, save, "tangent");
      return true;
    }

    if (name === "btw:new") {
      await resetThread(ctx, true, "contextual");
      const { question, save } = parseBtwArgs(trimmedArgs);
      if (question) {
        await runBtw(ctx, question, save, "contextual");
      } else {
        await ensureBtwSession(ctx, "contextual");
        setOverlayStatus("Started a fresh BTW thread.", ctx);
        await ensureOverlay(ctx);
        notify(ctx, "Started a fresh BTW thread.", "info");
      }
      return true;
    }

    if (name === "btw:clear") {
      await resetThread(ctx);
      dismissOverlay();
      notify(ctx, "Cleared BTW thread.", "info");
      return true;
    }

    if (name === "btw:inject") {
      if (pendingThread.length === 0) {
        notify(ctx, "No BTW thread to inject.", "warning");
        return true;
      }

      const instructions = trimmedArgs;
      const content = instructions
        ? `Here is a side conversation I had. ${instructions}\n\n${formatThread(pendingThread)}`
        : `Here is a side conversation I had for additional context:\n\n${formatThread(pendingThread)}`;

      sendThreadToMain(ctx, content);
      const count = pendingThread.length;
      await resetThread(ctx);
      dismissOverlay();
      notify(ctx, `Injected BTW thread (${count} exchange${count === 1 ? "" : "s"}).`, "info");
      return true;
    }

    if (name === "btw:summarize") {
      if (pendingThread.length === 0) {
        notify(ctx, "No BTW thread to summarize.", "warning");
        return true;
      }

      setOverlayStatus("⏳ summarizing...", ctx);
      await ensureOverlay(ctx);

      try {
        const summary = await summarizeThread(ctx, pendingThread);
        const instructions = trimmedArgs;
        const content = instructions
          ? `Here is a summary of a side conversation I had. ${instructions}\n\n${summary}`
          : `Here is a summary of a side conversation I had:\n\n${summary}`;

        sendThreadToMain(ctx, content);
        const count = pendingThread.length;
        await resetThread(ctx);
        dismissOverlay();
        notify(ctx, `Injected BTW summary (${count} exchange${count === 1 ? "" : "s"}).`, "info");
      } catch (error) {
        setOverlayStatus("Summarize failed. Thread preserved for retry or injection.", ctx);
        notify(ctx, error instanceof Error ? error.message : String(error), "error");
      }
      return true;
    }

    return false;
  }

  function parseOverlaySlashCommand(value: string): { name: string; args: string } | null {
    const trimmed = value.trim();
    const match = trimmed.match(/^\/(btw(?::(?:new|tangent|clear|inject|summarize))?)(?:\s+(.*))?$/);
    if (!match) {
      return null;
    }

    return {
      name: match[1],
      args: match[2]?.trim() ?? "",
    };
  }

  async function submitFromOverlay(ctx: ExtensionCommandContext | ExtensionContext, value: string): Promise<void> {
    const question = value.trim();
    if (!question) {
      setOverlayStatus("Enter a BTW prompt before submitting.", ctx);
      return;
    }

    if (!("getSystemPrompt" in ctx)) {
      setOverlayStatus("BTW overlay submit requires a command context. Reopen BTW from a command.", ctx);
      return;
    }

    const slashCommand = parseOverlaySlashCommand(question);

    if (question.startsWith("/") && !slashCommand) {
      const message = "Unsupported slash input in BTW. Only /btw, /btw:new, /btw:tangent, /btw:clear, /btw:inject, and /btw:summarize run inside the modal.";
      setOverlayStatus(message, ctx);
      notify(ctx, message, "warning");
      await ensureOverlay(ctx);
      return;
    }

    if (slashCommand) {
      setOverlayDraft("");
      await dispatchBtwCommand(slashCommand.name, slashCommand.args, ctx);
      return;
    }

    setOverlayDraft("");
    setOverlayStatus("⏳ streaming...", ctx);
    syncUi(ctx);
    await runBtw(ctx, question, false, pendingMode);
  }

  async function resetThread(
    ctx: ExtensionContext | ExtensionCommandContext,
    persist = true,
    mode: BtwThreadMode = "contextual",
  ): Promise<void> {
    await disposeBtwSession();
    pendingThread = [];
    pendingMode = mode;
    slots = [];
    setOverlayDraft("");
    setOverlayStatus(null, ctx);
    if (persist) {
      const details: BtwResetDetails = { timestamp: Date.now(), mode };
      pi.appendEntry(BTW_RESET_TYPE, details);
    }
    syncUi(ctx);
  }

  async function restoreThread(ctx: ExtensionContext): Promise<void> {
    await disposeBtwSession();
    pendingThread = [];
    pendingMode = "contextual";
    slots = [];
    overlayDraft = "";
    lastUiContext = ctx;
    overlayStatus = null;

    const branch = ctx.sessionManager.getBranch();
    let lastResetIndex = -1;

    for (let i = 0; i < branch.length; i++) {
      if (isCustomEntry(branch[i], BTW_RESET_TYPE)) {
        lastResetIndex = i;
        const details = branch[i].data as BtwResetDetails | undefined;
        pendingMode = details?.mode ?? "contextual";
      }
    }

    for (const entry of branch.slice(lastResetIndex + 1)) {
      if (!isCustomEntry(entry, BTW_ENTRY_TYPE)) {
        continue;
      }

      const details = entry.data as BtwDetails | undefined;
      if (!details?.question || !details.answer) {
        continue;
      }

      pendingThread.push(details);
      slots.push({
        question: details.question,
        modelLabel: `${details.provider}/${details.model}`,
        thinking: details.thinking || "",
        toolActivity: [],
        answer: details.answer,
        done: true,
      });
    }

    syncUi(ctx);
  }

  async function runBtw(
    ctx: ExtensionCommandContext,
    question: string,
    saveRequested: boolean,
    mode: BtwThreadMode,
  ): Promise<void> {
    lastUiContext = ctx;
    const model = ctx.model;
    if (!model) {
      setOverlayStatus("No active model selected.", ctx);
      notify(ctx, "No active model selected.", "error");
      return;
    }

    const apiKey = await ctx.modelRegistry.getApiKey(model);
    if (!apiKey) {
      const message = `No credentials available for ${model.provider}/${model.id}.`;
      setOverlayStatus(message, ctx);
      notify(ctx, message, "error");
      await ensureOverlay(ctx);
      return;
    }

    const sessionRuntime = await ensureBtwSession(ctx, mode);
    if (!sessionRuntime) {
      setOverlayStatus("No active model selected.", ctx);
      notify(ctx, "No active model selected.", "error");
      return;
    }

    const session = sessionRuntime.session;
    const wasBusy = !ctx.isIdle();
    pendingMode = mode;
    const thinkingLevel = pi.getThinkingLevel() as SessionThinkingLevel;
    const slot: BtwSlot = {
      question,
      modelLabel: `${model.provider}/${model.id}`,
      thinking: "",
      toolActivity: [],
      answer: "",
      done: false,
    };

    slots.push(slot);
    setOverlayStatus("⏳ streaming...", ctx);
    await ensureOverlay(ctx);

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
        applyAssistantMessageToSlot(slot, event.message);
        syncUi(ctx);
        return;
      }

      if (event.type === "tool_execution_start") {
        const preview = formatToolPreview(event.args);
        appendToolActivity(slot, `→ ${event.toolName}${preview ? ` ${preview}` : ""}`);
        setOverlayStatus(`⏳ running tool: ${event.toolName}`, ctx);
        syncUi(ctx);
        return;
      }

      if (event.type === "tool_execution_end") {
        appendToolActivity(slot, `${event.isError ? "✗" : "✓"} ${event.toolName}`);
        setOverlayStatus(session.isStreaming ? `⏳ running tool: ${event.toolName}` : "⏳ streaming...", ctx);
        syncUi(ctx);
      }
    });
    sessionRuntime.subscriptions.add(unsubscribe);

    try {
      await session.prompt(question, { source: "extension" });

      const response = getLastAssistantMessage(session);
      if (!response) {
        throw new Error("BTW request finished without a response.");
      }
      if (response.stopReason === "aborted") {
        const slotIndex = slots.indexOf(slot);
        if (slotIndex >= 0) {
          slots.splice(slotIndex, 1);
          setOverlayStatus("Request aborted.", ctx);
        }
        return;
      }
      if (response.stopReason === "error") {
        throw new Error(response.errorMessage || "BTW request failed.");
      }

      const answer = extractAnswer(response);
      const thinking = extractThinking(response) || slot.thinking;
      slot.thinking = thinking;
      slot.answer = answer;
      slot.done = true;

      const details: BtwDetails = {
        question,
        thinking,
        answer,
        provider: model.provider,
        model: model.id,
        thinkingLevel,
        timestamp: Date.now(),
        usage: response.usage,
      };

      pendingThread.push(details);
      pi.appendEntry(BTW_ENTRY_TYPE, details);

      const saveState = saveVisibleBtwNote(pi, details, saveRequested, wasBusy);
      if (saveState === "saved") {
        notify(ctx, "Saved BTW note to the session.", "info");
        setOverlayStatus("Saved BTW note to the session.", ctx);
      } else if (saveState === "queued") {
        notify(ctx, "BTW note queued to save after the current turn finishes.", "info");
        setOverlayStatus("BTW note queued to save after the current turn finishes.", ctx);
      } else {
        setOverlayStatus("Ready for a follow-up. Hidden BTW thread updated.", ctx);
      }
    } catch (error) {
      slot.answer = `❌ ${error instanceof Error ? error.message : String(error)}`;
      slot.done = true;
      setOverlayStatus("Request failed. Thread preserved for retry or follow-up.", ctx);
      notify(ctx, error instanceof Error ? error.message : String(error), "error");
      await disposeBtwSession();
    } finally {
      sessionRuntime.subscriptions.delete(unsubscribe);
      unsubscribe();
      syncUi(ctx);
    }
  }

  async function summarizeThread(ctx: ExtensionCommandContext, thread: BtwDetails[]): Promise<string> {
    const model = ctx.model;
    if (!model) {
      throw new Error("No active model selected.");
    }

    const apiKey = await ctx.modelRegistry.getApiKey(model);
    if (!apiKey) {
      throw new Error(`No credentials available for ${model.provider}/${model.id}.`);
    }

    const response = await completeSimple(
      model,
      {
        systemPrompt: "Summarize the side conversation concisely. Preserve key decisions, plans, insights, risks, and action items. Output only the summary.",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: formatThread(thread) }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        reasoning: "low",
      },
    );

    if (response.stopReason === "error") {
      throw new Error(response.errorMessage || "Failed to summarize BTW thread.");
    }
    if (response.stopReason === "aborted") {
      throw new Error("BTW summarize aborted.");
    }

    return extractAnswer(response);
  }

  function sendThreadToMain(ctx: ExtensionCommandContext, content: string): void {
    if (ctx.isIdle()) {
      pi.sendUserMessage(content);
    } else {
      pi.sendUserMessage(content, { deliverAs: "followUp" });
    }
  }

  pi.registerMessageRenderer(BTW_MESSAGE_TYPE, (message, { expanded }, theme) => {
    const details = message.details as BtwDetails | undefined;
    const content = typeof message.content === "string" ? message.content : "[non-text btw message]";
    const lines = [theme.fg("accent", theme.bold("[BTW]")), content];

    if (expanded && details) {
      lines.push(
        theme.fg("dim", `model: ${details.provider}/${details.model} · thinking: ${details.thinkingLevel}`),
      );

      if (details.usage) {
        lines.push(
          theme.fg(
            "dim",
            `tokens: in ${details.usage.input} · out ${details.usage.output} · total ${details.usage.totalTokens}`,
          ),
        );
      }
    }

    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(lines.join("\n"), 0, 0));
    return box;
  });

  pi.on("context", async (event) => {
    return {
      messages: event.messages.filter((message) => !isVisibleBtwMessage(message)),
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    await restoreThread(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    await restoreThread(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    await restoreThread(ctx);
  });

  pi.on("session_shutdown", async () => {
    await disposeBtwSession();
    dismissOverlay();
  });

  pi.registerCommand("btw", {
    description: "Continue a side conversation in a focused BTW modal. Add --save to also persist a visible note.",
    handler: async (args, ctx) => {
      await dispatchBtwCommand("btw", args, ctx);
    },
  });

  pi.registerCommand("btw:tangent", {
    description: "Start or continue a contextless BTW tangent in the focused BTW modal.",
    handler: async (args, ctx) => {
      await dispatchBtwCommand("btw:tangent", args, ctx);
    },
  });

  pi.registerCommand("btw:new", {
    description: "Start a fresh BTW thread with main-session context. Optionally ask the first question immediately.",
    handler: async (args, ctx) => {
      await dispatchBtwCommand("btw:new", args, ctx);
    },
  });

  pi.registerCommand("btw:clear", {
    description: "Dismiss the BTW modal/widget and clear the current thread.",
    handler: async (args, ctx) => {
      await dispatchBtwCommand("btw:clear", args, ctx);
    },
  });

  pi.registerCommand("btw:inject", {
    description: "Inject the full BTW thread into the main agent as a user message.",
    handler: async (args, ctx) => {
      await dispatchBtwCommand("btw:inject", args, ctx);
    },
  });

  pi.registerCommand("btw:summarize", {
    description: "Summarize the BTW thread, then inject the summary into the main agent.",
    handler: async (args, ctx) => {
      await dispatchBtwCommand("btw:summarize", args, ctx);
    },
  });
}
