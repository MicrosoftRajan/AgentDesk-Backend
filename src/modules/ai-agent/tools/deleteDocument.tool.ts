import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from "./tool.types.js";

const MAX_DOCUMENT_NAME_LENGTH = 200;

function validateInput(input: unknown): { document: string } {
  if (!input || typeof input !== "object") {
    throw new Error("delete_document input must be an object");
  }

  const value = input as Record<string, unknown>;

  if (
    typeof value.document !== "string" ||
    !value.document.trim()
  ) {
    throw new Error(
      "delete_document requires a non-empty document name or id",
    );
  }

  const document = value.document.trim();

  if (document.length > MAX_DOCUMENT_NAME_LENGTH) {
    throw new Error("document name is too long");
  }

  return { document };
}

/**
 * Placeholder high-risk tool so the approval flow can be exercised end
 * to end. There is no document store yet, so nothing is deleted and the
 * result says so explicitly. Replace the body when a real store exists;
 * the riskLevel keeps it behind human approval.
 */
export const deleteDocumentTool: AgentTool = {
  name: "delete_document",

  description:
    "Deletes a document permanently. Requires human approval before it runs.",

  riskLevel: "high",

  parameters: {
    type: "object",
    properties: {
      document: {
        type: "string",
        description:
          "Name or id of the document to delete, e.g. 'medical-report.pdf'.",
      },
    },
    required: ["document"],
  },

  async execute(
    input: unknown,
    _context: ToolContext,
  ): Promise<ToolResult> {
    try {
      const { document } = validateInput(input);

      return {
        success: true,
        data: {
          document,
          deleted: false,
          simulated: true,
          note:
            "Demo tool: no document store is connected, so nothing was actually deleted.",
        },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error:
          error instanceof Error
            ? error.message
            : "delete_document failed",
      };
    }
  },
};
