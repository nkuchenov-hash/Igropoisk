const MONTHS = new Map([
  ['jan',0],['january',0],['feb',1],['february',1],['mar',2],['march',2],['apr',3],['april',3],
  ['may',4],['jun',5],['june',5],['jul',6],['july',6],['aug',7],['august',7],['sep',8],['sept',8],['september',8],
  ['oct',9],['october',9],['nov',10],['november',10],['dec',11],['december',11],
]);

const iso = value => value.toISOString().slice(0, 10);
const utcDay = (year, month, day) => new Date(Date.UTC(year, month, day));

export function parseReleaseDateClaim(rawValue = '') {
  const raw = String(rawValue || '').trim();
  if (!raw) return { precision: 'tbd', date: null, date_start: null, date_end: null, raw_date: raw };

  let match = raw.match(/^Q([1-4])\s+(\d{4})$/i);
  if (match) {
    const quarter = Number(match[1]);
    const year = Number(match[2]);
    const month = (quarter - 1) * 3;
    return {
      precision: 'quarter', date: null,
      date_start: iso(utcDay(year, month, 1)),
      date_end: iso(utcDay(year, month + 3, 0)),
      raw_date: raw,
    };
  }

  match = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (match && MONTHS.has(match[1].toLowerCase())) {
    const month = MONTHS.get(match[1].toLowerCase());
    const year = Number(match[2]);
    return {
      precision: 'month', date: null,
      date_start: iso(utcDay(year, month, 1)),
      date_end: iso(utcDay(year, month + 1, 0)),
      raw_date: raw,
    };
  }

  match = raw.match(/^(\d{4})$/);
  if (match) {
    const year = Number(match[1]);
    return {
      precision: 'year', date: null,
      date_start: `${year}-01-01`, date_end: `${year}-12-31`, raw_date: raw,
    };
  }

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return { precision: 'tbd', date: null, date_start: null, date_end: null, raw_date: raw };
  const date = new Date(timestamp).toISOString().slice(0, 10);
  return { precision: 'exact', date, date_start: date, date_end: date, raw_date: raw };
}
