import { describe, expect, it } from 'vitest';
import {
  createMeasurementRecordRequestSchema,
  measurementValueSchema,
  saveTemplateRequestSchema,
} from './measurements.js';

describe('measurementValueSchema', () => {
  it.each(['34', '34.5', '34.125', '0.125', '9999.999'])('accepts %s', (v) => {
    expect(measurementValueSchema.safeParse(v).success).toBe(true);
  });

  it.each(['0', '0.000', '-1', '34.1255', '10000', '34 1/8', ''])('rejects %j', (v) => {
    expect(measurementValueSchema.safeParse(v).success).toBe(false);
  });

  it('rejects numbers (decimals travel as strings)', () => {
    expect(measurementValueSchema.safeParse(34.125).success).toBe(false);
  });
});

describe('saveTemplateRequestSchema', () => {
  it('rejects duplicate keys and accepts sectioned keys', () => {
    const ok = saveTemplateRequestSchema.safeParse({
      fields: [
        { key: 'suit.waistline', label: 'Waistline', section: 'Suit' },
        { key: 'trouser.waistline', label: 'Waistline', section: 'Trouser' },
      ],
    });
    expect(ok.success).toBe(true);
    const dup = saveTemplateRequestSchema.safeParse({
      fields: [
        { key: 'neck', label: 'Neck' },
        { key: 'neck', label: 'Neck again' },
      ],
    });
    expect(dup.error?.issues[0]?.path).toEqual(['fields', 1, 'key']);
  });

  it.each(['Neck', 'a.b.c', '1neck', 'neck-down'])('rejects key %s', (key) => {
    expect(saveTemplateRequestSchema.safeParse({ fields: [{ key, label: 'X' }] }).success).toBe(
      false,
    );
  });
});

describe('createMeasurementRecordRequestSchema', () => {
  it('rejects unknown fields such as clientId or tenantId', () => {
    expect(
      createMeasurementRecordRequestSchema.safeParse({
        categoryId: '0190c0de-0000-7000-8000-000000000001',
        values: {},
        clientId: '0190c0de-0000-7000-8000-000000000002',
      }).success,
    ).toBe(false);
  });
});
