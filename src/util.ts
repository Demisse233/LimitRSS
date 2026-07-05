/**
 * 工具函数
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function genId(prefix = ""): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const H = String(d.getHours()).padStart(2, "0");
    const M = String(d.getMinutes()).padStart(2, "0");
    const S = String(d.getSeconds()).padStart(2, "0");
    let r = "";
    for (let i = 0; i < 7; i++) r += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return `${prefix}${y}${m}${dd}${H}${M}${S}-${r}`;
}
