import type { DatabaseClient } from '@tahi/database';

type Tx = Parameters<Parameters<DatabaseClient['$transaction']>[0]>[0];

interface DefaultField {
  key: string;
  label: string;
}

/**
 * Starter categories for new ateliers, modelled on paper measurement forms the product owner
 * uses (ADR-027). Ateliers edit them freely; editing creates a new template version.
 */
export const DEFAULT_TEMPLATES: { name: string; sections: [string, DefaultField[]][] }[] = [
  {
    name: 'Barong / Suit',
    sections: [
      [
        'Suit',
        [
          { key: 'suit.shoulder', label: 'Shoulder' },
          { key: 'suit.bust', label: 'Bust' },
          { key: 'suit.neck', label: 'Neck' },
          { key: 'suit.neckdown', label: 'Neckdown' },
          { key: 'suit.figure_front', label: 'Figure Front' },
          { key: 'suit.figure_back', label: 'Figure Back' },
          { key: 'suit.span_back', label: 'Span Back' },
          { key: 'suit.span_front', label: 'Span Front' },
          { key: 'suit.armhole', label: 'Armhole' },
          { key: 'suit.arm', label: 'Arm' },
          { key: 'suit.sleeve_length', label: 'Sleeve Length' },
          { key: 'suit.sleeve_opening', label: 'Sleeve Opening' },
          { key: 'suit.waistline', label: 'Waistline' },
          { key: 'suit.length', label: 'Suit Length' },
        ],
      ],
      ['Vest', [{ key: 'vest.length', label: 'Vest Length' }]],
      [
        'Trouser',
        [
          { key: 'trouser.waistline', label: 'Waistline' },
          { key: 'trouser.hips_1', label: '1st Hips' },
          { key: 'trouser.hips_2', label: '2nd Hips' },
          { key: 'trouser.crotch', label: 'Crotch' },
          { key: 'trouser.thigh', label: 'Thigh' },
          { key: 'trouser.knee', label: 'Knee' },
          { key: 'trouser.ankle', label: 'Ankle' },
          { key: 'trouser.length', label: 'Pant Length' },
        ],
      ],
      [
        'Dress Shirt',
        [
          { key: 'shirt.sleeve_length', label: 'Sleeve Length' },
          { key: 'shirt.sleeve_opening', label: 'Sleeve Opening' },
          { key: 'shirt.polo_length', label: 'Polo Length' },
        ],
      ],
    ],
  },
  {
    name: 'Gown / Dress',
    sections: [
      [
        'Gown',
        [
          { key: 'gown.shoulder', label: 'Shoulder' },
          { key: 'gown.bust', label: 'Bust' },
          { key: 'gown.upper_bust', label: 'Upper Bust' },
          { key: 'gown.lower_bust', label: 'Lower Bust' },
          { key: 'gown.bust_point', label: 'Bust Point' },
          { key: 'gown.bust_distance', label: 'Bust Distance' },
          { key: 'gown.figure_front', label: 'Figure Front' },
          { key: 'gown.figure_back', label: 'Figure Back' },
          { key: 'gown.span_front', label: 'Span Front' },
          { key: 'gown.span_back', label: 'Span Back' },
          { key: 'gown.armhole', label: 'Armhole' },
          { key: 'gown.arm', label: 'Arm' },
          { key: 'gown.sleeve_length', label: 'Sleeve Length' },
          { key: 'gown.sleeve_opening', label: 'Sleeve Opening' },
          { key: 'gown.neck', label: 'Neck' },
          { key: 'gown.neckdown', label: 'Neckdown' },
          { key: 'gown.waistline', label: 'Waistline' },
          { key: 'gown.hips_1', label: 'Hips 1' },
          { key: 'gown.hips_2', label: 'Hips 2' },
          { key: 'gown.length', label: 'Gown Length' },
          { key: 'gown.skirt_length', label: 'Skirt Length' },
          { key: 'gown.train_length', label: 'Train Length' },
        ],
      ],
      [
        'Pants',
        [
          { key: 'pants.waistline', label: 'Waistline' },
          { key: 'pants.crotch', label: 'Crotch' },
          { key: 'pants.thigh', label: 'Thigh' },
          { key: 'pants.knee', label: 'Knee' },
          { key: 'pants.ankle', label: 'Ankle' },
          { key: 'pants.length', label: 'Pant Length' },
        ],
      ],
    ],
  },
];

/** Creates the default categories with version-1 templates. Runs inside the onboarding tx. */
export async function seedDefaultMeasurementTemplates(tx: Tx, tenantId: string): Promise<void> {
  for (const def of DEFAULT_TEMPLATES) {
    const category = await tx.garmentCategory.create({
      data: { tenantId, name: def.name },
      select: { id: true },
    });
    const template = await tx.measurementTemplate.create({
      data: { tenantId, categoryId: category.id, version: 1 },
      select: { id: true },
    });
    await tx.measurementField.createMany({
      data: def.sections
        .flatMap(([section, fields]) => fields.map((f) => ({ ...f, section })))
        .map((f, sortOrder) => ({ tenantId, templateId: template.id, ...f, sortOrder })),
    });
  }
}
