import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { PlatformPaymentProvider } from '../../billing/entity/payment-provider.entity';
import { Subscription } from '../../billing/entity/subscription.entity';
import { SubscriptionStatus } from '../../billing/enum/subscription-status.enum';
import { TenantBroadcastService } from './tenant-broadcast.service';

// Platform-admin-only. No registerProvider() here unlike Communication/
// GivingProvider — paystack/flutterwave/kora are hard-coded IPaymentProvider
// classes wired in BillingModule (PaystackPaymentProvider etc.), not
// arbitrary BYOK entries a platform admin can add by id/name alone; a
// fourth vendor needs its own provider class written and registered in
// PaymentProviderRegistryService first, same as it always has.
@Injectable()
export class PlatformPaymentProviderService {
  constructor(
    @InjectRepository(PlatformPaymentProvider)
    private readonly providerRepo: Repository<PlatformPaymentProvider>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    private readonly tenantBroadcastService: TenantBroadcastService,
  ) {}

  async listProviders(): Promise<PlatformPaymentProvider[]> {
    return this.providerRepo.find({ order: { name: 'ASC' } });
  }

  // Mirrors PlatformCommunicationProviderService/PlatformGivingProviderService
  // .setActive — no cache to invalidate here (PaymentProviderRegistryService
  // resolves straight from the DB on every assertActive() call, no 300s
  // TTL like the resolved-credential caches those two have). Narrower
  // blast radius than those two, though: deactivating only blocks a NEW
  // subscription checkout (CheckoutService.initiateSubscriptionCheckout) —
  // an existing subscriber's recurring renewal keeps working via their own
  // provider's webhook, which deliberately never checks isActive (see
  // PaymentProviderRegistryService.get()'s comment). The notification below
  // reflects that accurately rather than implying their subscription itself
  // is at risk.
  async setActive(
    id: string,
    isActive: boolean,
  ): Promise<PlatformPaymentProvider> {
    const provider = await this.providerRepo.findOneBy({ id });
    if (!provider) {
      throw new NotFoundException(`Payment provider "${id}" not found.`);
    }
    provider.isActive = isActive;
    const saved = await this.providerRepo.save(provider);

    const affected = await this.subscriptionRepo.find({
      where: {
        paymentProvider: id,
        status: Not(SubscriptionStatus.CANCELED),
      },
    });

    if (affected.length > 0) {
      const tenantIds = affected.map((s) => s.tenantId);
      const subject = isActive
        ? `${provider.name} is available again`
        : `${provider.name} is temporarily unavailable`;
      const message = isActive
        ? `${provider.name} is available again for new checkouts. No action is needed on your end.`
        : `${provider.name} is temporarily unavailable due to an issue on our end. Your current subscription is not affected and will keep renewing normally — this only affects starting a new checkout with ${provider.name} until it's restored. No action is needed on your end.`;
      this.tenantBroadcastService.notifyTenants(
        tenantIds,
        subject,
        `<p>${message}</p>`,
      );
    }

    return saved;
  }
}
