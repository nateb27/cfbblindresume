/** GET /api/fans?season=&week=&trio=a,b,c — fans' consensus order for a trio (null under 20 votes per pair). */
import type { PagesHandler } from '../_lib/cf';
import { handleFans } from '../_lib/handlers';

export const onRequest: PagesHandler = ({ request, env, waitUntil }) => handleFans(request, env, waitUntil);
