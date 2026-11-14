const LENGTH_IN_METERS = Object.freeze({ mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, mi: 1609.344 });

/** Converts a length between the units of LENGTH_IN_METERS. */
export function convertLength(value, from, to) {
  if (!Number.isFinite(value)) throw new TypeError("value must be a finite number");
  if (!(from in LENGTH_IN_METERS) || !(to in LENGTH_IN_METERS)) {
    throw new RangeError(`unknown length unit: ${from in LENGTH_IN_METERS ? to : from}`);
  }
  return (value * LENGTH_IN_METERS[from]) / LENGTH_IN_METERS[to];
}

/** Converts a temperature between "C", "F" and "K". */
export function convertTemperature(value, from, to) {
  if (!Number.isFinite(value)) throw new TypeError("value must be a finite number");
  const toCelsius = { C: (v) => v, F: (v) => ((v - 32) * 5) / 9, K: (v) => v - 273.15 };
  const fromCelsius = { C: (v) => v, F: (v) => (v * 9) / 5 + 32, K: (v) => v + 273.15 };
  if (!toCelsius[from] || !fromCelsius[to]) throw new RangeError("unknown temperature unit");
  return fromCelsius[to](toCelsius[from](value));
}

export const LENGTH_UNITS = Object.keys(LENGTH_IN_METERS);
