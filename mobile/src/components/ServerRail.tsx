import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C } from '../../App';

export type Server = { id: string; name: string; icon_url?: string };

type Props = {
  servers: Server[];
  selectedId: string | null;
  onSelect: (server: Server) => void;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

// Deterministic accent colour from server id
function serverColor(id: string): string {
  const palette = ['#00d2aa', '#7289da', '#f47fff', '#f9a825', '#4fc3f7', '#ef5350', '#66bb6a'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffff;
  return palette[h % palette.length];
}

export default function ServerRail({ servers, selectedId, onSelect }: Props) {
  return (
    <View style={s.rail}>
      {/* Home / logo button */}
      <View style={[s.icon, s.homeIcon]}>
        <Text style={s.homeText}>D</Text>
      </View>
      <View style={s.divider} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.list}
      >
        {servers.map(srv => {
          const active = srv.id === selectedId;
          const color  = serverColor(srv.id);
          return (
            <TouchableOpacity
              key={srv.id}
              onPress={() => onSelect(srv)}
              activeOpacity={0.75}
              style={s.iconWrap}
            >
              {/* Active indicator bar */}
              {active && <View style={[s.activePill, { backgroundColor: color }]} />}

              <View style={[
                s.icon,
                { backgroundColor: active ? color : C.sf2,
                  borderRadius: active ? 14 : 22,
                  borderColor: active ? color : C.bd },
              ]}>
                <Text style={[s.iconText, { color: active ? '#000' : C.tx }]}>
                  {initials(srv.name) || '?'}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  rail: {
    width: 62,
    backgroundColor: C.bg,
    borderRightWidth: 1,
    borderRightColor: C.bd,
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 10,
  },
  list: {
    alignItems: 'center',
    gap: 6,
    paddingBottom: 10,
  },
  divider: {
    width: 32,
    height: 2,
    backgroundColor: C.bd,
    borderRadius: 1,
    marginVertical: 8,
  },
  iconWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 52,
  },
  activePill: {
    position: 'absolute',
    left: 0,
    width: 4,
    height: 32,
    borderRadius: 2,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.sf2,
    borderWidth: 1,
    borderColor: C.bd,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    overflow: 'hidden',
  },
  iconText: {
    fontSize: 15,
    fontWeight: '700',
    color: C.tx,
  },
  homeIcon: {
    backgroundColor: C.ac,
    borderColor: C.ac,
    borderRadius: 14,
  },
  homeText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#000',
  },
});
