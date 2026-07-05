// src/web/components/PluginPermissions.tsx — renders permission chips for a plugin.

import { Globe, FileText, Settings, Terminal, Shield, type LucideIcon } from 'lucide-react';

const PERMISSION_LABELS: Record<string, { label: string; icon: LucideIcon; color: string; description: string }> = {
  net: { label: 'Network access', icon: Globe, color: 'blue', description: 'Can make HTTP requests to external services' },
  fs: { label: 'Filesystem', icon: FileText, color: 'yellow', description: 'Can read and write files' },
  config: { label: 'Config access', icon: Settings, color: 'gray', description: 'Can read and write Bizar config' },
  log: { label: 'Logging', icon: FileText, color: 'gray', description: 'Can write to the structured log' },
  exec: { label: 'Shell execution', icon: Terminal, color: 'red', description: 'Can run shell commands' },
};

export type PluginPermissionsProps = {
  permissions: string[];
};

export function PluginPermissions({ permissions }: PluginPermissionsProps) {
  return (
    <div className="plugin-permissions" aria-label="Required permissions">
      {permissions.map((perm) => {
        const info = PERMISSION_LABELS[perm] ?? { label: perm, icon: Shield, color: 'gray', description: '' };
        const Icon = info.icon;
        return (
          <div
            key={perm}
            className={`permission-chip is-${info.color}`}
            title={info.description}
          >
            <Icon size={12} aria-hidden />
            <span>{info.label}</span>
          </div>
        );
      })}
    </div>
  );
}
