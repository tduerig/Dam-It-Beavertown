import { View, Text, StyleSheet } from 'react-native';
import { useEffect, useState } from 'react';
import { useGameStore } from '../store';

export function ElevationGauge() {
  const [elevationPercent, setElevationPercent] = useState(50);
  
  useEffect(() => {
    let intervalId = setInterval(() => {
      const zPos = useGameStore.getState().playerPosition[2];
      const percent = Math.max(0, Math.min(100, ((zPos + 300) / 600) * 100));
      setElevationPercent(Math.round(percent));
    }, 100);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.header}>
        <Text style={styles.headerText}>ALT</Text>
      </View>
      <View style={styles.gaugeContainer}>
        {/* React Native linear gradient requires expo-linear-gradient, using solid colors or simpler approach for now */}
        <View style={[styles.biomeBackground, { height: '25%', backgroundColor: '#ffffff' }]} />
        <View style={[styles.biomeBackground, { height: '25%', backgroundColor: '#888888', top: '25%' }]} />
        <View style={[styles.biomeBackground, { height: '25%', backgroundColor: '#4a5d23', top: '50%' }]} />
        <View style={[styles.biomeBackground, { height: '25%', backgroundColor: '#1e3a8a', top: '75%' }]} />
        
        <Text style={styles.labelTop}>PEAK</Text>
        <Text style={styles.labelBottom}>SEA</Text>
        
        {/* Player Marker */}
        <View 
          style={[
            styles.marker, 
            { top: `${elevationPercent}%` }
          ]} 
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 16,
    left: 184, // 16px edge margin + 160px minimap width + 8px gap
    width: 48,
    height: 160,
    borderWidth: 4,
    borderColor: '#78350f', // amber-900
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(254, 243, 199, 0.5)', // amber-100/50
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  header: {
    backgroundColor: '#78350f',
    paddingVertical: 4,
    alignItems: 'center',
    zIndex: 10,
  },
  headerText: {
    color: '#fef3c7',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  gaugeContainer: {
    flex: 1,
    position: 'relative',
    width: '100%',
  },
  biomeBackground: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  labelTop: {
    position: 'absolute',
    top: 4,
    left: 4,
    fontSize: 8,
    fontWeight: 'bold',
    color: 'rgba(0,0,0,0.5)',
    zIndex: 2,
  },
  labelBottom: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    fontSize: 8,
    fontWeight: 'bold',
    color: 'rgba(255,255,255,0.8)',
    zIndex: 2,
  },
  marker: {
    position: 'absolute',
    left: 0,
    width: '100%',
    height: 4,
    backgroundColor: '#ef4444', // red-500
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
    marginTop: -2,
    zIndex: 5,
  }
});
