/** Binary modules: wrangler bundles `*.bin` imports as ArrayBuffer (Pages Functions "Data" modules). */
declare module '*.bin' {
  const data: ArrayBuffer;
  export default data;
}
