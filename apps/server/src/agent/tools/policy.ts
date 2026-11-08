import type { AgentType } from '@koodu/protocol';

/**
 * Per-specialist tool allowlists. Research stays read-only, coding gets the
 * full workspace toolset, organizer coordinates, and memory curates context.
 */
export const TOOL_POLICY: Record<AgentType, readonly string[]> = {
  research: [
    'search_memory',
    'save_memory',
    'list_skills',
    'read_skill',
    'list_workspace_pages',
    'list_files',
    'read_file',
  ],
  coding: [
    'search_memory',
    'save_memory',
    'list_skills',
    'read_skill',
    'list_workspace_pages',
    'list_files',
    'read_file',
    'write_file',
    'append_file',
    'replace_in_file',
  ],
  organizer: [
    'search_memory',
    'save_memory',
    'list_skills',
    'read_skill',
    'list_workspace_pages',
  ],
  memory: [
    'search_memory',
    'save_memory',
    'list_skills',
    'read_skill',
  ],
};

export function toolNamesFor(agentType: AgentType): readonly string[] {
  return TOOL_POLICY[agentType] ?? TOOL_POLICY.organizer;
}
