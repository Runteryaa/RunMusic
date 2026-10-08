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
          placeholderTextColor="#71717a"
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
          placeholderTextColor="#71717a"
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
          placeholderTextColor="#71717a"
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
          placeholderTextColor="#71717a"
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
    backgroundColor: '#121212',
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 20,
  },
  settingRow: {
    marginBottom: 18,
  },
  label: {
    fontSize: 14,
    color: '#a1a1aa',
    marginBottom: 8,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#18181b',
    color: '#ffffff',
    fontSize: 15,
  },
});
