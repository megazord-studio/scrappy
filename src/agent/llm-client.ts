import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface LLMClient {
  messages: {
    create(
      params: Anthropic.Messages.MessageCreateParamsNonStreaming
    ): Promise<Anthropic.Message>;
  };
  /** Model ID used in the agent loop (full tool-use capable model) */
  agentModel: string;
  /** Model ID used for lightweight extraction (update command) */
  extractModel: string;
  provider: "anthropic" | "openai" | "zordmind";
}

export interface OpenAILLMClient extends LLMClient {
  provider: "openai";
  rawClient: OpenAI;
}

export function createAnthropicClient(
  apiKey: string,
  agentModel = "claude-opus-4-6",
  extractModel = "claude-haiku-4-5-20251001"
): LLMClient {
  const client = new Anthropic({ apiKey });
  return {
    provider: "anthropic",
    agentModel,
    extractModel,
    messages: {
      create: (params) => client.messages.create(params),
    },
  };
}

export function createZordMindClient(baseUrl: string, model: string): LLMClient {
  async function infer(prompt: string, maxTokens = 8192): Promise<string> {
    const url = baseUrl.replace(/\/$/, "") + "/infer";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        model,
        generation_options: { max_new_tokens: maxTokens },
      }),
    });
    if (!res.ok) {
      throw new Error(`ZordMind ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { assistant: string };
    return data.assistant ?? "";
  }

  function serializeMessages(
    system: string,
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[]
  ): string {
    const toolNames = tools.map((t) => t.name).join(", ");
    const toolSection =
      tools.length > 0
        ? `\n\n## Tool use instructions\nYou MUST call at least one tool every turn. Available tools: ${toolNames}\n\nYour ENTIRE response must be a single JSON array. No prose before or after. No markdown fences. Example:\n[{"type":"text","text":"brief reasoning"},{"type":"tool_use","id":"c1","name":"TOOL_NAME","input":{}}]\n\nTool definitions:\n${JSON.stringify(tools, null, 2)}\n`
        : "";

    const history = messages
      .map((m) => {
        const roleLabel = m.role === "user" ? "Human" : "Assistant";
        let text = "";
        if (typeof m.content === "string") {
          text = m.content;
        } else {
          text = (m.content as Anthropic.ContentBlockParam[])
            .map((b) => {
              if (b.type === "text") return (b as Anthropic.TextBlockParam).text;
              if (b.type === "tool_use") {
                // Use XML-style tags so the model won't confuse them with the JSON output format
                const tb = b as Anthropic.ToolUseBlockParam;
                return `<executed tool="${tb.name}">${JSON.stringify(tb.input)}</executed>`;
              }
              if (b.type === "tool_result") {
                const rb = b as Anthropic.ToolResultBlockParam;
                const c =
                  typeof rb.content === "string"
                    ? rb.content
                    : JSON.stringify(rb.content);
                return `<tool_result>${c}</tool_result>`;
              }
              return "";
            })
            .filter(Boolean)
            .join("\n");
        }
        return `${roleLabel}: ${text}`;
      })
      .join("\n\n");

    return `${system}${toolSection}\n\n${history}\n\nAssistant (JSON array only):`;
  }

  return {
    provider: "zordmind",
    agentModel: model,
    extractModel: model,
    messages: {
      async create(
        params: Anthropic.Messages.MessageCreateParamsNonStreaming
      ): Promise<Anthropic.Message> {
        const system =
          typeof params.system === "string" ? params.system : "";
        const tools = (params.tools ?? []) as Anthropic.Tool[];
        const prompt = serializeMessages(
          system,
          params.messages as Anthropic.MessageParam[],
          tools
        );

        const raw = await infer(prompt, params.max_tokens);

        const content: Anthropic.ContentBlock[] = [];

        function parseBlocks(json: string): boolean {
          try {
            const parsed = JSON.parse(json.trim());
            const blocks = Array.isArray(parsed) ? parsed : [parsed];
            if (!blocks.some((b: Record<string, unknown>) => b.type === "tool_use" || b.type === "text")) return false;
            for (const b of blocks) {
              if (b.type === "text" && b.text) {
                content.push({ type: "text", text: b.text } as Anthropic.ContentBlock);
              } else if (b.type === "tool_use" && b.name) {
                content.push({
                  type: "tool_use",
                  id: b.id ?? `zm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  name: b.name,
                  input: b.input ?? {},
                } as Anthropic.ContentBlock);
              }
            }
            return true;
          } catch {
            return false;
          }
        }

        // 1. Try fenced code blocks first
        const codeBlockRe = /```(?:json)?\s*([\s\S]*?)```/g;
        let lastIdx = 0;
        let match: RegExpExecArray | null;

        while ((match = codeBlockRe.exec(raw)) !== null) {
          const textBefore = raw.slice(lastIdx, match.index).trim();
          if (textBefore) content.push({ type: "text", text: textBefore } as Anthropic.ContentBlock);
          if (!parseBlocks(match[1])) {
            content.push({ type: "text", text: match[0] } as Anthropic.ContentBlock);
          }
          lastIdx = match.index + match[0].length;
        }

        const tail = raw.slice(lastIdx).trim();

        // 2. If no fenced blocks found, try bare JSON array anywhere in the response
        if (content.length === 0) {
          // Find the outermost [...] that contains tool_use or text blocks
          const arrMatch = tail.match(/(\[[\s\S]*\])/);
          if (arrMatch && parseBlocks(arrMatch[1])) {
            // parsed successfully — any text outside the array is discarded (it's preamble/postamble)
          } else if (tail) {
            content.push({ type: "text", text: tail } as Anthropic.ContentBlock);
          }
        } else if (tail) {
          content.push({ type: "text", text: tail } as Anthropic.ContentBlock);
        }

        if (content.length === 0) content.push({ type: "text", text: raw } as Anthropic.ContentBlock);

        const hasToolUse = content.some((b) => b.type === "tool_use");

        return {
          id: `zm_msg_${Date.now()}`,
          type: "message",
          role: "assistant",
          content,
          model,
          stop_reason: hasToolUse ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 } as Anthropic.Usage,
        } as Anthropic.Message;
      },
    },
  };
}

export function createOpenAIClient(apiKey: string, model = "gpt-5.4", extractModel = "gpt-5.4-mini"): OpenAILLMClient {
  const client = new OpenAI({ apiKey });

  function toOpenAIMessages(
    system: string,
    messages: Anthropic.MessageParam[]
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];
    if (system) result.push({ role: "system", content: system });

    for (const m of messages) {
      if (typeof m.content === "string") {
        result.push({ role: m.role, content: m.content });
        continue;
      }

      if (m.role === "assistant") {
        const textParts = (m.content as Anthropic.ContentBlockParam[])
          .filter((b) => b.type === "text")
          .map((b) => (b as Anthropic.TextBlockParam).text)
          .join("\n");
        const toolCalls = (m.content as Anthropic.ContentBlockParam[])
          .filter((b) => b.type === "tool_use")
          .map((b) => {
            const tb = b as Anthropic.ToolUseBlockParam;
            return {
              id: tb.id as string,
              type: "function" as const,
              function: { name: tb.name, arguments: JSON.stringify(tb.input) },
            };
          });
        result.push({
          role: "assistant",
          content: textParts || null,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        });
      } else {
        // user: may contain tool_result blocks
        const toolResults = (m.content as Anthropic.ContentBlockParam[]).filter(
          (b) => b.type === "tool_result"
        );
        if (toolResults.length) {
          for (const b of toolResults) {
            const rb = b as Anthropic.ToolResultBlockParam;
            result.push({
              role: "tool",
              tool_call_id: rb.tool_use_id,
              content: typeof rb.content === "string" ? rb.content : JSON.stringify(rb.content),
            });
          }
        } else {
          const text = (m.content as Anthropic.ContentBlockParam[])
            .filter((b) => b.type === "text")
            .map((b) => (b as Anthropic.TextBlockParam).text)
            .join("\n");
          result.push({ role: "user", content: text });
        }
      }
    }
    return result;
  }

  function toOpenAITools(tools: Anthropic.Tool[]): OpenAI.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema as Record<string, unknown>,
      },
    }));
  }

  return {
    provider: "openai",
    agentModel: model,
    extractModel,
    rawClient: client,
    messages: {
      async create(
        params: Anthropic.Messages.MessageCreateParamsNonStreaming
      ): Promise<Anthropic.Message> {
        const system = typeof params.system === "string" ? params.system : "";
        const tools = (params.tools ?? []) as Anthropic.Tool[];
        const oaiMessages = toOpenAIMessages(system, params.messages as Anthropic.MessageParam[]);
        const oaiTools = tools.length ? toOpenAITools(tools) : undefined;

        const response = await client.chat.completions.create({
          model,
          max_completion_tokens: params.max_tokens,
          messages: oaiMessages,
          stream: false,
          ...(oaiTools ? { tools: oaiTools, tool_choice: "required" } : {}),
        });

        const choice = response.choices[0];
        const content: Anthropic.ContentBlock[] = [];

        if (choice.message.content) {
          content.push({ type: "text", text: choice.message.content } as Anthropic.ContentBlock);
        }
        for (const tc of choice.message.tool_calls ?? []) {
          if (tc.type !== "function") continue;
          const fn = (tc as unknown as { id: string; function: { name: string; arguments: string } });
          content.push({
            type: "tool_use",
            id: fn.id,
            name: fn.function.name,
            input: JSON.parse(fn.function.arguments || "{}"),
          } as Anthropic.ContentBlock);
        }
        if (content.length === 0) content.push({ type: "text", text: "" } as Anthropic.ContentBlock);

        const hasToolUse = content.some((b) => b.type === "tool_use");
        return {
          id: response.id,
          type: "message",
          role: "assistant",
          content,
          model,
          stop_reason: hasToolUse ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 } as Anthropic.Usage,
        } as Anthropic.Message;
      },
    },
  };
}
