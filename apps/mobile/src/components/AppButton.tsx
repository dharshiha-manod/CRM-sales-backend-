import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';

type AppButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({ title, onPress, variant = 'primary', loading = false, disabled = false, style }: AppButtonProps) {
  const inactive = disabled || loading;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      activeOpacity={0.8}
      disabled={inactive}
      onPress={onPress}
      style={[styles.button, styles[variant], inactive && styles.disabled, style]}
    >
      {loading ? <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? '#0f172a' : '#fff'} /> : <Text style={[styles.label, (variant === 'secondary' || variant === 'ghost') && styles.darkLabel]}>{title}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 40, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#0f172a' },
  secondary: { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1' },
  danger: { backgroundColor: '#b91c1c' },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.5 },
  label: { color: '#fff', fontSize: 14, fontWeight: '700' },
  darkLabel: { color: '#0f172a' },
});
