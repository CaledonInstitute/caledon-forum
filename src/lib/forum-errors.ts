import { z } from 'zod';

export function forumError(error: unknown): Response {
    if (error instanceof Response) return error;
    if (error instanceof z.ZodError) return Response.json({error:error.issues[0]?.message || 'Check your input.'},{status:400});
    if (error instanceof SyntaxError) return Response.json({error:'Invalid request.'},{status:400});
    const message = error instanceof Error ? error.message : '';
    if (/D1_|SQLITE|constraint|database|SQL/i.test(message)) { console.error('Forum database operation failed.'); return Response.json({error:'Unable to save your changes. Please try again.'},{status:500}); }
    return Response.json({error:message || 'Unable to complete this action.'},{status:400});
}
