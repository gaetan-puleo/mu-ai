import { Box, render, Text, useInput } from 'ink';
import { type ApiModel, formatModelId, type LocalServerInfo, listModels } from 'mu-local-provider';
import React from 'react';
import { Screen } from '../primitives';

const { useEffect, useState } = React;

const MODEL_ID_DISPLAY_CAP = 40;

function truncateModelId(id: string): string {
  if (id.length <= MODEL_ID_DISPLAY_CAP) return id;
  return `${id.slice(0, MODEL_ID_DISPLAY_CAP - 1)}…`;
}

export function ModelPicker({
  baseUrl,
  serverInfo,
  onPick,
  onAbort,
}: {
  baseUrl: string;
  serverInfo: LocalServerInfo;
  onPick: (qualifiedModelId: string) => void;
  onAbort: () => void;
}): React.ReactElement {
  const [models, setModels] = useState<ApiModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    listModels(baseUrl)
      .then(setModels)
      .catch((err) => setError(err.message ?? String(err)));
  }, [baseUrl]);

  useInput((input, key) => {
    if (!models || models.length === 0) return;
    if (key.upArrow) setCursor((c) => (c - 1 + models.length) % models.length);
    else if (key.downArrow) setCursor((c) => (c + 1) % models.length);
    else if (key.return) {
      const chosen = models[cursor];
      if (chosen) onPick(formatModelId({ kind: serverInfo.kind, id: chosen.id }));
    } else if (key.escape || input === 'q') onAbort();
  });

  if (error) return <Text color="red">Failed to list models: {error}</Text>;
  if (!models) return <Text dimColor={true}>Loading models from {baseUrl}…</Text>;
  if (models.length === 0) return <Text color="yellow">No models available at {baseUrl}</Text>;

  return (
    <Box flexDirection="column">
      <Text bold={true}>Select a model (↑/↓, enter):</Text>
      {models.map((m, i) => {
        const qualified = `local/${serverInfo.kind}/${truncateModelId(m.id)}`;
        return (
          <Text key={m.id} color={i === cursor ? 'cyan' : undefined}>
            {i === cursor ? '› ' : '  '}
            {qualified}
          </Text>
        );
      })}
    </Box>
  );
}

export async function pickModelInteractive(baseUrl: string, serverInfo: LocalServerInfo): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let picked = false;
    const { unmount, waitUntilExit } = render(
      <Screen>
        <ModelPicker
          baseUrl={baseUrl}
          serverInfo={serverInfo}
          onPick={(id) => {
            picked = true;
            unmount();
            resolve(id);
          }}
          onAbort={() => {
            unmount();
            resolve(null);
          }}
        />
      </Screen>,
    );
    waitUntilExit().then(() => {
      if (!picked) resolve(null);
    });
  });
}
