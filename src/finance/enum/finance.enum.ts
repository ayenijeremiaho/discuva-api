export enum FundType {
  RESTRICTED = 'RESTRICTED',
  UNRESTRICTED = 'UNRESTRICTED',
}

export enum AccountingPeriodStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
}

export enum AccountSubtype {
  BANK = 'BANK',
  CASH = 'CASH',
  PETTY_CASH = 'PETTY_CASH',
  OFFERING = 'OFFERING',
  TITHE = 'TITHE',
  SALARY = 'SALARY',
  UTILITIES = 'UTILITIES',
  REMITTANCE = 'REMITTANCE',
  EQUIPMENT = 'EQUIPMENT',
  OTHER = 'OTHER',
}

export enum NormalBalance {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum ExternalPayeeType {
  REMITTANCE = 'REMITTANCE',
  VENDOR = 'VENDOR',
  UTILITY = 'UTILITY',
  CONTRACTOR = 'CONTRACTOR',
  GOVERNMENT = 'GOVERNMENT',
  MISSION = 'MISSION',
  BENEVOLENCE = 'BENEVOLENCE',
  OTHER = 'OTHER',
}

export enum JournalEntrySource {
  MANUAL = 'MANUAL',
  CSV_IMPORT = 'CSV_IMPORT',
  VIRTUAL_ACCOUNT = 'VIRTUAL_ACCOUNT',
  PAYMENT_GATEWAY = 'PAYMENT_GATEWAY',
}

export enum JournalEntryType {
  STANDARD = 'STANDARD',
  OPENING_BALANCE = 'OPENING_BALANCE',
  REVERSAL = 'REVERSAL',
  RECURRING = 'RECURRING',
}

export enum JournalEntryStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  POSTED = 'POSTED',
  VOIDED = 'VOIDED',
}

export enum JournalLineType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum JournalLinkType {
  MEMBER = 'MEMBER',
  DEPARTMENT = 'DEPARTMENT',
  SERVICE = 'SERVICE',
  EXTERNAL_PAYEE = 'EXTERNAL_PAYEE',
}

export enum JournalLinkRole {
  RECIPIENT = 'RECIPIENT',
  CHARGE_TO = 'CHARGE_TO',
  FOR_SERVICE = 'FOR_SERVICE',
  PAYEE = 'PAYEE',
}

export enum OfferingType {
  GENERAL = 'GENERAL',
  TITHE_SUNDAY = 'TITHE_SUNDAY',
  PLEDGE = 'PLEDGE',
  SEED = 'SEED',
}

export enum BudgetPeriod {
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
  CUSTOM = 'CUSTOM',
}

export enum PledgeFrequency {
  ONE_OFF = 'ONE_OFF',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
}

export enum PledgeStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum RecurringFrequency {
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
}

export enum PettyCashReplenishmentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  POSTED = 'POSTED',
}

export enum BulkUploadJobStatus {
  QUEUED = 'QUEUED',
  PARSING = 'PARSING',
  READY_FOR_REVIEW = 'READY_FOR_REVIEW',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
}

export enum BulkUploadType {
  TITHE = 'TITHE',
  CSV_RECONCILIATION = 'CSV_RECONCILIATION',
}

export enum ReconciliationRowStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  SKIPPED = 'SKIPPED',
  POSTED = 'POSTED',
}

export enum TitheSource {
  MANUAL_PROOF = 'MANUAL_PROOF',
  VIRTUAL_ACCOUNT = 'VIRTUAL_ACCOUNT',
  PAYMENT_GATEWAY = 'PAYMENT_GATEWAY',
}

export enum VirtualAccountProvider {
  PAYSTACK = 'PAYSTACK',
  FLUTTERWAVE = 'FLUTTERWAVE',
}

export enum AmountConvention {
  SIGNED = 'SIGNED',
  SEPARATE_COLUMNS = 'SEPARATE_COLUMNS',
  AMOUNT_WITH_TYPE = 'AMOUNT_WITH_TYPE',
}
