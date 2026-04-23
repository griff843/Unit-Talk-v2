import { handlers } from '@/auth';
import type { NextRequest } from 'next/server';

type RouteHandler = (req: NextRequest) => Promise<Response>;
const { GET, POST } = handlers as { GET: RouteHandler; POST: RouteHandler };

export { GET, POST };
