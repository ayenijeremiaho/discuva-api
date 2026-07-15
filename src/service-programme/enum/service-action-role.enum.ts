export enum ServiceActionRoleEnum {
  ADMIN = 'ADMIN',
  WORKER = 'WORKER',
  PUBLIC_LINK = 'PUBLIC_LINK',
}

export const ServiceActionRoleLabels: Record<ServiceActionRoleEnum, string> = {
  [ServiceActionRoleEnum.ADMIN]: 'Admin',
  [ServiceActionRoleEnum.WORKER]: 'Worker',
  [ServiceActionRoleEnum.PUBLIC_LINK]: 'Public Link',
};
