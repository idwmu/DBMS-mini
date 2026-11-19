// Date helpers for <input type="datetime-local"> (which works in local time)

const pad = (n) => String(n).padStart(2, '0');

/** Date -> "YYYY-MM-DDTHH:mm" in the browser's local time zone */
export function toLocalInput(dateInput) {
  const d = new Date(dateInput);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" (local) -> ISO 8601 UTC string for the API */
export function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function recommendationTone(recommendation = '') {
  if (recommendation.startsWith('APPROVE')) return 'LOW';
  if (recommendation.startsWith('NOT')) return 'HIGH';
  return 'MEDIUM';
}

export const recommendationLabel = (recommendation = '') => recommendation.split(':')[0];
