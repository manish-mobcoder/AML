/**
 * @fileoverview Barrel collecting all tool definitions into `allToolDefinitions`
 * for `createApp()`.
 * @module mcp-server/tools/definitions/index
 */

import { clearHitTool, revokeClearanceTool } from './clear-hit.tool.js';
import { getDesignationTool } from './get-designation.tool.js';
import { getEntityTool } from './get-entity.tool.js';
import { getJurisdictionRiskTool } from './get-jurisdiction-risk.tool.js';
import { listSourcesTool } from './list-sources.tool.js';
import { resolveEntityTool } from './resolve-entity.tool.js';
import { screenNameTool } from './screen-name.tool.js';
import { traceOwnershipTool } from './trace-ownership.tool.js';

export const allToolDefinitions = [
  screenNameTool,
  getDesignationTool,
  listSourcesTool,
  resolveEntityTool,
  getEntityTool,
  traceOwnershipTool,
  getJurisdictionRiskTool,
  clearHitTool,
  revokeClearanceTool,
];

export {
  clearHitTool,
  getDesignationTool,
  getEntityTool,
  getJurisdictionRiskTool,
  listSourcesTool,
  resolveEntityTool,
  revokeClearanceTool,
  screenNameTool,
  traceOwnershipTool,
};
