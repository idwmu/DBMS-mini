// Resolves the time zone used for database sessions.
// Postgres builds may not ship legacy aliases (e.g. "Asia/Calcutta"), so the
// candidate is checked against pg_timezone_names before being used.

const LEGACY_ALIASES = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Truk': 'Pacific/Chuuk',
  'US/Pacific': 'America/Los_Angeles',
  'US/Eastern': 'America/New_York'
};

export function timezoneCandidates() {
  const requested = process.env.DB_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return [...new Set([requested, LEGACY_ALIASES[requested], 'UTC'].filter(Boolean))];
}

export async function resolveTimezone(client) {
  for (const tz of timezoneCandidates()) {
    const { rowCount } = await client.query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [tz]);
    if (rowCount > 0) return tz;
  }
  return 'UTC';
}
