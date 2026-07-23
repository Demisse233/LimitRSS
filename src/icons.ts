/**
 * Product icon layer.
 *
 * Keep the UI using local semantic names (`rss`, `save`, `settings`, ...),
 * and map them to Solar's line-duotone icons here.
 */

import addCircle from "@iconify-icons/solar/add-circle-line-duotone";
import altArrowDown from "@iconify-icons/solar/alt-arrow-down-line-duotone";
import altArrowLeft from "@iconify-icons/solar/alt-arrow-left-line-duotone";
import altArrowRight from "@iconify-icons/solar/alt-arrow-right-line-duotone";
import archive from "@iconify-icons/solar/archive-line-duotone";
import arrowRightUp from "@iconify-icons/solar/arrow-right-up-line-duotone";
import bell from "@iconify-icons/solar/bell-line-duotone";
import chart from "@iconify-icons/solar/chart-line-duotone";
import chartSquare from "@iconify-icons/solar/chart-square-line-duotone";
import checkCircle from "@iconify-icons/solar/check-circle-line-duotone";
import clockCircle from "@iconify-icons/solar/clock-circle-line-duotone";
import closeCircle from "@iconify-icons/solar/close-circle-line-duotone";
import code2 from "@iconify-icons/solar/code-2-line-duotone";
import copyIcon from "@iconify-icons/solar/copy-line-duotone";
import diskette from "@iconify-icons/solar/diskette-line-duotone";
import documentText from "@iconify-icons/solar/document-text-line-duotone";
import documents from "@iconify-icons/solar/documents-line-duotone";
import download from "@iconify-icons/solar/download-line-duotone";
import feed from "@iconify-icons/solar/feed-line-duotone";
import fileText from "@iconify-icons/solar/file-text-line-duotone";
import folder from "@iconify-icons/solar/folder-line-duotone";
import gallery from "@iconify-icons/solar/gallery-line-duotone";
import globalIcon from "@iconify-icons/solar/global-line-duotone";
import home from "@iconify-icons/solar/home-line-duotone";
import inbox from "@iconify-icons/solar/inbox-line-duotone";
import infoCircle from "@iconify-icons/solar/info-circle-line-duotone";
import keyboard from "@iconify-icons/solar/keyboard-line-duotone";
import letterOpened from "@iconify-icons/solar/letter-opened-line-duotone";
import lightbulbBolt from "@iconify-icons/solar/lightbulb-bolt-line-duotone";
import linkIcon from "@iconify-icons/solar/link-line-duotone";
import list from "@iconify-icons/solar/list-line-duotone";
import magicStick from "@iconify-icons/solar/magic-stick-3-line-duotone";
import map from "@iconify-icons/solar/map-line-duotone";
import menuDots from "@iconify-icons/solar/menu-dots-line-duotone";
import palette from "@iconify-icons/solar/palette-line-duotone";
import pauseCircle from "@iconify-icons/solar/pause-circle-line-duotone";
import pen2 from "@iconify-icons/solar/pen-2-line-duotone";
import plain from "@iconify-icons/solar/plain-line-duotone";
import playCircle from "@iconify-icons/solar/play-circle-line-duotone";
import questionCircle from "@iconify-icons/solar/question-circle-line-duotone";
import refreshCircle from "@iconify-icons/solar/refresh-circle-line-duotone";
import roundedMagnifer from "@iconify-icons/solar/rounded-magnifer-line-duotone";
import settings from "@iconify-icons/solar/settings-minimalistic-line-duotone";
import shieldCheck from "@iconify-icons/solar/shield-check-line-duotone";
import star from "@iconify-icons/solar/star-line-duotone";
import stopCircle from "@iconify-icons/solar/stop-circle-line-duotone";
import tag from "@iconify-icons/solar/tag-line-duotone";
import target from "@iconify-icons/solar/target-line-duotone";
import trash from "@iconify-icons/solar/trash-bin-minimalistic-line-duotone";

type SolarIconData = {
    body: string;
    width?: number;
    height?: number;
};

const checkPlain: SolarIconData = {
    body: `<path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
};

const closePlain: SolarIconData = {
    body: `<path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
};

const infoPlain: SolarIconData = {
    body: `<path d="M12 10.5v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 7.25h.01" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
};

const warnPlain: SolarIconData = {
    body: `<path d="M12 7.5v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 17h.01" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
};

const translation: SolarIconData = {
    body: `<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></g>`,
};

const rssMain: SolarIconData = {
    width: 32,
    height: 32,
    body: `<path d="M6.6 9.4c8.95 0 16.2 7.25 16.2 16.2" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="butt"/><path d="M6.8 16.1c5.25 0 9.5 4.25 9.5 9.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="butt"/><path d="M7.7 21.25 8.55 23.35 10.65 24.2 8.55 25.05 7.7 27.15 6.85 25.05 4.75 24.2 6.85 23.35 7.7 21.25Z" fill="currentColor"/>`,
};

const ICONS: Record<string, SolarIconData> = {
    ai: magicStick,
    archive,
    article: documentText,
    bell,
    brain: lightbulbBolt,
    brush: palette,
    chart: chartSquare,
    check: checkCircle,
    checkPlain,
    chevronDown: altArrowDown,
    chevronLeft: altArrowLeft,
    chevronRight: altArrowRight,
    clock: clockCircle,
    close: closeCircle,
    closePlain,
    code2,
    copy: copyIcon,
    download,
    edit: pen2,
    external: arrowRightUp,
    feed,
    fileText,
    folder,
    gauge: chart,
    globe: globalIcon,
    help: questionCircle,
    home,
    image: gallery,
    inbox,
    info: infoCircle,
    infoPlain,
    keyboard,
    lightbulb: lightbulbBolt,
    link: linkIcon,
    list,
    mailOpen: letterOpened,
    map,
    more: menuDots,
    opml: documents,
    palette,
    pause: pauseCircle,
    pen: pen2,
    play: playCircle,
    plus: addCircle,
    refresh: refreshCircle,
    rss: feed,
    rssMain,
    save: diskette,
    search: roundedMagnifer,
    send: plain,
    settings,
    shield: shieldCheck,
    sparkle: magicStick,
    star,
    stop: stopCircle,
    tag,
    target,
    translate: translation,
    trash,
    wand: magicStick,
    warnPlain,
};

const LEGACY_ICON_ALIASES: Record<string, string> = {
    "1f4e1": "rss",
    "1f4cb": "list",
    "1f514": "bell",
    "1f4e5": "inbox",
    "2b50": "star",
    "1f916": "ai",
    "2728": "sparkle",
    "1f4a1": "lightbulb",
    "1f914": "help",
    "1f310": "translate",
    "2705": "check",
    "1f9ed": "map",
    "1f4f0": "article",
    "1f3f7": "tag",
    "270f": "edit",
    "270e": "edit",
    "271a": "plus",
    "21bb": "refresh",
    "23f8": "pause",
    "25b6": "play",
    "1f5d1": "trash",
    "1f4ed": "mailOpen",
    "1f4d6": "article",
    "1f4c4": "fileText",
    "1f517": "link",
    "1f4ca": "chart",
    "23f1": "clock",
    "2699": "settings",
    "1f3a8": "palette",
    "1f4be": "save",
    "1f4dd": "fileText",
    "2139": "info",
    "1f9e0": "brain",
    "1f4bb": "code2",
    "270d": "pen",
    "1f4da": "archive",
    "1f4c8": "chart",
    "1f317": "palette",
    "2328": "keyboard",
    "1f512": "shield",
};

export function normalizeIconName(name: string): string {
    if (!name) return "help";
    const codeKey = Array.from(name.replace(/\uFE0F/g, ""))
        .map((char) => char.codePointAt(0)?.toString(16))
        .filter(Boolean)
        .join("-");
    return LEGACY_ICON_ALIASES[codeKey] || name;
}

export function icon(name: string, size = 16): SVGElement {
    const resolved = normalizeIconName(name);
    const data = ICONS[resolved] || ICONS.help;
    const width = data.width || 24;
    const height = data.height || 24;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    svg.setAttribute("class", `ar-solar ar-solar--${resolved}`);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.style.setProperty("--ar-icon-size", `${size}px`);
    svg.innerHTML = data.body;

    return svg;
}

export function iconText(iconName: string, text?: string, size = 14): HTMLElement {
    const span = document.createElement("span");
    span.className = "ar-icon-text";
    span.appendChild(icon(iconName, size));
    if (text) span.appendChild(document.createTextNode(text));
    return span;
}
