'use strict';

const { toRow } = require('../csv');

const cell = (v) => toRow({ v }, [{ key: 'v' }]);

describe('csv escaping', () => {
  it('defuses formulas but leaves negative amounts as numbers', () => {
    expect(cell('=cmd|calc')).toBe("'=cmd|calc");
    expect(cell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(cell('-1+cmd')).toBe("'-1+cmd");
    expect(cell('+233241234567')).toBe("'+233241234567"); // a phone keeps its +
    expect(cell('-5.00')).toBe('-5.00');
    expect(cell(-500)).toBe('-500');
  });
  it('quotes commas and quotes', () => {
    expect(cell('Osu, Accra')).toBe('"Osu, Accra"');
    expect(cell('say "hi"')).toBe('"say ""hi"""');
  });
});
