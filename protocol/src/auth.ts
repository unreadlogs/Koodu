import { z } from 'zod';

export const AUTH_HEADER = 'x-koodu-auth';
export const AUTH_TOKEN_KEY = 'koodu:auth:token';

export const loginRequestSchema = z.object({
  password: z.string().min(1).max(256),
});

export const loginResponseSchema = z.object({
  token: z.string().min(16),
  expiresAt: z.number().int().positive().optional(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
