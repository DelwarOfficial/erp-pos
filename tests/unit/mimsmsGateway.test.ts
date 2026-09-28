// MiMSMS adapter against a mocked fetch: request shape from the official v2.1
// documentation, and how every outcome is classified. No real SMS is sent.
import { describe, expect, it, vi } from 'vitest';
import { MimSmsGateway, MIMSMS_BASE_URL } from '@/lib/sms/mimsms';

const credentials = { userName: 'ops@example.com', apiKey: 'SECRETKEY123456', senderName: 'MYSHOP' };
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
const networkError = (code: string) => vi.fn(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code } }); });

const ACCEPTED = {
  statusCode: '200', status: 'Success', trxnId: 'BRN0T2ZCWRCEL1D', responseResult: 'SMS Send Successfully', numberQty: '1',
  success_Data: [{ mobNumber: '8801777712720', trackingId: 'BRN0T2ZCWRCEL1D', sms_Count: 2, lang_Type: 'Unicode' }],
  error_Data: [{ res_Code: '200', error: '', failedNumbers: '', errorParm: '' }],
};

describe('MiMSMS send', () => {
  it('posts the documented transactional request, credentials in the body', async () => {
    const fetchImpl = reply(200, ACCEPTED);
    await new MimSmsGateway(credentials, fetchImpl as never).send({ to: '8801777712720', text: 'বকেয়া ৳১০০' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${MIMSMS_BASE_URL}/SMS`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      userName: 'ops@example.com', apiKey: 'SECRETKEY123456', senderName: 'MYSHOP',
      transactionType: 'T', mobileNumber: '8801777712720', message: 'বকেয়া ৳১০০',
    });
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('reads an accepted send: the tracking ID and the provider\'s part count', async () => {
    const outcome = await new MimSmsGateway(credentials, reply(200, ACCEPTED) as never).send({ to: '8801777712720', text: 'x' });
    expect(outcome).toMatchObject({ kind: 'accepted', providerMessageId: 'BRN0T2ZCWRCEL1D', segments: 2 });
  });

  it.each([
    ['a refused connection', networkError('ECONNREFUSED'), 'retryable'],
    ['an unresolvable host', networkError('ENOTFOUND'), 'retryable'],
    ['HTTP 503', reply(503, 'Service Unavailable'), 'retryable'],
    ['HTTP 429', reply(429, 'Too Many Requests'), 'retryable'],
    ['a timeout', vi.fn(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }), 'ambiguous'],
    ['a reset connection', networkError('ECONNRESET'), 'ambiguous'],
    ['an unreadable 200', reply(200, '<html>gateway</html>'), 'ambiguous'],
    ['a 200 success without a tracking ID', reply(200, { statusCode: '200', status: 'Success', success_Data: [] }), 'ambiguous'],
    ['a refusal in the body', reply(200, { statusCode: '208', status: 'Failed', error_Data: [{ res_Code: '208', error: 'Invalid Sender ID' }] }), 'permanent'],
    ['HTTP 401', reply(401, { statusCode: '401', status: 'Unauthorized' }), 'permanent'],
  ])('classifies %s as %s', async (_label, fetchImpl, kind) => {
    const outcome = await new MimSmsGateway(credentials, fetchImpl as never).send({ to: '8801777712720', text: 'x' });
    expect(outcome.kind).toBe(kind);
  });

  it('never keeps a credential the provider echoes back', async () => {
    const outcome = await new MimSmsGateway(credentials, reply(400, `bad key SECRETKEY123456 for ops@example.com`) as never)
      .send({ to: '8801777712720', text: 'x' });
    expect(outcome.raw).not.toContain('SECRETKEY123456');
    expect(outcome.raw).not.toContain('ops@example.com');
  });
});

describe('MiMSMS delivery report', () => {
  it('asks DlrApi with the number and tracking ID', async () => {
    const fetchImpl = reply(200, { statusCode: '200', status: 'Ok', trackingId: 'T1', dlrCode: '0', operatorStatus: 'DELIVERED', mobileNumber: '8801777712720' });
    const status = await new MimSmsGateway(credentials, fetchImpl as never).deliveryStatus('T1', '8801777712720');
    expect(status).toEqual({ kind: 'delivered', providerStatus: 'DELIVERED' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${MIMSMS_BASE_URL}/DlrApi`);
    expect(JSON.parse(init.body as string)).toMatchObject({ mobileNumber: '8801777712720', trackingId: 'T1' });
  });

  it.each([
    ['Absent subscriber for SM', 'failed'],
    ['Barred subscriber', 'failed'],
    ['SMSC Timeout-abort', 'failed'],
    ['PENDING', 'pending'],
  ])('reads "%s" as %s', async (operatorStatus, kind) => {
    const status = await new MimSmsGateway(credentials, reply(200, { statusCode: '200', operatorStatus }) as never).deliveryStatus('T1', '8801777712720');
    expect(status.kind).toBe(kind);
  });

  it('reports no report yet rather than guessing', async () => {
    const status = await new MimSmsGateway(credentials, reply(200, { statusCode: '404', status: 'Not found' }) as never).deliveryStatus('T1', '8801777712720');
    expect(status.kind).toBe('unavailable');
  });
});

describe('MiMSMS balance', () => {
  it('reads the documented balance response', async () => {
    const balance = await new MimSmsGateway(credentials, reply(200, { statusCode: '200', status: 'Success', data: [{ balance: '37.45', expair_Date: '03/06/2028' }] }) as never).balance();
    expect(balance).toEqual({ balance: '37.45', expiresOn: '03/06/2028' });
  });
});
