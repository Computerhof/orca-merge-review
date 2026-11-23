// Orca validates request input as JSON and refuses `undefined` fields (invalid_params), so every
// optional field is dropped before a request instead of being sent as undefined.
export function defined<T extends object>(input: T): T {
  const out = {} as T
  for (const [k, v] of Object.entries(input)) if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}
