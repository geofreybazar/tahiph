import { z } from 'zod';
import { appointmentSchema } from './appointments.js';
import { clientNoteSchema, clientSchema, communicationSchema } from './clients.js';
import { measurementRecordSchema } from './measurements.js';

/** Data-subject rights (RA 10173, ADR-032). */
export const ERASURE_REASONS = ['DATA_SUBJECT_REQUEST', 'TENANT_REQUEST'] as const;

export const eraseClientRequestSchema = z.object({ reason: z.enum(ERASURE_REASONS) }).strict();

/** Everything the atelier holds about one client, in one document. */
export const clientExportSchema = z.object({
  exportedAt: z.iso.datetime(),
  client: clientSchema,
  notes: z.array(clientNoteSchema),
  communications: z.array(communicationSchema),
  measurements: z.array(measurementRecordSchema),
  appointments: z.array(appointmentSchema),
});

export type EraseClientRequest = z.infer<typeof eraseClientRequestSchema>;
export type ClientExport = z.infer<typeof clientExportSchema>;
