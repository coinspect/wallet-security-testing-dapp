"use client";

/**
 * Render a DOM element to a PNG Blob with NO dependencies, via the
 * SVG-<foreignObject> → <canvas> technique.
 *
 * The trap this avoids: a naive outerHTML → foreignObject loses the wizard's
 * palette (the `--wsr-*` custom properties live on :root, not the panel) AND all
 * Tailwind utility classes (the stylesheet isn't inside the isolated SVG), so the
 * image comes out unstyled with the wrong colours. The fix is to walk the tree
 * and inline `getComputedStyle` values, which are already RESOLVED to literals
 * (rgb()/px) — so var(--wsr-*) and Tailwind classes both come through correctly.
 *
 * Webfonts (Inter / JetBrains Mono) are NOT embedded in the SVG,
 * so they wouldn't render inside the foreignObject — we deliberately force a
 * legible system stack instead (mono where the on-screen font was mono).
 */

// Deliberate, embedded-free system fallbacks.
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', monospace";

// Curated computed-style properties to inline. Kept small so the serialized SVG
// stays light, but covers everything the evidence panel uses: colour, borders
// (longhands — the `border` shorthand isn't returned by getComputedStyle),
// spacing, layout, and type.
const HTML_PROPS = [
    "display", "flex-direction", "align-items", "justify-content", "gap",
    "flex-wrap", "flex-shrink", "flex-grow", "flex-basis",
    "box-sizing", "width", "min-width", "max-width", "height", "overflow", "opacity",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "color", "background-color",
    "border-top-width", "border-top-style", "border-top-color",
    "border-right-width", "border-right-style", "border-right-color",
    "border-bottom-width", "border-bottom-style", "border-bottom-color",
    "border-left-width", "border-left-style", "border-left-color",
    "border-top-left-radius", "border-top-right-radius",
    "border-bottom-right-radius", "border-bottom-left-radius",
    "font-size", "font-weight", "font-style", "line-height", "letter-spacing",
    "text-align", "text-transform", "text-decoration-line", "white-space", "word-break",
    "overflow-wrap", "vertical-align",
    "table-layout", "border-collapse", "border-spacing", "list-style-type", "list-style-position",
];
const SVG_EXTRA = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"];

const inlineComputed = (src, dst) => {
    const cs = window.getComputedStyle(src);
    const isSvg = src instanceof SVGElement;
    let style = "";
    for (const p of HTML_PROPS) {
        const v = cs.getPropertyValue(p);
        if (v) style += `${p}:${v};`;
    }
    if (isSvg) {
        for (const p of SVG_EXTRA) {
            const v = cs.getPropertyValue(p);
            if (v) style += `${p}:${v};`;
        }
    }
    // Deliberate font fallback (webfonts aren't embedded in the SVG).
    const fam = cs.fontFamily || "";
    style += `font-family:${/mono/i.test(fam) ? MONO : SANS};`;
    dst.setAttribute("style", style);
    dst.removeAttribute("class"); // classes are inert in the isolated SVG; drop the noise
    // Form controls: cloneNode copies the initial `value` ATTRIBUTE, not the live
    // typed property, so a captured <input> would render empty. Reflect the current
    // value onto the clone so the image shows what the tester actually pasted
    // (e.g. VERI-001's checksum verifier field).
    if (src instanceof HTMLInputElement) {
        dst.setAttribute("value", src.value);
    } else if (src instanceof HTMLTextAreaElement) {
        dst.textContent = src.value;
    }
};

// Parallel walk: read styles off the LIVE original (laid out), write onto the
// detached clone. Text nodes carry no style, so only elements are processed.
const walk = (src, dst) => {
    if (dst.nodeType === 1) inlineComputed(src, dst);
    const sc = src.childNodes;
    const dc = dst.childNodes;
    for (let i = 0; i < sc.length; i += 1) {
        if (dc[i]) walk(sc[i], dc[i]);
    }
};

const svgToPngBlob = (svgString, w, h, scale, bg) =>
    new Promise((resolve, reject) => {
        // base64 data URI (UTF-8 safe) — avoids canvas tainting that blob: URLs
        // can trigger for SVG in some browsers.
        const encoded =
            typeof window.btoa === "function"
                ? window.btoa(unescape(encodeURIComponent(svgString)))
                : "";
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(w * scale));
                canvas.height = Math.max(1, Math.round(h * scale));
                const ctx = canvas.getContext("2d");
                if (!ctx) return reject(new Error("no 2d context"));
                // Opaque background so transparent regions don't render black.
                ctx.fillStyle = bg || "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.scale(scale, scale);
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob null"))), "image/png");
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = () => reject(new Error("SVG failed to load (foreignObject unsupported here)"));
        img.src = `data:image/svg+xml;base64,${encoded}`;
    });

/**
 * Capture `rootEl` as a PNG Blob at `scale`× (default 2×). Throws if the browser
 * can't rasterize the foreignObject (e.g. some Safari versions) — callers should
 * catch and offer a download / message.
 */
export const panelToPngBlob = async (rootEl, { scale = 2 } = {}) => {
    if (!rootEl) throw new Error("no element to capture");
    const rect = rootEl.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(rect.width));

    const clone = rootEl.cloneNode(true);
    walk(rootEl, clone);
    // Drop interactive chrome (the copy buttons) so the evidence image is clean.
    clone.querySelectorAll('[data-capture-skip]').forEach((n) => n.remove());
    // Responsive account chips are abbreviated on phones, but the image keeps
    // the complete identity. This changes only the detached export clone.
    clone.querySelectorAll('[data-capture-only]').forEach((node) => {
        node.style.display = 'block';
        node.style.width = 'auto';
        node.style.height = 'auto';
    });

    // Image-only caption — clarifies this is the wizard's recorded evidence, NOT
    // the wallet's own dialog (which a page cannot capture). Added to the clone
    // only, so the live panel is untouched.
    const rootCs = window.getComputedStyle(rootEl);
    const mutedColor = rootCs.getPropertyValue("--wsr-fg-muted").trim() || "#6b7280";
    const captionHeight = 26;
    const caption = document.createElement("div");
    caption.textContent = "Wizard-recorded evidence — the wallet's own dialog is not captured here.";
    caption.setAttribute(
        "style",
        `box-sizing:border-box;padding:5px 12px;font-family:${SANS};font-size:11px;line-height:16px;` +
            `color:${mutedColor};border-top:1px solid rgba(127,127,127,0.18);`
    );
    clone.appendChild(caption);

    const height = Math.max(1, Math.ceil(rect.height) + captionHeight);

    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    // Pin the clone's width so it lays out exactly as on screen.
    clone.style.width = `${width}px`;
    clone.style.margin = "0";

    const serialized = new XMLSerializer().serializeToString(clone);
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<foreignObject x="0" y="0" width="${width}" height="${height}">${serialized}</foreignObject>` +
        `</svg>`;

    const bg = rootCs.backgroundColor && rootCs.backgroundColor !== "rgba(0, 0, 0, 0)"
        ? rootCs.backgroundColor
        : "#ffffff";

    return svgToPngBlob(svg, width, height, scale, bg);
};
