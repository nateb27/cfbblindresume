/**
 * Share module (DESIGN.md §13): the /r/{code} link, Web Share when the device has it, copy link
 * (with a visible fallback field), and the share image /og/r/{code}.png (rendered by a Function).
 */
import { useEffect, useRef, useState } from 'react';
import { track } from './api';
import { ImageIcon, LinkIcon, ShareIcon } from './ui';

export function Share({ code, shared, title }: { code: string; shared: boolean; title: string }) {
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const [canShare, setCanShare] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef(0);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator.share === 'function');
    return () => window.clearTimeout(timer.current);
  }, []);

  const path = `/r/${code}`;
  const url = `${origin}${path}`;
  const image = `/og/r/${code}.png`;

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      const el = field.current;
      if (el) {
        el.focus();
        el.select();
        try {
          ok = document.execCommand('copy');
        } catch {
          ok = false;
        }
      }
    }
    if (ok) {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
      track({ name: 'results_shared', channel: 'copy' });
    } else {
      field.current?.select();
    }
  };

  const webShare = async () => {
    try {
      await navigator.share({ title, text: shared ? 'A college football top 25, built blind.' : 'My college football top 25, built blind. Can you do better?', url });
      track({ name: 'results_shared', channel: 'webshare' });
    } catch {
      /* cancelled */
    }
  };

  return (
    <section className="mt-10 rounded-card border border-line bg-surface p-4 sm:p-5" aria-labelledby="share-h" data-testid="share">
      <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-center">
        {imgOk && (
          <a href={image} target="_blank" rel="noopener" className="block overflow-hidden rounded-chip border border-line bg-raised" aria-label="Open the share image">
            <img src={image} width={1200} height={630} alt="" loading="lazy" decoding="async" className="aspect-[1200/630] h-auto w-full" onError={() => setImgOk(false)} />
          </a>
        )}
        <div className={imgOk ? '' : 'md:col-span-2'}>
          <h3 id="share-h" className="cond text-heading uppercase">
            {shared ? 'Share this ranking' : 'Share your ranking'}
          </h3>
          <p className="mt-1 text-[0.9375rem] leading-6 text-fg-muted">
            The link rebuilds this exact top 25 and bracket. Nothing about you is stored.
          </p>
          <div className="mt-3 flex items-stretch gap-2">
            <label className="sr-only" htmlFor="share-url">
              Link to this ranking
            </label>
            <input
              id="share-url"
              ref={field}
              readOnly
              value={url || path}
              onFocus={(e) => e.currentTarget.select()}
              className="cond min-w-0 flex-1 rounded-chip border border-control bg-page px-3 text-[0.9375rem] font-semibold tracking-[0.02em] text-fg-muted"
              data-testid="share-url"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {canShare && (
              <button type="button" className="btn btn-primary" onClick={webShare}>
                <ShareIcon />
                Share
              </button>
            )}
            <button type="button" className={`btn ${canShare ? 'btn-secondary' : 'btn-primary'}`} onClick={copy} data-testid="copy-link">
              <LinkIcon />
              <span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>
            </button>
            <a className="btn btn-secondary" href={image} download={`top25-${code.slice(0, 8)}.png`} onClick={() => track({ name: 'results_shared', channel: 'image' })}>
              <ImageIcon />
              Save image
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
