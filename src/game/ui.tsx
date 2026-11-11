/** Shared presentational pieces of the game island (DESIGN.md §7-8 classes). */
import type { CSSProperties, ReactNode } from 'react';
import type { GameTeam } from '@lib/game-data';
import { teamVars } from '../styles/tokens';

export type BlockSize = 'tile' | 'row' | 'reveal' | 'slot';

// Names never truncate where space is tight (320-390px phones): rows and reveal slabs wrap to a
// second line instead (rows grow; the reveal slab fits two 20px lines). Bracket slots are full width
// on phones and wide columns on desktop, so they always fit one line.
const HEIGHT: Record<BlockSize, string> = { tile: 'min-h-16', row: 'min-h-12', reveal: 'h-14', slot: 'h-9' };
const NAME: Record<BlockSize, string> = {
  tile: 'text-team line-clamp-2 hyphens-auto [overflow-wrap:anywhere]',
  row: 'py-1 text-[1.125rem] leading-[1.125rem] [overflow-wrap:anywhere]',
  reveal: 'text-heading line-clamp-2 max-sm:text-[1.25rem] max-sm:leading-5 [overflow-wrap:anywhere]',
  slot: 'text-[0.9375rem] leading-4 truncate',
};
// Seed plates have one fixed width per size (no padding), so a two-digit seed never pushes its
// name right of the one above it ("Alabama" over "Boise State" in a bracket box).
const PLATE: Record<BlockSize, string> = {
  tile: 'w-10 px-0 text-[1.375rem]',
  row: 'w-10 px-0 text-[1.375rem]',
  reveal: 'min-w-12 text-[1.75rem]',
  slot: 'w-10 px-0 text-[1.125rem]',
};
// Meta (the record): right of the name; on tiles it prints under the name (game.css), so the
// name keeps the label's full width.
const META: Record<BlockSize, string> = {
  tile: 'pl-2.5 text-[0.8125rem] leading-4',
  row: 'ml-2 text-[1.0625rem]',
  reveal: 'ml-auto pl-3 text-[1.0625rem]',
  slot: 'ml-2 text-[1.0625rem]',
};

export function teamStyle(team: Pick<GameTeam, 'colors'>): CSSProperties {
  return teamVars(team.colors) as CSSProperties;
}

/**
 * Lower-third team block: seed plate + condensed caps name (+ meta) on the team's primary color with
 * the 4px secondary rule. Links to the team page unless `link` is false (inside the reveal, where a
 * tap means "continue").
 */
export function TeamBlock(props: {
  slug: string;
  team: GameTeam;
  seed?: number | string;
  size: BlockSize;
  meta?: string;
  /** Partial runs: a team that never came up (provisional look, game.css). */
  unseen?: boolean;
  link?: boolean;
  className?: string;
  label?: string;
}) {
  const { slug, team, seed, size, meta, unseen, link = true, className = '', label } = props;
  const inner = (
    <>
      {seed !== undefined && <span className={`seed-plate ${PLATE[size]}`}>{seed}</span>}
      {/* In the reveal the name shrink-wraps its text, so the redaction bar over it is the name's own width. */}
      <span className={`team-name ${seed !== undefined ? 'pl-2.5' : 'pl-3'} min-w-0 ${size === 'reveal' ? 'flex-initial' : 'flex-1'} ${NAME[size]}`}>{team.name}</span>
      {meta && <span className={`team-meta flex-none ${META[size]}`}>{meta}</span>}
    </>
  );
  const cls = `team-block ${HEIGHT[size]} pr-3 ${className}`;
  const field = { 'data-unseen': unseen ? '' : undefined, 'data-meta': meta ? '' : undefined };
  // Index tab (seed plate + name typed on paper) for dense lists; cover (full team colour) for the reveal.
  const variant = seed !== undefined && size !== 'reveal' ? 'tab' : 'cover';
  return link ? (
    <a href={`/teams/${slug}`} className={cls} style={teamStyle(team)} aria-label={label} data-variant={variant} data-size={size} {...field}>
      {inner}
    </a>
  ) : (
    <div className={cls} style={teamStyle(team)} aria-label={label} data-variant={variant} data-size={size} {...field}>
      {inner}
    </div>
  );
}

/** Inline team mark (12x20 block + rule + caps name), linking to the team page. */
export function TeamChip({ slug, team, children }: { slug: string; team: GameTeam; children?: ReactNode }) {
  return (
    <a href={`/teams/${slug}`} className="team-chip hover:underline hover:decoration-2 hover:underline-offset-4" style={teamStyle(team)}>
      {team.name}
      {children}
    </a>
  );
}

/** "Ratings: FEI by Brian Fremeau" (SPEC house rule 8), opening in a new tab so a run is never lost. */
export function FeiCredit({ url }: { url: string }) {
  return (
    <>
      Ratings:{' '}
      <a className="link whitespace-nowrap" href={url} target="_blank" rel="noopener">
        FEI by Brian Fremeau
      </a>
    </>
  );
}

/** Toggle switch (`.switch`): a button with role="switch". */
export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; className?: string; testid?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      className={`switch text-left ${props.className ?? ''}`}
      data-testid={props.testid}
      onClick={(e) => {
        e.stopPropagation();
        props.onChange(!props.checked);
      }}
    >
      <span className="switch-track" aria-hidden="true" />
      {props.children}
    </button>
  );
}

export function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" className="flex-none">
      <path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function CrossIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" className="flex-none">
      <path d="M3 3l6 6M9 3L3 9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="flex-none">
      <path d="M5.5 3.5L2.5 6.5l3 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <path d="M3 6.5h6.25a3.75 3.75 0 010 7.5H7" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="flex-none">
      <path d="M2.5 8h10M8.5 3.5L13 8l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="flex-none">
      <path d="M6.5 9.5l3-3M7 4.5l1.25-1.25a2.65 2.65 0 013.75 3.75L10.75 8.25M9 11.5l-1.25 1.25A2.65 2.65 0 014 9l1.25-1.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="flex-none">
      <path d="M8 10V2.5M5 5.25L8 2.25l3 3M3.5 8.5v5h9v-5" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

export function ImageIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="flex-none">
      <path d="M2.5 3.5h11v9h-11z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 10.5l2.5-3 2 2 1.5-1.5 1.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
