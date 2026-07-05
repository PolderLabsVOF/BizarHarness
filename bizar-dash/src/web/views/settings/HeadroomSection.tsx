// src/web/views/settings/HeadroomSection.tsx
import React from 'react';
import { HeadroomSettingsCard } from '../../components/HeadroomSettings';
import { type HeadroomSettings, type Settings } from '../../lib/types';

const DEFAULT_HEADROOM_SETTINGS: HeadroomSettings = {
  enabled: true,
  autoInstall: true,
  port: 8787,
  host: '127.0.0.1',
  outputShaper: false,
  telemetry: false,
  budget: 0,
  backend: 'anthropic',
  autoStart: true,
  autoWrap: true,
  routeAllProviders: true,
};

type Props = {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  setDirty: React.Dispatch<React.SetStateAction<boolean>>;
};

export function HeadroomSection({ settings, setSettings, setDirty }: Props) {
  return (
    <HeadroomSettingsCard
      settings={settings.headroom || DEFAULT_HEADROOM_SETTINGS}
      onPatch={(patch) => {
        setSettings((cur) => ({
          ...cur,
          headroom: { ...(cur.headroom || DEFAULT_HEADROOM_SETTINGS), ...patch },
        }));
        setDirty(true);
      }}
    />
  );
}
