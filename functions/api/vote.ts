/** POST /api/vote — one ranked trio `{ season, week, order: [1st, 2nd, 3rd] }` -> 204. See functions/README.md. */
import type { PagesHandler } from '../_lib/cf';
import { handleVote } from '../_lib/handlers';

export const onRequest: PagesHandler = ({ request, env }) => handleVote(request, env);
