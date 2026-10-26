import { Router } from "express";

import { requireAuth } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/authorize.js";
import {
  getAppointmentController,
  listAppointmentsController,
} from "../../modules/appointments/appointments.controller.js";

const router = Router();

router.use(requireAuth);
// This lists every patient's name and phone: clinic staff only.
router.use(requireRole("staff"));

router.get("/", listAppointmentsController);
router.get("/:id", getAppointmentController);

export default router;
