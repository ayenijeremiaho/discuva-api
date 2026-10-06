import { formatWindow } from './online-window';

describe('formatWindow', () => {
  it('reads naturally for hours, minutes or both', () => {
    expect(formatWindow(45)).toBe('45 minutes');
    expect(formatWindow(60)).toBe('1 hour');
    expect(formatWindow(150)).toBe('2 hours 30 minutes');
    expect(formatWindow(61)).toBe('1 hour 1 minute');
  });
});
