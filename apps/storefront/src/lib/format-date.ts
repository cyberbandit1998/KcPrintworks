const formatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC', // the same text on the server and in every visitor's time zone
});

/** "October 9, 2026" for an ISO timestamp. */
export function formatDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : formatter.format(new Date(time));
}
