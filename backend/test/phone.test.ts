import { describe, expect, it } from 'vitest';
import { detectOperator, maskPhone, normalizeSlPhone } from '../src/lib/phone.js';

describe('Sierra Leone phone numbers', () => {
  it('normalises the common local formats to E.164', () => {
    for (const v of ['076123456', '76 123 456', '+232 76 123456', '23276123456', '0023276123456', '(076) 123-456']) {
      expect(normalizeSlPhone(v)).toBe('+23276123456');
    }
  });

  it('rejects numbers of the wrong length', () => {
    expect(() => normalizeSlPhone('07612345')).toThrow();
    expect(() => normalizeSlPhone('0761234567')).toThrow();
  });

  it('detects the network from the prefix', () => {
    expect(detectOperator('+23276123456')).toBe('orange');
    expect(detectOperator('+23277123456')).toBe('africell');
    expect(detectOperator('+23230123456')).toBe('africell');
    expect(detectOperator('+23231123456')).toBe('qcell');
    expect(detectOperator('+23222123456')).toBe('unknown');
  });

  it('masks numbers for display in payment prompts', () => {
    expect(maskPhone('+23276123456')).toBe('+23276***456');
  });
});
