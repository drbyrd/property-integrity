import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDecimals,
  decimalToString,
  formatFixed,
  multiplyDecimals,
  parseDecimal,
  roundDecimal,
  subtractDecimals,
  sumDecimals
} from '../src/exact-decimal.mjs';

test('adds decimal inputs without binary floating-point drift', () => {
  assert.equal(decimalToString(sumDecimals(['0.1', '0.2', '614.57', '-25'])), '589.87');
});

test('supports subtraction and multiplication', () => {
  assert.equal(decimalToString(subtractDecimals(parseDecimal('550'), parseDecimal('120'))), '430');
  assert.equal(decimalToString(multiplyDecimals(parseDecimal('37'), parseDecimal('1.25'))), '46.25');
});

test('rounds display values while retaining the raw value', () => {
  const raw = parseDecimal('253.825');
  assert.equal(decimalToString(raw), '253.825');
  assert.equal(formatFixed(raw, 2), '253.83');
  assert.equal(decimalToString(roundDecimal(parseDecimal('-1.235'), 2)), '-1.24');
  assert.equal(formatFixed(parseDecimal('10.1'), 2), '10.10');
});

test('rejects invalid or non-finite values', () => {
  assert.throws(() => parseDecimal('1e3'), /invalid decimal/);
  assert.throws(() => parseDecimal('PRIVATE-VALUE'), (error) => !error.message.includes('PRIVATE-VALUE'));
  assert.throws(() => parseDecimal(Number.NaN), /finite/);
});
