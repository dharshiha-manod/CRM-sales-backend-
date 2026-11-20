import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius } from '../lib/theme';

type AppButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'dangerSoft' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

const LABEL_COLOR = { primary: '#fff', danger: '#fff', secondary: colors.brand, ghost: colors.brand, dangerSoft: colors.danger } as const;

export function AppButton({ title, onPress, variant = 'primary', loading = false, disabled = false, compact = false, style }: AppButtonProps) {
  const inactive = disabled || loading;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      activeOpacity={0.8}
      disabled={inactive}
      onPress={onPress}
      style={[styles.button, compact && styles.compact, styles[variant], inactive && styles.disabled, style]}
    >
      {loading ? <ActivityIndicator color={LABEL_COLOR[variant]} /> : <Text style={[styles.label, compact && styles.compactLabel, { color: LABEL_COLOR[variant] }]}>{title}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 50, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  compact: { minHeight: 38, paddingVertical: 6, paddingHorizontal: 14 },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: '#bfdbfe' },
  danger: { backgroundColor: colors.danger },
  dangerSoft: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: '#fecaca' },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.5 },
  label: { fontSize: 16, fontWeight: '700' },
  compactLabel: { fontSize: 14 },
});
