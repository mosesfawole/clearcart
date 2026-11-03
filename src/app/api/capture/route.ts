import { z } from 'zod';
import { CheckoutService } from '../../../lib/checkout';
import { getGateway } from '../../../lib/paypal';
import { getStore } from '../../../lib/store';
import { apiError, assertSameOrigin, readBody, readSession, UserError } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({ orderId: z.uuid(), token: z.string().min(1).max(128).optional() }).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const sessionId = readSession(request);
    if (!sessionId) throw new UserError('Your shopping session has expired. Refresh the page and retry verification.');
    const { orderId, token } = schema.parse(await readBody(request));
    const receipt = await new CheckoutService(getStore(), getGateway()).capture(sessionId, orderId, token);
    return Response.json({ receipt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
