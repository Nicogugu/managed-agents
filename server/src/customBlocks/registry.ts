import type { ClientBlockSchema } from "../customBlockSchema.js";
import { superprofBlocks } from "./superprof.js";

/**
 * Server-side registry: aggregates ClientBlockSchema from all clients.
 * Used by the generic Gutenberg parser/serializer + agent tool dispatch.
 *
 * To add a new client: drop a new file in server/src/customBlocks/<client>.ts
 * and append it here. No other code change.
 */
export const customBlockRegistry: ClientBlockSchema[] = [
  ...superprofBlocks,
  // ...futureClientBlocks
];

const byNamespace = new Map(customBlockRegistry.map((s) => [s.namespace, s]));

export function getSchema(namespace: string): ClientBlockSchema | undefined {
  return byNamespace.get(namespace);
}

/** All known top-level namespaces (registered as wp:NAMESPACE in Gutenberg comments). */
export function knownNamespaces(): string[] {
  return Array.from(byNamespace.keys());
}

/** Default wrapper class derived from a namespace ("foo/bar-baz" → "wp-block-foo-bar-baz"). */
export function defaultWrapperClass(namespace: string): string {
  return "wp-block-" + namespace.replace(/[/]/g, "-");
}
