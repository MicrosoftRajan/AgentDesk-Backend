import type { RequestHandler, Response } from "express";
import { AppError, sendData } from "../../common/http";
import type { ValidInput } from "../../middleware/validate";
import type { UserRole } from "../../models/enums";
import type { DoctorsService } from "./doctors.service";
import type { AvailabilityQuery, ListDoctorsQuery, UpdateDoctorBody } from "./doctors.validation";

/* Handlers read only what protect() already checked: the role from the token and the parsed input. */
function checked(res: Response): { role: UserRole; input: ValidInput } {
  const { auth, input } = res.locals;
  if (!auth || !input) throw new AppError(401, "AUTH_INVALID_TOKEN", "Sign in again");
  return { role: auth.role, input };
}

const idOf = (input: ValidInput) => (input.params as { id: string }).id;

export function createDoctorsController(service: DoctorsService) {
  return {
    list: async (_req, res) => {
      const { input } = checked(res);
      sendData(res, 200, await service.list(input.query as ListDoctorsQuery));
    },
    get: async (_req, res) => {
      const { role, input } = checked(res);
      sendData(res, 200, { doctor: await service.get(idOf(input), role) });
    },
    schedule: async (_req, res) => {
      const { role, input } = checked(res);
      sendData(res, 200, await service.schedule(idOf(input), role));
    },
    availability: async (_req, res) => {
      const { role, input } = checked(res);
      sendData(res, 200, await service.availability(idOf(input), (input.query as AvailabilityQuery).date, role));
    },
    update: async (_req, res) => {
      const { input } = checked(res);
      sendData(res, 200, { doctor: await service.update(idOf(input), input.body as UpdateDoctorBody) });
    },
  } satisfies Record<string, RequestHandler>;
}
