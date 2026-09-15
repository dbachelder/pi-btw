import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSessionContext,
  copyToClipboard,
  createAgentSession,
  createExtensionRuntime,
  defineTool,
  getAgentDir,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ResourceLoader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  getSupportedThinkingLevels,
  Type,
  type AssistantMessage,
  type Message,
  type ThinkingLevel as AiThinkingLevel,
  type UserMessage,
} from "@earendil-works/pi-ai";
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
} from "@earendil-works/pi-tui";

const BTW_MESSAGE_TYPE = "btw-note";
const BTW_ENTRY_TYPE = "btw-thread-entry";
const BTW_RESET_TYPE = "btw-thread-reset";
const BTW_MODEL_OVERRIDE_TYPE = "btw-model-override";
const BTW_THINKING_OVERRIDE_TYPE = "btw-thinking-override";
const BTW_FOCUS_SHORTCUTS = [Key.alt("/"), Key.ctrlAlt("w")] as const;

function matchesBtwFocusShortcut(data: string): boolean {
  return BTW_FOCUS_SHORTCUTS.some((shortcut) => matchesKey(data, shortcut));
}

const BTW_SYSTEM_PROMPT = [
  "You are having an aside conversation with the user, separate from their main working session.",
  "If main session messages are provided, they are for context only — that work is being handled by another agent.",
  "If no main session messages are provided, treat this as a fully contextless tangent thread and rely only on the user's words plus your general instructions.",
  "Focus on answering the user's side questions, helping them think through ideas, or planning next steps.",
  "Do not act as if you need to continue unfinished work from the main session unless the user explicitly asks you to prepare something for injection back to it.",
  "You can change the model or thinking level for this side conversation when the user asks by using the configure_btw tool.",
].join(" ");

const BTW_SUMMARIZE_SYSTEM_PROMPT =
  "Summarize the side conversation concisely. Preserve key decisions, plans, insights, risks, and action items. Output only the summary.";

const BTW_CONTINUE_THREAD_USER_TEXT = "[The following is a separate side conversation. Continue this thread.]";
const BTW_CONTINUE_THREAD_ASSISTANT_TEXT = "Understood, continuing our side conversation.";

type SessionThinkingLevel = "off" | AiThinkingLevel;
type BtwThreadMode = "contextual" | "tangent";
type SessionModel = NonNullable<ExtensionCommandContext["model"]>;
/**
 * Model reference persisted to session entries. Resolved to a full SessionModel via ctx.modelRegistry.find(...).
 */
type BtwModelRef = Pick<SessionModel, "provider" | "id" | "api">;

type BtwDetails = {
  question: string;
  thinking: string;
  answer: string;
  provider: string;
  model: string;
  api: string;
  thinkingLevel: SessionThinkingLevel;
  timestamp: number;
  usage?: AssistantMessage["usage"];
};

type ParsedBtwArgs = {
  question: string;
  save: boolean;
  modelQuery?: string;
  thinkingLevel?: SessionThinkingLevel;
};

type SaveState = "not-saved" | "saved" | "queued";

type BtwResetDetails = {
  timestamp: number;
  mode?: BtwThreadMode;
};

type BtwModelOverrideDetails =
  | ({ timestamp: number; action: "set" } & Pick<SessionModel, "provider" | "id" | "api">)
  | { timestamp: number; action: "clear" };

type BtwThinkingOverrideDetails =
  | { timestamp: number; action: "set"; thinkingLevel: SessionThinkingLevel }
  | { timestamp: number; action: "clear" };

type ResolvedBtwModel = {
  model: SessionModel | null;
  source: "override" | "main" | "none";
  configuredOverride: SessionModel | null;
  fallbackReason?: string;
};

type ResolvedBtwSettings = {
  model: SessionModel | null;
  modelSource: "override" | "main" | "none";
  configuredModelOverride: SessionModel | null;
  thinkingLevel: SessionThinkingLevel;
  thinkingSource: "override" | "main";
  fallbackReason?: string;
};

type ModelDisambiguationState = {
  query: string;
  candidates: SessionModel[];
  pendingQuestion?: string;
  save: boolean;
  mode: BtwThreadMode;
};

type BtwTranscriptEntry =
  | { id: number; turnId: number; type: "turn-boundary"; phase: "start" | "end" }
  | { id: number; turnId: number; type: "user-message"; text: string }
  | { id: number; turnId: number; type: "thinking"; text: string; streaming: boolean }
  | { id: number; turnId: number; type: "assistant-text"; text: string; streaming: boolean }
  | { id: number; turnId: number; type: "tool-call"; toolCallId: string; toolName: string; args: string }
  | {
      id: number;
      turnId: number;
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      content: string;
      truncated: boolean;
      isError: boolean;
      streaming: boolean;
    };

type BtwTranscript = BtwTranscriptEntry[];

type BtwTranscriptState = {
  entries: BtwTranscript;
  nextEntryId: number;
  nextTurnId: number;
  currentTurnId: number | null;
  lastTurnId: number | null;
  toolCalls: Map<string, { turnId: number; callEntryId: number; resultEntryId?: number }>;
};

type BtwSessionRuntime = {
  session: AgentSession;
  mode: BtwThreadMode;
  subscriptions: Set<() => void>;
  sideThreadStartIndex: number;
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

function createBtwResourceLoader(
  ctx: ExtensionCommandContext,
  appendSystemPrompt: string[] = [BTW_SYSTEM_PROMPT],
): ResourceLoader {
  const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  const systemPrompt = stripDynamicSystemPromptFooter(ctx.getSystemPrompt());

  return {
    getExtensions: () => extensionsResult,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => appendSystemPrompt,
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
  let raw = args.trim();
  let save = false;
  let modelQuery: string | undefined;
  let thinkingLevel: SessionThinkingLevel | undefined;

  // Extract --save / -s anywhere if present as a standalone flag
  if (/(?:^|\s)(?:--save|-s)(?=\s|$)/.test(raw)) {
    save = true;
    raw = raw.replace(/(?:^|\s)(?:--save|-s)(?=\s|$)/g, " ").trim();
  }

  // Extract --model=... and --thinking=... anywhere if present
  const modelEqMatch = raw.match(/(?:^|\s)(?:--model|-m)=([^\s"']+|"[^"]*"|'[^']*')(?=\s|$)/);
  if (modelEqMatch) {
    modelQuery = modelEqMatch[1].replace(/^["']|["']$/g, "").trim();
    raw = raw.replace(modelEqMatch[0], " ").trim();
  }

  const thinkingEqMatch = raw.match(/(?:^|\s)(?:--thinking|-t)=([^\s"']+|"[^"]*"|'[^']*')(?=\s|$)/);
  if (thinkingEqMatch) {
    thinkingLevel = thinkingEqMatch[1].replace(/^["']|["']$/g, "").trim() as SessionThinkingLevel;
    raw = raw.replace(thinkingEqMatch[0], " ").trim();
  }

  // Next, parse leading space-separated flags (e.g. "--model gpt-5", "-m gpt-5", "--thinking low", "-t low")
  // Only consume from the FRONT of raw until we hit the first non-flag argument.
  while (raw.length > 0) {
    const modelSpaceMatch = raw.match(/^(?:--model|-m)\s+([^\s"']+|"[^"]*"|'[^']*')(?:\s+|$)/);
    if (modelSpaceMatch) {
      if (!modelQuery) {
        modelQuery = modelSpaceMatch[1].replace(/^["']|["']$/g, "").trim();
      }
      raw = raw.slice(modelSpaceMatch[0].length).trim();
      continue;
    }

    const thinkingSpaceMatch = raw.match(/^(?:--thinking|-t)\s+([^\s"']+|"[^"]*"|'[^']*')(?:\s+|$)/);
    if (thinkingSpaceMatch) {
      if (!thinkingLevel) {
        thinkingLevel = thinkingSpaceMatch[1].replace(/^["']|["']$/g, "").trim() as SessionThinkingLevel;
      }
      raw = raw.slice(thinkingSpaceMatch[0].length).trim();
      continue;
    }

    break;
  }

  return {
    question: raw.replace(/\s+/g, " ").trim(),
    save,
    modelQuery: modelQuery || undefined,
    thinkingLevel: thinkingLevel || undefined,
  };
}

const PROVIDER_ALIASES: Record<string, string> = {
  copilot: "github-copilot",
  "github-copilot": "github-copilot",
  bedrock: "amazon-bedrock",
  "amazon-bedrock": "amazon-bedrock",
  vertex: "google-vertex",
  "google-vertex": "google-vertex",
  azure: "azure-openai-responses",
  "azure-openai": "azure-openai-responses",
  openai: "openai",
  anthropic: "anthropic",
  deepseek: "deepseek",
  groq: "groq",
  together: "together",
  openrouter: "openrouter",
};

const CONVERSATIONAL_STOP_WORDS = new Set([
  "the", "a", "an", "model", "models", "use", "to", "switch", "please", "can", "you", "back", "into", "for", "me", "set", "change", "try"
]);

function normalizeModelBaseUrl(
  model: SessionModel,
  apiKey?: string,
  currentModel?: SessionModel | null,
): SessionModel {
  if (model.provider === "github-copilot") {
    if (apiKey) {
      const match = apiKey.match(/proxy-ep=([^;]+)/);
      if (match) {
        const proxyHost = match[1];
        const apiHost = proxyHost.replace(/^proxy\./, "api.");
        return { ...model, baseUrl: `https://${apiHost}` };
      }
    }
    if (currentModel?.provider === "github-copilot" && currentModel.baseUrl) {
      return { ...model, baseUrl: currentModel.baseUrl };
    }
  }
  return model;
}

function getAllAvailableModels(ctx: ExtensionCommandContext): SessionModel[] {
  const models: SessionModel[] = [];
  const seen = new Set<string>();

  const add = (m: SessionModel | null | undefined) => {
    if (!m || !m.provider || !m.id) return;
    const key = `${m.provider}/${m.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      models.push(m);
    }
  };

  if (ctx.model) {
    add(ctx.model);
  }

  const scopedModels = (ctx as any).scopedModels;
  if (Array.isArray(scopedModels)) {
    for (const scoped of scopedModels) {
      add((scoped as any).model ?? scoped);
    }
  }

  if (!process.env.VITEST) {
    try {
      const storePath = join(getAgentDir(), "models-store.json");
      if (existsSync(storePath)) {
        const raw = JSON.parse(readFileSync(storePath, "utf-8"));
        for (const val of Object.values(raw)) {
          if (Array.isArray(val)) {
            for (const m of val) add(m as SessionModel);
          } else if (val && typeof val === "object" && Array.isArray((val as any).models)) {
            for (const m of (val as any).models) add(m as SessionModel);
          }
        }
      }
    } catch {}
  }

  if (typeof (ctx.modelRegistry as any).getAll === "function") {
    for (const m of (ctx.modelRegistry as any).getAll()) {
      add(m);
    }
  }

  return models;
}

type ModelResolutionResult =
  | { status: "resolved"; model: SessionModel }
  | { status: "ambiguous"; candidates: SessionModel[]; reason: string }
  | { status: "not_found"; error: string };

async function resolveBtwModelQuery(
  ctx: ExtensionCommandContext,
  query: string,
): Promise<ModelResolutionResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { status: "not_found", error: "No model query provided." };
  }

  const allModels = getAllAvailableModels(ctx);
  if (allModels.length === 0) {
    return { status: "not_found", error: `No models available in registry to match "${query}".` };
  }

  const normalized = trimmed.toLowerCase();

  // 1. Exact match on provider/id
  const canonicalMatches = allModels.filter(
    (m) => `${m.provider}/${m.id}`.toLowerCase() === normalized,
  );
  if (canonicalMatches.length === 1) {
    return { status: "resolved", model: canonicalMatches[0] };
  }

  // 2. Exact match on id alone
  const exactIdMatches = allModels.filter((m) => m.id.toLowerCase() === normalized);
  if (exactIdMatches.length === 1) {
    return { status: "resolved", model: exactIdMatches[0] };
  }

  // 3. Check if provider was specified via slash or space (e.g. "copilot/gpt-4o", "copilot gpt-4o")
  let candidates: SessionModel[] = [];
  const slashIndex = normalized.indexOf("/");
  const spaceIndex = normalized.indexOf(" ");
  const splitIndex = slashIndex !== -1 ? slashIndex : spaceIndex;

  if (splitIndex !== -1) {
    const rawProvider = normalized.substring(0, splitIndex).trim();
    const rawPattern = normalized.substring(splitIndex + 1).trim();
    const canonicalProvider = PROVIDER_ALIASES[rawProvider];

    if (canonicalProvider) {
      const providerCandidates = allModels.filter((m) => {
        if (m.provider.toLowerCase() !== canonicalProvider) return false;
        const normId = m.id.toLowerCase();
        const normPattern = rawPattern.replace(/[-_.]/g, "");
        const normModelId = normId.replace(/[-_.]/g, "");

        return (
          normId === rawPattern ||
          normId.includes(rawPattern) ||
          normModelId.includes(normPattern) ||
          (m.name && m.name.toLowerCase().includes(rawPattern))
        );
      });

      if (providerCandidates.length > 0) {
        candidates = providerCandidates;
      }
    }
  }

  // 4. If no provider-specific candidates, search across all models
  if (candidates.length === 0) {
    const rawWords = normalized.split(/[\s/]+/).filter(Boolean);
    const cleanedWords = rawWords.filter((w) => !CONVERSATIONAL_STOP_WORDS.has(w));
    const qWords = cleanedWords.length > 0 ? cleanedWords : rawWords;

    candidates = allModels.filter((m) => {
      const idNorm = m.id.toLowerCase().replace(/[-_.]/g, " ");
      const nameNorm = (m.name ?? "").toLowerCase().replace(/[-_.]/g, " ");
      const fullNorm = `${m.provider.toLowerCase().replace(/[-_.]/g, " ")} ${idNorm} ${nameNorm}`;
      const fullCompact = `${m.provider}${m.id}${m.name ?? ""}`.toLowerCase().replace(/[-_.\s]/g, "");

      return qWords.every((word) => {
        const wordCompact = word.replace(/[-_.\s]/g, "");
        return fullNorm.includes(word) || fullCompact.includes(wordCompact);
      });
    });
  }

  if (candidates.length === 0) {
    return { status: "not_found", error: `No model found matching "${query}".` };
  }

  // Deduplicate candidates by provider + id
  const seen = new Set<string>();
  const deduped: SessionModel[] = [];
  for (const c of candidates) {
    const key = `${c.provider}/${c.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(c);
    }
  }

  const resolveWithNormalizedUrl = async (m: SessionModel): Promise<SessionModel> => {
    try {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(m);
      return normalizeModelBaseUrl(m, auth.ok ? auth.apiKey : undefined, ctx.model);
    } catch {
      return normalizeModelBaseUrl(m, undefined, ctx.model);
    }
  };

  if (deduped.length === 1) {
    return { status: "resolved", model: await resolveWithNormalizedUrl(deduped[0]) };
  }

  // Prioritize current provider if current provider has exactly 1 match
  if (ctx.model?.provider) {
    const currentProviderMatches = deduped.filter((m) => m.provider === ctx.model?.provider);
    if (currentProviderMatches.length === 1) {
      return { status: "resolved", model: await resolveWithNormalizedUrl(currentProviderMatches[0]) };
    }
  }

  // 5. Multiple matches: check credentials
  const authChecks = await Promise.all(
    deduped.map(async (m) => {
      try {
        const res = await ctx.modelRegistry.getApiKeyAndHeaders(m);
        return res.ok && res.apiKey !== undefined;
      } catch {
        return false;
      }
    }),
  );

  const authenticated = deduped.filter((_, i) => authChecks[i]);

  // If only one candidate is authenticated, pick it!
  if (authenticated.length === 1) {
    return { status: "resolved", model: await resolveWithNormalizedUrl(authenticated[0]) };
  }

  // If multiple are authenticated, disambiguate among authenticated ones
  if (authenticated.length > 1) {
    return {
      status: "ambiguous",
      candidates: authenticated,
      reason: `Multiple authenticated models match "${query}".`,
    };
  }

  // None are authenticated; disambiguate among all matched candidates
  return {
    status: "ambiguous",
    candidates: deduped,
    reason: `Multiple models match "${query}".`,
  };
}

function parseBtwThinkingArgs(args: string):
  | { action: "show" }
  | { action: "clear" }
  | { action: "set"; thinkingLevel: SessionThinkingLevel } {
  const trimmed = args.trim();
  if (!trimmed) {
    return { action: "show" };
  }

  if (trimmed === "clear") {
    return { action: "clear" };
  }

  return { action: "set", thinkingLevel: trimmed as SessionThinkingLevel };
}

function formatModelRef(model: Pick<SessionModel, "provider" | "id" | "api">): string {
  return `${model.provider}/${model.id} (${model.api})`;
}

function buildBtwSeedState(
  ctx: ExtensionCommandContext,
  thread: BtwDetails[],
  mode: BtwThreadMode,
  sessionModel: SessionModel | null,
): { messages: Message[]; sideThreadStartIndex: number } {
  const messages: Message[] = [];

  if (mode === "contextual") {
    try {
      messages.push(
        ...(buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages as Message[]).filter(
          (message) => !isVisibleBtwMessage(message),
        ),
      );
    } catch {
      messages.push(
        ...ctx.sessionManager.getEntries().flatMap((entry) => {
          if (!entry || typeof entry !== "object") {
            return [];
          }

          const message = entry as unknown as Partial<Message> & { role?: string; customType?: string; content?: unknown };
          if (typeof message.role !== "string" || !Array.isArray(message.content)) {
            return [];
          }

          return isVisibleBtwMessage({ role: message.role, customType: message.customType }) ? [] : [message as Message];
        }),
      );
    }
  }

  const sideThreadStartIndex = messages.length;

  if (thread.length > 0) {
    messages.push(
      {
        role: "user",
        content: [{ type: "text", text: BTW_CONTINUE_THREAD_USER_TEXT }],
        timestamp: Date.now(),
      },
      {
        role: "assistant",
        content: [{ type: "text", text: BTW_CONTINUE_THREAD_ASSISTANT_TEXT }],
        provider: sessionModel?.provider ?? "unknown",
        model: sessionModel?.id ?? "unknown",
        api: sessionModel?.api ?? "openai-responses",
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
          api: entry.api || sessionModel?.api || ctx.model?.api || "openai-responses",
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

  return {
    messages,
    sideThreadStartIndex,
  };
}

function formatToolPreview(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const path = (value as { path?: unknown }).path;
    if (typeof path === "string") {
      return path;
    }
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

function createEmptyTranscriptState(): BtwTranscriptState {
  return {
    entries: [],
    nextEntryId: 1,
    nextTurnId: 1,
    currentTurnId: null,
    lastTurnId: null,
    toolCalls: new Map(),
  };
}

function appendTranscriptEntry<T extends BtwTranscriptEntry>(
  state: BtwTranscriptState,
  entry: Omit<T, "id">,
): T {
  const nextEntry = { ...entry, id: state.nextEntryId++ } as T;
  state.entries.push(nextEntry);
  return nextEntry;
}

function ensureTranscriptTurn(state: BtwTranscriptState): number {
  if (state.currentTurnId !== null) {
    return state.currentTurnId;
  }

  const turnId = state.nextTurnId++;
  state.currentTurnId = turnId;
  state.lastTurnId = turnId;
  appendTranscriptEntry(state, { type: "turn-boundary", turnId, phase: "start" } as Omit<Extract<BtwTranscriptEntry, { type: "turn-boundary" }>, "id">);
  return turnId;
}

function finishTranscriptTurn(state: BtwTranscriptState, turnId?: number | null): void {
  const resolvedTurnId = turnId ?? state.currentTurnId;
  if (resolvedTurnId === null || resolvedTurnId === undefined) {
    return;
  }

  const hasEndBoundary = state.entries.some(
    (entry) => entry.turnId === resolvedTurnId && entry.type === "turn-boundary" && entry.phase === "end",
  );
  if (!hasEndBoundary) {
    appendTranscriptEntry(state, { type: "turn-boundary", turnId: resolvedTurnId, phase: "end" } as Omit<Extract<BtwTranscriptEntry, { type: "turn-boundary" }>, "id">);
  }

  for (const entry of state.entries) {
    if (entry.turnId !== resolvedTurnId) {
      continue;
    }

    if (entry.type === "thinking" || entry.type === "assistant-text" || entry.type === "tool-result") {
      entry.streaming = false;
    }
  }

  state.lastTurnId = resolvedTurnId;
  if (state.currentTurnId === resolvedTurnId) {
    state.currentTurnId = null;
  }
}

function removeTranscriptTurn(state: BtwTranscriptState, turnId: number | null): void {
  if (turnId === null) {
    return;
  }

  state.entries = state.entries.filter((entry) => entry.turnId !== turnId);
  for (const [toolCallId, toolCall] of state.toolCalls.entries()) {
    if (toolCall.turnId === turnId) {
      state.toolCalls.delete(toolCallId);
    }
  }

  if (state.currentTurnId === turnId) {
    state.currentTurnId = null;
  }
  if (state.lastTurnId === turnId) {
    state.lastTurnId = null;
  }
}

function findLatestTranscriptEntry<TType extends BtwTranscriptEntry["type"]>(
  state: BtwTranscriptState,
  turnId: number,
  type: TType,
): Extract<BtwTranscriptEntry, { type: TType }> | undefined {
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const entry = state.entries[i];
    if (entry.turnId === turnId && entry.type === type) {
      return entry as Extract<BtwTranscriptEntry, { type: TType }>;
    }
  }

  return undefined;
}

function findLatestAssistantText(state: BtwTranscriptState): string | undefined {
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const entry = state.entries[i];
    if (entry.type === "assistant-text" && entry.text) {
      return entry.text;
    }
  }
  return undefined;
}

function ensureTranscriptTurnForUserMessage(state: BtwTranscriptState): number {
  if (state.currentTurnId !== null) {
    const currentAssistant = findLatestTranscriptEntry(state, state.currentTurnId, "assistant-text");
    if (currentAssistant && !currentAssistant.streaming) {
      finishTranscriptTurn(state, state.currentTurnId);
    }
  }

  return ensureTranscriptTurn(state);
}

function extractMessageText(message: { content?: string | AssistantMessage["content"] | UserMessage["content"] }): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function upsertUserMessageEntry(state: BtwTranscriptState, turnId: number, text: string): void {
  if (!text) {
    return;
  }

  const existing = findLatestTranscriptEntry(state, turnId, "user-message");
  if (existing) {
    existing.text = text;
    return;
  }

  appendTranscriptEntry(state, { type: "user-message", turnId, text } as Omit<Extract<BtwTranscriptEntry, { type: "user-message" }>, "id">);
}

function upsertTranscriptTextEntry(
  state: BtwTranscriptState,
  turnId: number,
  type: "thinking" | "assistant-text",
  text: string,
  streaming: boolean,
): void {
  if (!text) {
    return;
  }

  const existing = findLatestTranscriptEntry(state, turnId, type);
  if (existing) {
    existing.text = text;
    existing.streaming = streaming;
    return;
  }

  appendTranscriptEntry(state, { type, turnId, text, streaming } as Omit<Extract<BtwTranscriptEntry, { type: "thinking" | "assistant-text" }>, "id">);
}

function summarizeToolResult(value: unknown, maxLength = 400): { content: string; truncated: boolean } {
  let content = "";

  if (value && typeof value === "object") {
    const toolValue = value as {
      content?: Array<{ type?: string; text?: string }>;
      error?: unknown;
      message?: unknown;
    };

    if (Array.isArray(toolValue.content)) {
      content = toolValue.content
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text ?? "")
        .join("\n")
        .trim();
    }

    if (!content && typeof toolValue.error === "string") {
      content = toolValue.error;
    }

    if (!content && typeof toolValue.message === "string") {
      content = toolValue.message;
    }
  }

  if (!content) {
    if (typeof value === "string") {
      content = value;
    } else if (value !== undefined) {
      try {
        content = JSON.stringify(value, null, 2);
      } catch {
        content = String(value);
      }
    }
  }

  if (!content) {
    content = "(no tool output)";
  }

  const truncated = content.length > maxLength;
  return {
    content: truncated ? `${content.slice(0, maxLength - 3)}...` : content,
    truncated,
  };
}

function ensureToolCallEntry(
  state: BtwTranscriptState,
  turnId: number,
  toolCallId: string,
  toolName: string,
  args: string,
): { turnId: number; callEntryId: number; resultEntryId?: number } {
  const existing = state.toolCalls.get(toolCallId);
  if (existing) {
    return existing;
  }

  const callEntry = appendTranscriptEntry(state, {
    type: "tool-call",
    turnId,
    toolCallId,
    toolName,
    args,
  } as Omit<Extract<BtwTranscriptEntry, { type: "tool-call" }>, "id">);
  const record = { turnId, callEntryId: callEntry.id };
  state.toolCalls.set(toolCallId, record);
  return record;
}

function upsertToolResultEntry(
  state: BtwTranscriptState,
  turnId: number,
  toolCallId: string,
  toolName: string,
  content: string,
  truncated: boolean,
  isError: boolean,
  streaming: boolean,
): void {
  const toolCall = ensureToolCallEntry(state, turnId, toolCallId, toolName, "");
  const existing =
    toolCall.resultEntryId !== undefined
      ? state.entries.find((entry) => entry.id === toolCall.resultEntryId && entry.type === "tool-result")
      : undefined;

  if (existing && existing.type === "tool-result") {
    existing.content = content;
    existing.truncated = truncated;
    existing.isError = isError;
    existing.streaming = streaming;
    return;
  }

  const resultEntry = appendTranscriptEntry(state, {
    type: "tool-result",
    turnId,
    toolCallId,
    toolName,
    content,
    truncated,
    isError,
    streaming,
  } as Omit<Extract<BtwTranscriptEntry, { type: "tool-result" }>, "id">);
  toolCall.resultEntryId = resultEntry.id;
}

function applyAssistantMessageToTranscript(
  state: BtwTranscriptState,
  turnId: number,
  message: AssistantMessage,
  streaming: boolean,
): void {
  const assistantMessage = message;
  const thinking = extractThinking(assistantMessage);
  const answer = extractMessageText(assistantMessage);

  if (thinking) {
    upsertTranscriptTextEntry(state, turnId, "thinking", thinking, streaming);
  }

  if (answer) {
    upsertTranscriptTextEntry(state, turnId, "assistant-text", answer, streaming);
  }
}

function applyTranscriptEvent(state: BtwTranscriptState, event: AgentSessionEvent): void {
  switch (event.type) {
    case "turn_start": {
      ensureTranscriptTurn(state);
      return;
    }
    case "message_start": {
      if (event.message.role === "user") {
        const turnId = ensureTranscriptTurnForUserMessage(state);
        upsertUserMessageEntry(state, turnId, extractMessageText(event.message));
        return;
      }

      if (event.message.role === "assistant") {
        const turnId = ensureTranscriptTurn(state);
        applyAssistantMessageToTranscript(state, turnId, event.message, true);
      }
      return;
    }
    case "message_update": {
      if (event.message.role !== "assistant") {
        return;
      }

      const turnId = ensureTranscriptTurn(state);
      applyAssistantMessageToTranscript(state, turnId, event.message, true);
      return;
    }
    case "message_end": {
      if (event.message.role === "user") {
        const turnId = ensureTranscriptTurnForUserMessage(state);
        upsertUserMessageEntry(state, turnId, extractMessageText(event.message));
        return;
      }

      if (event.message.role === "assistant") {
        const turnId = ensureTranscriptTurn(state);
        applyAssistantMessageToTranscript(state, turnId, event.message, false);
      }
      return;
    }
    case "tool_execution_start": {
      const turnId = ensureTranscriptTurn(state);
      ensureToolCallEntry(state, turnId, event.toolCallId, event.toolName, formatToolPreview(event.args));
      return;
    }
    case "tool_execution_update": {
      const turnId = state.toolCalls.get(event.toolCallId)?.turnId ?? ensureTranscriptTurn(state);
      const result = summarizeToolResult(event.partialResult);
      upsertToolResultEntry(
        state,
        turnId,
        event.toolCallId,
        event.toolName,
        result.content,
        result.truncated,
        false,
        true,
      );
      return;
    }
    case "tool_execution_end": {
      const turnId = state.toolCalls.get(event.toolCallId)?.turnId ?? ensureTranscriptTurn(state);
      const result = summarizeToolResult(event.result);
      upsertToolResultEntry(
        state,
        turnId,
        event.toolCallId,
        event.toolName,
        result.content,
        result.truncated,
        event.isError,
        false,
      );
      return;
    }
    case "turn_end": {
      finishTranscriptTurn(state);
      return;
    }
    default:
      return;
  }
}

function appendPersistedTranscriptTurn(state: BtwTranscriptState, details: BtwDetails): void {
  const turnId = ensureTranscriptTurn(state);
  upsertUserMessageEntry(state, turnId, details.question);
  if (details.thinking) {
    upsertTranscriptTextEntry(state, turnId, "thinking", details.thinking, false);
  }
  upsertTranscriptTextEntry(state, turnId, "assistant-text", details.answer, false);
  finishTranscriptTurn(state, turnId);
}

function setTranscriptFailure(state: BtwTranscriptState, message: string): void {
  const turnId = state.currentTurnId ?? state.lastTurnId ?? ensureTranscriptTurn(state);
  upsertTranscriptTextEntry(state, turnId, "assistant-text", `❌ ${message}`, false);
  finishTranscriptTurn(state, turnId);
}

function hasStreamingTranscriptEntry(entries: BtwTranscript): boolean {
  return entries.some(
    (entry) =>
      (entry.type === "thinking" || entry.type === "assistant-text" || entry.type === "tool-result") &&
      entry.streaming,
  );
}

function getCompletedExchangeCount(entries: BtwTranscript): number {
  return entries.filter((entry) => entry.type === "assistant-text" && !entry.streaming).length;
}

function buildOverlayTranscript(
  entries: BtwTranscript,
  theme: ExtensionContext["ui"]["theme"],
  debug = false,
): string[] {
  if (entries.length === 0) {
    return [theme.fg("dim", "No BTW thread yet. Ask a side question to start one.")];
  }

  const lines: string[] = [];
  const userBadge = buildTranscriptBadge(theme, "You", "userMessageBg", "accent");
  const thinkingBadge = buildTranscriptBadge(theme, "Thinking", "toolPendingBg", "warning");
  const toolBadge = buildTranscriptBadge(theme, "Tool", "toolPendingBg", "warning");
  const assistantBadge = buildTranscriptBadge(theme, "Assistant", "customMessageBg", "success");
  const separator = theme.fg("borderMuted", "────────────────────────────────────────");
  const blockIndent = "    ";
  const resultIndent = blockIndent;

  const pushBlankLine = () => {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
  };

  const pushInlineBlock = (
    header: string,
    text: string,
    options: { blankBefore?: boolean; style?: (value: string) => string } = {},
  ) => {
    const bodyLines = text.split("\n");
    const style = options.style ?? ((value: string) => value);
    if (options.blankBefore !== false) {
      pushBlankLine();
    }

    const firstLine = bodyLines.shift() ?? "";
    lines.push(`${header}${firstLine ? ` ${style(firstLine)}` : ""}`);
    for (const line of bodyLines) {
      lines.push(`${blockIndent}${style(line)}`);
    }
  };

  const pushStackedBlock = (
    header: string,
    text: string,
    options: { blankBefore?: boolean; indent?: string; style?: (value: string) => string } = {},
  ) => {
    const bodyLines = text.split("\n");
    const indent = options.indent ?? blockIndent;
    const style = options.style ?? ((value: string) => value);
    if (options.blankBefore !== false) {
      pushBlankLine();
    }

    lines.push(header);
    for (const line of bodyLines) {
      lines.push(`${indent}${style(line)}`);
    }
  };

  let hasContentSinceSeparator = false;

  for (const entry of entries) {
    if (entry.type === "turn-boundary") {
      if (entry.phase === "start" && lines.length > 0 && hasContentSinceSeparator) {
        pushBlankLine();
        lines.push(separator);
        hasContentSinceSeparator = false;
      }
      continue;
    }

    if (entry.type === "user-message") {
      pushInlineBlock(userBadge, entry.text, { blankBefore: false });
      hasContentSinceSeparator = true;
      continue;
    }

    if (entry.type === "thinking") {
      if (!debug) {
        continue;
      }
      const thinkingHeader = entry.streaming ? `${thinkingBadge} ${theme.fg("warning", "▍")}` : thinkingBadge;
      pushStackedBlock(thinkingHeader, entry.text, {
        style: (line) => theme.fg("warning", theme.italic(line)),
      });
      hasContentSinceSeparator = true;
      continue;
    }

    if (entry.type === "tool-call") {
      if (!debug) {
        continue;
      }
      const toolLabel = theme.fg("warning", theme.bold(entry.toolName));
      const argsLabel = entry.args ? theme.fg("dim", ` · ${entry.args}`) : "";
      pushInlineBlock(toolBadge, `${toolLabel}${argsLabel}`);
      hasContentSinceSeparator = true;
      continue;
    }

    if (entry.type === "tool-result") {
      if (!debug) {
        continue;
      }
      const resultHeaderLabel = entry.isError
        ? theme.fg("error", "↳ error")
        : entry.streaming
          ? theme.fg("warning", "↳ streaming result")
          : theme.fg("dim", "↳ result");
      const truncationLabel = entry.truncated ? theme.fg("dim", " (truncated)") : "";
      pushStackedBlock(`${resultHeaderLabel}${truncationLabel}`, entry.content, {
        blankBefore: false,
        indent: resultIndent,
        style: (line) => (entry.isError ? theme.fg("error", line) : theme.fg("dim", line)),
      });
      hasContentSinceSeparator = true;
      continue;
    }

    if (entry.type === "assistant-text") {
      const assistantHeader = entry.streaming ? `${assistantBadge} ${theme.fg("warning", "▍")}` : assistantBadge;
      pushStackedBlock(assistantHeader, entry.text);
      hasContentSinceSeparator = true;
    }
  }

  return lines;
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

type BtwHandoffExchange = {
  user: string;
  assistant: string;
};

function buildBtwMessageContent(question: string, answer: string): string {
  return `Q: ${question}\n\nA: ${answer}`;
}

function formatThread(thread: BtwHandoffExchange[]): string {
  return thread.map((entry) => `User: ${entry.user.trim()}\nAssistant: ${entry.assistant.trim()}`).join("\n\n---\n\n");
}

function isThreadContinuationMarker(messages: Message[], index: number): boolean {
  const userMessage = messages[index];
  const assistantMessage = messages[index + 1];
  return (
    userMessage?.role === "user" &&
    extractMessageText(userMessage) === BTW_CONTINUE_THREAD_USER_TEXT &&
    assistantMessage?.role === "assistant" &&
    extractMessageText(assistantMessage) === BTW_CONTINUE_THREAD_ASSISTANT_TEXT
  );
}

function extractBtwHandoffThread(sessionRuntime: BtwSessionRuntime): BtwHandoffExchange[] {
  const handoffMessages = sessionRuntime.session.state.messages.slice(sessionRuntime.sideThreadStartIndex);
  const threadMessages = isThreadContinuationMarker(handoffMessages as Message[], 0) ? handoffMessages.slice(2) : handoffMessages;
  const exchanges: BtwHandoffExchange[] = [];
  let currentUser = "";
  let currentAssistant = "";

  const pushCurrent = () => {
    if (!currentUser && !currentAssistant) {
      return;
    }

    exchanges.push({
      user: currentUser.trim() || "(No user prompt)",
      assistant: currentAssistant.trim() || "(No assistant response)",
    });
    currentUser = "";
    currentAssistant = "";
  };

  for (const message of threadMessages) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }

    const text = extractMessageText(message).trim();
    if (!text) {
      continue;
    }

    if (message.role === "user") {
      pushCurrent();
      currentUser = text;
      continue;
    }

    currentAssistant = currentAssistant ? `${currentAssistant}\n\n${text}` : text;
  }

  pushCurrent();
  return exchanges;
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

/** Fixed overlay rows outside the transcript viewport (must match render() structure). */
const BTW_OVERLAY_CHROME_LINES = 9;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function isActiveStatus(status: string | null): boolean {
  if (!status) return false;
  return (
    status.includes("running tool") ||
    status.includes("thinking") ||
    status.includes("generating") ||
    status.includes("resolving") ||
    status.includes("switching") ||
    status.includes("configuring") ||
    status.includes("⏳")
  );
}

function getOverlayTitle(mode: BtwThreadMode): string {
  return mode === "tangent" ? "BTW tangent" : "BTW";
}

function buildTranscriptBadge(
  theme: ExtensionContext["ui"]["theme"],
  label: string,
  background: "userMessageBg" | "toolPendingBg" | "customMessageBg",
  foreground: "accent" | "warning" | "success",
): string {
  return theme.bg(background, theme.fg(foreground, theme.bold(` ${label} `)));
}

class BtwOverlayComponent extends Container implements Focusable {
  private readonly input: Input;
  private readonly transcript: Container;
  private readonly statusText: Text;
  private readonly modeText: Text;
  private readonly summaryText: Text;
  private readonly hintsText: Text;
  private readonly readTranscriptEntries: () => BtwTranscript;
  private readonly getStatus: () => string | null;
  private readonly getMode: () => BtwThreadMode;
  private readonly getDebug: () => boolean;
  private readonly getModelInfo: () => string;
  private readonly getDisambiguation?: () => ModelDisambiguationState | null;
  private readonly onSubmitCallback: (value: string) => void;
  private readonly onDismissCallback: () => void;
  private readonly onUnfocusCallback: () => void;
  private readonly tui: TUI;
  private readonly theme: ExtensionContext["ui"]["theme"];
  private transcriptLines: string[] = [];
  private transcriptScrollOffset = 0;
  private transcriptViewportHeight = 8;
  private followTranscript = true;
  private _focused = false;
  private modeTextValue = "";
  private summaryTextValue = "";
  private statusTextValue = "";
  private hintsTextValue = "";
  private spinnerIndex = 0;
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private activityStartTime: number | null = null;

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
    readTranscriptEntries: () => BtwTranscript,
    getStatus: () => string | null,
    getMode: () => BtwThreadMode,
    getDebug: () => boolean,
    getModelInfo: () => string,
    onSubmit: (value: string) => void,
    onDismiss: () => void,
    onUnfocus: () => void,
    getDisambiguation?: () => ModelDisambiguationState | null,
  ) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.readTranscriptEntries = readTranscriptEntries;
    this.getStatus = getStatus;
    this.getMode = getMode;
    this.getDebug = getDebug;
    this.getModelInfo = getModelInfo;
    this.getDisambiguation = getDisambiguation;
    this.onSubmitCallback = onSubmit;
    this.onDismissCallback = onDismiss;
    this.onUnfocusCallback = onUnfocus;

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
      if (keybindings.matches(data, "app.clear")) {
        if (this.input.getValue().length > 0) {
          this.input.setValue("");
          this.tui.requestRender();
          return;
        }

        this.onDismissCallback();
        return;
      }

      if (keybindings.matches(data, "tui.select.cancel")) {
        this.onDismissCallback();
        return;
      }
      originalHandleInput(data);
    };

    this.refresh();
  }

  private frameLine(content: string, innerWidth: number, padX = 2): string {
    const contentWidth = Math.max(1, innerWidth - padX * 2);
    const truncated = truncateToWidth(content, contentWidth, "");
    const padding = Math.max(0, contentWidth - visibleWidth(truncated));
    const leftMargin = " ".repeat(padX);
    const rightMargin = " ".repeat(padX + padding);
    return `${this.theme.fg("border", "│")}${leftMargin}${truncated}${rightMargin}${this.theme.fg("border", "│")}`;
  }

  private ruleLine(innerWidth: number): string {
    return this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`);
  }

  private borderLine(innerWidth: number, edge: "top" | "bottom"): string {
    const left = edge === "top" ? "┌" : "└";
    const right = edge === "top" ? "┐" : "┘";
    return this.theme.fg("border", `${left}${"─".repeat(innerWidth)}${right}`);
  }

  private wrapTranscript(innerWidth: number, padX = 2): string[] {
    const contentWidth = Math.max(1, innerWidth - padX * 2);
    const wrapped: string[] = [];
    for (const line of this.transcriptLines) {
      if (!line) {
        wrapped.push("");
        continue;
      }
      const indentMatch = line.match(/^(\s{2,})/);
      if (indentMatch) {
        const indent = indentMatch[1];
        const indentWidth = visibleWidth(indent);
        const available = Math.max(1, contentWidth - indentWidth);
        const stripped = line.slice(indent.length);
        const subWrapped = wrapTextWithAnsi(stripped, available);
        wrapped.push(...subWrapped.map((l) => `${indent}${l}`));
      } else {
        wrapped.push(...wrapTextWithAnsi(line, contentWidth));
      }
    }
    return wrapped;
  }

  private getDialogHeight(): number {
    const terminalRows = process.stdout.rows ?? 30;
    return Math.max(18, Math.min(32, Math.floor(terminalRows * 0.78)));
  }

  private scrollTranscript(delta: number): void {
    if (delta < 0) {
      this.followTranscript = false;
    }
    this.transcriptScrollOffset = Math.max(0, this.transcriptScrollOffset + delta);
    this.tui.requestRender();
  }

  private startAnimationIfNeeded(status: string | null): void {
    if (isActiveStatus(status)) {
      if (this.activityStartTime === null) {
        this.activityStartTime = Date.now();
      }
      if (!this.animationTimer) {
        this.animationTimer = setInterval(() => {
          this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
          this.tui.requestRender();
        }, 120);
      }
    } else {
      this.activityStartTime = null;
      if (this.animationTimer) {
        clearInterval(this.animationTimer);
        this.animationTimer = null;
      }
    }
  }

  dispose(): void {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }

  handleInput(data: string): void {
    if (matchesBtwFocusShortcut(data)) {
      this.onUnfocusCallback();
      return;
    }

    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.up)) {
      const step = matchesKey(data, Key.pageUp) ? Math.max(1, this.transcriptViewportHeight - 1) : 1;
      this.scrollTranscript(-step);
      return;
    }

    if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.down)) {
      const step = matchesKey(data, Key.pageDown) ? Math.max(1, this.transcriptViewportHeight - 1) : 1;
      this.scrollTranscript(step);
      return;
    }

    this.input.handleInput(data);
  }

  private inputFrameLine(dialogWidth: number, padX = 2): string {
    const innerWidth = Math.max(1, dialogWidth - 2);
    const contentWidth = Math.max(1, innerWidth - padX * 2);
    const previousFocused = this.input.focused;
    // Input.render() emits CURSOR_MARKER when focused. In overlay mode that APC marker
    // can skew width/composition on this one row before the TUI strips it, producing a
    // right-edge notch and shifted border. Render the embedded input unfocused here so
    // the row stays geometrically stable while the overlay still owns keyboard input.
    this.input.focused = false;
    try {
      const renderedInputLine = this.input.render(contentWidth)[0] ?? "";
      const inputLine = truncateToWidth(renderedInputLine, contentWidth, "");
      const padding = Math.max(0, contentWidth - visibleWidth(inputLine));
      const leftMargin = " ".repeat(padX);
      const rightMargin = " ".repeat(padX + padding);
      return `${this.theme.fg("border", "│")}${leftMargin}${inputLine}${rightMargin}${this.theme.fg("border", "│")}`;
    } finally {
      this.input.focused = previousFocused;
    }
  }

  private fitRenderedLine(line: string, width: number): string {
    return visibleWidth(line) > width ? truncateToWidth(line, width, "") : line;
  }

  override render(width: number): string[] {
    const dialogWidth = Math.max(24, width);
    const innerWidth = Math.max(22, dialogWidth - 2);
    const transcriptLines = this.wrapTranscript(innerWidth);
    const dialogHeight = this.getDialogHeight();
    const chromeHeight = BTW_OVERLAY_CHROME_LINES;
    const transcriptHeight = Math.max(6, dialogHeight - chromeHeight);
    this.transcriptViewportHeight = transcriptHeight;

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
        ? `${this.summaryTextValue.trim()} · ↑${hiddenAbove} ↓${hiddenBelow}`
        : this.summaryTextValue.trim();

    const lines = [this.borderLine(innerWidth, "top")];

    lines.push(this.frameLine(this.theme.fg("accent", this.theme.bold(this.modeTextValue.trim())), innerWidth));
    lines.push(this.frameLine(this.theme.fg("dim", summary), innerWidth));
    lines.push(this.ruleLine(innerWidth));

    for (const line of visibleTranscript) {
      lines.push(this.frameLine(line, innerWidth));
    }
    for (let i = 0; i < transcriptPadCount; i++) {
      lines.push(this.frameLine("", innerWidth));
    }

    lines.push(this.ruleLine(innerWidth));
    const rawStatus = this.getStatus();
    this.startAnimationIfNeeded(rawStatus);
    let displayStatus = this.statusTextValue;
    if (rawStatus && isActiveStatus(rawStatus)) {
      const clean = rawStatus.replace(/^⏳\s*/, "");
      const elapsed = Math.max(0, Math.floor((Date.now() - (this.activityStartTime ?? Date.now())) / 1000));
      displayStatus = `${SPINNER_FRAMES[this.spinnerIndex]} ${clean} (${elapsed}s)`;
    }
    lines.push(this.frameLine(this.theme.fg("warning", displayStatus.trim()), innerWidth));
    lines.push(this.inputFrameLine(dialogWidth));
    lines.push(this.frameLine(this.theme.fg("dim", this.hintsTextValue.trim()), innerWidth));
    lines.push(this.borderLine(innerWidth, "bottom"));

    return lines.map((line) => this.fitRenderedLine(line, width));
  }

  setDraft(value: string): void {
    this.input.setValue(value);
    this.tui.requestRender();
  }

  getDraft(): string {
    return this.input.getValue();
  }

  getTranscriptEntries(): BtwTranscript {
    return this.readTranscriptEntries().map((entry) => ({ ...entry }));
  }

  refresh(): void {
    const debugTag = this.getDebug() ? " · debug" : "";
    const modelInfo = this.getModelInfo();
    const modelTag = modelInfo ? ` · ${modelInfo}` : "";
    this.modeTextValue = `${getOverlayTitle(this.getMode())}${debugTag}${modelTag}`;
    this.modeText.setText(this.modeTextValue);
    const entries = this.readTranscriptEntries();
    const exchanges = getCompletedExchangeCount(entries);
    const active = hasStreamingTranscriptEntry(entries) ? " · thinking" : " · idle";
    this.summaryTextValue = `${exchanges} exchange${exchanges === 1 ? "" : "s"}${active}`;
    this.summaryText.setText(this.summaryTextValue);

    this.transcriptLines = buildOverlayTranscript(entries, this.theme, this.getDebug());
    const disambiguation = this.getDisambiguation?.();
    if (disambiguation) {
      const disambiguationLines = [
        "",
        this.theme.fg("accent", this.theme.bold(`Multiple models match "${disambiguation.query}". Select one:`)),
        ...disambiguation.candidates.map((c: SessionModel, i: number) =>
          `  ${this.theme.fg("warning", `[${i + 1}]`)} ${formatModelRef(c)}`
        ),
        this.theme.fg("dim", `Type 1-${disambiguation.candidates.length} or model name to confirm (or type cancel).`),
      ];
      this.transcriptLines = [...this.transcriptLines, ...disambiguationLines];
    }
    this.transcript.clear();
    for (const line of this.transcriptLines) {
      this.transcript.addChild(new Text(line, 1, 0));
    }

    const defaultStatus = disambiguation
      ? `Ambiguous model "${disambiguation.query}". Choose 1-${disambiguation.candidates.length}:`
      : "Ready. Enter submits; Escape dismisses without clearing.";
    const status = this.getStatus() ?? defaultStatus;
    this.statusTextValue = status;
    this.statusText.setText(this.statusTextValue);
    this.hintsTextValue = disambiguation
      ? "Enter: confirm choice · Esc: cancel"
      : "PgUp/PgDn/↑↓ scroll · Enter submit · Alt+/ focus · Esc";
    this.hintsText.setText(this.hintsTextValue);
    this.tui.requestRender();
  }
}

export default function (pi: ExtensionAPI) {
  let pendingThread: BtwDetails[] = [];
  let pendingMode: BtwThreadMode = "contextual";
  let btwModelOverride: SessionModel | null = null;
  let btwThinkingOverride: SessionThinkingLevel | null = null;
  let currentMainModel: SessionModel | null = null;
  let debugMode = false;
  let transcriptState = createEmptyTranscriptState();
  let overlayStatus: string | null = null;
  let overlayDraft = "";
  let overlayRuntime: OverlayRuntime | null = null;
  let lastUiContext: ExtensionContext | ExtensionCommandContext | null = null;
  let activeBtwSession: BtwSessionRuntime | null = null;
  let pendingModelDisambiguation: ModelDisambiguationState | null = null;
  let pendingSessionDispose = false;

  function getEffectiveModel(): SessionModel | null {
    return (
      btwModelOverride ??
      currentMainModel ??
      (lastUiContext && "model" in lastUiContext ? (lastUiContext as ExtensionCommandContext).model ?? null : null)
    );
  }

  function getEffectiveThinkingLevel(): SessionThinkingLevel {
    return btwThinkingOverride ?? (pi.getThinkingLevel() as SessionThinkingLevel);
  }

  function getOverlayModelInfo(): string {
    const model = getEffectiveModel();
    const thinking = getEffectiveThinkingLevel();
    const modelLabel = model ? (btwModelOverride ? `${model.provider}/${model.id}` : model.id) : null;
    return modelLabel ? `${modelLabel} · thinking: ${thinking}` : `thinking: ${thinking}`;
  }

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
    pendingModelDisambiguation = null;
    overlayRuntime?.close?.();
    overlayRuntime = null;
  }

  function toggleOverlayFocus(): void {
    const handle = overlayRuntime?.handle;
    if (!handle) {
      return;
    }

    handle.setHidden(false);
    if (handle.isFocused()) {
      handle.unfocus();
    } else {
      handle.focus();
    }
    overlayRuntime?.refresh?.();
  }

  function focusOverlay(): void {
    const handle = overlayRuntime?.handle;
    if (!handle) {
      return;
    }

    handle.setHidden(false);
    handle.focus();
    overlayRuntime?.refresh?.();
  }

  function removeBtwSessionSubscription(sessionRuntime: BtwSessionRuntime, unsubscribe: () => void): void {
    if (!sessionRuntime.subscriptions.delete(unsubscribe)) {
      return;
    }

    try {
      unsubscribe();
    } catch {
      // Ignore unsubscribe errors during BTW session replacement/shutdown.
    }
  }

  function clearBtwSessionSubscriptions(sessionRuntime: BtwSessionRuntime): void {
    for (const unsubscribe of [...sessionRuntime.subscriptions]) {
      removeBtwSessionSubscription(sessionRuntime, unsubscribe);
    }
  }

  function handleBtwSessionEvent(
    sessionRuntime: BtwSessionRuntime,
    event: AgentSessionEvent,
    ctx?: ExtensionContext | ExtensionCommandContext,
  ): void {
    if (activeBtwSession?.session !== sessionRuntime.session || !overlayRuntime) {
      return;
    }

    applyTranscriptEvent(transcriptState, event);

    if (event.type === "tool_execution_start") {
      setOverlayStatus(`running tool: ${event.toolName}`, ctx);
      return;
    }

    if (event.type === "tool_execution_end") {
      setOverlayStatus("thinking...", ctx);
      return;
    }

    if (
      event.type === "message_update" ||
      event.type === "message_end" ||
      (event as any).type === "turn_end" ||
      (event as any).type === "turn_start" ||
      (event as any).type === "message_start"
    ) {
      syncUi(ctx);
    }
  }

  function subscribeOverlayToActiveBtwSession(ctx?: ExtensionContext | ExtensionCommandContext): void {
    const sessionRuntime = activeBtwSession;
    if (!sessionRuntime || sessionRuntime.subscriptions.size > 0) {
      return;
    }

    const unsubscribe = sessionRuntime.session.subscribe((event: AgentSessionEvent) => {
      handleBtwSessionEvent(sessionRuntime, event, ctx);
    });
    sessionRuntime.subscriptions.add(unsubscribe);
  }

  async function disposeBtwSession(): Promise<void> {
    const current = activeBtwSession;
    activeBtwSession = null;
    if (!current) {
      return;
    }

    clearBtwSessionSubscriptions(current);

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

  async function resolveBtwModel(
    ctx: ExtensionCommandContext,
    notifyOnFallback = false,
  ): Promise<ResolvedBtwModel> {
    if (btwModelOverride) {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(btwModelOverride);
      if (auth.ok) {
        const normalized = normalizeModelBaseUrl(btwModelOverride, auth.apiKey, ctx.model);
        return {
          model: normalized,
          source: "override",
          configuredOverride: btwModelOverride,
        };
      }

      const fallbackReason = ctx.model
        ? `Configured BTW model ${formatModelRef(btwModelOverride)} has no credentials. Falling back to main model ${formatModelRef(
            ctx.model,
          )}.`
        : `Configured BTW model ${formatModelRef(btwModelOverride)} has no credentials, and no main model is active.`;
      if (notifyOnFallback) {
        notify(ctx, fallbackReason, "warning");
      }

      if (ctx.model) {
        return {
          model: ctx.model,
          source: "main",
          configuredOverride: btwModelOverride,
          fallbackReason,
        };
      }

      return {
        model: null,
        source: "none",
        configuredOverride: btwModelOverride,
        fallbackReason,
      };
    }

    if (ctx.model) {
      return {
        model: ctx.model,
        source: "main",
        configuredOverride: null,
      };
    }

    return {
      model: null,
      source: "none",
      configuredOverride: null,
    };
  }

  async function resolveBtwSettings(
    ctx: ExtensionCommandContext,
    notifyOnFallback = false,
  ): Promise<ResolvedBtwSettings> {
    const resolvedModel = await resolveBtwModel(ctx, notifyOnFallback);
    const thinkingLevel = btwThinkingOverride ?? (pi.getThinkingLevel() as SessionThinkingLevel);

    return {
      model: resolvedModel.model,
      modelSource: resolvedModel.source,
      configuredModelOverride: resolvedModel.configuredOverride,
      thinkingLevel,
      thinkingSource: btwThinkingOverride ? "override" : "main",
      fallbackReason: resolvedModel.fallbackReason,
    };
  }

  function describeResolvedModel(settings: ResolvedBtwSettings): string {
    if (!settings.model) {
      if (settings.configuredModelOverride && settings.fallbackReason) {
        return `BTW model unavailable. ${settings.fallbackReason}`;
      }
      return "BTW model unavailable. No active model selected.";
    }

    const source =
      settings.modelSource === "override"
        ? "override"
        : settings.configuredModelOverride
          ? "inherited fallback"
          : "inherits main thread";
    return `BTW model: ${formatModelRef(settings.model)} (${source}).${
      settings.fallbackReason ? ` ${settings.fallbackReason}` : ""
    }`;
  }

  function describeResolvedThinking(settings: ResolvedBtwSettings): string {
    const source = settings.thinkingSource === "override" ? "override" : "inherits main thread";
    return `BTW thinking: ${settings.thinkingLevel} (${source}).`;
  }

  async function setBtwModelOverride(
    ctx: ExtensionCommandContext,
    nextModel: SessionModel | null,
    disposeCurrent = true,
  ): Promise<void> {
    if (nextModel) {
      try {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(nextModel);
        nextModel = normalizeModelBaseUrl(nextModel, auth.ok ? auth.apiKey : undefined, ctx.model);
      } catch {
        nextModel = normalizeModelBaseUrl(nextModel, undefined, ctx.model);
      }
    }
    btwModelOverride = nextModel;
    const details: BtwModelOverrideDetails = nextModel
      ? { action: "set", timestamp: Date.now(), provider: nextModel.provider, id: nextModel.id, api: nextModel.api }
      : { action: "clear", timestamp: Date.now() };
    pi.appendEntry(BTW_MODEL_OVERRIDE_TYPE, details);
    if (disposeCurrent) {
      await disposeBtwSession();
    } else {
      pendingSessionDispose = true;
    }
    const settings = await resolveBtwSettings(ctx);
    const message = nextModel
      ? `BTW model override set to ${formatModelRef(nextModel)}.`
      : "BTW model override cleared. BTW now inherits the main thread model.";
    setOverlayStatus(message, ctx);
    notify(ctx, `${message} ${describeResolvedModel(settings)}`, "info");
  }

  async function setBtwThinkingOverride(
    ctx: ExtensionCommandContext,
    nextThinkingLevel: SessionThinkingLevel | null,
  ): Promise<void> {
    btwThinkingOverride = nextThinkingLevel;
    const details: BtwThinkingOverrideDetails = nextThinkingLevel
      ? { action: "set", timestamp: Date.now(), thinkingLevel: nextThinkingLevel }
      : { action: "clear", timestamp: Date.now() };
    pi.appendEntry(BTW_THINKING_OVERRIDE_TYPE, details);
    await disposeBtwSession();
    const settings = await resolveBtwSettings(ctx);
    const message = nextThinkingLevel
      ? `BTW thinking override set to ${nextThinkingLevel}.`
      : "BTW thinking override cleared. BTW now inherits the main thread thinking level.";
    setOverlayStatus(message, ctx);
    notify(ctx, `${message} ${describeResolvedThinking(settings)}`, "info");
  }

  async function createBtwSubSession(ctx: ExtensionCommandContext, mode: BtwThreadMode): Promise<BtwSessionRuntime> {
    const settings = await resolveBtwSettings(ctx, true);
    if (!settings.model) {
      throw new Error(settings.fallbackReason || "No active model selected.");
    }

    const configureBtwTool: ToolDefinition = defineTool({
      name: "configure_btw",
      label: "Configure BTW",
      description:
        "Change the model or thinking level for this BTW side conversation. Use this when the user asks to switch or change models, or adjust thinking level.",
      parameters: Type.Object({
        model: Type.Optional(
          Type.String({
            description:
              "Clean model identifier or query without conversational filler (e.g. 'gemini-3.7-flash', 'gpt-5.6-sol', 'gpt-5.6-luna', 'claude', 'clear')",
          }),
        ),
        thinking: Type.Optional(
          Type.String({
            description: "Thinking level: 'off', 'low', 'medium', 'high', 'xhigh', 'max', or 'clear'",
          }),
        ),
      }),
      execute: async (_toolCallId, params) => {
        const changes: string[] = [];

        if (params.thinking !== undefined) {
          const t = params.thinking.trim().toLowerCase();
          if (t === "clear") {
            await setBtwThinkingOverride(ctx, null);
            changes.push("cleared thinking override (now inherits main thread)");
          } else if (["off", "low", "medium", "high", "xhigh", "max"].includes(t)) {
            await setBtwThinkingOverride(ctx, t as SessionThinkingLevel);
            changes.push(`set thinking level to ${t}`);
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `Invalid thinking level "${params.thinking}". Valid levels: off, low, medium, high, max, clear.`,
                },
              ],
              details: {},
              isError: true,
            };
          }
        }

        if (params.model !== undefined) {
          const m = params.model.trim();
          if (m.toLowerCase() === "clear") {
            setOverlayStatus("clearing model override...", ctx);
            await setBtwModelOverride(ctx, null, false);
            changes.push("cleared model override (now inherits main thread)");
          } else {
            setOverlayStatus(`resolving model "${m}"...`, ctx);
            const res = await resolveBtwModelQuery(ctx, m);
            if (res.status === "resolved") {
              setOverlayStatus(`switching model to ${formatModelRef(res.model)}...`, ctx);
              await setBtwModelOverride(ctx, res.model, false);
              changes.push(`set model to ${formatModelRef(res.model)}`);
            } else if (res.status === "ambiguous") {
              const list = res.candidates.map((c: SessionModel, i: number) => `${i + 1}) ${formatModelRef(c)}`).join("\n");
              return {
                content: [
                  {
                    type: "text",
                    text: `Multiple models match "${m}":\n${list}\nPlease ask the user to clarify which provider/model they prefer.`,
                  },
                ],
                details: {},
              };
            } else {
              return {
                content: [{ type: "text", text: res.error }],
                details: {},
                isError: true,
              };
            }
          }
        }

        if (changes.length === 0) {
          return {
            content: [{ type: "text", text: "No changes requested. Provide 'model' or 'thinking'." }],
            details: {},
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully ${changes.join(" and ")}. Changes will take effect on the next prompt.`,
            },
          ],
          details: {},
        };
      },
    });

    const identityPrompt = `You are currently running as model ${formatModelRef(settings.model)} with thinking level ${settings.thinkingLevel}.`;

    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model: settings.model,
      modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
      thinkingLevel: settings.thinkingLevel,
      // Match pi's default coding-agent toolset (read/bash/edit/write) plus configure_btw.
      tools: ["read", "bash", "edit", "write", "configure_btw"],
      customTools: [configureBtwTool],
      resourceLoader: createBtwResourceLoader(ctx, [BTW_SYSTEM_PROMPT, identityPrompt]),
    });

    const { messages: seedMessages, sideThreadStartIndex } = buildBtwSeedState(ctx, pendingThread, mode, settings.model);
    if (seedMessages.length > 0) {
      session.agent.state.messages = seedMessages as typeof session.state.messages;
    }

    return { session, mode, subscriptions: new Set(), sideThreadStartIndex };
  }

  async function ensureBtwSession(ctx: ExtensionCommandContext, mode: BtwThreadMode): Promise<BtwSessionRuntime | null> {
    const settings = await resolveBtwSettings(ctx);
    if (!settings.model) {
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
      subscribeOverlayToActiveBtwSession(ctx);
      focusOverlay();
      return;
    }

    const runtime: OverlayRuntime = {};
    const closeRuntime = () => {
      if (runtime.closed) {
        return;
      }
      runtime.closed = true;
      if (activeBtwSession) {
        clearBtwSessionSubscriptions(activeBtwSession);
      }
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
            () => transcriptState.entries,
            () => overlayStatus,
            () => pendingMode,
            () => debugMode,
            () => getOverlayModelInfo(),
            (value) => {
              void submitFromOverlay(ctx, value);
            },
            () => {
              void dismissOverlaySession();
            },
            () => {
              overlayRuntime?.handle?.unfocus();
              overlayRuntime?.refresh?.();
            },
            () => pendingModelDisambiguation,
          );

          overlay.focused = runtime.handle?.isFocused() ?? true;
          overlay.setDraft(overlayDraft);
          runtime.setDraft = (value) => {
            overlay.setDraft(value);
          };
          runtime.refresh = () => {
            overlay.focused = runtime.handle?.isFocused() ?? false;
            overlay.refresh();
          };
          runtime.close = () => {
            overlayDraft = overlay.getDraft();
            overlay.dispose();
            closeRuntime();
          };

          subscribeOverlayToActiveBtwSession(ctx);

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
            anchor: "top-center",
            margin: { top: 1, left: 2, right: 2 },
            nonCapturing: true,
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

  async function syncParentContext(ctx: ExtensionCommandContext): Promise<void> {
    await disposeBtwSession();
    pendingMode = "contextual";
    activeBtwSession = await createBtwSubSession(ctx, "contextual");
    subscribeOverlayToActiveBtwSession(ctx);
    const count = activeBtwSession.sideThreadStartIndex;
    const msg = `Synced ${count} parent message${count === 1 ? "" : "s"} into BTW.`;
    setOverlayStatus(msg, ctx);
    notify(ctx, msg, "info");
    syncUi(ctx);
  }

  async function applyModelAndThinkingFlags(
    ctx: ExtensionCommandContext,
    modelQuery: string | undefined,
    thinkingLevel: SessionThinkingLevel | undefined,
    pendingQuestion: string | undefined,
    save: boolean,
    mode: BtwThreadMode,
  ): Promise<{ proceed: boolean }> {
    if (thinkingLevel) {
      await setBtwThinkingOverride(ctx, (thinkingLevel as string) === "clear" ? null : thinkingLevel);
    }

    if (modelQuery) {
      if (modelQuery.toLowerCase() === "clear") {
        await setBtwModelOverride(ctx, null);
      } else {
        const res = await resolveBtwModelQuery(ctx, modelQuery);
        if (res.status === "not_found") {
          setOverlayStatus(res.error, ctx);
          notify(ctx, res.error, "error");
          await ensureOverlay(ctx);
          return { proceed: false };
        }
        if (res.status === "ambiguous") {
          pendingModelDisambiguation = {
            query: modelQuery,
            candidates: res.candidates,
            pendingQuestion,
            save,
            mode,
          };
          setOverlayStatus(`Multiple models match "${modelQuery}". Choose one below.`, ctx);
          await ensureOverlay(ctx);
          return { proceed: false };
        }
        await setBtwModelOverride(ctx, res.model);
      }
    }

    return { proceed: true };
  }

  async function dispatchBtwCommand(name: string, args: string, ctx: ExtensionCommandContext): Promise<boolean> {
    const trimmedArgs = args.trim();

    if (name === "btw") {
      debugMode = false;
      const { question, save, modelQuery, thinkingLevel } = parseBtwArgs(trimmedArgs);
      const flagResult = await applyModelAndThinkingFlags(ctx, modelQuery, thinkingLevel, question || undefined, save, "contextual");
      if (!flagResult.proceed) {
        return true;
      }

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

    if (name === "btw:debug") {
      if (trimmedArgs.toLowerCase() === "off") {
        debugMode = false;
        setOverlayStatus("BTW debug view disabled.", ctx);
        await ensureOverlay(ctx);
        notify(ctx, "BTW debug view disabled.", "info");
        return true;
      }

      if (trimmedArgs.toLowerCase() === "on") {
        debugMode = true;
        setOverlayStatus("BTW debug view enabled.", ctx);
        await ensureOverlay(ctx);
        notify(ctx, "BTW debug view enabled.", "info");
        return true;
      }

      debugMode = true;
      const { question, save, modelQuery, thinkingLevel } = parseBtwArgs(trimmedArgs);
      const flagResult = await applyModelAndThinkingFlags(ctx, modelQuery, thinkingLevel, question || undefined, save, pendingMode);
      if (!flagResult.proceed) {
        return true;
      }

      if (!question) {
        await ensureBtwSession(ctx, pendingMode);
        setOverlayStatus("BTW debug view enabled.", ctx);
        await ensureOverlay(ctx);
        notify(ctx, "BTW debug view enabled.", "info");
        return true;
      }

      await runBtw(ctx, question, save, pendingMode);
      return true;
    }

    if (name === "btw:tangent") {
      debugMode = false;
      const { question, save, modelQuery, thinkingLevel } = parseBtwArgs(trimmedArgs);
      if (pendingMode !== "tangent") {
        await resetThread(ctx, true, "tangent");
      }

      const flagResult = await applyModelAndThinkingFlags(ctx, modelQuery, thinkingLevel, question || undefined, save, "tangent");
      if (!flagResult.proceed) {
        return true;
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
      debugMode = false;
      await resetThread(ctx, true, "contextual");
      const { question, save, modelQuery, thinkingLevel } = parseBtwArgs(trimmedArgs);
      const flagResult = await applyModelAndThinkingFlags(ctx, modelQuery, thinkingLevel, question || undefined, save, "contextual");
      if (!flagResult.proceed) {
        return true;
      }

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
      debugMode = false;
      await resetThread(ctx);
      dismissOverlay();
      notify(ctx, "Cleared BTW thread.", "info");
      return true;
    }

    if (name === "btw:thinking") {
      const parsed = parseBtwThinkingArgs(trimmedArgs);
      if (parsed.action === "show") {
        const settings = await resolveBtwSettings(ctx);
        const message = describeResolvedThinking(settings);
        setOverlayStatus(message, ctx);
        notify(ctx, message, "info");
        return true;
      }

      await setBtwThinkingOverride(ctx, parsed.action === "clear" ? null : parsed.thinkingLevel);
      return true;
    }

    if (name === "btw:inject") {
      if (pendingThread.length === 0) {
        notify(ctx, "No BTW thread to inject.", "warning");
        return true;
      }

      setOverlayStatus("⏳ injecting into the main session...", ctx);
      await ensureOverlay(ctx);

      try {
        const { thread } = await getBtwHandoffThread(ctx);
        const instructions = trimmedArgs;
        const content = instructions
          ? `Here is a side conversation I had. ${instructions}\n\n${formatThread(thread)}`
          : `Here is a side conversation I had for additional context:\n\n${formatThread(thread)}`;

        sendThreadToMain(ctx, content);
        const count = thread.length;
        await resetThread(ctx);
        dismissOverlay();
        notify(ctx, `Injected BTW thread (${count} exchange${count === 1 ? "" : "s"}).`, "info");
      } catch (error) {
        setOverlayStatus("Inject failed. Thread preserved for retry or summarize.", ctx);
        notify(ctx, error instanceof Error ? error.message : String(error), "error");
      }
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
        const { thread } = await getBtwHandoffThread(ctx);
        const summary = await summarizeThread(ctx, thread);
        const instructions = trimmedArgs;
        const content = instructions
          ? `Here is a summary of a side conversation I had. ${instructions}\n\n${summary}`
          : `Here is a summary of a side conversation I had:\n\n${summary}`;

        sendThreadToMain(ctx, content);
        const count = thread.length;
        await resetThread(ctx);
        dismissOverlay();
        notify(ctx, `Injected BTW summary (${count} exchange${count === 1 ? "" : "s"}).`, "info");
      } catch (error) {
        setOverlayStatus("Summarize failed. Thread preserved for retry or injection.", ctx);
        notify(ctx, error instanceof Error ? error.message : String(error), "error");
      }
      return true;
    }

    if (name === "btw:copy") {
      const lastAnswer = findLatestAssistantText(transcriptState) || pendingThread.at(-1)?.answer;
      if (!lastAnswer) {
        setOverlayStatus("No BTW response to copy.", ctx);
        notify(ctx, "No BTW response to copy.", "warning");
        return true;
      }
      try {
        await copyToClipboard(lastAnswer);
        setOverlayStatus("Copied last response to clipboard.", ctx);
        notify(ctx, "Copied last response to clipboard.", "info");
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setOverlayStatus(`Copy failed: ${errorMsg}`, ctx);
        notify(ctx, `Copy failed: ${errorMsg}`, "error");
      }
      return true;
    }

    if (name === "btw:sync") {
      try {
        await syncParentContext(ctx);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setOverlayStatus(`Sync failed: ${errorMsg}`, ctx);
        notify(ctx, `Sync failed: ${errorMsg}`, "error");
      }
      return true;
    }

    return false;
  }

  function parseOverlayBtwCommand(value: string): { name: string; args: string; bare: boolean } | null {
    const trimmed = value.trim();
    const match = trimmed.match(
      /^\/(?:btw:(new|tangent|clear|inject|summarize|thinking|debug|copy|sync)|btw\b|(new|tangent|clear|inject|summarize|thinking|debug|copy|sync)\b)(?:\s+(.*))?$/i,
    );
    if (!match) {
      return null;
    }

    const btwCmd = match[1];
    const bareCmd = match[2];
    const cmdName = btwCmd ? `btw:${btwCmd.toLowerCase()}` : bareCmd ? `btw:${bareCmd.toLowerCase()}` : "btw";
    return {
      name: cmdName,
      args: match[3]?.trim() ?? "",
      bare: Boolean(bareCmd),
    };
  }

function parseModelSwitchIntent(text: string): { modelQuery?: string; thinking?: SessionThinkingLevel } | null {
  const t = text.trim();

  const thinkMatch = t.match(
    /^(?:(?:can you\s+)?(?:set|change|turn|switch)\s+(?:the\s+)?thinking(?:\s+level)?(?:\s+to)?\s+|(?:thinking(?:\s+level)?(?:\s*[:=]\s*|\s+)))(off|low|medium|high|xhigh|max|clear)(?:\s+please)?$/i,
  );
  if (thinkMatch) {
    return { thinking: thinkMatch[1].toLowerCase() as SessionThinkingLevel };
  }

  const modelMatch = t.match(
    /^(?:can you\s+)?(?:please\s+)?(?:use|switch(?:\s+model)?(?:\s+to)?|change(?:\s+model)?(?:\s+to)?|set\s+model\s+to)\s+(?:the\s+)?(.+?)(?:\s+model)?(?:\s+please)?$/i,
  );
  if (modelMatch) {
    const raw = modelMatch[1].trim();
    const withThinking = raw.match(
      /^(.+?)\s+(?:with|and)\s+(?:thinking\s+(?:level\s+)?(?:to\s+)?)?(off|low|medium|high|xhigh|max|clear)$/i,
    );
    if (withThinking) {
      return { modelQuery: withThinking[1].trim(), thinking: withThinking[2].toLowerCase() as SessionThinkingLevel };
    }
    return { modelQuery: raw };
  }

  return null;
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

    const cmdCtx = ctx as ExtensionCommandContext;

    if (pendingModelDisambiguation) {
      setOverlayDraft("");
      const input = question.toLowerCase();
      if (input === "cancel" || input === "/clear") {
        pendingModelDisambiguation = null;
        setOverlayStatus("Model selection cancelled.", cmdCtx);
        syncUi(cmdCtx);
        return;
      }

      const num = parseInt(input, 10);
      let chosen: SessionModel | undefined;
      if (!isNaN(num) && num >= 1 && num <= pendingModelDisambiguation.candidates.length) {
        chosen = pendingModelDisambiguation.candidates[num - 1];
      } else {
        chosen = pendingModelDisambiguation.candidates.find(
          (c: SessionModel) =>
            c.id.toLowerCase() === input ||
            `${c.provider}/${c.id}`.toLowerCase() === input ||
            c.provider.toLowerCase() === input,
        );
      }

      if (!chosen) {
        setOverlayStatus(
          `Invalid selection. Enter 1-${pendingModelDisambiguation.candidates.length} or type cancel.`,
          cmdCtx,
        );
        syncUi(cmdCtx);
        return;
      }

      const saved = pendingModelDisambiguation;
      pendingModelDisambiguation = null;
      await setBtwModelOverride(cmdCtx, chosen);

      if (saved.pendingQuestion) {
        setOverlayStatus("⏳ thinking...", cmdCtx);
        syncUi(cmdCtx);
        await runBtw(cmdCtx, saved.pendingQuestion, saved.save, saved.mode);
      } else {
        setOverlayStatus(`BTW model set to ${formatModelRef(chosen)}.`, cmdCtx);
        syncUi(cmdCtx);
      }
      return;
    }

    // Allow flags like --model or -m or --thinking or -t directly in the overlay composer
    if (/^(?:--model|-m\s|--thinking|-t\s)/i.test(question)) {
      setOverlayDraft("");
      await dispatchBtwCommand("btw", question, cmdCtx);
      return;
    }

    // Direct conversational model or thinking switch intent (instant local execution)
    const switchIntent = parseModelSwitchIntent(question);
    if (switchIntent) {
      if (switchIntent.thinking && !switchIntent.modelQuery) {
        setOverlayDraft("");
        await setBtwThinkingOverride(cmdCtx, (switchIntent.thinking as string) === "clear" ? null : switchIntent.thinking);
        const settings = await resolveBtwSettings(cmdCtx);
        appendPersistedTranscriptTurn(transcriptState, {
          question,
          thinking: "",
          answer: `Switched BTW thinking level to \`${settings.thinkingLevel}\`.`,
          provider: settings.model?.provider ?? "unknown",
          model: settings.model?.id ?? "unknown",
          api: settings.model?.api ?? "openai-responses",
          thinkingLevel: settings.thinkingLevel,
          timestamp: Date.now(),
        });
        setOverlayStatus("Ready for a follow-up.", cmdCtx);
        syncUi(cmdCtx);
        return;
      }

      if (switchIntent.modelQuery) {
        const res = await resolveBtwModelQuery(cmdCtx, switchIntent.modelQuery);
        if (res.status === "resolved") {
          setOverlayDraft("");
          await setBtwModelOverride(cmdCtx, res.model);
          if (switchIntent.thinking) {
            await setBtwThinkingOverride(cmdCtx, (switchIntent.thinking as string) === "clear" ? null : switchIntent.thinking);
          }
          const settings = await resolveBtwSettings(cmdCtx);
          appendPersistedTranscriptTurn(transcriptState, {
            question,
            thinking: "",
            answer: `Switched BTW model to \`${formatModelRef(res.model)}\`. It will take effect on your next message.`,
            provider: res.model.provider,
            model: res.model.id,
            api: res.model.api,
            thinkingLevel: settings.thinkingLevel,
            timestamp: Date.now(),
          });
          setOverlayStatus("Ready for a follow-up.", cmdCtx);
          syncUi(cmdCtx);
          return;
        }

        if (res.status === "ambiguous") {
          setOverlayDraft("");
          pendingModelDisambiguation = {
            query: switchIntent.modelQuery,
            candidates: res.candidates,
            save: false,
            mode: pendingMode,
          };
          setOverlayStatus(`Multiple models match "${switchIntent.modelQuery}". Choose one below.`, cmdCtx);
          syncUi(cmdCtx);
          return;
        }
      }
    }

    const btwCommand = parseOverlayBtwCommand(question);
    if (btwCommand) {
      setOverlayDraft("");
      if (btwCommand.name === "btw:clear" && btwCommand.bare) {
        await resetThread(cmdCtx);
        setOverlayStatus("Cleared BTW thread.", cmdCtx);
        notify(cmdCtx, "Cleared BTW thread.", "info");
        return;
      }
      await dispatchBtwCommand(btwCommand.name, btwCommand.args, cmdCtx);
      return;
    }

    setOverlayDraft("");
    setOverlayStatus("⏳ thinking...", ctx);
    syncUi(ctx);
    await runBtw(cmdCtx, question, false, pendingMode);
  }

  async function resetThread(
    ctx: ExtensionContext | ExtensionCommandContext,
    persist = true,
    mode: BtwThreadMode = "contextual",
  ): Promise<void> {
    await disposeBtwSession();
    pendingThread = [];
    pendingMode = mode;
    pendingModelDisambiguation = null;
    debugMode = false;
    transcriptState = createEmptyTranscriptState();
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
    debugMode = false;
    btwModelOverride = null;
    btwThinkingOverride = null;
    transcriptState = createEmptyTranscriptState();
    overlayDraft = "";
    lastUiContext = ctx;
    overlayStatus = null;

    const branch = ctx.sessionManager.getBranch();
    let lastResetIndex = -1;

    for (let i = 0; i < branch.length; i++) {
      if (isCustomEntry(branch[i], BTW_MODEL_OVERRIDE_TYPE)) {
        const details = (branch[i] as unknown as { data?: BtwModelOverrideDetails }).data;
        if (details?.action === "set") {
          const resolved = ctx.modelRegistry.find(details.provider, details.id);
          if (resolved) {
            btwModelOverride = resolved;
          } else {
            // Configured override is no longer in the registry; drop it on restore.
            btwModelOverride = null;
          }
        } else if (details?.action === "clear") {
          btwModelOverride = null;
        }
      }

      if (isCustomEntry(branch[i], BTW_THINKING_OVERRIDE_TYPE)) {
        const details = (branch[i] as unknown as { data?: BtwThinkingOverrideDetails }).data;
        btwThinkingOverride =
          details?.action === "set"
            ? details.thinkingLevel
            : details?.action === "clear"
              ? null
              : btwThinkingOverride;
      }

      if (isCustomEntry(branch[i], BTW_RESET_TYPE)) {
        lastResetIndex = i;
        const details = (branch[i] as unknown as { data?: BtwResetDetails }).data;
        pendingMode = details?.mode ?? "contextual";
      }
    }

    for (const entry of branch.slice(lastResetIndex + 1)) {
      if (!isCustomEntry(entry, BTW_ENTRY_TYPE)) {
        continue;
      }

      const details = (entry as unknown as { data?: BtwDetails }).data;
      if (!details?.question || !details.answer) {
        continue;
      }

      const normalizedDetails: BtwDetails = {
        ...details,
        api: details.api || ctx.model?.api || "openai-responses",
      };

      pendingThread.push(normalizedDetails);
      appendPersistedTranscriptTurn(transcriptState, normalizedDetails);
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
    const settings = await resolveBtwSettings(ctx);
    const model = settings.model;
    if (!model) {
      const message = settings.fallbackReason || "No active model selected.";
      setOverlayStatus(message, ctx);
      notify(ctx, message, "error");
      return;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      const message = auth.error || `No credentials available for ${model.provider}/${model.id}.`;
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
    const thinkingLevel = settings.thinkingLevel;

    setOverlayStatus("⏳ thinking...", ctx);
    await ensureOverlay(ctx);

    try {
      await session.prompt(question, { source: "extension" });

      const response = getLastAssistantMessage(session);
      if (!response) {
        throw new Error("BTW request finished without a response.");
      }
      if (response.stopReason === "aborted") {
        removeTranscriptTurn(transcriptState, transcriptState.lastTurnId ?? transcriptState.currentTurnId);
        setOverlayStatus("Request aborted.", ctx);
        return;
      }
      if (response.stopReason === "error") {
        throw new Error(response.errorMessage || "BTW request failed.");
      }

      const completedTurnId = transcriptState.lastTurnId ?? transcriptState.currentTurnId;
      const streamedThinking =
        completedTurnId !== null ? findLatestTranscriptEntry(transcriptState, completedTurnId, "thinking")?.text : "";
      const answer = extractAnswer(response);
      const thinking = extractThinking(response) || streamedThinking || "";

      const details: BtwDetails = {
        question,
        thinking,
        answer,
        provider: model.provider,
        model: model.id,
        api: model.api,
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
        setOverlayStatus("Ready for a follow-up.", ctx);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setTranscriptFailure(transcriptState, errorMessage);
      setOverlayStatus("Request failed. Thread preserved for retry or follow-up.", ctx);
      notify(ctx, errorMessage, "error");
      await disposeBtwSession();
    } finally {
      if (pendingSessionDispose) {
        pendingSessionDispose = false;
        await disposeBtwSession();
      }
      syncUi(ctx);
    }
  }

  function getPendingThreadForHandoff(): BtwHandoffExchange[] {
    return pendingThread.map((entry) => ({ user: entry.question, assistant: entry.answer }));
  }

  async function getBtwHandoffThread(
    ctx: ExtensionCommandContext,
  ): Promise<{ sessionRuntime: BtwSessionRuntime | null; thread: BtwHandoffExchange[] }> {
    const sessionRuntime = activeBtwSession ?? (await ensureBtwSession(ctx, pendingMode));
    const thread = sessionRuntime ? extractBtwHandoffThread(sessionRuntime) : [];
    const resolvedThread = thread.length > 0 ? thread : getPendingThreadForHandoff();

    if (resolvedThread.length === 0) {
      throw new Error("No BTW thread available for handoff.");
    }

    return { sessionRuntime, thread: resolvedThread };
  }

  async function summarizeThread(ctx: ExtensionCommandContext, thread: BtwHandoffExchange[]): Promise<string> {
    const settings = await resolveBtwSettings(ctx, true);
    const model = settings.model;
    if (!model) {
      throw new Error(settings.fallbackReason || "No active model selected.");
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      throw new Error(auth.error || `No credentials available for ${model.provider}/${model.id}.`);
    }

    const attemptSummarize = async (thinkingLevel: SessionThinkingLevel): Promise<string> => {
      const { session } = await createAgentSession({
        sessionManager: SessionManager.inMemory(),
        model,
        modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
        thinkingLevel,
        tools: [],
        resourceLoader: createBtwResourceLoader(ctx, [BTW_SUMMARIZE_SYSTEM_PROMPT]),
      });

      try {
        await session.prompt(formatThread(thread), { source: "extension" });

        const response = getLastAssistantMessage(session);
        if (!response) {
          throw new Error("BTW summarize finished without a response.");
        }
        if (response.stopReason === "error") {
          throw new Error(response.errorMessage || "Failed to summarize BTW thread.");
        }
        if (response.stopReason === "aborted") {
          throw new Error("BTW summarize aborted.");
        }

        return extractAnswer(response);
      } finally {
        try {
          await session.abort();
        } catch {
          // Ignore abort errors during summarize session shutdown.
        }
        session.dispose();
      }
    };

    const supportedLevels = getSupportedThinkingLevels(model);
    const safeFallback: SessionThinkingLevel = settings.thinkingLevel !== "off" ? settings.thinkingLevel : "low";
    const preferredLevel: SessionThinkingLevel = supportedLevels.includes("off") ? "off" : safeFallback;

    try {
      return await attemptSummarize(preferredLevel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (preferredLevel === "off" && /thinking/i.test(message)) {
        return await attemptSummarize(safeFallback);
      }
      throw error;
    }
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
        theme.fg(
          "dim",
          `model: ${details.provider}/${details.model} (${details.api ?? "openai-responses"}) · thinking: ${details.thinkingLevel}`,
        ),
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

  pi.on("session_tree", async (_event, ctx) => {
    await restoreThread(ctx);
  });

  pi.on("session_shutdown", async () => {
    await disposeBtwSession();
    dismissOverlay();
  });

  for (const shortcut of BTW_FOCUS_SHORTCUTS) {
    pi.registerShortcut(shortcut, {
      description: "Toggle BTW overlay focus while leaving it open.",
      handler: async (_ctx) => {
        toggleOverlayFocus();
      },
    });
  }

  pi.on("model_select", async (event) => {
    currentMainModel = event.model;
    syncUi();
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

  pi.registerCommand("btw:thinking", {
    description: "Show, set, or clear the BTW-only thinking override.",
    handler: async (args, ctx) => {
      await dispatchBtwCommand("btw:thinking", args, ctx);
    },
  });

  pi.registerCommand("btw:sync", {
    description: "Sync latest parent session messages into the active BTW thread context.",
    handler: async (_args, ctx) => {
      await dispatchBtwCommand("btw:sync", "", ctx);
    },
  });

  pi.registerCommand("btw:copy", {
    description: "Copy the last BTW assistant response to the clipboard.",
    handler: async (_args, ctx) => {
      await dispatchBtwCommand("btw:copy", "", ctx);
    },
  });

  pi.registerCommand("btw:debug", {
    description: "Start or continue BTW with debug info (thinking and tool activity) visible.",
    handler: async (args, ctx) => {
      await dispatchBtwCommand("btw:debug", args, ctx);
    },
  });
}
