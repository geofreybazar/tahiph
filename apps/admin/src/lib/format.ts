const dateFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  dateStyle: 'medium',
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
