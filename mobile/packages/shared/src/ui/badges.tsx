import { StyleSheet, Text, View } from 'react-native';
import { badgeTone, sortBadges } from '../domain';
import type { BadgeCode } from '../types';
import { useT } from './i18n';
import { colors, radius } from './theme';

const ICON: Record<string, string> = {
  PHONE_VERIFIED: '📱',
  NATIONAL_ID: '🪪',
  POLICE_CLEARANCE: '🛡️',
  TRADE_CERTIFIED: '🎓',
  BUSINESS_REGISTERED: '🏢',
  TOP_RATED: '⭐',
  RELIABLE: '✅',
  VETERAN: '🏅',
};

export function badgeIcon(code: BadgeCode): string {
  return ICON[code] ?? '🔖';
}

export function BadgeChip({ code, label }: { code: BadgeCode; label?: string }) {
  const t = useT();
  const tone = badgeTone(code);
  const c = tone === 'verified' ? { bg: colors.brandSoft, fg: colors.brandDark } : tone === 'performance' ? { bg: colors.accentSoft, fg: '#7A5400' } : { bg: '#ECEFEA', fg: colors.textMuted };
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]} accessibilityLabel={label ?? t.dyn(`badge.${code}`, code)}>
      <Text style={[styles.text, { color: c.fg }]}>
        {badgeIcon(code)} {label ?? t.dyn(`badge.${code}`, code)}
      </Text>
    </View>
  );
}

/** Trust chips in the order customers care about. `max` keeps lists short on small screens. */
export function BadgeChips({ codes, max }: { codes: BadgeCode[]; max?: number }) {
  const sorted = sortBadges(codes);
  const shown = max ? sorted.slice(0, max) : sorted;
  const more = sorted.length - shown.length;
  return (
    <View style={styles.wrap}>
      {shown.map((c) => (
        <BadgeChip key={c} code={c} />
      ))}
      {more > 0 ? (
        <View style={[styles.chip, { backgroundColor: '#ECEFEA' }]}>
          <Text style={[styles.text, { color: colors.textMuted }]}>+{more}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  text: { fontSize: 14, fontWeight: '800' },
});
