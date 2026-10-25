// Watcher definition used by core/agent.ts.
import { defaultConfig, validateConfig } from "./config.ts";
import { judge, configKey } from "./judge.ts";

export default {
  id: "flights",
  intervalHours: 3,
  defaultConfig,
  validateConfig,
  configKey,
  judge,
};
