/** POST /api/event — anonymous (day, name, prop) counter for allowlisted game events -> 204. */
import type { PagesHandler } from '../_lib/cf';
import { handleEvent } from '../_lib/handlers';

export const onRequest: PagesHandler = ({ request, env }) => handleEvent(request, env);
