# Plan : refonte mu vers une architecture agent-first multi-host

> Ce document est le plan d'exécution validé pour la refonte de mu. Il sert de
> référence pendant l'implémentation et de base de revue avant merge.

## 0. Vision

mu devient un framework d'agents générique consommable :
- par mu-coding (TUI Ink) — host coding interactif
- par Arya — host non-coding multi-canal (Telegram, Companion websocket, voice, …)
- par tout futur host (web, slack, voice-only, embarqué)

L'orchestration (boucle d'agent, sessions, channels, permissions, sous-agents,
chargement markdown) vit dans mu. Les **intégrations** spécifiques (Telegram,
voice, Home Assistant, CalDAV, MCP, scheduler, serveur d'approbation HTTP)
restent dans Arya. mu-coding ne contient que le TUI + ses outils coding.

Critère de réussite : Arya peut migrer son `bootstrap.ts` à ~30 lignes qui
chargent ses plugins d'intégration et appellent `startMu({ configPath, plugins })`.

## 1. Liste finale des paquets (6)

```
mu-core              SDK : types LLM + Provider interface + registre providers
                     + (optionnel) ProviderAdapter + createProvider() + transport
                     SSE/NDJSON/fetch (pour providers non-SDK)
                     + Channel + Session + SessionManager + ActivityBus
                     + UIService + runAgent + plugin SDK + host (startMu)
mu-openai-provider   wrapper du SDK officiel `openai` exposé comme Provider
                     + factory plugin (pas de parse SSE maison, pas d'adapter)
mu-agents            moteur agent / sous-agent / permission + ApprovalGateway
                     + ApprovalChannel + chargeur markdown (chokidar) + globs picomatch
mu-repomap           search_code (existant, paths d'imports mis à jour)
mu-coding-agents     build/plan/explore/review .md (data-only)
mu-coding            channel TUI Ink + InkUIService + adaptateur ApprovalChannel
                     + SYSTEM.md coding + outils coding (bash/read/write/edit)
                     + persistence + binaire `mu`
```

Layering : `mu-core` ← `{mu-openai-provider, mu-agents, mu-repomap}` ← `{mu-coding-agents, mu-coding}`.

## 2. Renommages disque

| Avant | Après |
|---|---|
| `packages/mu-provider/` | `packages/mu-openai-provider/` |
| `packages/mu-agents/` | `packages/mu-core/` |
| `packages/mu-agent/` | `packages/mu-agents/` |
| — | `packages/mu-coding-agents/` (nouveau) |

Le paquet `mu-fs-tools` envisagé puis abandonné : les outils filesystem/shell
restent dans `mu-coding/src/runtime/codingTools/`, factory
`createCodingToolsPlugin()`.

## 3. mu-core — détail du contenu

### 3.1 Types LLM (rapatriés depuis l'ancien mu-provider)

`mu-core/src/types/llm.ts` :
- `ChatMessage`, `MessageDisplay` (avec `customType`, `meta`, `display`)
- `ToolCall`, `ToolDefinition`, `ToolResultInfo`
- `ImageAttachment`, `ProviderConfig`, `ApiModel`
- `StreamChunk`, `Usage`, `StreamOptions`

`ProviderConfig` gagne `providerId?: string` (défaut `'openai'`).

### 3.2 Provider — couches d'extensibilité

mu-core expose **deux niveaux** d'API pour qu'un plugin puisse contribuer un
provider LLM :

1. **Niveau haut — `Provider` direct.** Implémenter l'interface `Provider`
   et l'enregistrer dans `ProviderRegistry`. C'est ce que fait
   `mu-openai-provider` : il wrappe le SDK officiel `openai` (pas de parsing
   SSE manuel) et expose le tout comme un `Provider`.

2. **Niveau bas (optionnel) — `ProviderAdapter` + `createProvider`.** Pour
   les providers qui ne disposent pas de SDK Node ou parlent un wire
   protocol custom (Anthropic, Ollama natif, mistral.rs, …), mu-core fournit
   les primitives transport + un contrat `ProviderAdapter` que
   `createProvider(adapter)` transforme en `Provider`.

Aucun couplage entre les deux : un plugin peut sauter entièrement la couche
adapter si son SDK fait déjà le travail.

`mu-core/src/provider/transport.ts` (primitives génériques pour la voie
adapter) :
- `readSSE(response, signal)` — lecteur SSE générique
- `readNDJSON(response, signal)` — lecteur NDJSON
- `fetchWithIdleTimeout(url, init, timeoutMs)` — fetch avec timeout d'inactivité

`mu-core/src/provider/adapter.ts` (contrat + factory, optionnel pour le
consommateur) :

```ts
export interface RequestSpec {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export interface ChatRequestInput {
  messages: ChatMessage[];
  config: ProviderConfig;
  model: string;
  tools?: ToolDefinition[];
}

export interface ModelsRequestInput {
  baseUrl: string;
  config: ProviderConfig;
}

export type ParsedChatEvent =
  | { kind: 'chunk'; chunk: StreamChunk }
  | { kind: 'usage'; usage: Usage }
  | null;

export interface ProviderAdapter {
  id: string;
  transport: 'sse' | 'ndjson';
  buildChatRequest(input: ChatRequestInput): RequestSpec;
  parseChatEvent(raw: string): ParsedChatEvent;
  buildModelsRequest(input: ModelsRequestInput): RequestSpec;
  parseModelsResponse(body: unknown): ApiModel[];
}

export interface Provider {
  id: string;
  streamChat(messages: ChatMessage[], config: ProviderConfig, model: string,
             options: StreamOptions): AsyncIterable<StreamChunk>;
  listModels(config: ProviderConfig): Promise<ApiModel[]>;
}

export function createProvider(adapter: ProviderAdapter): Provider;
```

`createProvider` :
- Branche fetch + abort + idle timeout
- Choisit `readSSE` ou `readNDJSON` selon `adapter.transport`
- Boucle d'événements appelant `adapter.parseChatEvent`
- Émet les chunks au consommateur, propage l'usage via `options.onUsage`

`mu-core/src/provider/registry.ts` :
```ts
export interface ProviderRegistry {
  register(provider: Provider): () => void;
  get(id: string): Provider | undefined;
  list(): Provider[];
}
```

Exposé via `PluginContext.providers`.

### 3.3 Channel (compatible Arya)

`mu-core/src/channel.ts` :

```ts
export type InboundKind = 'text' | 'audio';
export type ResponseMode = 'text' | 'voice';

export interface InboundMessage {
  kind: InboundKind;
  channelId: string;
  sessionId: string;
  messageId?: string;
  userId?: string;
  userName?: string;
  text?: string;
  responseMode?: ResponseMode;
  audio?: { url?: string; mimeType?: string; filePath?: string };
  raw?: unknown;
}

export interface ChannelResponder {
  sendText(text: string): Promise<void>;
  sendVoice?(text: string): Promise<void>;
  sendAck?(text: string): Promise<void>;
  sendError?(text: string): Promise<void>;
}

export interface Channel {
  id: string;
  start(): Promise<void>;
  stop?(): Promise<void>;
}

export interface ChannelRegistry {
  register(channel: Channel): () => void;
  list(): Channel[];
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
}
```

Exposé via `PluginContext.channels`.

### 3.4 Session + SessionManager

`mu-core/src/session.ts` :

```ts
export type SessionEvent =
  | { type: 'messages_changed'; messages: ChatMessage[] }
  | { type: 'stream_partial'; text: string; reasoning?: string }
  | { type: 'stream_started' }
  | { type: 'stream_ended' }
  | { type: 'usage'; totalTokens: number; cachedTokens: number }
  | { type: 'error'; message: string };

export interface Session {
  readonly id: string;
  getMessages(): ChatMessage[];
  submit(input: InboundMessage, responder: ChannelResponder): Promise<void>;
  abort(): void;
  appendSynthetic(msg: ChatMessage): void;
  queueForNextTurn(msg: ChatMessage): void;
  subscribe(listener: (event: SessionEvent) => void): () => void;
}

export interface SessionInit {
  initialMessages?: ChatMessage[];
  systemPrompt?: string;
}

export interface SessionManager {
  getOrCreate(key: string, init?: SessionInit): Session;
  get(key: string): Session | undefined;
  list(): Session[];
  close(key: string): Promise<void>;
}

export function createSessionManager(opts: {
  registry: PluginRegistry;
  config: ProviderConfig;
  model: string;
}): SessionManager;
```

Multi-session : channels émettent un `sessionId` ; `SessionManager` instancie
paresseusement. mu-coding utilise toujours `'tui'`. Arya utilise `telegram:${chatId}`.

Persistence : aucun écrit fichier dans mu-core. Les hosts s'abonnent via
`session.subscribe` et écrivent leur format (mu-coding écrit JSONL via
`useSessionPersistence` adapté).

### 3.5 ActivityBus

`mu-core/src/activity.ts` :

```ts
export type ActivityKind =
  | 'agent_start' | 'agent_end'
  | 'tool_start' | 'tool_end'
  | 'task_started' | 'task_completed' | 'task_error';

export interface ActivityEvent {
  id: number;
  ts: number;
  kind: ActivityKind;
  source: string;       // agent id ou nom de tâche
  summary: string;
  detail?: Record<string, unknown>;
}

export type SubAgentEventKind =
  | 'invocation_start' | 'text_delta' | 'message_end'
  | 'tool_call_start' | 'tool_call_end' | 'invocation_end';

export interface SubAgentEvent {
  runId: string;
  parentRunId?: string;
  agentId: string;
  kind: SubAgentEventKind;
  ts: number;
  data: Record<string, unknown>;
}

export interface ActivityBus {
  subscribe(fn: (e: ActivityEvent) => void): () => void;
  emit(kind, source, summary, detail?): void;
  subscribeSubAgent(fn: (e: SubAgentEvent) => void): () => void;
  emitSubAgent(e: SubAgentEvent): void;
}
```

Exposé via `PluginContext.activity`. `runAgent` émet des events. Channels
subscribent (Companion broadcast websocket, TUI affiche un timeline d'outils).

### 3.6 Host — startMu

`mu-core/src/host/index.ts` :

```ts
export interface StartMuOptions {
  configPath?: string;
  /** Plugins passés en code, ajoutés à ceux listés dans config.plugins. */
  plugins?: Plugin[];
  /** cwd par défaut si non fourni dans config */
  cwd?: string;
}

export interface MuHandle {
  registry: PluginRegistry;
  sessions: SessionManager;
  channels: ChannelRegistry;
  activity: ActivityBus;
  shutdown(): Promise<void>;
}

export async function startMu(options: StartMuOptions = {}): Promise<MuHandle>;
```

`startMu` :
1. Charge la config (`configPath` ou défaut XDG)
2. Construit `PluginRegistry` avec providers/sessions/channels/activity registries
3. Enregistre les plugins listés dans `config.plugins` puis ceux passés dans `options.plugins`
4. Démarre tous les channels (`channels.startAll()`)
5. Retourne un handle pour shutdown gracieux

### 3.7 Plugin SDK étendu

`PluginContext` gagne :

```ts
export interface PluginContext extends PluginExtras {
  // existant
  cwd: string;
  config: Record<string, unknown>;
  ui?: UIService;
  shutdown?: (code?: number) => Promise<void> | void;
  setStatusLine?: (segments: StatusSegment[]) => void;

  // nouveau
  providers?: ProviderRegistry;
  channels?: ChannelRegistry;
  sessions?: SessionManager;
  activity?: ActivityBus;
  agents?: AgentSourceRegistry;       // exposé par mu-agents
}
```

`AgentSourceRegistry` (interface dans mu-core, implémentation dans mu-agents) :
```ts
export interface AgentSourceRegistry {
  registerSource(absoluteDirPath: string): () => void;
}
```

### 3.8 Hooks et UIService — inchangés

Hooks lifecycle existants conservés (`beforeLlmCall`, `afterLlmCall`,
`beforeToolExec` avec `ToolBlock`, `afterToolExec`, `filterTools`,
`transformSystemPrompt`, `transformUserInput`, `afterAgentRun`).

`UIService` reste l'interface dialogs/toasts/status.

### 3.9 Index public

`mu-core/src/index.ts` exporte :
- `runAgent`, `PluginRegistry`, `Plugin`, `PluginContext`, `PluginTool`, hooks
- Tous les types LLM
- `Provider`, `ProviderAdapter`, `createProvider`, `readSSE`, `readNDJSON`, `fetchWithIdleTimeout`
- `Channel`, `InboundMessage`, `ChannelResponder`
- `Session`, `SessionManager`, `SessionEvent`, `createSessionManager`
- `ActivityBus`, `ActivityEvent`, `SubAgentEvent`
- `UIService`, `ConsoleUIService`, `MessageRenderer`, `ShortcutHandler`, `MentionProvider`
- `startMu`

## 4. mu-openai-provider — détail

### 4.1 Stratégie : SDK officiel `openai`

Le paquet **utilise directement le SDK Node officiel** (`openai` sur npm)
plutôt que de reconstruire le wire protocol via `ProviderAdapter` +
`createProvider`. Justification :

- Le SDK gère pour nous : accumulation des `tool_calls` cross-chunks, retry,
  auth, désérialisation des `delta` (incluant `reasoning_content` /
  `reasoning` exposés par les serveurs locaux).
- La complexité de maintenance d'un parser SSE OpenAI maison ne se justifie
  pas pour gagner ~quelques centaines de kB de bundle.
- Les hosts qui veulent un chemin SDK-free peuvent toujours publier leur
  propre provider via la voie `Provider` directe ou
  `createProvider(adapter)` (cf. §3.2).

### 4.2 Modules

`mu-openai-provider/src/stream.ts` :
- `streamChat(messages, config, model, options?): AsyncGenerator<StreamChunk>`
- Wrap le SDK `openai`, gère :
  - construction des `ChatCompletionMessageParam[]` (texte, `image_url`,
    `tool_calls`, `tool_call_id`, system messages embarqués)
  - timeout d'inactivité par chunk via un helper interne `withInactivityTimeout`
  - extraction des `reasoning_content` / `reasoning` propres aux serveurs locaux
  - accumulation des fragments `tool_calls` puis émission lorsqu'un
    `finish_reason` (`'tool_calls'` ou `'stop'`) arrive ; fallback final
    pour les serveurs qui omettent un `finish_reason`
  - propagation du `usage` final (avec `cached_tokens` quand reporté) via
    `options.onUsage`

`mu-openai-provider/src/models.ts` :
- `listModels(baseUrl): Promise<ApiModel[]>` — appel `client.models.list()` via SDK

`mu-openai-provider/src/plugin.ts` :
```ts
import type { Plugin, Provider } from 'mu-core';
import { listModels } from './models';
import { streamChat } from './stream';

export interface OpenAIProviderPluginConfig {
  /** Override id; defaults to 'openai'. */
  id?: string;
}

export function createOpenAIProviderPlugin(config: OpenAIProviderPluginConfig = {}): Plugin {
  const provider: Provider = {
    id: config.id ?? 'openai',
    streamChat: (messages, cfg, model, options) => streamChat(messages, cfg, model, options),
    listModels: (cfg) => listModels(cfg.baseUrl),
  };
  return {
    name: 'mu-openai-provider',
    version: '0.5.0',
    activate(ctx) {
      ctx.providers?.register(provider);
    },
  };
}

export default createOpenAIProviderPlugin;
```

`mu-openai-provider/src/index.ts` re-exporte :
- `streamChat`, `listModels` — entry points ad-hoc (scripts, tests)
- `createOpenAIProviderPlugin`, `OpenAIProviderPluginConfig`, default export
- Types LLM ré-exportés depuis `mu-core` (compat ascendante des imports
  `from 'mu-openai-provider'`)

### 4.3 Pas de `format.ts` ni `adapter.ts`

Les helpers `toOpenAIMessages` / `parseOpenAIChunk` / `parseOpenAIUsage` ne
sont **pas** exposés : leur logique vit dans `stream.ts` (privée, fournie
par le SDK lui-même). Un futur `mu-ollama-provider` qui souhaiterait parler
OpenAI-compat sans le SDK implémentera son propre `ProviderAdapter` via
`createProvider(...)` (cf. §3.2).

## 5. mu-agents — détail

### 5.1 Frontmatter (schéma final)

```yaml
---
id: build                           # canonique, remplace `name`
description: Execute code changes
agent: primary                      # primary | subagent
model: openai/qwen-3.6-35b          # optionnel, "providerId/model"
enabled: true                       # défaut true
color: "#3498db"
tools:
  bash:
    "git *": allow
    "rm -rf *": deny
    "*": ask
  read_file: allow
  write_file:
    "**/.env": deny
    "src/**": allow
    "**": ask
  subagent: allow
---

System prompt body...
```

Champs supportés : `id`, `description`, `agent`, `model`, `enabled`, `color`, `tools`.
Tout autre champ → ignoré (compat ascendante avec frontmatters Arya).
**Drop** : `name` (utiliser `id`), `timezone`.

### 5.2 Permission resolver

`mu-agents/src/permissions.ts` :

```ts
export type Action = 'allow' | 'deny' | 'ask';
export type ToolPermission = Action | Record<string /* glob */, Action>;
export type PermissionMap = Record<string /* tool */, ToolPermission>;

export interface PermissionContext {
  toolName: string;
  args: Record<string, unknown>;
  matchKey?: (args: Record<string, unknown>) => string | undefined;
}

/** Résout la règle pour un appel donné. */
export function resolvePermission(
  rule: ToolPermission | undefined,
  ctx: PermissionContext,
): Action;
```

Algorithme :
1. `rule === undefined` (tool pas dans la map) → `'deny'`
2. `typeof rule === 'string'` → action directe
3. Object form sans `matchKey` → **erreur au chargement** (validé en amont,
   pas à l'exécution)
4. Object form avec `matchKey` :
   - extraire la clé via `matchKey(args)`
   - parcourir les entrées dans l'ordre déclaré
   - premier match picomatch (avec `dot: true`) → action
   - aucun match → `'deny'`

Validation au load : un parser inspecte chaque `.md` et croise avec les
`PluginTool.permission?.matchKey` enregistrés. Si un tool reçoit une règle
glob mais n'a pas de `matchKey`, le `.md` est rejeté avec un message clair.
Le validation s'exécute après que tous les plugins ont été enregistrés (sinon
on ne connaît pas encore les `matchKey`).

### 5.3 ApprovalGateway

`mu-agents/src/approval.ts` :

```ts
export interface ApprovalRequest {
  id: string;
  token: string;
  agentId: string;
  toolName: string;
  toolArgs: unknown;
  channelId: string;
  createdAt: number;
  status: 'pending' | 'approved' | 'denied' | 'timeout';
  approveUrl?: string;
  denyUrl?: string;
}

export type ApprovalResult = 'approved' | 'denied' | 'timeout';

export interface ApprovalChannel {
  sendApprovalRequest(request: ApprovalRequest): Promise<void>;
}

export interface ApprovalGateway {
  request(input: {
    agentId: string;
    toolName: string;
    toolArgs: unknown;
    channelId: string;
    timeoutMs?: number;
  }): Promise<ApprovalResult>;
  registerChannel(channelId: string, channel: ApprovalChannel): () => void;
  approve(token: string): void;
  deny(token: string): void;
  setApprovalBaseUrl(url: string): void;
}

export function createApprovalGateway(): ApprovalGateway;
```

Le gateway :
- génère un token unique par requête
- envoie au(x) channel(s) enregistré(s)
- attend `approve(token)` / `deny(token)` ou timeout
- retourne le résultat

mu-coding fournit un `InkUIServiceApprovalChannel` qui réémet vers
`uiService.confirm` (dialogue Ink). Arya enregistre Telegram + Companion.

### 5.4 Chargement markdown avec watch

`mu-agents/src/sources.ts` :

```ts
export interface AgentSource {
  path: string;
  unwatch: () => void;
}

export class AgentSourceManager implements AgentSourceRegistry {
  registerSource(absoluteDirPath: string): () => void;
  list(): AgentDefinition[];
  onChange(listener: (agents: AgentDefinition[]) => void): () => void;
}
```

Utilise `chokidar` (déjà disponible — vérifier dépendance, sinon `bun add chokidar`).
Debounce 100ms. Re-parse tous les `.md` du répertoire après changement.
Émet aux listeners. `AgentManager` re-merge avec les overrides utilisateur
(`~/.config/mu/agents/`).

### 5.5 Outils sous-agents

Inchangés au niveau logique — `subagent` et `subagent_parallel` restent dans
mu-agents, utilisent `runAgent` avec un registry shimé qui force la
permission map du sous-agent. Mise à jour : déclarer un `matchKey` à
`undefined` (pas de chemin), donc seul le format simple (`allow`/`deny`/`ask`)
est accepté pour configurer ces outils.

### 5.6 UX (renderers, commands, shortcuts, mentions) — inchangé

Renderers `mu-agent.switch`, `mu-agent.indicator`, `mu-agent.subagent`,
slash commands `/build`, `/plan`, `/agent`, shortcut `Tab`, mention provider
`@<subagent>` — tout reste fonctionnel après les renames d'imports.

### 5.7 Factory plugin

`mu-agents/src/plugin.tsx` :
- Renommer `createMuAgentPlugin` → `createAgentsPlugin`
- Default export = factory
- Activate :
  - construit `AgentSourceManager`
  - construit `AgentManager` (état actif, persistence)
  - construit `ApprovalGateway`
  - enregistre `ctx.agents` (le `AgentSourceRegistry`)
  - charge les overrides utilisateur (`~/.config/mu/agents/`) automatiquement
  - enregistre commandes / shortcut / mentions / renderers
  - hooks lifecycle : `beforeLlmCall` (snapshot model), `transformSystemPrompt`,
    `filterTools`, `beforeToolExec` (avec gateway pour `ask`)

### 5.8 Index public

```ts
export { createAgentsPlugin, default } from './plugin.tsx';
export type { AgentDefinition, AgentSettings } from './types.ts';
export type {
  ApprovalChannel, ApprovalRequest, ApprovalResult, ApprovalGateway,
} from './approval.ts';
export type { Action, ToolPermission, PermissionMap } from './permissions.ts';
export { resolvePermission } from './permissions.ts';
```

## 6. mu-coding-agents — détail

```
packages/mu-coding-agents/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   └── plugin.ts
└── agents/
    ├── build.md
    ├── plan.md
    ├── explore.md
    └── review.md
```

`package.json#files: ["src", "agents", "README.md"]`.

`src/plugin.ts` :
```ts
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function createCodingAgentsPlugin() {
  const here = dirname(fileURLToPath(import.meta.url));
  const agentsDir = join(here, '..', 'agents');
  return {
    name: 'mu-coding-agents',
    version: '0.5.0',
    activate(ctx) {
      ctx.agents?.registerSource(agentsDir);
    },
  };
}
```

Quatre `.md` au format final (frontmatter avec `id`, `tools` avec globs).
Contenu :
- `build.md` — primary, modèle agnostic, tools : bash + read_file (allow) +
  write_file/edit_file (allow `src/**` + `tests/**`, deny `**/.env`,
  ask `**`) + subagent
- `plan.md` — primary, read-only, tools : read_file + search_code
- `explore.md` — subagent, tools : read_file + search_code + bash (allow `git *`,
  ask `*`)
- `review.md` — subagent, tools : read_file + search_code + bash (allow `git diff *`,
  allow `git log *`, ask `*`)

## 7. mu-coding — refactor

### 7.1 Outils coding

Nouveau dossier `mu-coding/src/runtime/codingTools/` :
- `bash.ts` (déplacé depuis l'ancien mu-agents/src/builtin/)
- `read-file.ts`
- `write-file.ts`
- `edit-file.ts`
- `index.ts` exportant `createCodingToolsPlugin()`

Chaque outil ajoute `permission.matchKey` :
- `read_file`/`write_file`/`edit_file` : `(a) => a.path as string`
- `bash` : `(a) => a.cmd as string`

`createBuiltinPlugin` est renommé/remplacé par `createCodingToolsPlugin`.
`createRegistry` enregistre `createCodingToolsPlugin()` au lieu de
`createBuiltinPlugin()`.

### 7.2 TUI comme Channel

`mu-coding/src/tui/channel/tuiChannel.ts` (nouveau) :

```ts
import type { Channel, Session, SessionManager } from 'mu-core';

export interface TuiChannelOptions {
  sessions: SessionManager;
  config: AppConfig;
  uiService: InkUIService;
  // ... autres deps
}

export function createTuiChannel(opts: TuiChannelOptions): Channel {
  return {
    id: 'tui',
    async start() {
      const session = opts.sessions.getOrCreate('tui');
      // monter Ink, brancher session events → React state
      renderApp({ session, ... });
    },
    async stop() {
      // unmount Ink
    },
  };
}
```

Le plugin `mu-coding` enregistre son channel via `ctx.channels?.register(...)`.

### 7.3 useChatSession adapté

`useChatSession` consomme un `Session` au lieu de gérer messages/streaming
directement. La session est passée via context React.

```ts
// avant : useChatSession({ config, currentModel, ..., registry })
// après : useChatSession({ session })
```

Internement :
- `session.subscribe` → met à jour les states React (messages, streaming, error)
- `session.submit({ kind: 'text', text, sessionId: 'tui', channelId: 'tui' }, responder)` au submit
- `session.abort()` au Ctrl+C

Le `responder` côté TUI est une struct qui appelle `session.appendSynthetic`
pour les réponses synchrones. (En pratique, le TUI consomme les events et
l'UI se met à jour automatiquement, donc les méthodes du responder peuvent
être no-op ou écrire dans la transcript.)

### 7.4 Persistence

`mu-coding/src/sessions/index.ts` reste responsable de l'écriture JSONL.
Nouveau wiring : un listener `session.subscribe` écoute `messages_changed` et
appelle `saveSession(path, messages)`. Ne dépend plus de `useChatSession`.

### 7.5 Approval channel adapter

`mu-coding/src/tui/plugins/InkApprovalChannel.ts` (nouveau) :

```ts
import type { ApprovalChannel, ApprovalRequest } from 'mu-agents';
import type { InkUIService } from './InkUIService.ts';

export function createInkApprovalChannel(ui: InkUIService): ApprovalChannel {
  return {
    async sendApprovalRequest(req) {
      const ok = await ui.confirm(
        `Approve ${req.toolName}?`,
        formatToolArgs(req.toolArgs),
      );
      // Note: le gateway n'est pas appelé directement — on doit signaler le
      // résultat. Approche : exposer un callback dans le request, ou avoir
      // accès au gateway. À résoudre proprement à l'implémentation.
    },
  };
}
```

À la conception : le mécanisme de retour vers le gateway. Deux options :
- a) `ApprovalChannel.sendApprovalRequest` retourne `Promise<ApprovalResult>` directement (channel bloque sur l'UX). Plus simple pour Ink.
- b) Le channel appelle `gateway.approve(token)` / `gateway.deny(token)` (pattern Arya pour HTTP).

Décision : **supporter les deux**. L'interface devient :
```ts
export interface ApprovalChannel {
  sendApprovalRequest(req: ApprovalRequest):
    Promise<ApprovalResult | void>;
}
```
Si le channel renvoie `void`, le gateway attend `approve/deny` externe (Arya HTTP / Telegram callback). Si le channel renvoie un résultat, le gateway l'honore. mu-coding utilise la forme synchrone.

### 7.6 Binaire et bootstrap

`mu-coding/bin/mu.js` reste le point d'entrée. `src/main.ts` devient :

```ts
import { startMu } from 'mu-core';
import openai from 'mu-openai-provider';
import agents from 'mu-agents';
import codingAgents from 'mu-coding-agents';
import { createCodingPlugin } from './plugin.ts';

const handle = await startMu({
  configPath: getConfigPath(),
  plugins: [openai(), agents(), codingAgents(), createCodingPlugin()],
});

// SIGINT etc.
```

`src/plugin.ts` (nouveau) — le plugin coding :
```ts
export function createCodingPlugin() {
  return {
    name: 'mu-coding',
    activate(ctx) {
      ctx.channels?.register(createTuiChannel({ ... }));
      // enregistrer outils coding
      // enregistrer ApprovalChannel
      // SYSTEM.md coding via plugin.systemPrompt
    },
  };
}
```

### 7.7 Plus de createRegistry custom

L'actuel `createRegistry` est remplacé par le mécanisme de `startMu`. Les
plugins listés dans `config.plugins` sont chargés exactement comme avant
(via `loadConfiguredPlugin`), plus ceux passés en code via `startMu`.

## 8. mu-repomap — détail

Aucun changement fonctionnel. Mises à jour :
- `from 'mu-agents'` → `from 'mu-core'` (types Plugin, PluginTool, etc.)
- `package.json` : dependency `mu-agents` → `mu-core`
- `tsconfig.json` : reference `mu-agents` → `mu-core`

## 9. Plomberie workspace

### 9.1 tsconfig.json (root)

```json
{
  "files": [],
  "references": [
    { "path": "packages/mu-core" },
    { "path": "packages/mu-openai-provider" },
    { "path": "packages/mu-agents" },
    { "path": "packages/mu-repomap" },
    { "path": "packages/mu-coding-agents" },
    { "path": "packages/mu-coding" }
  ]
}
```

### 9.2 Per-package tsconfig.json

- `mu-openai-provider` → references `mu-core`
- `mu-agents` → references `mu-core`
- `mu-repomap` → references `mu-core`
- `mu-coding-agents` → references `mu-core`, `mu-agents`
- `mu-coding` → references `mu-core`, `mu-openai-provider`, `mu-agents`, `mu-coding-agents`

### 9.3 Per-package package.json

Mises à jour des champs `name`, `dependencies`, `version` (toutes restent à `0.5.0`).

### 9.4 knip.json

Mettre à jour les noms de paquets si listés. Ajouter `mu-coding-agents` et
`mu-coding-agents/agents/*.md` aux sources si knip cherche dans `src` par défaut.

### 9.5 README.md (root)

Mise à jour de la liste des paquets, du diagramme de dépendance, de la
section Plugin Configuration pour mentionner les nouveaux noms.

## 10. Tests

### 10.1 Existants à migrer

103 tests existent. Mettre à jour les imports :
- `from 'mu-agents'` → `from 'mu-core'`
- `from 'mu-provider'` → `from 'mu-core'` (types) ou `from 'mu-openai-provider'` (plugin)
- Tests du plugin `mu-agent` → mettre à jour vers `mu-agents`

### 10.2 Nouveaux tests

#### mu-core
- `provider/transport.test.ts` : `readSSE`, `readNDJSON`, idle timeout
- `provider/createProvider.test.ts` : adapter SSE, adapter NDJSON, error paths
- `provider/registry.test.ts` : register/get/list, double-registration
- `session.test.ts` : multi-session, submit, subscribe, queue next turn
- `activity.test.ts` : émission, multiple listeners, sub-agent stream
- `host/startMu.test.ts` : config + plugins en code, ordre d'activation

#### mu-openai-provider
- `stream.test.ts` (existant, étendu) :
  - streaming content + reasoning (incluant `reasoning_content` non-standard)
  - accumulation tool_calls (cas standard et `finish_reason: 'stop'`,
    fallback sans `finish_reason`)
  - propagation de `usage` (avec `cached_tokens`)
  - erreurs HTTP propagées par le SDK
  - timeout d'inactivité (mock du SDK)
- Pas de `format.test.ts` ni `adapter.test.ts` : ces modules n'existent plus.

#### mu-agents
- `permissions.test.ts` : `resolvePermission` :
  - tool absent → deny
  - simple action allow/deny/ask
  - object form → ordre, premier match, default deny
  - matchKey absent + object form → erreur au load (test du validateur)
  - bash command glob avec picomatch
- `approval.test.ts` :
  - request happy path (canal sync)
  - request avec canal async (approve/deny par token)
  - timeout
  - multiple canaux enregistrés
- `sources.test.ts` :
  - registerSource ajoute des agents
  - watch détecte ajout/suppression/modif (utilise `tmpdir`)
  - debounce
- `markdown.test.ts` (existant, mis à jour pour nouveau schéma) :
  - parser `id` + `model` + `enabled` + `tools` (objet)
  - rejet de `name` (warning ou alias ?) — décision : `id` est canonique, `name` ignoré silencieusement
- `manager.test.ts` (existant, paths mis à jour)

#### mu-coding-agents
- Smoke test : factory enregistre un source, source contient les 4 agents
  attendus

#### mu-coding
- Tests existants mis à jour pour nouveaux paths
- Nouveaux : `tuiChannel.test.ts` (smoke), `InkApprovalChannel.test.ts`

### 11.1 Tests supprimés

- `mu-openai-provider/src/format.test.ts` — supprimé en même temps que
  `format.ts` (cf. §4.3).

### 10.3 Couverture cible

Pas de seuil dur, mais : chaque nouveau type d'API public doit avoir au
moins un test happy path et un test edge case clair.

## 11. Migration des tests existants

Liste des fichiers de test à migrer :
- `packages/mu-agents/src/hooks.test.ts` → `packages/mu-core/src/hooks.test.ts`
- `packages/mu-agent/src/markdown.test.ts` → `packages/mu-agents/src/markdown.test.ts` (avec mise à jour du schéma)
- `packages/mu-agent/src/manager.test.ts` → `packages/mu-agents/src/manager.test.ts`
- `packages/mu-coding/src/runtime/messageBus.test.ts` → conserver mais adapter (MessageBus disparaît, tests reciblés sur `Session`)
- Tests dans `mu-coding/src/config/`, `sessions/`, `utils/`, `tui/input/` → import path updates seulement
- `mu-repomap` tests → mêmes updates

## 12. Ordre d'exécution (Stratégie B — 3 commits avec gates verts)

### Commit 1 — Renommages + déplacement types LLM

**Scope** :
- Renommer paquets sur disque (sans toucher contenu fonctionnel)
- Déplacer types LLM de `mu-provider` (renommé) vers `mu-core`
- Mettre à jour tous les imports (`from 'mu-agents'` → `from 'mu-core'`,
  `from 'mu-provider'` → `from 'mu-core'` pour les types et
  `from 'mu-openai-provider'` pour ce qui reste OpenAI-spécifique)
- Mettre à jour tsconfig references, package.json deps, knip.json
- `bun install`

**Gate** : `tsc -b` + `biome check` + `bun test` + `knip` tous verts.
Aucun changement fonctionnel attendu — refacto purement mécanique.

### Commit 2 — Nouvelles abstractions

**Scope** :
- mu-core : `Channel`, `InboundMessage`, `ChannelResponder`, `Session`,
  `SessionManager`, `ActivityBus`, `Provider` interface, registres
  (`ProviderRegistry`, `ChannelRegistry`), `startMu`. Voie adapter optionnelle :
  `ProviderAdapter`, `createProvider`, `readSSE`, `readNDJSON`,
  `fetchWithIdleTimeout` (utiles pour des providers non-SDK ; mu-openai-provider
  ne s'en sert pas).
- mu-openai-provider : `createOpenAIProviderPlugin` enregistre un `Provider`
  qui wrappe directement le SDK `openai` (`streamChat` + `listModels`
  conservés). Pas d'adapter.
- mu-coding : `useChatSession` rebranché sur `Session`, persistence via
  `session.subscribe`, le TUI reste mais devient préparé à être un Channel
  (la registration via `ctx.channels` arrive au commit 3)
- Tests : SessionManager, ActivityBus, transport (pour la voie adapter),
  registry providers, startMu, `Session.submit`/`subscribe`/`queueForNextTurn`,
  stream OpenAI (SDK-based) inchangé.

**Gate** : tous verts. Smoke test : `mu` se lance, agent répond, switch
fonctionne, persistence écrit toujours JSONL.

### Commit 3 — Permissions + approval + TUI-as-Channel + nouveaux paquets

**Scope** :
- mu-agents : nouveau frontmatter, permissions avec globs picomatch,
  validation au load (erreur si glob sur tool sans matchKey), `ApprovalGateway`,
  `ApprovalChannel`, `registerSource` avec watch chokidar
- mu-coding-agents : nouveau paquet avec les 4 `.md` au nouveau schéma + plugin
- mu-coding : outils coding rapatriés depuis ancien `mu-agents/builtin`,
  TUI enregistré comme Channel, `InkApprovalChannel`, plugin coding qui
  branche tout
- Tests : permissions resolver complet, approval flow, sources hot-reload,
  picomatch globs

**Gate** : tous verts. Smoke test complet : agents s'affichent, `/build` /
`/plan` switch, `Tab` cycle, `@review` autocomplete, un outil `write_file`
sur `**/.env` est refusé sans appel, sur `**` demande confirmation, sur
`src/foo.ts` passe.

## 13. Risques identifiés

1. **Ink + Channel.start() lifecycle** — Ink prend possession du terminal.
   `Channel.start()` doit pouvoir bloquer ou retourner avec un callback de
   shutdown propre. Vérifier que Ink unmount proprement à `stop()`.

2. **Hot-reload des `.md` pendant streaming** — si un agent voit son prompt
   modifié pendant qu'il répond, comportement indéfini. Décision : le change
   prend effet au tour suivant ; ne pas interrompre le run en cours.

3. **picomatch et caractères spéciaux dans `bash`** — `cmd: "echo $(date)"`,
   les `$()`, `\``, etc. Décision : matching brut, l'utilisateur écrit ses
   globs en conséquence. Pas d'échappement implicite.

4. **Multi-session avec une seule UI** — mu-coding ne gère qu'une session
   `'tui'` ; la `SessionManager` peut en créer d'autres en interne (subagents),
   mais la TUI ne les affiche pas. Décision OK pour Phase 1.

5. **Permission resolver appelé avec `args` malformé** — protection : try/catch
   autour de l'appel `matchKey`, fallback à `deny` + log warning.

6. **`startMu` ordre des plugins** — l'ordre d'enregistrement compte pour
   les hooks (`filterTools` compose). `config.plugins` puis `options.plugins`.
   Décision : config d'abord, code après. Documenter.

7. **Backward compat des sessions JSONL** — les sessions existantes ont des
   messages sans `customType`/`display`/`meta`. Le parser doit tolérer ces
   champs absents (déjà optionnels dans le schéma).

## 14. Effort estimé

| Phase | Durée |
|---|---|
| Commit 1 (renames + types move) | 2-3h |
| Commit 2 (abstractions + provider plugin) | 5-7h |
| Commit 3 (permissions + approval + channels + nouveaux paquets) | 5-7h |
| Tests (intégrés à chaque commit) | inclus |
| **Total** | **12-17h** |

## 15. Hors scope (Phase 2+)

- Plugins Arya-spécifiques (`mu-telegram-channel`, `mu-voice`, etc.) — restent
  chez Arya
- Skills/tasks/prompts (autres types de définitions markdown) — Phase 2
- Permissions enrichies au-delà du path/cmd glob (rate limit, time-of-day, etc.)
- Channel "primary" (exclusivité terminal) — pas nécessaire tant qu'on a un seul host TUI
- Backward-compat des frontmatters `name:` (alias) — décision : drop net,
  aucune `.md` existante n'a `name:` à part les défauts ports qu'on rewrite
- Migration script CLI (`mu migrate-agents`) pour utilisateurs externes — pas
  nécessaire en pre-1.0

## 16. Validation finale

Avant merge :
- [ ] `tsc -b` vert
- [ ] `biome check packages/` vert
- [ ] `bun test packages/` 100% pass
- [ ] `knip` exit 0
- [ ] Smoke test manuel : `mu` lance, /build, /plan, Tab, @review, write_file deny/ask/allow paths
- [ ] README root + per-package à jour
- [ ] Aucun import résiduel `from 'mu-provider'` dans le code
- [ ] Aucun import résiduel `from 'mu-agent'` (singulier)

## 17. Notes pour l'implémenteur (moi)

- Commencer par Commit 1 en pur mécanique. Ne pas profiter du rename pour
  refactorer du contenu — ça brouille la diff.
- Pour Commit 2, écrire les nouvelles interfaces d'abord, puis les
  implémentations, puis brancher mu-coding. Tester unité par unité.
- Pour Commit 3, attaquer les permissions en premier (résolveur + tests),
  puis l'approval gateway (résolveur + tests), puis le wiring TUI.
- Garder un fichier de bouts de code à supprimer en queue (l'ancien
  `MessageBus`, l'ancien `createBuiltinPlugin`, etc.) et nettoyer en fin de commit 3.
- Lancer `bun install` à chaque renommage de paquet — sinon les symlinks
  workspace ne sont pas à jour et les imports ne résolvent pas.
