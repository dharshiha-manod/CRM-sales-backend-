import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius } from '../lib/theme';

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
  const light = variant === 'secondary' || variant === 'ghost';
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      activeOpacity={0.8}
      disabled={inactive}
      onPress={onPress}
      style={[styles.button, styles[variant], inactive && styles.disabled, style]}
    >
      {loading ? <ActivityIndicator color={light ? colors.ink : '#fff'} /> : <Text style={[styles.label, light && styles.darkLabel]}>{title}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 46, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: '#bfdbfe' },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.5 },
  label: { color: '#fff', fontSize: 15, fontWeight: '700' },
  darkLabel: { color: colors.brand },
});