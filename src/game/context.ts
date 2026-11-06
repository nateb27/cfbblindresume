/** React access to the per-island Zustand store. */
import { createContext, useContext } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { GameData } from '@lib/game-data';
import type { GameStore } from './store';

export const StoreContext = createContext<StoreApi<GameStore> | null>(null);

/** Select from the game store (re-renders only when the selected value changes). */
export function useGame<T>(selector: (s: GameStore) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useGame outside the game StoreContext');
  return useStore(store, selector);
}

/** The store API itself, for actions in event handlers. */
export function useGameApi(): StoreApi<GameStore> {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useGameApi outside the game StoreContext');
  return store;
}

/** Game data; only call where the phase guarantees it is loaded. */
export function useGameData(): GameData {
  const gd = useGame((s) => s.gd);
  if (!gd) throw new Error('game data not loaded');
  return gd;
}
