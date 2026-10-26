import { Router } from "express";

import { requireAuth } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/authorize.js";
import {
  approveAgentRunController,
  createAgentRunController,
  getAgentRunController,
  listAgentRunsController,
  rejectAgentRunController,
} from "../../modules/ai-agent/agent.controller.js";

const router = Router();

// Every agent route needs a signed-in clinic staff member. Patients use
// the patient portal and must never reach the front-desk agent.
router.use(requireAuth);
router.use(requireRole("staff"));

router.post("/runs", createAgentRunController);
router.get("/runs", listAgentRunsController);
router.get("/runs/:runId", getAgentRunController);
router.post("/runs/:runId/approve", approveAgentRunController);
router.post("/runs/:runId/reject", rejectAgentRunController);

export default router;
