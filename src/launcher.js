export function installLauncher(open) {
    function mount() {
    const menu = document.querySelector('#extensionsMenu');
    if (menu && !document.querySelector('#crowdlens-menu')) {
        const item = document.createElement('div'); item.id = 'crowdlens-menu'; item.className = 'list-group-item flex-container flexGap5'; item.tabIndex = 0; item.setAttribute('role', 'button');
        const icon = document.createElement('img'); icon.src = new URL('../icon.svg', import.meta.url).href; icon.alt = ''; icon.width = 22; icon.height = 22;
        item.append(icon, document.createTextNode('CrowdLens')); item.addEventListener('click', open); item.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); open(); } }); menu.append(item);
    }
    const wand = document.querySelector('#extensionsMenuButton'), host = wand?.parentElement;
    if (host && !document.querySelector('#crowdlens-shortcut')) {
        const button = document.createElement('button'); button.id = 'crowdlens-shortcut'; button.type = 'button'; button.className = 'interactable'; button.title = 'CrowdLens 열기'; button.setAttribute('aria-label', 'CrowdLens 열기');
        const icon = document.createElement('img'); icon.src = new URL('../icon.svg', import.meta.url).href; icon.alt = ''; button.append(icon); button.addEventListener('click', open);
        wand.insertAdjacentElement('afterend', button);
    }
    }
    mount();
    if (!document.querySelector('#crowdlens-shortcut')) {
        const observer = new MutationObserver(() => { mount(); if (document.querySelector('#crowdlens-shortcut')) observer.disconnect(); });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 30000);
    }
}
