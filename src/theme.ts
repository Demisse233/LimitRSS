import { Settings } from "./types";

const THEME_CLASSES = ["ar-theme-light", "ar-theme-dark"];

export function applyDisplaySettings(settings: Settings) {
    const display = settings.display;
    const reading = settings.reading || { fadeReadArticles: true, boundaryScrollSwitch: true };
    document.querySelectorAll<HTMLElement>(".ar-tab, .ar-modal__backdrop").forEach((node) => {
        node.classList.remove(...THEME_CLASSES);
        if (display.theme === "light") node.classList.add("ar-theme-light");
        if (display.theme === "dark") node.classList.add("ar-theme-dark");
        node.classList.toggle("ar-read-fade", reading.fadeReadArticles !== false);
        node.style.setProperty("--ar-reader-font-size", `${display.fontSize || 15}px`);
        node.style.setProperty("--ar-reader-line-height", String(display.lineHeight || 1.7));
    });
}
