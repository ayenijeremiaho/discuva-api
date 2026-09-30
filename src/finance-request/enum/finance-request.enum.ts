export enum FinanceRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

// List filters on top of the stored status: an approved request is "paid" once its payment proof is attached.
export enum FinanceRequestPaymentFilter {
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PAID = 'PAID',
}

export type FinanceRequestStatusFilter =
  FinanceRequestStatus | FinanceRequestPaymentFilter;
