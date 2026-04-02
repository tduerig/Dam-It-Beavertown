import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export function useKeyboard() {
  const [keys, setKeys] = useState<{ [key: string]: boolean }>({});

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      setKeys((keys) => ({ ...keys, [e.code]: true }));
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      setKeys((keys) => ({ ...keys, [e.code]: false }));
    };

    if (Platform.OS === 'web') {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
      };
    }
  }, []);

  return keys;
}
