/**
 * Tiny DOM helpers shared by every page. Never uses innerHTML for dynamic content.
 * @module ui/dom
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Append children (strings, numbers, nodes, arrays, null/false ignored) to a parent.
 * @param {Node} parent
 * @param {Array<any>} children
 */
function appendChildren(parent, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

/**
 * Apply props to an element.
 * Special keys: class (string | array | {name: bool}), style (object or string), dataset, attrs,
 * on ({event: handler}). Keys starting with "aria-" or containing "-" are set as attributes.
 * Everything else is assigned as a property (e.g. type, value, disabled, href, textContent).
 * @param {Element} el
 * @param {object} props
 */
function applyProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    switch (key) {
      case 'class':
      case 'className':
        el.setAttribute('class', classNames(value));
        break;
      case 'style':
        if (typeof value === 'string') el.setAttribute('style', value);
        else if (value) {
          for (const [prop, v] of Object.entries(value)) {
            if (v == null) continue;
            if (prop.startsWith('--') || prop.includes('-')) el.style.setProperty(prop, String(v));
            else el.style[prop] = v;
          }
        }
        break;
      case 'dataset':
        for (const [k, v] of Object.entries(value || {})) if (v != null) el.dataset[k] = String(v);
        break;
      case 'attrs':
        for (const [k, v] of Object.entries(value || {})) setAttr(el, k, v);
        break;
      case 'on':
        for (const [evt, fn] of Object.entries(value || {})) if (fn) el.addEventListener(evt, fn);
        break;
      default:
        if (key.startsWith('aria-') || key.startsWith('data-') || key === 'role' || key === 'for'
          || el instanceof SVGElement) {
          setAttr(el, key, value);
        } else {
          el[key] = value;
        }
    }
  }
}

function setAttr(el, name, value) {
  if (value === false || value == null) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : String(value));
}

/**
 * Join class names. Accepts strings, arrays and {name: boolean} maps.
 * @param {...any} parts
 * @returns {string}
 */
export function classNames(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === 'string') out.push(p);
    else if (Array.isArray(p)) out.push(classNames(...p));
    else if (typeof p === 'object') for (const [k, v] of Object.entries(p)) if (v) out.push(k);
  }
  return out.filter(Boolean).join(' ');
}

/**
 * Create an HTML element.
 * @example h('button', { class: 'btn btn-primary', on: { click } }, icon('plus'), 'New test')
 * @param {string} tag
 * @param {object|null} [props]
 * @param {...any} children strings become text nodes
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) applyProps(el, props);
  appendChildren(el, children);
  return el;
}

/**
 * Create an SVG element (attributes are always set as attributes).
 * @param {string} tag
 * @param {object|null} [attrs] also supports class/style/dataset/on
 * @param {...any} children
 * @returns {SVGElement}
 */
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) applyProps(el, attrs);
  appendChildren(el, children);
  return el;
}

/**
 * Remove all children of an element.
 * @param {Element} el
 * @returns {Element} the same element
 */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** @returns {Element|null} */
export const qs = (sel, root = document) => root.querySelector(sel);
/** @returns {Element[]} */
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Debounce a function. The returned function has `.cancel()` and `.flush()`.
 * @param {Function} fn
 * @param {number} wait ms
 */
export function debounce(fn, wait = 200) {
  let timer = null;
  let lastArgs = null;
  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...lastArgs); }, wait);
  };
  debounced.cancel = () => { clearTimeout(timer); timer = null; };
  debounced.flush = () => {
    if (timer) { clearTimeout(timer); timer = null; fn(...lastArgs); }
  };
  return debounced;
}

/** @returns {boolean} true when the user prefers reduced motion */
export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Animate a number inside an element (ease-out). Jumps straight to `to` under reduced motion.
 * @param {Element} el
 * @param {number} from
 * @param {number} to
 * @param {{duration?: number, format?: (n: number) => string}} [opts]
 * @returns {() => void} cancel function
 */
export function animateNumber(el, from, to, { duration = 600, format = (n) => String(Math.round(n)) } = {}) {
  if (prefersReducedMotion() || duration <= 0 || from === to) {
    el.textContent = format(to);
    return () => {};
  }
  let raf = 0;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(from + (to - from) * eased);
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

let idCounter = 0;

/**
 * Generate a unique DOM id with a prefix (for label/aria wiring).
 * @param {string} [prefix]
 * @returns {string}
 */
export function uid(prefix = 'hk') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
