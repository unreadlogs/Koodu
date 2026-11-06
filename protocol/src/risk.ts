import { z } from 'zod';

/**
 * Risk is the permission vocabulary for every registered action.
 * - `safe`      : executes immediately for any source.
 * - `confirm`   : requires explicit user approval before executing.
 * - `dangerous` : requires explicit user approval and is never local-model allowed.
 */
export const riskSchema = z.enum(['safe', 'confirm', 'dangerous']);
export type Risk = z.infer<typeof riskSchema>;

export interface ActionPolicy {
  risk: Risk;
  /** Whether a local (rule or server-side local model) proposal may target this action. */
  localAllowed: boolean;
  description: string;
}

export function requiresApproval(risk: Risk, approved = false): boolean {
  return risk !== 'safe' && !approved;
}
