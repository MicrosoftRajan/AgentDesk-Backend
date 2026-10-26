import { CohereClientV2 } from "cohere-ai";

import { env } from "./env.js";

export const cohere = new CohereClientV2({
  token: env.cohereApiKey,
});
