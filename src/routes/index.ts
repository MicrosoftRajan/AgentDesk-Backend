import { Router } from "express";

import agentRoutes from "./v1/agents.routes.js";
import appointmentRoutes from "./v1/appointments.routes.js";
import meRoutes from "./v1/me.routes.js";
import patientRoutes from "./v1/patients.routes.js";

const api = Router();

api.use("/agents", agentRoutes);
api.use("/appointments", appointmentRoutes);
api.use("/me", meRoutes);
// Singular on purpose: the Expo client calls `/api/v1/patient/...`.
api.use("/patient", patientRoutes);

export default api;
