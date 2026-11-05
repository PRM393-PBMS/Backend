/** Receiving money and granting the purchased benefit are separate milestones. */
export function paymentApplication(payment: {
  paymentStatus: string;
  appliedAt?: Date | null;
  reconciliationReason?: string | null;
}) {
  const received = payment.paymentStatus.toLowerCase() === 'success';
  const applicationStatus = payment.reconciliationReason
    ? 'ReconciliationRequired'
    : received && payment.appliedAt
      ? 'Applied'
      : received
        ? 'Applying'
        : 'NotReceived';
  return {
    appliedAt: payment.appliedAt ?? null,
    applicationStatus,
    isApplied: applicationStatus === 'Applied',
  };
}
