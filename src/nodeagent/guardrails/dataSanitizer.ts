export { redactPII } from "./gateway";

import { redactPII } from "./gateway";

export function sanitizeExternalContent(text: string): string {
  return redactPII(text).text.replace(/\u0000/g, "").trim();
}