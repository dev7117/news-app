/** Pixel position of a caret inside an <input> or <textarea>, relative to the element's
    border box, by mirroring its text into a hidden div with the same styles. */
const PROPS = [
  "direction", "boxSizing", "width", "height", "overflowX", "overflowY", "borderTopWidth", "borderRightWidth",
  "borderBottomWidth", "borderLeftWidth", "borderStyle", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontSizeAdjust", "lineHeight", "fontFamily",
  "textAlign", "textTransform", "textIndent", "textDecoration", "letterSpacing", "wordSpacing", "tabSize",
] as const;

export function caretCoordinates(el: HTMLInputElement | HTMLTextAreaElement, position: number) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const style = div.style;
  const computed = window.getComputedStyle(el);
  const isInput = el.nodeName === "INPUT";
  style.whiteSpace = isInput ? "pre" : "pre-wrap";
  if (!isInput) style.overflowWrap = "break-word";
  style.position = "absolute";
  style.visibility = "hidden";
  for (const prop of PROPS) style[prop as never] = computed[prop as never];
  style.overflow = "hidden";
  div.textContent = el.value.substring(0, position);
  const span = document.createElement("span");
  span.textContent = el.value.substring(position) || ".";
  div.appendChild(span);
  const coords = {
    top: span.offsetTop + parseInt(computed.borderTopWidth) - el.scrollTop,
    left: span.offsetLeft + parseInt(computed.borderLeftWidth) - el.scrollLeft,
    height: parseInt(computed.lineHeight) || parseInt(computed.fontSize) * 1.4,
  };
  document.body.removeChild(div);
  return coords;
}
