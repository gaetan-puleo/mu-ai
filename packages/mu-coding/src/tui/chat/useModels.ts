import type { ApiModel } from 'mu-core';
import { fetchModelContextLimit, listModels } from 'mu-openai-provider';
import { useCallback, useEffect, useState } from 'react';
import { saveConfig } from '../../config/index';

export interface ModelListState {
  models: ApiModel[];
  currentModel: string;
  modelError: string | null;
  cycleModel: () => void;
  selectModel: (id: string) => void;
}

export function useModelList(baseUrl: string, preferredModel?: string): ModelListState {
  const [models, setModels] = useState<ApiModel[]>([]);
  const [currentModel, setCurrentModel] = useState(preferredModel ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Guard against late resolution: if the user quits or `baseUrl` changes
    // before the request settles, swallow the response so we don't call
    // setState on an unmounted hook.
    let cancelled = false;
    listModels(baseUrl)
      .then((list) => {
        if (cancelled) return;
        if (list.length === 0) {
          setError(`No models found at ${baseUrl}`);
          return;
        }
        setError(null);
        setModels(list);
        const target = preferredModel && list.some((m) => m.id === preferredModel) ? preferredModel : list[0].id;
        setCurrentModel(target);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch models');
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, preferredModel]);

  // Lazily probe the active model's context window. Fires whenever the
  // selection changes; skips if we already know the limit for that id.
  // Runs in the background so the UI never blocks waiting for `/props`.
  // Triggers a model load on llama-swap-style proxies, but only for the
  // model the user has actually picked — same model the next chat would
  // load anyway.
  useEffect(() => {
    if (!(baseUrl && currentModel)) return;
    const known = models.find((m) => m.id === currentModel);
    if (!known || known.contextLimit !== undefined) return;
    let cancelled = false;
    fetchModelContextLimit(baseUrl, currentModel)
      .then((limit) => {
        if (cancelled || !limit) return;
        setModels((prev) => prev.map((m) => (m.id === currentModel ? { ...m, contextLimit: limit } : m)));
      })
      .catch(() => {
        /* silently ignore — providers without `/props` just don't get a limit */
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, currentModel, models]);

  const cycleModel = useCallback(() => {
    if (models.length === 0) {
      return;
    }
    const idx = models.findIndex((m) => m.id === currentModel);
    setCurrentModel(models[(idx + 1) % models.length].id);
  }, [models, currentModel]);

  const selectModel = useCallback((id: string) => {
    setCurrentModel(id);
    saveConfig({ model: id });
  }, []);

  return { models, currentModel, cycleModel, selectModel, modelError: error };
}
