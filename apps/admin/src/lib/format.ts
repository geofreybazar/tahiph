const dateFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  dateStyle: 'medium',
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

const timeFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  timeStyle: 'short',
});

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}
