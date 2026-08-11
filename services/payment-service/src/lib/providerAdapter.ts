/**
 * Provider adapter interface. In production this would have one
 * implementation per real payment rail (Airtel Money API, TNM Mpamba API,
 * national payment switch, bank transfer). The rest of payment-service only
 * ever talks to this interface, so swapping/adding a provider never touches
 * application/workflow code.
 */
export interface PaymentProviderAdapter {
  initiate(input: { amount: number; phoneNumber: string; referenceNumber: string }): Promise<{ providerTransactionId: string }>;
}

/**
 * Development/demo stand-in. Simulates the real-world pattern where a mobile
 * money provider processes the request asynchronously and later calls back
 * a webhook -- here we just schedule that "callback" locally instead of
 * waiting on a real telco sandbox.
 */
export class MockMobileMoneyAdapter implements PaymentProviderAdapter {
  constructor(private readonly onCallback: (referenceNumber: string, providerTransactionId: string) => void) {}

  async initiate(input: { amount: number; phoneNumber: string; referenceNumber: string }) {
    const providerTransactionId = `MOCK-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    setTimeout(() => this.onCallback(input.referenceNumber, providerTransactionId), 3000);
    return { providerTransactionId };
  }
}
