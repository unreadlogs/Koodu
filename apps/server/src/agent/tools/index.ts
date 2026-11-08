import { fileTools } from './file-tools';
import { memoryTools } from './memory-tools';
import { ToolRegistry } from './registry';
import { skillTools } from './skill-tools';
import { workspaceTools } from './workspace-tools';

/** Default allowlisted toolset for the main companion agent. */
export function createDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry([
    ...memoryTools,
    ...skillTools,
    ...workspaceTools,
    ...fileTools,
  ]);
}

export { ToolRegistry } from './registry';
export { TOOL_POLICY, toolNamesFor } from './policy';
export { resolveWorkspacePath, MAX_FILE_BYTES } from './file-tools';
export type { MemoryPort, ToolCallRecord, ToolContext, ToolDefinition, ToolDescriptor, ToolResult, ToolRisk } from './types';
