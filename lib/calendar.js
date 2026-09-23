// Google Calendar (or any iCal feed) through its secret iCal address.
const ical = require('node-ical');

class CalendarError extends Error {}

function normalize(url) {
  const u = String(url || '').trim().replace(/^webcal:\/\//i, 'https://');
  let parsed;
  try { parsed = new URL(u); } catch {
    throw new CalendarError('Paste the whole address, starting with https://');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new CalendarError('Paste the whole address, starting with https://');
  if (/calendar\.google\.com$/i.test(parsed.hostname) && !/\/ical\//.test(parsed.pathname)) {
    throw new CalendarError('That’s a link to the Calendar website, not an iCal address. Copy the address labeled “Secret address in iCal format” instead. It contains /calendar/ical/ and ends in /basic.ics.');
  }
  return u;
}

async function fetchCalendar(url) {
  const u = normalize(url);
  let res;
  try {
    // Ask every hop for a fresh copy; Google already builds the feed anew for each request.
    res = await fetch(u, { headers: { 'User-Agent': 'start-page', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(20000) });
  } catch {
    throw new CalendarError('Couldn’t reach this address. Check your internet connection and try again.');
  }
  if (res.status === 404 && /\/public\/basic\.ics/.test(u)) {
    throw new CalendarError('Google says this calendar isn’t public. Use its Secret address in iCal format instead. If your organization hides that option, this calendar can’t be connected this way.');
  }
  if (res.status === 404 || res.status === 403 || res.status === 401) {
    throw new CalendarError('Google didn’t return a calendar for this address. Check that you copied all of it, or reset the secret address in Google Calendar and copy the new one.');
  }
  if (!res.ok) throw new CalendarError(`The calendar server answered with an error (${res.status}). Try again in a minute.`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/.test(text)) throw new CalendarError('This address didn’t return calendar data. Make sure it’s the iCal address, which ends in .ics.');
  return ical.sync.parseICS(text);
}

// Expand one calendar's events (including repeating ones) that overlap [rangeStart, rangeEnd).
function expand(data, calName, rangeStart, rangeEnd) {
  const out = [];
  const push = (ev, start, end) => {
    if (end <= rangeStart || start >= rangeEnd) return;
    out.push({
      title: ev.summary ? String(ev.summary.val || ev.summary) : '(no title)',
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: ev.datetype === 'date',
      location: String((ev.location && (ev.location.val || ev.location)) || '').split(',')[0].trim(),
      calendar: calName,
    });
  };
  const key = d => d.toISOString().slice(0, 10);
  for (const ev of Object.values(data)) {
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
    const dur = (ev.end ? ev.end : ev.start) - ev.start;
    if (ev.rrule) {
      // Start a little early so an occurrence already under way when the range begins is included.
      const from = new Date(rangeStart.getTime() - Math.max(dur, 0));
      for (const s of ev.rrule.between(from, rangeEnd, true)) {
        const k = key(s);
        if (ev.exdate && ev.exdate[k]) continue;
        const o = ev.recurrences && ev.recurrences[k];
        if (o && o.start) push(o, new Date(o.start), new Date(o.end || o.start));
        else push(ev, s, new Date(s.getTime() + dur));
      }
    } else {
      push(ev, new Date(ev.start), new Date(ev.end || ev.start));
    }
  }
  return out;
}

const calName = (data, fallback) => (data.vcalendar && data.vcalendar['WR-CALNAME']) || fallback || 'Calendar';

async function test(url) {
  const data = await fetchCalendar(url);
  const now = new Date();
  const events = expand(data, '', now, new Date(now.getTime() + 7 * 86400e3)).sort((a, b) => new Date(a.start) - new Date(b.start));
  return { name: calName(data), count: events.length, next: events[0] || null };
}

// This computer's current week, Sunday 00:00 to the next Sunday 00:00 (local time).
function currentWeek() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

// Events for both of the dashboard's views: from this Sunday (the current week, including days
// already past) through the end of the 7th day from today (the "next 7 days" view).
async function events(calendars) {
  const week = currentWeek();
  const until = new Date();
  until.setHours(0, 0, 0, 0);
  until.setDate(until.getDate() + 7);
  const to = until > week.end ? until : week.end;
  const results = await Promise.allSettled(calendars.map(async c => {
    const data = await fetchCalendar(c.url);
    return expand(data, c.name || calName(data), week.start, to);
  }));
  const list = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
  list.sort((a, b) => new Date(a.start) - new Date(b.start));
  const errors = results.map((r, i) => (r.status === 'rejected' ? { index: i, error: r.reason.message } : null)).filter(Boolean);
  return { weekStart: week.start.toISOString(), until: to.toISOString(), events: list.slice(0, 300), errors };
}

module.exports = { test, events, CalendarError };
