import { createDemoHandler } from '../server/demo.ts';

export default {
  async fetch(request: Request) {
    const secret = process.env.DEMO_SESSION_SECRET;
    if (!secret) return Response.json({ error: 'The demo is not configured yet.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return createDemoHandler(secret)(request);
  }
};
