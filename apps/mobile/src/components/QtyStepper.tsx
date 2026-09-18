import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type QtyStepperProps = { value: number; onChange: (value: number) => void; min?: number };

export function QtyStepper({ value, onChange, min = 1 }: QtyStepperProps) {
  return (
    <View style={styles.stepper}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Decrease quantity" disabled={value <= min} onPress={() => onChange(value - 1)} style={[styles.control, value <= min && styles.disabled]}><Text style={styles.symbol}>-</Text></TouchableOpacity>
      <Text accessibilityLabel={`Quantity ${value}`} style={styles.value}>{value}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Increase quantity" onPress={() => onChange(value + 1)} style={styles.control}><Text style={styles.symbol}>+</Text></TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 999, overflow: 'hidden' },
  control: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
  symbol: { color: '#0f172a', fontSize: 20, fontWeight: '700' },
  value: { minWidth: 28, textAlign: 'center', color: '#0f172a', fontWeight: '700' },
});
