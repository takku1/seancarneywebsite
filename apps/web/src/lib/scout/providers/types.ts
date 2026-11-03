/**
 * The seam between Scout and whichever AI backend runs it. Add a provider by
 * implementing ScoutProvider in a new file and registering it in ../index.ts.
 * The transcript is provider-owned and opaque to the client, which stores it
 * and sends it back unchanged (append-only; providers may depend on that).
 */
import type { Card, ToolContext } from '../tools';

export interface ScoutTurnInput {
  /** Provider-specific history returned by the previous turn (opaque JSON). */
  transcript: unknown[];
  /** The visitor's new message, already length-checked. */
  text: string;
  /** Volatile context sent with this turn (today, page). */
  contextTag: string;
  tools: ToolContext;
}

export interface ScoutTurnOutput {
  reply: string;
  cards: Card[];
  transcript: unknown[];
  /** Tool names called this turn, for analytics. */
  toolCalls: string[];
  stop: 'done' | 'refusal' | 'limit';
}

export interface ScoutProvider {
  id: string;
  model: string;
  run(input: ScoutTurnInput): Promise<ScoutTurnOutput>;
}
