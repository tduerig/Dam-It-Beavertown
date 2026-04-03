import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Platform, Pressable } from 'react-native';
import { useGameStore } from '../store';
import { Hammer, Droplets, TreePine, Download, Upload, CloudRain, ArrowUp, ArrowDown } from 'lucide-react-native';
import { Minimap } from './Minimap';
import { ElevationGauge } from './ElevationGauge';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export function UI() {
  const gameState = useGameStore((state) => state.gameState);
  const setGameState = useGameStore((state) => state.setGameState);
  
  // React 19 RN-Web SyntheticEvent Bypass
  const playButtonRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS === 'web' && playButtonRef.current) {
      const node = playButtonRef.current as HTMLElement;
      const handler = () => setGameState('playing');
      node.addEventListener('click', handler);
      // Fallback for pointer environments
      node.addEventListener('pointerdown', handler);
      return () => {
        node.removeEventListener('click', handler);
        node.removeEventListener('pointerdown', handler);
      };
    }
  }, [setGameState]);
  const inventory = useGameStore((state) => state.inventory);
  const rainIntensity = useGameStore((state) => state.rainIntensity);
  const saveGame = useGameStore((state) => state.saveGame);
  const loadGame = useGameStore((state) => state.loadGame);

  const setVirtualJoystick = useGameStore((state) => state.setVirtualJoystick);
  const setVirtualCamera = useGameStore((state) => state.setVirtualCamera);
  const setVirtualButton = useGameStore((state) => state.setVirtualButton);
  
  const [isMobile, setIsMobile] = useState(Platform.OS !== 'web');

  useEffect(() => {
    if (Platform.OS === 'web') {
      const checkMobile = () => {
        setIsMobile(window.innerWidth <= 1024 || 'ontouchstart' in window);
      };
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }
  }, []);

  const [leftStick, setLeftStick] = useState({ x: 0, y: 0, active: false });
  const [rightStick, setRightStick] = useState({ x: 0, y: 0, active: false });

  // Left side screen pan for Movement
  const leftPan = Gesture.Pan()
    .runOnJS(true)
    .onBegin(() => {
      setLeftStick(prev => ({ ...prev, active: true }));
    })
    .onUpdate((e) => {
      // Normalize to roughly -1 to 1 based on a 100px radius
      const maxDist = 100;
      let dx = e.translationX;
      let dy = e.translationY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) {
        dx = (dx / dist) * maxDist;
        dy = (dy / dist) * maxDist;
      }
      setLeftStick({ x: dx, y: dy, active: true });
      setVirtualJoystick(dx / maxDist, dy / maxDist);
    })
    .onFinalize(() => {
      setLeftStick({ x: 0, y: 0, active: false });
      setVirtualJoystick(0, 0);
    });

  // Right side screen pan for Camera
  const rightPan = Gesture.Pan()
    .runOnJS(true)
    .onBegin(() => {
      setRightStick(prev => ({ ...prev, active: true }));
    })
    .onUpdate((e) => {
      const maxDist = 100;
      let dx = e.translationX;
      let dy = e.translationY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) {
        dx = (dx / dist) * maxDist;
        dy = (dy / dist) * maxDist;
      }
      setRightStick({ x: dx, y: dy, active: true });
      setVirtualCamera(dx / maxDist, dy / maxDist);
    })
    .onFinalize(() => {
      setRightStick({ x: 0, y: 0, active: false });
      setVirtualCamera(0, 0);
    });

  // Tap for jumping like a dolphin
  const doubleTapJump = Gesture.Tap()
    .runOnJS(true)
    .numberOfTaps(2)
    .onStart(() => {
      setVirtualButton('jump', true);
      setTimeout(() => setVirtualButton('jump', false), 200);
    });

  const gestureComposerLeft = Gesture.Simultaneous(leftPan, doubleTapJump);
  const gestureComposerRight = Gesture.Simultaneous(rightPan, doubleTapJump);

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Start Menu Overlay */}
      {gameState === 'menu' && (
        <View style={styles.startMenu} pointerEvents="auto">
          <Text style={styles.title}>Dam It! Beavertown</Text>
          <Text style={styles.subtitle}>Protect the ecosystem. Build the ultimate dam.</Text>
          
          <Pressable 
            ref={playButtonRef}
            style={({ pressed }) => [styles.startButton, pressed && styles.startButtonPressed]}
            onPress={() => setGameState('playing')}
          >
            <Text style={styles.startButtonText}>PLAY NOW</Text>
          </Pressable>
          
          <Pressable style={styles.loadButton} onPress={() => loadGame()}>
            <Text style={styles.loadButtonText}>Load Saved Map</Text>
          </Pressable>
        </View>
      )}

      {/* Main Game UI Overlay */}
      {gameState === 'playing' && (
        <View style={styles.hudContainer} pointerEvents="box-none">
          {/* Mobile Gesture Overlay */}
          {isMobile && (
        <View style={styles.gestureOverlay} pointerEvents="box-none">
          <GestureDetector gesture={gestureComposerLeft}>
            <View style={styles.touchHalf} pointerEvents="auto" />
          </GestureDetector>
          <GestureDetector gesture={gestureComposerRight}>
            <View style={styles.touchHalf} pointerEvents="auto" />
          </GestureDetector>

          {/* Static Left Joystick */}
          <View style={[styles.joystickBase, styles.joystickLeft]} pointerEvents="none">
            <View style={[styles.joystickNub, { transform: [{ translateX: leftStick.x }, { translateY: leftStick.y }], opacity: leftStick.active ? 0.9 : 0.4 }]} />
          </View>
          
          {/* Static Right Joystick */}
          <View style={[styles.joystickBase, styles.joystickRight]} pointerEvents="none">
            <View style={[styles.joystickNub, { transform: [{ translateX: rightStick.x }, { translateY: rightStick.y }], opacity: rightStick.active ? 0.9 : 0.4 }]} />
          </View>
        </View>
      )}

      {/* Crosshair */}
      <View style={styles.crosshair} pointerEvents="none" />

      {/* HUD: Inventory & Environment */}
      <View style={styles.hudTopLeft} pointerEvents="box-none">
        <View style={styles.statsBox}>
          <View style={styles.statRow}>
            <TreePine color="#d97706" size={24} />
            <Text style={styles.statText}>{inventory.sticks}</Text>
          </View>
          <View style={styles.statRow}>
            <Droplets color="#78350f" size={24} />
            <Text style={styles.statText}>{inventory.mud}</Text>
          </View>
          <View style={[styles.statRow, styles.borderLeft]}>
            <CloudRain color={rainIntensity > 0 ? '#60a5fa' : '#6b7280'} size={24} />
            <Text style={styles.statText}>{Math.round(rainIntensity * 100)}%</Text>
          </View>
        </View>
      </View>

      {/* Action Buttons Overlay for Mobile specific interactions */}
      {isMobile && (
        <>
          <View style={styles.mobileActionsLeft} pointerEvents="box-none">
            {/* Jump */}
            <Pressable
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
              onPressIn={() => setVirtualButton('jump', true)}
              onPressOut={() => setVirtualButton('jump', false)}
            >
              <ArrowUp color="#fff" size={24} />
            </Pressable>
            {/* Crouch/Dive */}
            <Pressable
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
              onPressIn={() => setVirtualButton('crouch', true)}
              onPressOut={() => setVirtualButton('crouch', false)}
            >
              <ArrowDown color="#fff" size={24} />
            </Pressable>
          </View>

          <View style={styles.mobileActionsRight} pointerEvents="box-none">
            {/* Action 1 */}
            <Pressable
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
              onPressIn={() => setVirtualButton('action1', true)}
              onPressOut={() => setVirtualButton('action1', false)}
            >
              <Hammer color="#fff" size={24} />
            </Pressable>
            {/* Action 2 */}
            <Pressable
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
              onPressIn={() => setVirtualButton('action2', true)}
              onPressOut={() => setVirtualButton('action2', false)}
            >
              <TreePine color="#fff" size={24} />
            </Pressable>
            {/* Action 3 */}
            <Pressable
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
              onPressIn={() => setVirtualButton('action3', true)}
              onPressOut={() => setVirtualButton('action3', false)}
            >
              <Droplets color="#fff" size={24} />
            </Pressable>
          </View>
        </>
      )}

      {/* Desktop Controls Helper */}
      {!isMobile && (
        <View style={styles.desktopControls} pointerEvents="none">
          <Text style={styles.controlsTitle}>Controls</Text>
          <Text style={styles.controlsText}><Text style={styles.controlsHighlight}>WASD</Text> - Move</Text>
          <Text style={styles.controlsText}><Text style={styles.controlsHighlight}>Arrows</Text> - Rotate</Text>
          <Text style={styles.controlsText}><Text style={styles.controlsHighlight}>+/-</Text> - Rain</Text>
          <Text style={styles.controlsText}><Text style={styles.controlsHighlight}>SPACE</Text> - Jump</Text>
          <Text style={styles.controlsText}><Text style={styles.controlsHighlight}>E</Text> - Collect</Text>
          <Text style={styles.controlsText}><Text style={styles.controlsHighlight}>F/G</Text> - Place Stick/Mud</Text>
        </View>
      )}

      {/* Map & Gauge */}
      <ElevationGauge />
      <Minimap />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  hudContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  startMenu: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(56, 189, 248, 0.85)', // translucent sky blue
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  title: {
    fontSize: 48,
    fontWeight: '900',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
    marginBottom: 8,
    textAlign: 'center'
  },
  subtitle: {
    fontSize: 18,
    color: '#0284c7', // darker blue
    fontWeight: '600',
    marginBottom: 48,
    textAlign: 'center'
  },
  startButton: {
    backgroundColor: '#16a34a', // lush green
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 32,
    shadowColor: '#000',
    shadowRadius: 6,
    marginBottom: 24,
    ...Platform.select({
      web: { zIndex: 9999, cursor: 'pointer' } as any,
    }),
  },
  startButtonPressed: {
    backgroundColor: '#15803d', // darker green
    transform: [{ scale: 0.95 }]
  },
  startButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 2,
  },
  loadButton: {
    padding: 12,
  },
  loadButtonText: {
    color: '#e0f2fe',
    fontSize: 16,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  gestureOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    zIndex: 1, // Be behind explicit buttons
  },
  touchHalf: {
    flex: 1,
    height: '100%',
  },
  crosshair: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 6,
    height: 6,
    marginLeft: -3,
    marginTop: -3,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 3,
  },
  hudTopLeft: {
    position: 'absolute',
    top: 40,
    left: 20,
    zIndex: 10,
  },
  statsBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  borderLeft: {
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255, 255, 255, 0.2)',
    paddingLeft: 16,
    marginRight: 0,
  },
  statText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  mobileActionsLeft: {
    position: 'absolute',
    bottom: 180, // Moved up to clear joystick
    left: 40,
    flexDirection: 'row',
    gap: 12,
    zIndex: 10,
  },
  mobileActionsRight: {
    position: 'absolute',
    bottom: 180, // Moved up to clear joystick
    right: 40,
    flexDirection: 'row',
    gap: 12,
    zIndex: 10,
  },
  actionButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  desktopControls: {
    position: 'absolute',
    top: 40,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 16,
    borderRadius: 8,
  },
  controlsTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  controlsText: {
    color: '#fff',
    fontSize: 12,
    marginBottom: 4,
    opacity: 0.8,
  },
  controlsHighlight: {
    color: '#facc15', // yellow-400
  },
  joystickBase: {
    position: 'absolute',
    bottom: 40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  joystickLeft: {
    left: 40,
  },
  joystickRight: {
    right: 40,
  },
  joystickNub: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
});
