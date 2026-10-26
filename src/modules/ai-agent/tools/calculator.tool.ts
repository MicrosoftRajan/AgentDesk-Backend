import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from "./tool.types.js";

interface CalculatorInput {
  expression: string;
}

function validateInput(
  input: unknown,
): CalculatorInput {
  if (!input || typeof input !== "object") {
    throw new Error(
      "Calculator input must be an object",
    );
  }

  const value = input as Record<string, unknown>;

  if (
    typeof value.expression !== "string" ||
    !value.expression.trim()
  ) {
    throw new Error(
      "Calculator requires a valid expression",
    );
  }

  return {
    expression: value.expression.trim(),
  };
}

function calculate(expression: string): number {
  // Only digits, arithmetic operators, parentheses, dot and whitespace.
  if (!/^[0-9+\-*/().%\s]+$/.test(expression)) {
    throw new Error(
      "Expression contains unsupported characters",
    );
  }

  const result: unknown = Function(
    `"use strict"; return (${expression})`,
  )();

  if (
    typeof result !== "number" ||
    !Number.isFinite(result)
  ) {
    throw new Error(
      "Expression did not produce a valid number",
    );
  }

  return result;
}

export const calculatorTool: AgentTool = {
  name: "calculator",

  description:
    "Performs arithmetic calculations from a mathematical expression.",

  riskLevel: "low",

  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description:
          "Mathematical expression to calculate, e.g. '1250 * 18 + 500'.",
      },
    },
    required: ["expression"],
  },

  async execute(
    input: unknown,
    _context: ToolContext,
  ): Promise<ToolResult> {
    try {
      const { expression } = validateInput(input);
      const result = calculate(expression);

      return {
        success: true,
        data: { expression, result },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error:
          error instanceof Error
            ? error.message
            : "Calculator failed",
      };
    }
  },
};
