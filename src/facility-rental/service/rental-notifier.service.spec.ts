import { formatInTimeZone } from 'date-fns-tz';
import { RentalNotifierService } from './rental-notifier.service';
import { RentalPaymentType } from '../enum/rental.enum';
import { PushNotificationKey } from '../../notification-catalogue/push-catalogue';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';

describe('RentalNotifierService', () => {
  const dispatch = { notifyMember: jest.fn() };
  const service = new RentalNotifierService(
    dispatch as never,
    {
      format: (d: Date, p: string, tz: string) => formatInTimeZone(d, tz, p),
    } as never,
    { get: jest.fn().mockResolvedValue('Africa/Lagos') } as never,
    { resolveCurrencyCode: jest.fn().mockResolvedValue('NGN') } as never,
  );
  const booking = (over: Record<string, unknown> = {}) =>
    ({
      id: 'b1',
      // 10:00–16:00 Lagos time.
      startDateTime: new Date('2026-11-07T09:00:00Z'),
      endDateTime: new Date('2026-11-07T15:00:00Z'),
      grandTotal: '70000',
      rejectionReason: null,
      facility: { name: 'Main Hall' },
      member: { id: 'm1', firstname: 'Ada', email: 'ada@x.org' },
      ...over,
    }) as never;

  beforeEach(() => dispatch.notifyMember.mockClear());

  it('confirms with the facility, day, local times and total', async () => {
    await service.confirmed(booking());
    expect(dispatch.notifyMember).toHaveBeenCalledWith({
      category: EmailCategory.FACILITY_RENTAL,
      email: expect.objectContaining({
        to: 'ada@x.org',
        recipientMemberId: 'm1',
        template: 'rental-booking-confirmed',
        data: {
          name: 'Ada',
          facilityName: 'Main Hall',
          bookingDate: 'Sat 7 Nov',
          bookingTime: '10:00 AM–4:00 PM',
          amountDue: 'NGN 70,000.00',
        },
      }),
      push: {
        memberIds: ['m1'],
        key: PushNotificationKey.RENTAL_BOOKING_CONFIRMED,
        vars: {
          facility_name: 'Main Hall',
          booking_date: 'Sat 7 Nov',
          booking_time: '10:00 AM–4:00 PM',
        },
        idempotencyKey: 'rental-confirmed:b1',
      },
    });
  });

  it('shows the end date for a booking over several days', async () => {
    await service.reminder(
      booking({ endDateTime: new Date('2026-11-08T15:00:00Z') }),
    );
    expect(dispatch.notifyMember.mock.calls[0][0].push.vars.booking_time).toBe(
      '10:00 AM – Sun 8 Nov, 4:00 PM',
    );
  });

  it('names a caution payment as such, with its reference', async () => {
    await service.paymentReceived(
      {
        id: 'p1',
        amount: '20000',
        type: RentalPaymentType.CAUTION,
        reference: 'TRF-1',
      } as never,
      booking(),
    );
    const call = dispatch.notifyMember.mock.calls[0][0];
    expect(call.push.vars).toEqual(
      expect.objectContaining({
        amount: 'NGN 20,000.00',
        payment_label: 'caution deposit',
      }),
    );
    expect(call.email.data).toEqual(
      expect.objectContaining({
        paymentLabel: 'Caution deposit',
        reference: 'TRF-1',
      }),
    );
  });

  it('gives a fallback reason in the push when none was written', async () => {
    await service.rejected(booking());
    expect(dispatch.notifyMember.mock.calls[0][0].push.vars.reason).toBe(
      'Please contact the church office.',
    );
  });

  it('sends push only when the renter has no email, and nothing without a renter', async () => {
    await service.reminder(
      booking({ member: { id: 'm1', firstname: 'Ada', email: null } }),
    );
    expect(dispatch.notifyMember.mock.calls[0][0].email).toBeUndefined();
    await service.reminder(booking({ member: null }));
    expect(dispatch.notifyMember).toHaveBeenCalledTimes(1);
  });

  it("never throws, so a failed notice can't undo the booking change it reports", async () => {
    const failing = new RentalNotifierService(
      dispatch as never,
      { format: () => 'x' } as never,
      {
        get: jest.fn().mockRejectedValue(new Error('timezone lookup failed')),
      } as never,
      { resolveCurrencyCode: jest.fn() } as never,
    );
    await expect(failing.confirmed(booking())).resolves.toBeUndefined();
    await expect(failing.reminder(booking())).resolves.toBeUndefined();
    expect(dispatch.notifyMember).not.toHaveBeenCalled();
  });
});
