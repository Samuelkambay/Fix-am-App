import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text as RNText, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatLe } from '../money';
import { colors, font, radius, space, toneColors, TOUCH, type Tone } from './theme';

// ───────── Layout ─────────
export function Screen({
  children, scroll = true, refreshing, onRefresh, padded = true, footer, edges, style,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  /** Sticky bottom area for the main action (thumb reach). */
  footer?: ReactNode;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  style?: StyleProp<ViewStyle>;
}) {
  const inner = padded ? styles.padded : undefined;
  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges ?? ['left', 'right', 'bottom']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[inner, { paddingBottom: space.xxl }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.brand]} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Row({ children, style, gap = space.sm, wrap }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export function Stack({ children, gap = space.md, style, testID }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  return <View testID={testID} style={[{ gap }, style]}>{children}</View>;
}

export function Spacer({ size = space.lg }: { size?: number }) {
  return <View style={{ height: size }} />;
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.md }} />;
}

export function Card({ children, style, onPress, tone, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: Tone; testID?: string }) {
  const t = tone ? toneColors(tone) : null;
  const body = <View testID={testID} style={[styles.card, t && { backgroundColor: t.bg, borderColor: t.bg }, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
      {body}
    </Pressable>
  );
}

// ───────── Text ─────────
type TextProps = { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; center?: boolean; color?: string; testID?: string };

export function H1({ children, style, center, color }: TextProps) {
  return <RNText accessibilityRole="header" style={[styles.h1, center && styles.center, color ? { color } : null, style]}>{children}</RNText>;
}
export function H2({ children, style, center, color }: TextProps) {
  return <RNText accessibilityRole="header" style={[styles.h2, center && styles.center, color ? { color } : null, style]}>{children}</RNText>;
}
export function Body({ children, style, numberOfLines, center, color, testID }: TextProps) {
  return <RNText testID={testID} numberOfLines={numberOfLines} style={[styles.body, center && styles.center, color ? { color } : null, style]}>{children}</RNText>;
}
export function Muted({ children, style, numberOfLines, center }: TextProps) {
  return <RNText numberOfLines={numberOfLines} style={[styles.muted, center && styles.center, style]}>{children}</RNText>;
}
export function Label({ children, style }: TextProps) {
  return <RNText style={[styles.label, style]}>{children}</RNText>;
}
export function Strong({ children, style, color }: TextProps) {
  return <RNText style={[styles.body, { fontWeight: '700' }, color ? { color } : null, style]}>{children}</RNText>;
}

/** Leones, always formatted from minor units. */
export function Money({ minor, size = 'body', color, style, strike }: { minor: number | null | undefined; size?: 'body' | 'large' | 'title' | 'hero'; color?: string; style?: StyleProp<TextStyle>; strike?: boolean }) {
  const fs = size === 'hero' ? font.hero + 6 : size === 'title' ? font.title : size === 'large' ? font.large : font.body;
  return (
    <RNText style={[{ fontSize: fs, fontWeight: '800', color: color ?? colors.text }, strike && { textDecorationLine: 'line-through', color: colors.textMuted }, style]}>
      {formatLe(minor)}
    </RNText>
  );
}

// ───────── Buttons ─────────
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent' | 'pro';

export function Button({
  title, onPress, variant = 'primary', loading, disabled, icon, small, style, testID,
}: {
  title: string;
  onPress?: () => unknown;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const [busy, setBusy] = useState(false);
  const isLoading = loading || busy;
  const off = disabled || isLoading;
  const v = variantStyle(variant);
  const press = async () => {
    if (!onPress || off) return;
    const r = onPress();
    if (r && typeof (r as Promise<unknown>).then === "function") {
      setBusy(true);
      try {
        await r;
      } finally {
        setBusy(false);
      }
    }
  };
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: isLoading }}
      onPress={press}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        off && !isLoading && { backgroundColor: variant === 'ghost' || variant === 'secondary' ? colors.card : colors.disabled, borderColor: colors.disabled },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {isLoading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <RNText style={[styles.buttonText, small && { fontSize: font.body }, { color: off ? (variant === 'ghost' || variant === 'secondary' ? colors.disabled : colors.white) : v.fg }]}>
          {icon ? `${icon}  ` : ''}
          {title}
        </RNText>
      )}
    </Pressable>
  );
}

function variantStyle(v: ButtonVariant) {
  switch (v) {
    case 'secondary':
      return { bg: colors.card, fg: colors.brandDark, border: colors.brand };
    case 'danger':
      return { bg: colors.danger, fg: colors.white, border: colors.danger };
    case 'ghost':
      return { bg: 'transparent', fg: colors.brandDark, border: 'transparent' };
    case 'accent':
      return { bg: colors.accent, fg: colors.text, border: colors.accent };
    case 'pro':
      return { bg: colors.pro, fg: colors.white, border: colors.pro };
    default:
      return { bg: colors.brand, fg: colors.white, border: colors.brand };
  }
}

// ───────── Inputs ─────────
export function Field({
  label, hint, error, optional, optionalText = 'optional', ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null; optional?: boolean; optionalText?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Label>
        {label}
        {optional ? <RNText style={styles.optional}>{`  (${optionalText})`}</RNText> : null}
      </Label>
      <TextInput
        placeholderTextColor={colors.disabled}
        {...input}
        accessibilityLabel={label}
        style={[styles.input, input.multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: space.md }, error ? { borderColor: colors.danger } : null, input.style]}
      />
      {error ? <RNText style={styles.error}>{error}</RNText> : hint ? <Muted>{hint}</Muted> : null}
    </View>
  );
}

/** Large digit entry for 4-digit job codes and 6-digit OTPs. */
export function CodeInput({ value, onChange, length, label, testID, color }: { value: string; onChange: (v: string) => void; length: number; label?: string; testID?: string; color?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        testID={testID}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete={length === 6 ? 'sms-otp' : 'off'}
        textContentType={length === 6 ? 'oneTimeCode' : 'none'}
        maxLength={length}
        placeholder={'•'.repeat(length)}
        placeholderTextColor={colors.disabled}
        accessibilityLabel={label}
        style={[styles.codeInput, color ? { borderColor: color } : null]}
      />
    </View>
  );
}

/** A code the customer reads out loud: very big, spaced digits. */
export function BigCode({ code, tone = 'brand', label, hint, testID }: { code: string; tone?: Tone; label?: string; hint?: string; testID?: string }) {
  const t = toneColors(tone);
  return (
    <View style={[styles.bigCodeBox, { backgroundColor: t.bg, borderColor: t.fg }]}>
      {label ? <RNText style={[styles.label, { color: t.fg, textAlign: 'center' }]}>{label}</RNText> : null}
      <RNText testID={testID} selectable style={[styles.bigCode, { color: t.fg }]} accessibilityLabel={code.split('').join(' ')}>
        {code.split('').join(' ')}
      </RNText>
      {hint ? <RNText style={[styles.body, { textAlign: 'center', color: colors.text }]}>{hint}</RNText> : null}
    </View>
  );
}

export function Toggle({ label, value, onChange, hint, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <Pressable onPress={() => !disabled && onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} style={styles.toggleRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Strong>{label}</Strong>
        {hint ? <Muted>{hint}</Muted> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.brand, false: colors.border }} thumbColor={colors.white} />
    </Pressable>
  );
}

/** Two to four big options side by side (tabs, language, yes/no). */
export function Segmented<T extends string>({ options, value, onChange, tone = 'brand' }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; tone?: 'brand' | 'pro' }) {
  const active = tone === 'pro' ? colors.pro : colors.brand;
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segmentItem, on && { backgroundColor: active }]}
          >
            <RNText style={[styles.segmentText, on && { color: colors.white }]}>{o.label}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A large selectable row (radio style). */
export function Choice({ title, subtitle, selected, onPress, right, disabled, testID }: { title: string; subtitle?: string | null; selected: boolean; onPress: () => void; right?: ReactNode; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      style={[styles.choice, selected && { borderColor: colors.brand, backgroundColor: colors.brandSoft }, disabled && { opacity: 0.5 }]}
    >
      <View style={[styles.radio, selected && { borderColor: colors.brand }]}>{selected ? <View style={styles.radioDot} /> : null}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Strong>{title}</Strong>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
      {right}
    </Pressable>
  );
}

/** Checkbox row for multi-select lists (zones, services). */
export function Check({ title, subtitle, checked, onPress }: { title: string; subtitle?: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked }} style={[styles.choice, checked && { borderColor: colors.brand, backgroundColor: colors.brandSoft }]}>
      <View style={[styles.checkbox, checked && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
        {checked ? <RNText style={{ color: colors.white, fontWeight: '900', fontSize: 16 }}>✓</RNText> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Strong>{title}</Strong>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
    </Pressable>
  );
}

// ───────── Status & feedback ─────────
export function Pill({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: string }) {
  const t = toneColors(tone);
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <RNText style={[styles.pillText, { color: t.fg }]}>{icon ? `${icon} ` : ''}{label}</RNText>
    </View>
  );
}

export function Banner({ tone = 'info', title, body, action, onAction, icon, testID }: { tone?: Tone; title: string; body?: string; action?: string; onAction?: () => void; icon?: string; testID?: string }) {
  const t = toneColors(tone);
  return (
    <View testID={testID} style={[styles.banner, { backgroundColor: t.bg, borderLeftColor: t.fg }]} accessibilityRole="alert">
      <RNText style={[styles.bannerTitle, { color: t.fg }]}>{icon ? `${icon}  ` : ''}{title}</RNText>
      {body ? <RNText style={[styles.body, { color: colors.text }]}>{body}</RNText> : null}
      {action && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" style={[styles.bannerAction, { borderColor: t.fg }]}>
          <RNText style={{ color: t.fg, fontWeight: '800', fontSize: font.body }}>{action} →</RNText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.centerBox}>
      <ActivityIndicator size="large" color={colors.brand} />
      <Muted center>{label}</Muted>
    </View>
  );
}

export function EmptyState({ icon = '🧰', title, body, action, onAction }: { icon?: string; title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.centerBox}>
      <RNText style={{ fontSize: 44 }}>{icon}</RNText>
      <Strong style={{ textAlign: 'center', fontSize: font.large }}>{title}</Strong>
      {body ? <Muted center>{body}</Muted> : null}
      {action && onAction ? <Button title={action} onPress={onAction} variant="secondary" /> : null}
    </View>
  );
}

/** Offline and server errors look different: offline is not the user's fault and usually fixes itself. */
export function ErrorState({ message, offline, onRetry, retryLabel = 'Try again', title }: { message: string; offline?: boolean; onRetry?: () => void; retryLabel?: string; title?: string }) {
  return (
    <View style={styles.centerBox}>
      <RNText style={{ fontSize: 44 }}>{offline ? '📶' : '⚠️'}</RNText>
      <Strong style={{ textAlign: 'center', fontSize: font.large }}>{title ?? (offline ? 'Offline' : 'Something went wrong')}</Strong>
      <Muted center>{message}</Muted>
      {onRetry ? <Button title={retryLabel} onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}

export function Stars({ value, onChange, size = 40 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <Row gap={space.xs}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange?.(n)} disabled={!onChange} accessibilityRole="button" accessibilityLabel={`${n} star`} hitSlop={6}>
          <RNText style={{ fontSize: size, color: n <= value ? colors.accent : colors.border }}>★</RNText>
        </Pressable>
      ))}
    </Row>
  );
}

/** Key/value line used in price breakdowns and job details. */
export function KV({ k, v, bold, color }: { k: string; v: ReactNode; bold?: boolean; color?: string }) {
  return (
    <View style={styles.kv}>
      <RNText style={[styles.body, { flex: 1, color: color ?? colors.textMuted }, bold && { color: colors.text, fontWeight: '800' }]}>{k}</RNText>
      {typeof v === 'string' ? <RNText style={[styles.body, { fontWeight: bold ? '800' : '600', textAlign: 'right', flexShrink: 1, color: color ?? colors.text }]}>{v}</RNText> : v}
    </View>
  );
}

export function ListRow({ title, subtitle, right, onPress, left, testID }: { title: string; subtitle?: string | null; right?: ReactNode; onPress?: () => void; left?: ReactNode; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: '#F0F2EE' }]}>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Strong numberOfLines={2}>{title}</Strong>
        {subtitle ? <Muted numberOfLines={2}>{subtitle}</Muted> : null}
      </View>
      {right ?? (onPress ? <RNText style={{ fontSize: 26, color: colors.textMuted }}>›</RNText> : null)}
    </Pressable>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: space.lg, marginBottom: space.sm }}>
      <RNText style={styles.section}>{children}</RNText>
      {right}
    </Row>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  padded: { padding: space.lg, gap: space.md },
  footer: { padding: space.lg, paddingTop: space.md, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: space.sm },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border, gap: space.sm },
  h1: { fontSize: font.hero, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.title, fontWeight: '800', color: colors.text },
  body: { fontSize: font.body, color: colors.text, lineHeight: 24 },
  muted: { fontSize: font.small, color: colors.textMuted, lineHeight: 21 },
  label: { fontSize: font.body, fontWeight: '700', color: colors.text },
  optional: { fontWeight: '400', color: colors.textMuted, fontSize: font.small },
  section: { fontSize: font.large, fontWeight: '800', color: colors.text },
  center: { textAlign: 'center' },
  button: { minHeight: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, borderWidth: 2 },
  buttonSmall: { minHeight: 48, paddingHorizontal: space.md },
  buttonText: { fontSize: font.large, fontWeight: '800' },
  input: { minHeight: TOUCH, borderWidth: 2, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: font.large, backgroundColor: colors.card, color: colors.text },
  error: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
  codeInput: { minHeight: 72, borderWidth: 2, borderColor: colors.brand, borderRadius: radius.md, fontSize: 36, letterSpacing: 12, textAlign: 'center', fontWeight: '800', backgroundColor: colors.card, color: colors.text },
  bigCodeBox: { borderWidth: 3, borderRadius: radius.lg, padding: space.lg, alignItems: 'center', gap: space.sm },
  bigCode: { fontSize: font.code, fontWeight: '900', letterSpacing: 4, fontVariant: ['tabular-nums'] },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH, backgroundColor: colors.card, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.border },
  segment: { flexDirection: 'row', backgroundColor: '#E7EBE5', borderRadius: radius.md, padding: 4, gap: 4 },
  segmentItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, paddingHorizontal: space.sm },
  segmentText: { fontSize: font.body, fontWeight: '800', color: colors.text, textAlign: 'center' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 8, padding: space.md, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.card },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.brand },
  checkbox: { width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  pillText: { fontSize: 14, fontWeight: '800' },
  banner: { borderRadius: radius.md, padding: space.md, borderLeftWidth: 6, gap: space.xs },
  bannerTitle: { fontSize: font.body, fontWeight: '800' },
  bannerAction: { alignSelf: 'flex-start', marginTop: space.xs, minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md, borderWidth: 2, borderRadius: radius.sm },
  centerBox: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  kv: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 8, paddingVertical: space.md, paddingHorizontal: space.md, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
});
