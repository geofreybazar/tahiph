/** BullMQ queue names (docs/SYSTEM_ARCHITECTURE.md §5). Add queues here as modules need them. */
export const QUEUES = {
  maintenance: 'maintenance',
  email: 'email',
  reminders: 'reminders',
  media: 'media',
  quotations: 'quotations',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Redis key the worker refreshes; read by the worker container health check. */
export const WORKER_HEARTBEAT_KEY = 'tahi:worker:heartbeat';
export const WORKER_HEARTBEAT_TTL_SECONDS = 180;
