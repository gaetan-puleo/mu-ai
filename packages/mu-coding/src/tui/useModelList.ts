import { type ApiModel, listModels } from 'mu-provider';
import { useCallback, useEffect, useState } from 'react';
import { saveConfig } from '../config';

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
    listModels(baseUrl)
      .then((list) => {
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
        setError(err instanceof Error ? err.message : 'Failed to fetch models');
      });
  }, [baseUrl, preferredModel]);

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
