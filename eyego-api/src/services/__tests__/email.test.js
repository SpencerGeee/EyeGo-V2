'use strict';

const email = require('../email.service');

describe('email receipts', () => {
  it('is a silent no-op without a Resend key', async () => {
    if (email.isConfigured()) return; // a dev machine with a real key: nothing to assert
    expect(await email.send({ to: 'a@b.c', subject: 's', html: '<p/>', text: 't' })).toBeNull();
  });
  it('escapes everything a rider or driver typed', () => {
    const m = email.receiptEmail({
      receiptNumber: 'RCP-1', dateText: '2026-10-10 08:00 GMT', from: '<script>x</script>', to: 'Circle',
      driverName: 'Kofi & Sons', lines: [['Ride', 'GH₵37.00']], total: 'GH₵37.00', paymentMethod: 'cash', company: null,
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('Kofi &amp; Sons');
    expect(m.subject).toBe('Your EyeGo receipt — GH₵37.00');
  });
});
