import { describe, expect, it } from "vitest";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const supportsModelRuntime = "ModelRuntime" in codingAgent;

function createFixtureProviderStream(model: any) {
  const stream = createAssistantMessageEventStream();
  const message = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "" }],
    provider: model.provider,
    model: model.id,
    api: model.api,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending" as const,
    timestamp: Date.now(),
  };

  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "text_start", contentIndex: 0, partial: message });
    message.content[0].text = "CUSTOM_PROVIDER_OK";
    stream.push({ type: "text_delta", contentIndex: 0, delta: "CUSTOM_PROVIDER_OK", partial: message });
    stream.push({ type: "text_end", contentIndex: 0, content: "CUSTOM_PROVIDER_OK", partial: message });
    const completed = { ...message, stopReason: "stop" as const };
    stream.push({ type: "done", reason: "stop", message: completed });
    stream.end(completed);
  });

  return stream;
}

describe("Pi ModelRuntime integration", () => {
  it.skipIf(!supportsModelRuntime)(
    "calls an extension-registered provider from an isolated child session sharing the parent runtime",
    async () => {
      const ModelRuntime = (codingAgent as any).ModelRuntime;
      const runtime = await ModelRuntime.create({
        modelsPath: null,
        refreshOnCreate: false,
      });
      runtime.registerProvider("fixture-provider", {
        name: "Fixture Provider",
        baseUrl: "https://fixture.invalid",
        apiKey: "fake-test-key",
        api: "openai-responses",
        streamSimple: createFixtureProviderStream,
        models: [
          {
            id: "fixture-model",
            name: "Fixture Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 4096,
            maxTokens: 1024,
          },
        ],
      });

      const model = runtime.getModel("fixture-provider", "fixture-model");
      expect(model).toBeDefined();

      const resourceLoader = {
        getExtensions: () => ({
          extensions: [],
          errors: [],
          runtime: codingAgent.createExtensionRuntime(),
        }),
        getSkills: () => ({ skills: [], diagnostics: [] }),
        getPrompts: () => ({ prompts: [], diagnostics: [] }),
        getThemes: () => ({ themes: [], diagnostics: [] }),
        getAgentsFiles: () => ({ agentsFiles: [] }),
        getSystemPrompt: () => "You are a test assistant.",
        getSystemPromptSource: () => undefined,
        getAppendSystemPrompt: () => [],
        getAppendSystemPromptSources: () => [],
        extendResources: () => {},
        reload: async () => {},
      };

      const { session } = await codingAgent.createAgentSession({
        sessionManager: codingAgent.SessionManager.inMemory(),
        model,
        modelRuntime: runtime,
        thinkingLevel: "off",
        tools: [],
        resourceLoader,
      } as any);

      try {
        await session.prompt("Only reply with the fixture marker.", { source: "extension" });
        const response = session.state.messages.at(-1) as any;
        expect(response.stopReason).toBe("stop");
        expect(response.content).toEqual([{ type: "text", text: "CUSTOM_PROVIDER_OK" }]);
      } finally {
        session.dispose();
      }
    },
  );
});
