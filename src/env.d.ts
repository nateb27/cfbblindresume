/// <reference types="astro/client" />

// Types for import.meta.env without the generated .astro/types.d.ts, so `tsc --noEmit` passes on a
// fresh checkout (CI runs it before anything has run `astro sync`). List every PUBLIC_* variable the
// site reads; Cloudflare Pages sets them per environment at build time.
interface ImportMetaEnv {
  /** "on" renders the ad slots (src/components/site.ts ADS_ON). Anything else: no ads. */
  readonly PUBLIC_ADS?: string;
  /** Ad network id, read only when PUBLIC_ADS is "on". */
  readonly PUBLIC_AD_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
