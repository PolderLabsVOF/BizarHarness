// src/mobile/views/MobilePlans.tsx — alias of MobileArtifacts with the
// `onOpenPlan` prop naming used by the mobile stack router.
//
// v3.20.6 — Previously this file was missing, leaving the mobile
// `plans` stack route broken (TS error on import). MobileArtifacts
// already implements the plan list; this thin wrapper just adapts the
// prop name so the stack router can call `onOpenPlan(slug)` while the
// underlying view still uses its native `onOpenArtifact(slug)`.
import type { Snapshot } from '../../lib/types';
import { MobileArtifacts } from './MobileArtifacts';

type Props = {
  snapshot: Snapshot;
  onBack: () => void;
  onOpenPlan: (slug: string) => void;
};

export function MobilePlans({ snapshot, onBack, onOpenPlan }: Props) {
  return (
    <MobileArtifacts
      snapshot={snapshot}
      onBack={onBack}
      onOpenArtifact={onOpenPlan}
    />
  );
}
