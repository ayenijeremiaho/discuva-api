import { needsRecipient, recipientVars, withRecipient } from './recipient';

describe('recipient placeholders', () => {
  it('derives names, contact details, titles and department', () => {
    expect(
      recipientVars({
        firstname: 'Ada',
        lastname: 'Obi',
        email: 'ada@example.com',
        phoneNumber: '+2348012345678',
        gender: 'FEMALE',
        maritalStatus: 'MARRIED',
        department: 'Media',
      }),
    ).toEqual({
      first_name: 'Ada',
      last_name: 'Obi',
      full_name: 'Ada Obi',
      email: 'ada@example.com',
      phone: '+2348012345678',
      title: 'Mrs',
      church_title: 'Sister',
      department: 'Media',
    });
  });

  it.each([
    ['MALE', 'SINGLE', 'Mr', 'Brother'],
    ['FEMALE', 'SINGLE', 'Miss', 'Sister'],
    ['FEMALE', 'WIDOWED', 'Mrs', 'Sister'],
    ['FEMALE', null, 'Ms', 'Sister'],
    [null, 'MARRIED', '', ''],
  ])('%s/%s → %s, %s', (gender, maritalStatus, title, churchTitle) => {
    expect(recipientVars({ gender, maritalStatus })).toMatchObject({
      title,
      church_title: churchTitle,
    });
  });

  it('returns nothing for an unknown recipient', () => {
    expect(recipientVars(undefined)).toEqual({});
  });

  it('keeps sender values and only fills gaps', () => {
    expect(
      withRecipient(
        { first_name: 'Ada', last_name: '', amount: '5' },
        { first_name: 'X', last_name: 'Obi' },
      ),
    ).toEqual({ first_name: 'Ada', last_name: 'Obi', amount: '5' });
  });

  it('needs a lookup only for recipient tokens the sender left empty', () => {
    expect(needsRecipient(['Hi {{first_name}}'], { first_name: 'Ada' })).toBe(
      false,
    );
    expect(needsRecipient(['{{amount}}'], {})).toBe(false);
    expect(needsRecipient(['Dear {{title}}'], { first_name: 'Ada' })).toBe(
      true,
    );
  });
});
