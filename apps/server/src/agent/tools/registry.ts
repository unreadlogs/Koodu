import { z } from 'zod';
import type { ToolCallRecord, ToolContext, ToolDefinition, ToolDescriptor, ToolResult } from './types';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESULT_CHARS = 6_000;

function truncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n…[truncated ${content.length - maxChars} characters]`;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join('.') || 'args'}: ${issue.message}`)
    .join('; ');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Allowlisted tool registry. Unknown names, invalid arguments, timeouts and
 * executor errors become structured observations instead of crashing the loop.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly maxResultChars: number;

  constructor(definitions: ToolDefinition[] = [], options: { maxResultChars?: number } = {}) {
    this.maxResultChars = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
    for (const definition of definitions) this.register(definition);
  }

  register(definition: ToolDefinition): void {
    if (!definition.name || !/^[a-z][a-z0-9_]{1,40}$/.test(definition.name)) {
      throw new Error(`Invalid tool name: ${definition.name}`);
    }
    if (this.tools.has(definition.name)) {
      throw new Error(`Duplicate tool registration: ${definition.name}`);
    }
    this.tools.set(definition.name, definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** A filtered registry that only exposes the named tools. */
  subset(names: readonly string[]): ToolRegistry {
    const allowed = new Set(names);
    return new ToolRegistry(
      [...this.tools.values()].filter((tool) => allowed.has(tool.name)),
      { maxResultChars: this.maxResultChars },
    );
  }

  describe(): ToolDescriptor[] {
    return [...this.tools.values()].map(({ name, description, parameters, risk }) => ({
      name,
      description,
      parameters,
      risk,
    }));
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  async run(name: string, rawArgs: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        content: `Unknown tool "${name}". Available tools: ${this.names().join(', ') || 'none'}.`,
      };
    }
    if (context.signal?.aborted) {
      return { ok: false, content: `Tool "${name}" was cancelled before it started.` };
    }
    const parsed = tool.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return { ok: false, content: `Invalid arguments for "${name}": ${formatIssues(parsed.error)}.` };
    }
    try {
      const result = await withTimeout(
        tool.execute(parsed.data as Record<string, unknown>, context),
        tool.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        name,
      );
      const normalized: ToolResult = typeof result === 'string' ? { ok: true, content: result } : result;
      return { ok: normalized.ok, content: truncate(normalized.content, this.maxResultChars) };
    } catch (error) {
      return {
        ok: false,
        content: `Tool "${name}" failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }
  }

  /** Convenience wrapper that records the call for the agent checkpoint. */
  async runRecorded(name: string, rawArgs: unknown, context: ToolContext): Promise<ToolCallRecord> {
    const result = await this.run(name, rawArgs, context);
    const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
    return { name, args, result: result.content, ok: result.ok };
  }
}
