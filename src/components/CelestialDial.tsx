import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Sun, Moon } from 'lucide-react-native';
import { useGameStore } from '../store';

export function CelestialDial() {
  const [timeOfDay, setTimeOfDay] = useState(0);

  // Subscribe to timeOfDay but throttle updates slightly for UI
  useEffect(() => {
    const unsub = useGameStore.subscribe((state) => {
        // UI can update every ~500ms since orbital is slow
        setTimeOfDay(state.timeOfDay);
    });
    return unsub;
  }, []);

  // Map 0 -> 1 value to a CSS transform arch
  const rotationDegrees = (timeOfDay * 360) - 90; // -90 aligns 0% to the left horizon
  
  let phaseName = "DAY";
  let color = "#fbbf24";
  
  if (timeOfDay >= 0.75 && timeOfDay < 0.85) { phaseName = "DUSK"; color = "#f97316"; }
  else if (timeOfDay >= 0.85 && timeOfDay < 0.95) { phaseName = "NIGHT"; color = "#94a3b8"; }
  else if (timeOfDay >= 0.95) { phaseName = "DAWN"; color = "#38bdf8"; }

  return (
    <View style={styles.container}>
      <View style={styles.dialFrame}>
        <View style={[styles.rotator, { transform: [{ rotate: `${rotationDegrees}deg` }] }]}>
          {/* Sun is at 0 degrees relative to rotator */}
          <View style={[styles.iconWrapper, { transform: [{ translateX: -40 }, { rotate: `-${rotationDegrees}deg` }] }]}>
            <Sun size={20} color="#fbbf24" fill="#fbbf24" strokeWidth={2.5} />
          </View>
          {/* Moon is physically offset on the disc */}
          <View style={[styles.iconWrapper, { transform: [{ translateX: 40 }, { rotate: `-${rotationDegrees}deg` }] }]}>
            <Moon size={20} color="#94a3b8" fill="#e2e8f0" strokeWidth={2.5} />
          </View>
        </View>
        {/* Horizon Line Cover */}
        <View style={styles.horizonCover} />
      </View>
      <Text style={[styles.phaseText, { color }]}>{phaseName}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 20,
    right: 200,
    width: 100,
    height: 60,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3f3f46',
    overflow: 'hidden',
    paddingTop: 8,
    pointerEvents: 'none',
  },
  dialFrame: {
    width: 80,
    height: 40,
    borderRadius: 40,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rotator: {
    width: 80,
    height: 80,
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    top: 0,
  },
  iconWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
  },
  horizonCover: {
    position: 'absolute',
    bottom: -20,
    width: '100%',
    height: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderTopWidth: 1,
    borderTopColor: '#52525b',
  },
  phaseText: {
    position: 'absolute',
    bottom: 2,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  }
});
