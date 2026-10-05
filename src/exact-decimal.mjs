const POWERS = [1n];

const powerOfTen = (scale) => {
  if (!Number.isInteger(scale) || scale < 0) throw new TypeError('scale must be a non-negative integer');
  while (POWERS.length <= scale) POWERS.push(POWERS.at(-1) * 10n);
  return POWERS[scale];
};

export const normalizeDecimal = ({ coefficient, scale }) => {
  if (typeof coefficient !== 'bigint' || !Number.isInteger(scale) || scale < 0) throw new TypeError('invalid decimal');
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
};

export const parseDecimal = (value) => {
  if (typeof value === 'bigint') return { coefficient: value, scale: 0 };
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('decimal must be finite');
  const text = String(value ?? '').trim();
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new TypeError('invalid decimal value');
  const fraction = match[3] ?? '';
  const sign = match[1] === '-' ? -1n : 1n;
  return normalizeDecimal({ coefficient: sign * BigInt(`${match[2]}${fraction}`), scale: fraction.length });
};

const align = (left, right) => {
  const scale = Math.max(left.scale, right.scale);
  return {
    left: left.coefficient * powerOfTen(scale - left.scale),
    right: right.coefficient * powerOfTen(scale - right.scale),
    scale
  };
};

export const addDecimals = (left, right) => {
  const values = align(normalizeDecimal(left), normalizeDecimal(right));
  return normalizeDecimal({ coefficient: values.left + values.right, scale: values.scale });
};

export const subtractDecimals = (left, right) => {
  const values = align(normalizeDecimal(left), normalizeDecimal(right));
  return normalizeDecimal({ coefficient: values.left - values.right, scale: values.scale });
};

export const multiplyDecimals = (left, right) => normalizeDecimal({
  coefficient: left.coefficient * right.coefficient,
  scale: left.scale + right.scale
});

export const sumDecimals = (values) => values.reduce(
  (total, value) => addDecimals(total, parseDecimal(value)),
  { coefficient: 0n, scale: 0 }
);

export const decimalToString = (value) => {
  const normalized = normalizeDecimal(value);
  const negative = normalized.coefficient < 0n;
  const digits = (negative ? -normalized.coefficient : normalized.coefficient).toString();
  if (normalized.scale === 0) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(normalized.scale + 1, '0');
  const point = padded.length - normalized.scale;
  return `${negative ? '-' : ''}${padded.slice(0, point)}.${padded.slice(point)}`;
};

export const roundDecimal = (value, scale, mode = 'half-away-from-zero') => {
  const normalized = normalizeDecimal(value);
  if (normalized.scale <= scale) return normalized;
  if (mode !== 'half-away-from-zero' && mode !== 'truncate') throw new TypeError(`unsupported rounding mode: ${mode}`);
  const divisor = powerOfTen(normalized.scale - scale);
  let quotient = normalized.coefficient / divisor;
  const remainder = normalized.coefficient % divisor;
  if (mode === 'half-away-from-zero' && (remainder < 0n ? -remainder : remainder) * 2n >= divisor) {
    quotient += normalized.coefficient < 0n ? -1n : 1n;
  }
  return normalizeDecimal({ coefficient: quotient, scale });
};

export const formatFixed = (value, scale = 2) => {
  const rounded = roundDecimal(value, scale);
  const coefficient = rounded.coefficient * powerOfTen(scale - rounded.scale);
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${negative ? '-' : ''}${digits}`;
  const point = digits.length - scale;
  return `${negative ? '-' : ''}${digits.slice(0, point)}.${digits.slice(point)}`;
};
