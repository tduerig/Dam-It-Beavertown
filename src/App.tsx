import { View, StyleSheet } from 'react-native';
import { Game } from './components/Game';
import { UI } from './components/UI';

export default function App() {
  return (
    <View style={styles.container}>
      <Game />
      <UI />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#bae6fd', // tailwind sky-200 equivalent
    overflow: 'hidden',
  }
});
