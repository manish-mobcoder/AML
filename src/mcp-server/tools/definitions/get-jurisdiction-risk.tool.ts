/**
 * @fileoverview `sanctions_get_jurisdiction_risk` — FATF jurisdiction risk
 * lookup. Returns whether a country is on the FATF Call for Action (formerly
 * black list) or Increased Monitoring (grey list) lists.
 * @module mcp-server/tools/definitions/get-jurisdiction-risk.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import {
  FATF_DATA_VERSION,
  lookupFatfJurisdiction,
} from '@/services/screening/fatf-data.js';

export const getJurisdictionRiskTool = tool('sanctions_get_jurisdiction_risk', {
  title: 'sanctions-screening-mcp-server: get jurisdiction risk',
  description:
    'Look up a country\'s FATF jurisdiction risk classification. Returns whether the country is on the FATF Call for Action list (highest risk — counter-measures apply), the Increased Monitoring list (grey list — enhanced due diligence required), or neither. Accepts country name, common aliases, or ISO-2 code (e.g. "Iran", "IR", "North Korea", "DPRK", "Turkey", "Türkiye"). Data is a bundled static dataset updated after each FATF plenary (four times per year).',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  auth: ['tool:sanctions:read'],
  input: z.object({
    country: z
      .string()
      .min(1)
      .describe(
        'Country name, common alias, or ISO-2 code to look up (e.g. "Iran", "IR", "North Korea", "DPRK", "Turkey").',
      ),
  }),
  output: z.object({
    country: z.string().describe('Matched country name as published by FATF, or the query if not listed.'),
    fatfStatus: z
      .enum(['call_for_action', 'increased_monitoring', 'not_listed'])
      .describe(
        'call_for_action = highest risk, counter-measures apply (formerly black list). increased_monitoring = elevated risk, enhanced due diligence required (grey list). not_listed = not on either FATF list.',
      ),
    detail: z.string().describe('FATF statement or reason summary, or a note when not listed.'),
    listVersion: z.string().describe('Date of the FATF plenary this data reflects (ISO 8601).'),
  }),

  async handler(input) {
    const entry = lookupFatfJurisdiction(input.country);
    if (!entry) {
      return {
        country: input.country,
        fatfStatus: 'not_listed' as const,
        detail: `${input.country} is not currently on the FATF Call for Action or Increased Monitoring lists. Verify directly at fatf-gafi.org after each plenary.`,
        listVersion: FATF_DATA_VERSION,
      };
    }
    return {
      country: entry.country,
      fatfStatus: entry.status,
      detail: entry.detail,
      listVersion: FATF_DATA_VERSION,
    };
  },

  format: (result) => {
    const statusLabel =
      result.fatfStatus === 'call_for_action'
        ? '🔴 Call for Action (counter-measures apply)'
        : result.fatfStatus === 'increased_monitoring'
          ? '🟡 Increased Monitoring (enhanced due diligence required)'
          : '🟢 Not listed';
    return [
      {
        type: 'text',
        text: `**${result.country}** — ${statusLabel}\n\n${result.detail}\n\n*FATF data version: ${result.listVersion}*`,
      },
    ];
  },
});
