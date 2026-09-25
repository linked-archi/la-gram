/**
 * Collaboration: join a room, keep the model in sync, show who is here.
 *
 * ```
 * ?room=shop            join room "shop" on ws://localhost:1234
 * ?room=shop&ws=wss://… another server
 * ?room=shop&user=Ana   the name the others see
 * ```
 *
 * Without `?room`, nothing connects; the toolbar's "Share" asks for a room
 * name, puts it in the URL and joins — pushing the current model into the room
 * when the room is new, or taking the room's model when it already has one.
 *
 * The pieces:
 *
 * - {@link RdfYjsBinding} keeps the store's default graph and the room's Y.Doc
 *   equal (see its header for the document shape and conflict rule);
 * - Yjs *awareness* carries each client's name, colour, open view and
 *   selection. What others have selected is highlighted and locked on this
 *   canvas, so two people do not drag the same box;
 * - Hocuspocus is the transport (`server/collab-server.mjs` is the server).
 */

import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { App } from '../app.js';
import type { MountedUi } from '../ui/mount-ui.js';
import { ObservableRdfStore } from '../rdf-engine/observable-store.js';
import { RdfYjsBinding, type SeedPolicy } from './rdf-yjs-binding.js';
import { domDialogs } from '../ui/dialogs.js';

/** Default collaboration server. */
export const DEFAULT_COLLAB_SERVER = 'ws://localhost:1234';

/** CSS marker for concepts another collaborator has selected. */
export const REMOTE_SELECTION_MARKER = 'la-remote-selected';

/** Colours handed to collaborators, by a hash of their client id. */
const PEER_COLORS = ['#e8710a', '#9334e6', '#12b5cb', '#d93025', '#188038', '#1a73e8', '#f538a0', '#795548'];

/** What a client publishes about itself. */
export interface PresenceState {
  user: { name: string; color: string };
  viewIri?: string;
  selection: string[];
}

/** Options for {@link startCollaboration}. */
export interface CollaborationOptions {
  room?: string;
  serverUrl?: string;
  userName?: string;
}

/** Handle on the running collaboration. */
export interface Collaboration {
  isConnected(): boolean;
  /** Join a room (the "Share" action). */
  join(room: string, policy?: SeedPolicy): void;
  leave(): void;
  room(): string | undefined;
  /** What every connected client (this one included) currently publishes. */
  presence(): Array<PresenceState & { clientId: number; self: boolean }>;
}

/** Wire collaboration into a mounted app. Connects only when a room is given or chosen. */
export function startCollaboration(app: App, ui: MountedUi, options: CollaborationOptions = {}): Collaboration {
  const { eventBus } = app.components;
  const store = app.components.store;
  const serverUrl = options.serverUrl ?? DEFAULT_COLLAB_SERVER;
  const userName = options.userName ?? `Guest ${Math.floor(Math.random() * 900 + 100)}`;

  let provider: HocuspocusProvider | null = null;
  let binding: RdfYjsBinding | null = null;
  let doc: Y.Doc | null = null;
  let currentRoom: string | undefined;
  let status: 'off' | 'connecting' | 'connected' | 'disconnected' = 'off';
  let selection: string[] = [];

  const setIndicator = (peers: Array<{ name: string; color: string }> = []) => {
    ui.appToolbar.collab = { status, ...(currentRoom ? { room: currentRoom } : {}), peers };
    eventBus.emit('collab-status', { status, room: currentRoom });
  };

  /** Re-read the others' presence: highlight and lock what they hold. */
  const onAwareness = () => {
    const awareness = provider?.awareness;
    if (!awareness) return;
    const peers: Array<{ name: string; color: string }> = [];
    const held = new Set<string>();
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue;
      const s = state as Partial<PresenceState>;
      if (!s.user) continue;
      peers.push(s.user);
      for (const iri of s.selection ?? []) held.add(iri);
    }
    ui.diagramCanvas.setMarkers(REMOTE_SELECTION_MARKER, held);
    ui.diagramCanvas.setLockedIris(held);
    setIndicator(peers);
    eventBus.emit('peers-changed', { peers, held: [...held] });
  };

  const publish = () => {
    provider?.awareness?.setLocalStateField('viewIri', app.session.activeViewIri);
    provider?.awareness?.setLocalStateField('selection', selection);
  };

  const onSelection = (event: { detail?: Record<string, unknown> }) => {
    const iris = (event.detail?.iris as string[] | undefined) ?? (event.detail?.iri ? [event.detail.iri as string] : []);
    selection = iris.filter(Boolean);
    publish();
  };

  const join = (room: string, policy: SeedPolicy = 'prefer-room') => {
    if (!(store instanceof ObservableRdfStore)) {
      console.warn('[collab] The store is not observable; collaboration is unavailable.');
      return;
    }
    leave();
    currentRoom = room;
    app.collaborationRoom = room;
    status = 'connecting';
    setIndicator();
    doc = new Y.Doc();
    const color = PEER_COLORS[doc.clientID % PEER_COLORS.length];
    binding = new RdfYjsBinding(store, doc, {
      onRemoteChange: () => eventBus.emit('model-changed', { origin: 'remote' }),
    });
    provider = new HocuspocusProvider({
      url: serverUrl,
      name: room,
      document: doc,
      onStatus: ({ status: s }: { status: string }) => {
        status = s === 'connected' ? 'connected' : s === 'connecting' ? 'connecting' : 'disconnected';
        setIndicator();
      },
      onSynced: () => {
        if (!binding) return;
        const hadRoomContent = (doc?.getMap('triples').size ?? 0) > 0;
        binding.start(policy);
        if (hadRoomContent && policy === 'prefer-room') {
          // The room's model replaced ours: adopt it (model resource, views).
          app.session.adopt({ emit: true });
        }
        status = 'connected';
        onAwareness();
      },
    } as ConstructorParameters<typeof HocuspocusProvider>[0]);
    provider.awareness?.setLocalStateField('user', { name: userName, color });
    publish();
    provider.awareness?.on('change', onAwareness);
  };

  function leave(): void {
    binding?.stop();
    provider?.awareness?.off('change', onAwareness);
    provider?.destroy();
    doc?.destroy();
    binding = null;
    provider = null;
    doc = null;
    currentRoom = undefined;
    app.collaborationRoom = undefined;
    status = 'off';
    ui.diagramCanvas.setLockedIris(new Set());
    ui.diagramCanvas.setMarkers(REMOTE_SELECTION_MARKER, new Set());
    setIndicator();
  }

  // The toolbar's "Share": pick a room, put it in the URL, join with our model.
  const onShareRequest = async (event: { detail?: Record<string, unknown> }) => {
    if (event.detail?.request !== 'share') return;
    if (currentRoom) {
      const url = window.location.href;
      await domDialogs.info('Collaborating', [
        `Room: ${currentRoom}`,
        `Server: ${serverUrl}`,
        `Status: ${status}`,
        'Share this address with your collaborators:',
        url,
      ]);
      return;
    }
    const room = await domDialogs.prompt('Share this model', 'Room name', `model-${Math.random().toString(36).slice(2, 8)}`);
    if (!room) return;
    const url = new URL(window.location.href);
    url.searchParams.set('room', room);
    window.history.replaceState(null, '', url);
    join(room, 'prefer-room');
  };

  eventBus.on('selection-changed', onSelection);
  eventBus.on('view-opened', publish);
  eventBus.on('collab-status', onShareRequest);

  if (options.room) join(options.room);
  else setIndicator();

  return {
    isConnected: () => status === 'connected',
    join,
    leave,
    room: () => currentRoom,
    presence: () => {
      const awareness = provider?.awareness;
      if (!awareness) return [];
      return [...awareness.getStates()].map(([clientId, state]) => ({
        ...(state as PresenceState),
        clientId,
        self: clientId === awareness.clientID,
      }));
    },
  };
}
