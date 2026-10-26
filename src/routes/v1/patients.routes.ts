import { Router } from "express";

import { requireAuth } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/authorize.js";
import {
  bookPatientAppointmentController,
  cancelPatientAppointmentController,
  listPatientAppointmentsController,
  listSlotsController,
  updatePatientProfileController,
} from "../../modules/patients/patient.controller.js";

const router = Router();

router.use(requireAuth);
router.use(requireRole("patient"));

router.put("/profile", updatePatientProfileController);
router.get("/slots", listSlotsController);
router.get("/appointments", listPatientAppointmentsController);
router.post("/appointments", bookPatientAppointmentController);
router.post("/appointments/:id/cancel", cancelPatientAppointmentController);

export default router;
