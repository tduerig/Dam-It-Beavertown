import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable } from 'react-native';
import { useGameStore } from '../store';
import { Hammer, Droplets, TreePine, Download, Upload, CloudRain, ArrowUp, ArrowDown } from 'lucide-react-native';
import { Minimap } from './Minimap';
import { ElevationGauge } from './ElevationGauge';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export function UI() {
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

  // Left side screen pan for Movement
  const leftPan = Gesture.Pan()
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
      setVirtualJoystick(dx / maxDist, dy / maxDist);
    })
    .onEnd(() => {
      setVirtualJoystick(0, 0);
    });

  // Right side screen pan for Camera
  const rightPan = Gesture.Pan()
    .onUpdate((e) => {
      const maxDist = 100;
      let dx = e.translationX;
      let dy = e.translationY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) {
        dx = (dx / dist) * maxDist;
        dy = (dy / dist) * maxDist;
      }
      setVirtualCamera(dx / maxDist, dy / maxDist);
    })
    .onEnd(() => {
      setVirtualCamera(0, 0);
    });

  // Tap for jumping like a dolphin
  const doubleTapJump = Gesture.Tap()
    .numberOfTaps(2)
    .onStart(() => {
      setVirtualButton('jump', true);
      setTimeout(() => setVirtualButton('jump', false), 200);
    });

  const gestureComposerLeft = Gesture.Simultaneous(leftPan, doubleTapJump);
  const gestureComposerRight = Gesture.Simultaneous(rightPan, doubleTapJump);

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Mobile Gesture Overlay */}
      {isMobile && (
        <View style={styles.gestureOverlay} pointerEvents="box-none">
          <GestureDetector gesture={gestureComposerLeft}>
            <View style={styles.touchHalf} />
          </GestureDetector>
          <GestureDetector gesture={gestureComposerRight}>
            <View style={styles.touchHalf} />
          </GestureDetector>
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
        <View style={styles.mobileActions} pointerEvents="box-none">
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
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
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
  mobileActions: {
    position: 'absolute',
    bottom: 40,
    right: 20,
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
  },
  controlsHighlight: {
    color: '#facc15', // yellow-400
  }
});
