/**
 * @fileoverview `sanctions_clear_hit` and `sanctions_revoke_clearance` —
 * false-positive memory tools. When an analyst reviews a screening hit and
 * confirms it is not a match, they record that decision here. Future
 * `sanctions_screen_name` calls for the same customer will suppress the
 * cleared hit automatically, keeping the review queue clean.
 * @module mcp-server/tools/definitions/clear-hit.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getScreeningService } from '@/services/screening/screening-service.js';

export const clearHitTool = tool('sanctions_clear_hit', {
  title: 'sanctions-screening-mcp-server: clear hit',
  description:
    'Record that an analyst has reviewed a sanctions screening hit for a specific customer and confirmed it is not a match (a false positive). Once cleared, the hit will be suppressed in future sanctions_screen_name calls for that customer — it will no longer appear in results unless the list entry or the customer\'s data changes and the clearance is explicitly revoked. This is the false-positive memory: it prevents the same cleared hits from re-queuing every day and drowning real alerts in noise. The server stores no customer PII — customerRef is an opaque identifier you supply (e.g. your internal customer ID).',
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  auth: ['tool:sanctions:write'],
  input: z.object({
    customerRef: z
      .string()
      .min(1)
      .describe(
        'Your internal customer identifier — opaque to this server. Used to associate the clearance with future screen_name calls for the same customer.',
      ),
    designationId: z
      .string()
      .min(1)
      .describe(
        'The designation ID to clear — the designationId field from the sanctions_screen_name hit (format: "{source}:{entryId}", e.g. "ofac_sdn:12345").',
      ),
    clearedBy: z
      .string()
      .optional()
      .describe('Analyst identifier for the four-eyes audit trail. Recommended.'),
    reason: z
      .string()
      .optional()
      .describe(
        'Free-text reason for the clearance — e.g. "DOB mismatch: customer born 1985, list entry born 1942" or "Identifier mismatch: different passport". Recommended for audit trail.',
      ),
  }),
  output: z.object({
    cleared: z.boolean(),
    customerRef: z.string(),
    designationId: z.string(),
    clearedAt: z.string().describe('ISO 8601 timestamp of the clearance.'),
    message: z.string(),
  }),
  errors: [
    {
      reason: 'mirror_not_ready',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The sanctions mirror has never completed an initial sync.',
      retryable: true,
      recovery: 'Run mirror:init first.',
    },
  ],

  async handler(input, ctx) {
    const svc = getScreeningService();
    if (!(await svc.sanctionsReady())) {
      throw ctx.fail('mirror_not_ready', 'The local sanctions mirror is not yet populated.', {
        ...ctx.recoveryFor('mirror_not_ready'),
      });
    }
    const clearedAt = new Date().toISOString();
    await svc.clearHit({
      customerRef: input.customerRef,
      designationId: input.designationId,
      ...(input.clearedBy ? { clearedBy: input.clearedBy } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    });
    return {
      cleared: true,
      customerRef: input.customerRef,
      designationId: input.designationId,
      clearedAt,
      message: `Hit ${input.designationId} cleared for customer ${input.customerRef}. It will be suppressed in future screen_name calls for this customer. Revoke with sanctions_revoke_clearance if the customer's data or the list entry changes.`,
    };
  },

  format: (result) => [
    {
      type: 'text',
      text: `✓ **Cleared** — \`${result.designationId}\` suppressed for customer \`${result.customerRef}\` from ${result.clearedAt}.`,
    },
  ],
});

export const revokeClearanceTool = tool('sanctions_revoke_clearance', {
  title: 'sanctions-screening-mcp-server: revoke clearance',
  description:
    'Revoke a previously recorded hit clearance — re-enables alerting for a (customer, designation) pair. Use when the customer updates their identity documents, changes their name, or when the list entry is updated with new identifiers that may now match.',
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  auth: ['tool:sanctions:write'],
  input: z.object({
    customerRef: z.string().min(1).describe('The customer identifier used when the clearance was recorded.'),
    designationId: z.string().min(1).describe('The designation ID to re-enable alerting for.'),
  }),
  output: z.object({
    revoked: z.boolean(),
    message: z.string(),
  }),

  async handler(input) {
    const svc = getScreeningService();
    await svc.revokeClearance(input.customerRef, input.designationId);
    return {
      revoked: true,
      message: `Clearance revoked. ${input.designationId} will appear in future screen_name results for customer ${input.customerRef}.`,
    };
  },

  format: (result) => [{ type: 'text', text: result.message }],
});
