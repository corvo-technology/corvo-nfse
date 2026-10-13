export interface TenantSettings {
  id: string;
  tenantId: string;
  timezone: string;
  businessHoursStart: number;
  businessHoursEnd: number;
  businessDays: number[];
  createdAt: Date;
  updatedAt: Date;
}
