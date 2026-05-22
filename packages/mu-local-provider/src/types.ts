export type LocalBackendKind = 'llama-swap';

export type LocalModel = {
  id: string;
  name?: string;
  description?: string;
  ownedBy?: string;
};

export type LocalBackendIdentity = {
  kind: LocalBackendKind;
  baseUrl: string;
};

export type LocalBackendInfo = LocalBackendIdentity & {
  models: LocalModel[];
};

export type LocalProviderConfig = {
  kind?: LocalBackendKind;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};
