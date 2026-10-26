import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedBooks, prepareSource, sourceCandidates } from '../src/source-reader.js';
import { defaultSelection, sourceIdentity } from '../src/source-selection.js';
import { captureProfile } from '../src/snapshot.js';

function fixture() {
    const context = { characterId: 0, chatId: 'chat', user_avatar: 'persona.png', name1: 'Persona', characters: [{ avatar: 'char.png', data: { name: 'Character', description: 'UNSELECTED_CARD', personality: 'UNSELECTED_TRAIT', extensions: { world: 'Primary' } } }], powerUserSettings: { persona_description: 'UNSELECTED_PERSONA', persona_description_lorebook: 'GlobalPersona', persona_descriptions: { 'persona.png': { name: 'Persona', lorebook: 'ActivePersona' } } }, chat: [] };
    const books = { Primary: { entries: { 1: { comment: 'Career', content: 'SELECTED_PRIMARY' }, 2: { content: 'UNSELECTED_LORE' }, 3: { content: 'DISABLED', disable: true } } }, Extra: { entries: { 4: { content: 'SHARED_SELECTED' } } }, Unused: { entries: { 9: { content: 'UNSELECTED_BOOK' } } }, GlobalPersona: { entries: { 5: { content: 'SHARED_SELECTED' } } }, ActivePersona: { entries: { 6: { content: 'SELECTED_ACTIVE_PERSONA' } } } };
    const calls = [], world = { world_info: { charLore: [{ name: 'char', extraBooks: ['Extra', 'Unused', 'Primary'] }] }, loadWorldInfo: async name => { calls.push(name); return books[name]; } };
    return { context, books, calls, world };
}
test('card primary/additional and persona global/active books are available without duplicate books', async () => {
    const f = fixture();
    assert.deepEqual(linkedBooks(f.context, f.world.world_info, 'character').map(x => x.book), ['Primary', 'Extra', 'Unused']);
    assert.deepEqual(linkedBooks(f.context, f.world.world_info, 'persona').map(x => x.book), ['GlobalPersona', 'ActivePersona']);
    const candidates = await sourceCandidates(f.context, f.world);
    assert.equal(candidates.character[0].entries.length, 2);
    assert.equal(new Set(f.calls).size, f.calls.length);
});
test('only selected sources reach profile input; identical cross-persona lore content occurs once', async () => {
    const f = fixture(), selection = { character: { sheet: false, lore: [{ book: 'Primary', uid: '1' }, { book: 'Extra', uid: '4' }] }, persona: { sheet: false, lore: [{ book: 'GlobalPersona', uid: '5' }, { book: 'ActivePersona', uid: '6' }] } };
    const prepared = await prepareSource(f.context, selection, f.world), text = JSON.stringify(prepared.source);
    assert.equal(prepared.source.lore.length, 3);
    assert.equal(text.split('SHARED_SELECTED').length - 1, 1);
    assert.ok(!text.includes('UNSELECTED')); assert.ok(!f.calls.includes('Unused'));
    const id = sourceIdentity(f.context, 'main');
    const snapshot = captureProfile(f.context, { branch: 'main', sourceSelections: { [id.profileKey]: selection }, sourceInputs: { [id.profileKey]: prepared } });
    assert.equal(snapshot.profileKey, id.profileKey); assert.equal(snapshot.history, undefined);
    assert.equal(snapshot.source.character.description, ''); assert.ok(snapshot.source.character.loreIds.length);
});
test('missing, disabled or unlinked selected lore is an error instead of a silent omission', async () => {
    const f = fixture();
    for (const ref of [{ book: 'Primary', uid: '3' }, { book: 'Primary', uid: '999' }, { book: 'Unlinked', uid: '1' }]) {
        const choice = defaultSelection(); choice.character.lore = [ref];
        await assert.rejects(prepareSource(f.context, choice, f.world));
    }
    const choice = defaultSelection(); choice.character.sheet = false;
    await assert.rejects(prepareSource(f.context, choice, f.world), /하나 이상/);
});
test('profile capture works in an empty chat and keeps existing profile identifiers', () => {
    const f = fixture(), snapshot = captureProfile(f.context, { branch: 'main' }), id = sourceIdentity(f.context, 'main');
    assert.equal(snapshot.profileKey, id.profileKey);
    assert.equal(snapshot.scope.chat, 'chat'); assert.equal(snapshot.history, undefined);
    assert.notEqual(sourceIdentity(f.context, 'other').profileKey, id.profileKey);
});
