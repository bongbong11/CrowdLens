// Base card/persona fields; selected linked lore is assembled separately by source-reader.
export function readSheets(context) {
    const character = context.characters?.[context.characterId];
    const card = character?.data || character;
    const entry = context.powerUserSettings?.persona_descriptions?.[context.user_avatar];
    return {
        character: {
            name: card?.name || character?.name || context.name2 || '',
            description: card?.description || '',
            personality: card?.personality || '',
        },
        persona: {
            name: context.name1 || entry?.name || '',
            description: context.personaDescription || context.persona?.description
                || (typeof entry === 'string' ? entry : entry?.description)
                || context.powerUserSettings?.persona_description || '',
        },
    };
}
