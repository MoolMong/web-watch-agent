// Watcher definition used by core/agent.ts.
import { defaultConfig, validateConfig } from "./config.ts";
import { judge, configKey, events } from "./judge.ts";

export default {
  id: "flights",
  intervalHours: 3,
  // config path (PostgREST JSON syntax) of a date after which the watch is pointless
  expiresOn: "flight->>departDate",
  defaultConfig,
  validateConfig,
  configKey,
  judge,
  events,
};
