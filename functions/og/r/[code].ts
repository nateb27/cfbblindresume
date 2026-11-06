/**
 * GET /og/r/{code}.png — 1200x630 share image of the run's top 12, rendered from the code alone
 * (glyph atlas + palette PNG, no database); invalid codes get the default site image.
 */
import { getAtlas } from '../../_lib/atlas-data';
import { param, type PagesHandler } from '../../_lib/cf';
import { handleShareImage } from '../../_lib/handlers';

export const onRequest: PagesHandler<'code'> = (ctx) => handleShareImage(ctx.request, ctx.env, param(ctx, 'code'), getAtlas, (p) => ctx.waitUntil(p));
