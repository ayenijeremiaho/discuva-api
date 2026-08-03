import { Test, TestingModule } from '@nestjs/testing';
import { BillingWebhookController } from './billing-webhook.controller';
import { CheckoutService } from '../service/checkout.service';

const mockCheckoutService = { handleWebhookEvent: jest.fn() };

function req(body = '{}') {
  return { rawBody: Buffer.from(body, 'utf-8') } as any;
}

describe('BillingWebhookController', () => {
  let controller: BillingWebhookController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingWebhookController],
      providers: [{ provide: CheckoutService, useValue: mockCheckoutService }],
    }).compile();
    controller = module.get(BillingWebhookController);
  });

  it('dispatches to paystack when x-paystack-signature is present', async () => {
    await controller.handleWebhook(req(), 'sig-value', undefined);
    expect(mockCheckoutService.handleWebhookEvent).toHaveBeenCalledWith(
      'paystack',
      expect.any(Buffer),
      'sig-value',
    );
  });

  it('dispatches to flutterwave when verif-hash is present', async () => {
    await controller.handleWebhook(req(), undefined, 'hash-value');
    expect(mockCheckoutService.handleWebhookEvent).toHaveBeenCalledWith(
      'flutterwave',
      expect.any(Buffer),
      'hash-value',
    );
  });

  it('does nothing when neither signature header is present', async () => {
    await controller.handleWebhook(req(), undefined, undefined);
    expect(mockCheckoutService.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it('prefers paystack when both headers are somehow present', async () => {
    await controller.handleWebhook(req(), 'sig-value', 'hash-value');
    expect(mockCheckoutService.handleWebhookEvent).toHaveBeenCalledWith(
      'paystack',
      expect.any(Buffer),
      'sig-value',
    );
  });
});
