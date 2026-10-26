import { calculatorTool } from "./calculator.tool.js";
import { deleteDocumentTool } from "./deleteDocument.tool.js";
import { frontDeskTools } from "./frontdesk.tools.js";

import type { AgentTool } from "./tool.types.js";

const tools: AgentTool[] = [
  calculatorTool,
  deleteDocumentTool,
  ...frontDeskTools,
];

const toolMap = new Map(
  tools.map((tool) => [tool.name, tool]),
);

export function getTool(
  name: string,
): AgentTool | undefined {
  return toolMap.get(name);
}

export function getAllTools(): AgentTool[] {
  return [...tools];
}
