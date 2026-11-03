import { z } from 'zod';
import { effectiveBudget, recommendBasket } from '../../../lib/basket';
import { aiMode, interpretRequest, requestConstraints } from '../../../lib/intent';
import { getStore } from '../../../lib/store';
import { apiError, assertSameOrigin, rateLimit, readBody, readSession, UserError } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({
  request: z.string().trim().min(3).max(1200),
  budgetCents: z.number().int().min(1).max(100000),
  constraints: z.object({ lightweight: z.boolean(), leatherFree: z.boolean() }).strict(),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const sessionId = readSession(request);
    if (!sessionId) throw new UserError('Your shopping session has expired. Refresh the page and try again.');
    const body = schema.parse(await readBody(request));
    rateLimit(sessionId);
    const constraints = requestConstraints(body.request, body.constraints);
    const budgetCents = effectiveBudget(body.request, body.budgetCents);
    const intent = await interpretRequest(body.request);
    const basket = recommendBasket(intent, budgetCents, constraints);
    const { sessionId: _sessionId, ...quote } = getStore().saveQuote(sessionId, basket);
    return Response.json({ quote, aiMode: aiMode() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
