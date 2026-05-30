export type ClinicActivationGuard = {
  isClinicActive(clinicId: string): Promise<boolean> | boolean;
};
