/** GET /api/fans/top25?season=&week= — fans' top 25 (Bradley-Terry over pairwise votes; null under 200 votes). */
import type { PagesHandler } from '../../_lib/cf';
import { handleFansTop25 } from '../../_lib/handlers';

export const onRequest: PagesHandler = ({ request, env, waitUntil }) => handleFansTop25(request, env, waitUntil);
