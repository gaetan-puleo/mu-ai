import { capability } from '../capabilities';
import type { TuiFeature } from '../feature';
import { OSC, ST } from '../protocol';

export type ShellIntegrationFlavor = 'osc133' | 'vscode633';

export function shellIntegrationFeature(flavor: ShellIntegrationFlavor): TuiFeature {
  return {
    name: `shell-integration:${flavor}`,
    detect() {
      return {
        osc: { shellIntegration: capability(true, 'feature') },
        security: { shellIntegration: 'allow' },
      };
    },
  };
}

export function shellIntegrationSequences(flavor: ShellIntegrationFlavor): {
  promptStart: () => string;
  promptEnd: () => string;
  commandStart: () => string;
  commandEnd: (exitCode?: number) => string;
} {
  if (flavor === 'vscode633') {
    return {
      promptStart: () => `${OSC}633;A${ST}`,
      promptEnd: () => `${OSC}633;B${ST}`,
      commandStart: () => `${OSC}633;C${ST}`,
      commandEnd: (exitCode = 0) => `${OSC}633;D;${exitCode}${ST}`,
    };
  }

  return {
    promptStart: () => `${OSC}133;A${ST}`,
    promptEnd: () => `${OSC}133;B${ST}`,
    commandStart: () => `${OSC}133;C${ST}`,
    commandEnd: (exitCode = 0) => `${OSC}133;D;${exitCode}${ST}`,
  };
}
