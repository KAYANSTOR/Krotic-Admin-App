// ============================================================
// Minimal, dependency-free JSON Schema validator (subset).
// ------------------------------------------------------------
// Covers only the keywords used by the versioned contracts in
// `contracts/`. It is intentionally small: the goal is to make the
// contract files executable in CI, not to reimplement the full
// JSON Schema specification.
//
// Supported: type, const, enum, required, properties,
// additionalProperties (boolean), items, minItems, maxItems,
// minLength, maxLength, pattern, minimum, maximum, format
// (date-time / date), anyOf, oneOf, allOf.
// ============================================================

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates `value` against `schema`. Returns an array of human-readable
 * error strings; an empty array means the value is valid.
 */
export function validateSchema(value, schema, path = '$') {
  const errors = [];
  if (!isPlainObject(schema)) return errors;

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum`);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${path}: expected type ${types.join('|')}, got ${typeOf(value)}`);
      return errors;
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
    if (schema.format === 'date-time' && !DATE_TIME.test(value)) {
      errors.push(`${path}: not an RFC3339 date-time`);
    }
    if (schema.format === 'date' && !DATE.test(value)) {
      errors.push(`${path}: not a YYYY-MM-DD date`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: more than maxItems ${schema.maxItems}`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateSchema(item, schema.items, `${path}[${index}]`));
      });
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required property ${key}`);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) {
        errors.push(...validateSchema(value[key], childSchema, `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}: unexpected property ${key}`);
      }
    } else if (isPlainObject(schema.additionalProperties)) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(...validateSchema(value[key], schema.additionalProperties, `${path}.${key}`));
        }
      }
    }
  }

  for (const keyword of ['anyOf', 'oneOf']) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    const matched = branches.filter((branch) => validateSchema(value, branch, path).length === 0).length;
    if (keyword === 'anyOf' && matched === 0) errors.push(`${path}: no anyOf branch matched`);
    if (keyword === 'oneOf' && matched !== 1) errors.push(`${path}: expected exactly one oneOf branch, matched ${matched}`);
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      errors.push(...validateSchema(value, branch, path));
    }
  }

  return errors;
}
