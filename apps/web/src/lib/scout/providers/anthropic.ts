/**
 * Claude adapter for Scout (Anthropic TypeScript SDK, runs on Workers).
 *
 * - Static knowledge base as a cached system block (prompt caching).
 * - Manual tool loop (max 4 rounds) so every tool result can also emit a UI card.
 * - Effort "low": this is latency-sensitive chat, not deep reasoning.
 * - Server-side refusal fallback ("default" routing) on models that support it.
 * - Transcript is append-only: assistant content (including thinking blocks)
 *   is stored and resent unchanged, which current models require.
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadKnowledge } from '../knowledge';
import { TOOL_SPECS, executeTool, type Card } from '../tools';
import type { ScoutProvider, ScoutTurnInput, ScoutTurnOutput } from './types';

const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
const MAX_ROUNDS = 4;

export function createAnthropicProvider(apiKey: string, model: string): ScoutProvider {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
  const tools: Anthropic.Beta.BetaTool[] = TOOL_SPECS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema }));
  const useFallback = FALLBACK_MODELS.has(model);

  return {
    id: 'anthropic',
    model,
    async run({ transcript, text, contextTag, tools: ctx }: ScoutTurnInput): Promise<ScoutTurnOutput> {
      const { system } = await loadKnowledge();
      const messages = [...(transcript as Anthropic.Beta.BetaMessageParam[])];
      messages.push({ role: 'user', content: contextTag ? [{ type: 'text', text: contextTag }, { type: 'text', text }] : text });

      const cards: Card[] = [];
      const toolCalls: string[] = [];

      for (let round = 0; round < MAX_ROUNDS; round++) {
        const response = await client.beta.messages.create({
          model,
          max_tokens: 2000,
          ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          tools,
          messages,
        });

        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'refusal') {
          return { reply: "I can't help with that one, but I'm glad to help with music, dates or an inquiry for Sean.", cards, transcript: messages, toolCalls, stop: 'refusal' };
        }

        const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
          const reply = response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim();
          return { reply, cards, transcript: messages, toolCalls, stop: 'done' };
        }

        // Run all tool calls, return every result in one user message.
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          toolCalls.push(tu.name);
          const out = await executeTool(tu.name, tu.input, ctx);
          if (out.card) cards.push(out.card);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.result, ...(out.isError ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
      }

      return {
        reply: 'Let me hand you to the inquiry form so nothing gets lost. You can pick up right where we left off.',
        cards,
        transcript: messages,
        toolCalls,
        stop: 'limit',
      };
    },
  };
}
