import type { ClientBlockDescriptor } from "./types";
import { superprofDescriptors } from "./superprof";

/**
 * Web-side registry of client custom blocks.
 *
 * Onboarding a new client:
 *   1. Create web/src/customBlocks/<client>.tsx + server/src/customBlocks/<client>.ts
 *   2. Add the import + entry below + in server/src/customBlocks/registry.ts
 *   3. Done — slash menu, edit form, parser, serializer all light up.
 */
export const customBlockDescriptors: ClientBlockDescriptor[] = [
  ...superprofDescriptors,
];

const byNs = new Map(customBlockDescriptors.map((d) => [d.namespace, d]));
export function getDescriptor(namespace: string): ClientBlockDescriptor | undefined {
  return byNs.get(namespace);
}
