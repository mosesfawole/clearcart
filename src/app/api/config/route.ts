import { catalog } from '../../../lib/catalog';
import { aiMode } from '../../../lib/intent';
import { paymentMode } from '../../../lib/paypal';
import { apiError, assertSameOrigin, ConfigurationError, newSession, readSession } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const mode = paymentMode();
    const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(model)) {
      throw new ConfigurationError('The AI model configuration is invalid. Choose a valid Gemini model name.');
    }
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    if (!readSession(request)) {
      const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
      headers.set('Set-Cookie', `clearcart-session=${newSession()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
    }
    return Response.json({ aiMode: aiMode(), paymentMode: mode, model, catalog }, { headers });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
