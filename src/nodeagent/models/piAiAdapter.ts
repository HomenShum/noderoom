import { model } from "./adapter";
import type { AgentModel } from "../core/types";

export interface PiAdapterOptions {
  modelName?: string;
}

export function createPiAiAdapter(options: PiAdapterOptions = {}): AgentModel {
  return model(options.modelName ?? "gemini-2.5-flash");
}