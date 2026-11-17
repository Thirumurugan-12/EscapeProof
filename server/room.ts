import { z } from 'zod';
import type { Action, NodeId, PlayerState, PlayView } from '../shared/types.ts';

const node = z.enum(['notebook', 'drawer', 'key', 'door']);
const text = z.string().min(1).max(2000);
export const roomSchema = z.object({
  title: z.string().min(3).max(90), subtitle: z.string().min(3).max(120), story: text,
  notebook: z.object({ title: text, introduction: text, clue: z.string().max(2000) }).strict(),
  drawer: z.object({ title: text, description: text, code: z.string().regex(/^\d{4}$/) }).strict(),
  key: z.object({ title: text, description: text, container: node }).strict(),
  door: z.object({ title: text, description: text, requiredItem: node }).strict(),
  hints: z.array(text).length(3),
  dependencies: z.array(z.object({ id: node, requires: z.array(node).max(4) }).strict()).length(4),
  intendedSolution: z.array(z.enum(['inspect-notebook', 'unlock-drawer', 'collect-key', 'escape'])).length(4)
}).strict();
export type Room = z.infer<typeof roomSchema>;
export const handcrafted: Room = {
  title: 'The Missing Inventor', subtitle: 'A disappearance. A locked workshop. One way out.',
  story: 'Professor Ellery vanished at midnight. His workshop is just as he left it: the lamp still warm, the notebook open, the door locked behind you. Somewhere among his unfinished inventions, he left a way out.',
  notebook: { title: "Ellery’s notebook", introduction: 'A leather-bound journal, filled with sketches of impossible machines. The final entry is underlined twice.', clue: '“My four clockwork birds perch in order: THREE on the first branch, ONE on the second, FOUR on the third, TWO on the last. Their numbers guard my drawer.”' },
  drawer: { title: 'Combination drawer', description: 'A brass lock with four numbered wheels. A small bird is engraved beside each wheel.', code: '3142' },
  key: { title: 'Workshop key', description: 'An old brass key with a crescent-shaped bow.', container: 'drawer' },
  door: { title: 'Workshop door', description: 'Heavy oak, reinforced with brass. There is a crescent-shaped keyhole beneath the handle.', requiredItem: 'key' },
  hints: ['The notebook on the workbench was left open for a reason.', 'Read the birds’ numbers in the order of their branches.', 'The four numbers in the journal form the drawer’s combination. The drawer holds your way out.'],
  dependencies: [{ id: 'notebook', requires: [] }, { id: 'drawer', requires: ['notebook'] }, { id: 'key', requires: ['drawer'] }, { id: 'door', requires: ['key'] }],
  intendedSolution: ['inspect-notebook', 'unlock-drawer', 'collect-key', 'escape']
};

export function validateRoom(input: unknown): Room {
  const room = roomSchema.parse(input);
  const deps = new Map(room.dependencies.map(d => [d.id, d.requires]));
  if (deps.size !== 4) throw new Error('Each puzzle node must appear exactly once.');
  const visited = new Set<NodeId>(), visiting = new Set<NodeId>();
  function visit(id: NodeId) {
    if (!deps.has(id)) throw new Error(`Missing reference: ${id}`);
    if (visiting.has(id)) throw new Error('Circular puzzle prerequisites.');
    if (visited.has(id)) return;
    visiting.add(id); for (const parent of deps.get(id)!) visit(parent);
    visiting.delete(id); visited.add(id);
  }
  for (const id of deps.keys()) visit(id);
  const expected = { notebook: [], drawer: ['notebook'], key: ['drawer'], door: ['key'] };
  for (const [id, required] of Object.entries(expected)) {
    if (JSON.stringify([...deps.get(id as NodeId)!].sort()) !== JSON.stringify(required)) throw new Error(`Unreachable or unsupported prerequisites for ${id}.`);
  }
  if (room.key.container !== 'drawer' || room.door.requiredItem !== 'key') throw new Error('Required key must be reachable in the drawer and unlock the door.');
  if (room.intendedSolution.join(',') !== 'inspect-notebook,unlock-drawer,collect-key,escape') throw new Error('Intended solution must preserve all three puzzle mechanics.');
  return room;
}

export function initialState(): PlayerState {
  return { started: false, inspected: [], drawerOpen: false, hasKey: false, escaped: false, hintsUsed: 0, startedAt: new Date().toISOString(), escapedAt: null, moves: 0 };
}
export function act(room: Room, original: PlayerState, action: Action): { state: PlayerState; message: string } {
  const state = structuredClone(original);
  if (state.escaped) return { state, message: 'You have already escaped. Start a new expedition to play again.' };
  state.started = true;
  state.moves++;
  let message = '';
  if (action.type === 'inspect') {
    if (action.target === 'key' && !state.drawerOpen) return { state, message: 'The drawer is still locked.' };
    if (!state.inspected.includes(action.target)) state.inspected.push(action.target);
    message = action.target === 'notebook' ? 'You open the journal to the final entry.' : room[action.target].description;
  } else if (action.type === 'unlock') {
    if (!state.inspected.includes('notebook')) message = 'Find and inspect the notebook clue first.';
    else if (action.code !== room.drawer.code) message = 'The wheels click, but the drawer stays locked. Try another combination.';
    else { state.drawerOpen = true; message = 'The lock clicks open. A brass key rests inside the drawer.'; }
  } else if (action.type === 'collect') {
    if (!state.drawerOpen) message = 'Unlock the drawer before collecting the key.';
    else { state.hasKey = true; message = 'Workshop key added to your inventory.'; }
  } else if (action.type === 'escape') {
    if (!state.hasKey) message = 'The door is locked. You need the workshop key.';
    else { state.escaped = true; state.escapedAt = new Date().toISOString(); message = 'You escaped! The workshop door swings open.'; }
  } else {
    state.hintsUsed = Math.min(3, state.hintsUsed + 1);
    message = room.hints[state.hintsUsed - 1];
  }
  return { state, message };
}
export function publicView(room: Room, state: PlayerState, meta: { id: string; source: string; published: boolean; verified: boolean }, message = ''): PlayView {
  return { room: { revision: meta.id, title: room.title, subtitle: room.subtitle, story: room.story, source: meta.source, published: meta.published, verified: meta.verified, notebookTitle: room.notebook.title, drawerTitle: room.drawer.title, keyTitle: room.key.title, doorTitle: room.door.title }, state, message,
    notebook: state.inspected.includes('notebook') ? `${room.notebook.introduction}\n\n${room.notebook.clue}` : null,
    hints: room.hints.slice(0, state.hintsUsed) };
}

export function assertSafeRepair(before: Room, after: Room) {
  validateRoom(after);
  if (after.drawer.code !== before.drawer.code || JSON.stringify(after.dependencies) !== JSON.stringify(before.dependencies) || after.key.container !== before.key.container || after.door.requiredItem !== before.door.requiredItem || JSON.stringify(after.intendedSolution) !== JSON.stringify(before.intendedSolution)) throw new Error('Repair changed a protected answer, prerequisite, item location, or solution.');
  if (!after.notebook.clue.trim()) throw new Error('Repair did not restore a discoverable clue.');
  assertNoRawAnswer(after);
}

export function assertNoRawAnswer(room: Room) {
  const presentation = [room.title, room.subtitle, room.story, room.notebook.title, room.notebook.introduction, room.notebook.clue, room.drawer.title, room.drawer.description, room.key.title, room.key.description, room.door.title, room.door.description, ...room.hints];
  if (presentation.some(text => text.includes(room.drawer.code))) throw new Error('Room may not print the raw combination in public presentation or hints.');
}
