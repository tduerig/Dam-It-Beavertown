import React from 'react';
import { View, Text } from 'react-native';

export default function NpcSimFallback() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' }}>
      <Text style={{ color: '#fff' }}>NPC Sandbox is only available on Web (http://localhost:8081/npc-sim)</Text>
    </View>
  );
}
