import { parseDateSearch } from './date-search';

describe('parseDateSearch', () => {
  it.each([
    ['11', { day: 11 }],
    ['11th', { day: 11 }],
    ['1st', { day: 1 }],
    ['11 Oct', { day: 11, month: 10 }],
    ['Oct 11', { day: 11, month: 10 }],
    ['11th of October', { day: 11, month: 10 }],
    ['Sunday 11 October', { day: 11, month: 10 }],
    ['October 11th, 2026', { day: 11, month: 10, year: 2026 }],
    ['11 sept', { day: 11, month: 9 }],
    ['11/10', { day: 11, month: 10 }],
    ['11/10/2026', { day: 11, month: 10, year: 2026 }],
    ['11.10.26', { day: 11, month: 10, year: 2026 }],
    ['2026-10-11', { day: 11, month: 10, year: 2026 }],
    ['October', { month: 10 }],
    ['2026', { year: 2026 }],
  ])('reads %p as a date', (input, expected) => {
    expect(parseDateSearch(input)).toEqual(expected);
  });

  it.each([
    'Sunday Service',
    'Harvest 2026 thanksgiving',
    'ma',
    '32',
    '11/13',
    '2026-13-01',
    '11 12',
    'Sunday',
    '',
  ])('leaves %p to the name search', (input) => {
    expect(parseDateSearch(input)).toBeNull();
  });
});
