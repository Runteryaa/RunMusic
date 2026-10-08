import { StyleSheet, Text, View, TextInput } from 'react-native';
import { useStore } from '../store/useStore';

export default function SettingsScreen() {
  const { settings, updateSettings } = useStore();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Global Filters</Text>
      
      <View style={styles.settingRow}>
        <Text style={styles.label}>Min Track Length (seconds)</Text>
        <TextInput 
          style={styles.input} 
          keyboardType="numeric" 
          placeholder="e.g. 30" 
          value={settings.minLengthSec?.toString() || ''}
          onChangeText={(val) => updateSettings({ minLengthSec: val ? parseInt(val, 10) : null })}
        />
      </View>
      
      <View style={styles.settingRow}>
        <Text style={styles.label}>Max Track Length (seconds)</Text>
        <TextInput 
          style={styles.input} 
          keyboardType="numeric" 
          placeholder="e.g. 600" 
          value={settings.maxLengthSec?.toString() || ''}
          onChangeText={(val) => updateSettings({ maxLengthSec: val ? parseInt(val, 10) : null })}
        />
      </View>
      
      <View style={styles.settingRow}>
        <Text style={styles.label}>Min File Size (MB)</Text>
        <TextInput 
          style={styles.input} 
          keyboardType="numeric" 
          placeholder="e.g. 1" 
          value={settings.minSizeMB?.toString() || ''}
          onChangeText={(val) => updateSettings({ minSizeMB: val ? parseFloat(val) : null })}
        />
      </View>
      
      <View style={styles.settingRow}>
        <Text style={styles.label}>Max File Size (MB)</Text>
        <TextInput 
          style={styles.input} 
          keyboardType="numeric" 
          placeholder="e.g. 50" 
          value={settings.maxSizeMB?.toString() || ''}
          onChangeText={(val) => updateSettings({ maxSizeMB: val ? parseFloat(val) : null })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  settingRow: {
    marginBottom: 15,
  },
  label: {
    fontSize: 16,
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
  },
});
