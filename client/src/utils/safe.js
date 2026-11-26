// Defensive coercion for data that originates from an AI model. The server
// normalizes everything now, but results saved by older versions (or any
// future shape drift) must never crash the UI with "x.map is not a function"
// or "Objects are not valid as a React child".

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    const hit = ['text', 'point', 'description', 'title', 'name', 'summary', 'value'].find(
      (k) => typeof value[k] === 'string' && value[k]
    );
    return hit ? value[hit] : '';
  }
  return '';
}

export function asIndices(value) {
  return asArray(value).filter((n) => Number.isInteger(n) && n > 0);
}
