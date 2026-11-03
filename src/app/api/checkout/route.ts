import { z } from 'zod';
import { CheckoutService } from '../../../lib/checkout';
import { getGateway } from '../../../lib/paypal';
import { getStore } from '../../../lib/store';
import { apiError, assertSameOrigin, readBody, readSession, UserError } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({ quoteId: z.uuid() }).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const sessionId = readSession(request);
    if (!sessionId) throw new UserError('Your shopping session has expired. Refresh the page and try again.');
    const { quoteId } = schema.parse(await readBody(request));
    const result = await new CheckoutService(getStore(), getGateway()).start(sessionId, quoteId);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
