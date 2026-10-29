const { scheduleDays, departuresWithin } = require('../src/services/pulse-materialiser.service');

describe('pulse schedule departures (B4)', () => {
  test('reads both the admin format and the legacy JSON format', () => {
    expect([...scheduleDays('MON,TUE')]).toEqual([1, 2]);
    expect([...scheduleDays('[1,2]')]).toEqual([1, 2]);
    expect(scheduleDays('garbage').size).toBe(0);
  });

  test('publishes only departures inside the horizon on a running day', () => {
    // Wed 2026-10-28 05:00Z
    const now = new Date(Date.UTC(2026, 9, 28, 5, 0));
    expect(departuresWithin({ departureTime: '06:30', daysOfWeek: 'WED' }, now).map((d) => d.toISOString()))
      .toEqual(['2026-10-28T06:30:00.000Z']);
    expect(departuresWithin({ departureTime: '06:30', daysOfWeek: 'THU' }, now)).toEqual([]);
    expect(departuresWithin({ departureTime: '04:30', daysOfWeek: 'WED' }, now)).toEqual([]); // already left
    expect(departuresWithin({ departureTime: '09:00', daysOfWeek: 'WED' }, now)).toEqual([]); // beyond 3 h
  });

  test('a late-evening run rolls over to tomorrow', () => {
    const now = new Date(Date.UTC(2026, 9, 28, 23, 0)); // Wed 23:00Z
    expect(departuresWithin({ departureTime: '00:30', daysOfWeek: 'THU' }, now).map((d) => d.toISOString()))
      .toEqual(['2026-10-29T00:30:00.000Z']);
  });
});
