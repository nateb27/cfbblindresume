/** GET /r/{code} — the static results shell with per-code title, description, canonical and share-image tags. */
import { param, type PagesHandler } from '../_lib/cf';
import { handleSharedPage } from '../_lib/handlers';

export const onRequest: PagesHandler<'code'> = (ctx) => handleSharedPage(ctx.request, ctx.env, param(ctx, 'code'));
