import test, { describe, beforeEach, it } from 'node:test';
import assert from 'node:assert';
import { useGameStore } from './store';

describe('useGameStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useGameStore.setState({
      gameState: 'start_menu',
      inventory: { sticks: 0, mud: 0 },
      rainIntensity: 0,
      playerPosition: [0, 5, 0],
      placedBlocks: [],
    } as any);
  });

  it('should verify initial state is strictly "start_menu"', () => {
    const state = useGameStore.getState();
    assert.strictEqual(state.gameState, 'start_menu');
    assert.strictEqual(state.inventory.sticks, 0);
    assert.strictEqual(state.inventory.mud, 0);
  });

  it('should update gameState to "playing"', () => {
    useGameStore.getState().setGameState('playing');
    const state = useGameStore.getState();
    assert.strictEqual(state.gameState, 'playing');
  });

  it('should update inventory sticks correctly', () => {
    useGameStore.setState((state) => ({
      inventory: { ...state.inventory, sticks: state.inventory.sticks + 1 }
    }));
    
    assert.strictEqual(useGameStore.getState().inventory.sticks, 1);
    assert.strictEqual(useGameStore.getState().inventory.mud, 0);
  });
});

