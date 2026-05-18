import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";

import { useDeliveryCopy } from "@/src/lib/copy";
import { useRiderAuthStore } from "@/src/store/auth-store";
import { palette } from "@/src/theme/palette";

function TabIcon({
  focused,
  activeName,
  inactiveName,
}: {
  focused: boolean;
  activeName: keyof typeof Ionicons.glyphMap;
  inactiveName: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={[styles.tabIconShell, focused ? styles.tabIconShellActive : null]}>
      <Ionicons
        name={focused ? activeName : inactiveName}
        color={focused ? palette.secondary : palette.mutedForeground}
        size={20}
      />
    </View>
  );
}

export default function AppLayout() {
  const { copy } = useDeliveryCopy();
  const isHydrated = useRiderAuthStore((state) => state.isHydrated);
  const rider = useRiderAuthStore((state) => state.rider);
  const accessToken = useRiderAuthStore((state) => state.accessToken);

  if (!isHydrated) {
    return null;
  }

  if (!rider || !accessToken) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.secondary,
        tabBarInactiveTintColor: palette.mutedForeground,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          position: "absolute",
          left: 16,
          right: 16,
          bottom: 14,
          height: 76,
          paddingTop: 8,
          paddingBottom: 10,
          backgroundColor: palette.surface,
          borderTopWidth: 0,
          borderRadius: 26,
          borderWidth: 1,
          borderColor: palette.border,
          shadowColor: palette.shadow,
          shadowOpacity: 1,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
          elevation: 10,
        },
        tabBarItemStyle: {
          borderRadius: 20,
          marginHorizontal: 3,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "800",
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="available"
        options={{
          title: copy.tabs.available,
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} activeName="storefront" inactiveName="storefront-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="active"
        options={{
          title: copy.tabs.active,
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} activeName="flash" inactiveName="flash-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: copy.tabs.history,
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} activeName="time" inactiveName="time-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: copy.tabs.profile,
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} activeName="person-circle" inactiveName="person-circle-outline" />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabIconShell: {
    width: 40,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  tabIconShellActive: {
    backgroundColor: "#FFEAF2",
    borderWidth: 1,
    borderColor: "#FFCEE0",
  },
});
