import { useGameStore } from './store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Must mock AsyncStorage before it is required by the store
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// We should also mock any heavy visual or non-node modules used in the store if needed,
// but the async-storage mock is the critical one.
jest.mock('./components/Minimap', () => ({
  captureMinimapThumbnail: jest.fn(() => 'mock_thumbnail_base64')
}));

describe('Dam It! Beavertown - Save System (Zustand Store)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    
    // Reset store before each test
    useGameStore.setState({
      gameState: 'start_menu',
      inventory: { sticks: 0, mud: 0 },
      rainIntensity: 0,
      playerPosition: [0, 5, 0],
      placedBlocks: [],
      stats: {
        mudDug: 0, mudPatted: 0, treesDowned: 0, sticksPlaced: 0,
        massiveTreesFelled: 0, maxWaterCoverage: 0, snacksEaten: 0,
      },
      dayNumber: 1
    } as any);
  });

  it('should initialize cleanly', () => {
    const state = useGameStore.getState();
    expect(state.gameState).toBe('start_menu');
    expect(state.inventory.sticks).toBe(0);
  });

  describe('Multi-Slot Save/Load flows', () => {
    it('creates a new save slot with capture fallbacks and updates the index', async () => {
      const store = useGameStore.getState();
      
      // Simulate some progress
      useGameStore.setState({ dayNumber: 42 });

      // Action: save under a specific ID
      await store.saveGame('test_save_slot_1');

      // Verify the index was updated
      const slots = await store.getSaveSlots();
      expect(slots.length).toBe(1);
      expect(slots[0].id).toBe('test_save_slot_1');
      expect(slots[0].stats.dayNumber).toBe(42);

      // Verify the payload exists in storage
      const payloadStr = await AsyncStorage.getItem('beavertown_slot_test_save_slot_1_base');
      expect(payloadStr).toBeTruthy();
      const payload = JSON.parse(payloadStr!);
      expect(payload.dayNumber).toBe(42);
    });

    it('loads a previously saved game correctly into the store state', async () => {
      const store = useGameStore.getState();
      
      // Save game with modified state
      useGameStore.setState({ 
        inventory: { sticks: 99, mud: 12 },
        dayNumber: 7
      });
      await store.saveGame('slot_to_load');

      // Reset store to simulate a fresh app open
      useGameStore.setState({ 
        inventory: { sticks: 0, mud: 0 },
        dayNumber: 1
      });

      // Assert reset
      expect(useGameStore.getState().dayNumber).toBe(1);

      // Load it back
      await store.loadGame('slot_to_load');

      // Verify the state rehydrated correctly
      const loadedState = useGameStore.getState();
      expect(loadedState.inventory.sticks).toBe(99);
      expect(loadedState.inventory.mud).toBe(12);
      expect(loadedState.dayNumber).toBe(7);
      expect(loadedState.gameState).toBe('paused'); // Loading pauses the game
    });

    it('overwrites an existing slot instead of creating a duplicate index entry', async () => {
      const store = useGameStore.getState();
      
      // First save
      useGameStore.setState({ dayNumber: 1 });
      await store.saveGame('existing_slot');

      // Let some time pass (simulated)
      let slots = await store.getSaveSlots();
      expect(slots.length).toBe(1);

      // Second save (overwrite)
      useGameStore.setState({ dayNumber: 2 });
      await store.saveGame('existing_slot');

      // Verify index length is still 1
      slots = await store.getSaveSlots();
      expect(slots.length).toBe(1);
      expect(slots[0].stats.dayNumber).toBe(2);
    });

    it('can delete a slot successfully', async () => {
      const store = useGameStore.getState();
      
      // Create two saves
      await store.saveGame('slotA');
      await store.saveGame('slotB');

      // Verify lengths
      let slots = await store.getSaveSlots();
      expect(slots.length).toBe(2);

      // Delete slotA
      await store.deleteSlot('slotA');

      slots = await store.getSaveSlots();
      expect(slots.length).toBe(1);
      expect(slots[0].id).toBe('slotB');
      
      // Verify the payload key was actually cleared
      const payloadStr = await AsyncStorage.getItem('beavertown_slot_slotA');
      expect(payloadStr).toBeNull();
    });
    it('gracefully deep merges incomplete/legacy saves with missing fresh fields', async () => {
      // Simulate loading a save file that lacks newer fields (like snacksEaten in stats)
      const incompletePayload = {
        inventory: { sticks: 5 }, // missing mud
        stats: { treesDowned: 1 }, // completely missing all other stats including snacksEaten
        settings: { physicsSubsteps: 8 }, // missing showStatsOverlay, etc
        playerPosition: [1, 2, 3],
        dayNumber: 3
        // Notice it completely omits everything else (logs, placedBlocks, timeOfDay)
      };
      
      await AsyncStorage.setItem('beavertown_slot_v1_save', JSON.stringify(incompletePayload));
      
      // Load it back
      await useGameStore.getState().loadGame('v1_save');
      
      const loadedState = useGameStore.getState();
      
      // Values present in the payload should be loaded
      expect(loadedState.inventory.sticks).toBe(5);
      expect(loadedState.stats.treesDowned).toBe(1);
      expect(loadedState.settings.physicsSubsteps).toBe(8);
      expect(loadedState.playerPosition).toEqual([1, 2, 3]);
      expect(loadedState.dayNumber).toBe(3);
      
      // Missing fields should safely fallback to the new code defaults
      // instead of undefined/crashing!
      expect(loadedState.inventory.mud).toBe(0); // Safely assumed 0
      expect(loadedState.stats.snacksEaten).toBe(0); // Safe deep fallback
      expect(loadedState.settings.showStatsOverlay).toBe(false); // Safe deep fallback
      expect(loadedState.draggableLogs).toEqual([]);
      expect(loadedState.timeOfDay).toBe(0);
    });

  });

  describe('Legacy Save Migration', () => {
    it('lazily migrates a solitary legacy save to the multi-slot index', async () => {
      // Simulate legacy user data floating around in AsyncStorage
      const legacyPayload = {
        inventory: { sticks: 50, mud: 50 },
        stats: { treesDowned: 13, sticksPlaced: 42, maxWaterCoverage: 5 },
        dayNumber: 5
      };
      await AsyncStorage.setItem('beavertown_save', JSON.stringify(legacyPayload));

      // Trigger the lazy getSaveSlots fetch (which triggers migration internal check)
      const slots = await useGameStore.getState().getSaveSlots();
      
      expect(slots.length).toBe(1);
      const migratedSlot = slots[0];
      expect(migratedSlot.id).toMatch(/^migrated_/);
      expect(migratedSlot.stats.treesDowned).toBe(13);
      expect(migratedSlot.stats.sticksPlaced).toBe(42);

      // Check legacy key was scrubbed
      const remainingLegacy = await AsyncStorage.getItem('beavertown_save');
      expect(remainingLegacy).toBeNull();

      // Check it properly stored the newly formatted payload
      const loadedPayloadStr = await AsyncStorage.getItem('beavertown_slot_' + migratedSlot.id);
      expect(loadedPayloadStr).toBeTruthy();
      expect(JSON.parse(loadedPayloadStr!).inventory.sticks).toBe(50);
    });
  });
});

