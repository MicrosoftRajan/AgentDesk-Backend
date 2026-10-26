import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateTool } from "../../src/modules/ai-agent/guardrail.service.ts";
import type { AgentTool } from "../../src/modules/ai-agent/tools/tool.types.ts";

function tool(riskLevel: AgentTool["riskLevel"]): AgentTool {
  return {
    name: "example",
    description: "example",
    riskLevel,
    parameters: { type: "object", properties: {}, required: [] },
    async execute() {
      return { success: true, data: null };
    },
  };
}

describe("guardrail", () => {
  it("allows low risk and holds medium and high for approval", () => {
    assert.equal(evaluateTool(tool("low")), "allow");
    assert.equal(evaluateTool(tool("medium")), "require_approval");
    assert.equal(evaluateTool(tool("high")), "require_approval");
  });

  it("denies a risk level it does not understand", () => {
    const unknown = tool("low");
    unknown.riskLevel = "critical" as AgentTool["riskLevel"];

    assert.equal(evaluateTool(unknown), "deny");
  });
});
