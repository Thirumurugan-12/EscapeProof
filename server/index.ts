import 'dotenv/config';
import { buildApp } from './app.ts';
const { app } = await buildApp({ logger: true });
await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT) || 3001 });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
