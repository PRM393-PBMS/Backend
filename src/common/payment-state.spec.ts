import { paymentApplication } from './payment-state';

describe('payment application contract', () => {
  it('does not promise a benefit merely because money was received', () => {
    expect(paymentApplication({ paymentStatus: 'Success' })).toMatchObject({
      isApplied: false,
      applicationStatus: 'Applying',
      appliedAt: null,
    });
  });
  it('keeps disputed or legacy receipts in reconciliation even with an old marker', () => {
    expect(
      paymentApplication({
        paymentStatus: 'Success',
        appliedAt: new Date(),
        reconciliationReason: 'LEGACY_REVIEW_REQUIRED',
      }),
    ).toMatchObject({
      isApplied: false,
      applicationStatus: 'ReconciliationRequired',
    });
  });
  it('confirms only the applied receipt and rejects pending or refunded receipts', () => {
    expect(
      paymentApplication({ paymentStatus: 'Success', appliedAt: new Date() })
        .isApplied,
    ).toBe(true);
    for (const paymentStatus of ['Pending', 'Failed', 'Refunded']) {
      expect(
        paymentApplication({ paymentStatus, appliedAt: new Date() }).isApplied,
      ).toBe(false);
    }
  });
});
