import { Router } from "express";

import { requireAuth } from "../../middleware/authenticate.js";
import { getMeController } from "../../modules/profiles/me.controller.js";

const router = Router();

router.use(requireAuth);
router.get("/", getMeController);

export default router;
