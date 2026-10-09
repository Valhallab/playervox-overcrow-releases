// A strict check of a value against the JSON Schema subset the tools
// advertise (type, properties, required, additionalProperties: false,
// items, enum, const, bounds): what clients such as Claude Code check on
// every structured result.

export function schemaErrors(value, schema, path = "$") {
  const errors = [];
  const types =
    schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  const typeOf = (v) =>
    v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
  if (types.length > 0) {
    const actual = typeOf(value);
    const ok = types.some((type) => type === actual || (type === "number" && actual === "integer"));
    if (!ok) return [`${path}: ${actual} is not ${types.join("|")}`];
  }
  if (schema.const !== undefined && value !== schema.const)
    errors.push(`${path}: not ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value))
    errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (
    schema.anyOf &&
    !schema.anyOf.some((option) => schemaErrors(value, option, path).length === 0)
  ) {
    errors.push(`${path}: matches no anyOf`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push(`${path}: too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push(`${path}: too long`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${path}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${path}: above maximum`);
  }
  if (Array.isArray(value) && schema.items) {
    for (const [index, item] of value.entries()) {
      errors.push(...schemaErrors(item, schema.items, `${path}[${index}]`));
    }
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required ?? [])
      if (!(key in value)) errors.push(`${path}: missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (property) errors.push(...schemaErrors(item, property, `${path}.${key}`));
      else if (schema.additionalProperties === false)
        errors.push(`${path}: unexpected property ${key}`);
    }
  }
  return errors;
}
