import type { APIRoute } from 'astro';
import { openapi } from '../../lib/openapi';
export const GET: APIRoute = () => Response.json(openapi);
