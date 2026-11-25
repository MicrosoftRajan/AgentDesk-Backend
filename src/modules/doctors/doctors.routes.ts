import type { Router } from "express";
import { ANY_SIGNED_IN, type Protection } from "../../middleware/protect";
import { createDoctorsController } from "./doctors.controller";
import type { DoctorsService } from "./doctors.service";
import { availabilityQuery, idParams, listDoctorsQuery, updateDoctorBody } from "./doctors.validation";

/* Mounted at /api/v1/doctors. The router itself requires a valid token for every request;
each route then checks the role, then validates its input. Adding a doctor and editing
weekly hours are not built yet (see prompts/18). */
export function createDoctorsRouter(deps: {
  service: DoctorsService;
  protection: Protection;
  clock: () => Date;
  timeZone: string;
}): Router {
  const { protectedRouter, protect } = deps.protection;
  const c = createDoctorsController(deps.service);
  const router = protectedRouter();

  router.get("/", ...protect(ANY_SIGNED_IN, { query: listDoctorsQuery }), c.list);
  router.get("/:id", ...protect(ANY_SIGNED_IN, { params: idParams }), c.get);
  router.get("/:id/schedule", ...protect(ANY_SIGNED_IN, { params: idParams }), c.schedule);
  router.get(
    "/:id/availability",
    ...protect(ANY_SIGNED_IN, { params: idParams, query: availabilityQuery(deps.clock, deps.timeZone) }),
    c.availability,
  );
  router.patch("/:id", ...protect(["admin"], { params: idParams, body: updateDoctorBody }), c.update);

  return router;
}
