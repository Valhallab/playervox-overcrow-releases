// MIT License. Copyright (c) 2026 Valhallab SASU.
// Browser simulation of host-owned chrome. Never shipped inside a widget package.
import messages from "./chrome-messages.mjs";
/**
 * @param {Document} document
 * @param {string} locale
 * @param {(mode: string) => void} onModeChange
 * @param {{ onClose?: () => void, onVisibilityChange?: (visible: boolean) => void, query?: (selector: string) => Element | null, minimumWidth?: number, minimumHeight?: number, autoSize?: boolean, showInPassive?: boolean }} options
 */
export function createWidgetChrome(
  document,
  locale = "fr",
  onModeChange = () => {},
  {
    onClose,
    onVisibilityChange,
    onOptionChange,
    query,
    minimumWidth = 280,
    minimumHeight = 160,
    autoSize = false,
    showInPassive = true,
  } = {},
) {
  const copy = messages[locale === "en" ? "en" : "fr"];
  const find = query ?? ((selector) => document.querySelector(selector)),
    window = document.defaultView;
  const listeners = [];
  let presentation = null, optionValues = "{}", optionControls = [], optionCleanups = [], nativeOptions = null;
  let contentHint = null, sizeTimer = null, lastContentSize = null, previousContentSize = null, sizeCycle = null;
  let lastContentAt = 0;
  let maximumWidth = 900, maximumHeight = 900;
  const legacyMinimum = {width: minimumWidth, height: minimumHeight};
  const sizingMode = () => presentation?.sizing.mode ?? (autoSize ? "intrinsic" : "manual");
  let contentCleanup = () => {};
  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    listeners.push(() => target.removeEventListener(type, callback, options));
  }
  const host = find("#widget-host"),
    surface = find("#widget-surface"),
    view = find("#view");
  const toggle = find("#widget-options"),
    menu = find("#options-menu"),
    editor = find("#option-editor");
  const range = find("#option-range"),
    number = find("#option-number");
  const eye = find("#widget-eye"),
    modeSelect = find("#overlay-mode");
  let mode = "interactive",
    visible = true;
  function syncInteraction() {
    const passive = mode === "passive";
    move.disabled = toggle.disabled = eye.disabled = passive;
    move.hidden = passive;
    grip.disabled = grip.hidden = passive || sizingMode() === "intrinsic";
    grip.style.cursor = sizingMode() === "autoHeight" ? "ew-resize" : "nwse-resize";
    host.setAttribute("data-auto-size", String(sizingMode() === "intrinsic"));
    host.setAttribute("data-sizing-mode", sizingMode());
    for (const control of optionControls) control.disabled = passive;
  }
  function syncVisibility() {
    const nextVisible = mode === "interactive" || showInPassive;
    host.setAttribute("data-show-in-passive", String(showInPassive));
    eye.setAttribute("aria-pressed", String(showInPassive));
    const label = showInPassive ? copy.hidePassive : copy.showPassive;
    eye.setAttribute("aria-label", label);
    eye.setAttribute("title", label);
    if (visible !== nextVisible) {
      visible = nextVisible;
      onVisibilityChange?.(visible);
    }
  }
  function setMode(next) {
    if (!["interactive", "passive"].includes(next)) return;
    const changed = mode !== next;
    mode = next;
    if (changed) {
      close();
      drag = moveDrag = null;
      view.style.pointerEvents = "";
    }
    host.setAttribute("data-mode", mode);
    modeSelect.value = mode;
    view.inert = mode === "passive";
    syncInteraction();
    if (changed) onModeChange(mode);
    syncVisibility();
    if (changed && mode === "interactive") fitToStage();
  }
  listen(eye, "click", () => {
    if (mode !== "interactive") return;
    showInPassive = !showInPassive;
    close();
    syncVisibility();
  });
  listen(modeSelect, "change", () => setMode(modeSelect.value));
  const settings = {
    scale: {
      label: copy.scale,
      min: 50,
      max: 175,
      value: 100,
    },
    opacity: {
      label: copy.opacity,
      min: 0,
      max: 100,
      value: 100,
    },
  };
  let active = null,
    drag = null,
    stacked = false;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function paint() {
    const scale = settings.scale.value / 100,
      opacity = settings.opacity.value / 100;
    // Inverse viewport size models native WebView zoom: layout reflows while the host stays fixed.
    view.style.width = `${100 / scale}%`;
    view.style.height = `${100 / scale}%`;
    view.style.transform = `scale(${scale})`;
    surface.style.backgroundColor = `rgba(17, 17, 20, ${(238 / 255) * opacity})`;
    surface.style.borderColor = `rgba(255, 255, 255, ${(24 / 255) * opacity})`;
    for (const [key, setting] of Object.entries(settings))
      find(`#value-${key}`).textContent = `${setting.value}%`;
    applyContentSize(true);
  }
  function syncEditor() {
    const setting = settings[active];
    editor.setAttribute("aria-label", setting.label);
    for (const input of [range, number]) {
      input.min = String(setting.min);
      input.max = String(setting.max);
      input.value = String(setting.value);
      input.setAttribute(
        "aria-label",
        copy.percent.replace("{label}", setting.label),
      );
    }
  }
  function commit() {
    if (!active) return;
    const value = number.value.trim(),
      parsed = Number(value),
      setting = settings[active];
    if (value !== "" && Number.isFinite(parsed))
      setting.value = clamp(Math.round(parsed), setting.min, setting.max);
    syncEditor();
    paint();
  }
  function closeEditor(restoreFocus = false) {
    if (!active) return;
    commit();
    const row = find(`#option-${active}`);
    row.setAttribute("aria-expanded", "false");
    active = null;
    stacked = false;
    editor.hidden = true;
    if (restoreFocus) row.focus();
  }
  function close(restoreFocus = false) {
    closeEditor();
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    host.removeAttribute("data-options-open");
    if (restoreFocus) toggle.focus();
  }
  function position() {
    stacked = false;
    const margin = 8,
      gap = 6,
      button = toggle.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    const left = clamp(
      button.right - bounds.width,
      margin,
      Math.max(margin, window.innerWidth - bounds.width - margin),
    );
    const top = clamp(
      button.bottom + gap,
      margin,
      Math.max(margin, window.innerHeight - bounds.height - margin),
    );
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    if (!active) return;
    const size = editor.getBoundingClientRect(),
      row = find(`#option-${active}`).getBoundingClientRect();
    let x = left + bounds.width + gap,
      y = row.top;
    if (x + size.width > window.innerWidth - margin) {
      x = left - size.width - gap;
      if (x < margin) {
        x = left;
        y = top + bounds.height + gap;
        stacked = true;
      }
    }
    editor.style.left = `${clamp(x, margin, Math.max(margin, window.innerWidth - size.width - margin))}px`;
    editor.style.top = `${clamp(y, margin, Math.max(margin, window.innerHeight - size.height - margin))}px`;
  }
  function openEditor(key, focus = false) {
    if (menu.hidden) return;
    if (active !== key) {
      closeEditor();
      active = key;
      syncEditor();
    }
    editor.hidden = false;
    find(`#option-${key}`).setAttribute("aria-expanded", "true");
    position();
    if (focus) range.focus();
  }
  listen(toggle, "click", () => {
    if (mode !== "interactive") return;
    if (!menu.hidden) {
      close();
      return;
    }
    menu.hidden = false;
    host.setAttribute("data-options-open", "");
    toggle.setAttribute("aria-expanded", "true");
    position();
    find("#option-scale").focus();
  });
  for (const key of Object.keys(settings)) {
    const row = find(`#option-${key}`);
    listen(row, "click", () => openEditor(key, true));
    // When stacked, reaching the editor crosses the other row: require an intentional click.
    listen(row, "pointerenter", () => {
      if (!stacked) openEditor(key);
    });
  }
  const displayOptions = find("#display-options");
  if (displayOptions) {
    listen(displayOptions, "pointerenter", () => closeEditor());
    listen(displayOptions, "focusin", () => closeEditor());
  }
  listen(menu, "scroll", () => closeEditor());
  listen(range, "input", () => {
    if (!active) return;
    const setting = settings[active],
      value = Number(range.value);
    if (!Number.isFinite(value)) return;
    setting.value = clamp(Math.round(value), setting.min, setting.max);
    number.value = String(setting.value);
    paint();
  });
  listen(number, "input", () => {
    number.value = number.value.replace(/[^0-9]/g, "");
  });
  listen(number, "blur", commit);
  listen(number, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  });
  const escape = (event) => {
    if (event.key !== "Escape" || menu.hidden) return;
    event.preventDefault();
    if (active) closeEditor(true);
    else close(true);
  };
  listen(document, "keydown", escape);
  listen(document, "pointerdown", (event) => {
    if (
      !menu.hidden &&
      ![toggle, menu, editor].some((element) => element.contains(event.target))
    )
      close();
  });
  // Iframe events do not bubble to the host document. Reattach after each live reload.
  listen(view, "load", () => {
    contentCleanup();
    const content = view.contentDocument;
    if (!content) return;
    const closeOptions = () => close();
    content.addEventListener("pointerdown", closeOptions);
    content.addEventListener("keydown", escape);
    contentCleanup = () => {
      content.removeEventListener("pointerdown", closeOptions);
      content.removeEventListener("keydown", escape);
    };
  });
  listen(window, "resize", () => {
    positionToolbar();
    if (!menu.hidden) position();
  });
  listen(
    window,
    "scroll",
    () => {
      if (!menu.hidden) close();
    },
    { passive: true },
  );
  const grip = find("#widget-resize");
  let origin = null;

  function anchorPosition() {
    if (origin) return;

    const bounds = host.getBoundingClientRect();
    const area = stage.getBoundingClientRect();
    origin = { x: bounds.left - area.left, y: bounds.top - area.top };

    // Leave centering once a gesture starts. Avoid transforms: they also move fixed menus.
    host.style.position = "absolute";
    host.style.left = `${origin.x}px`;
    host.style.top = `${origin.y}px`;
  }

  function resize(width, height) {
    anchorPosition();
    const bounds = host.getBoundingClientRect(),
      area = stage.getBoundingClientRect();
    const maxWidth = Math.max(0, Math.min(maximumWidth, area.right - bounds.left));
    const maxHeight = Math.max(0, Math.min(maximumHeight, area.bottom - bounds.top));
    host.style.width = `${clamp(width, Math.min(minimumWidth, maxWidth), maxWidth)}px`;
    host.style.height = `${clamp(height, Math.min(minimumHeight, maxHeight), maxHeight)}px`;
    positionToolbar();
  }
  listen(grip, "pointerdown", (event) => {
    if (event.button !== 0 || sizingMode() === "intrinsic" || mode !== "interactive") return;
    event.preventDefault();
    close();
    const bounds = host.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: bounds.width,
      height: bounds.height,
    };
    view.style.pointerEvents = "none";
    grip.setPointerCapture(event.pointerId);
  });
  listen(grip, "pointermove", (event) => {
    if (drag?.id === event.pointerId)
      resize(
        drag.width + event.clientX - drag.x,
        sizingMode() === "autoHeight" ? drag.height : drag.height + event.clientY - drag.y,
      );
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    listen(grip, type, () => {
      drag = null;
      view.style.pointerEvents = "";
    });
  listen(grip, "keydown", (event) => {
    if (sizingMode() === "intrinsic" || mode !== "interactive") return;
    if (sizingMode() === "autoHeight" && ["ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    close();
    const bounds = host.getBoundingClientRect(),
      step = event.shiftKey ? 10 : 1;
    resize(
      bounds.width +
        (event.key === "ArrowRight"
          ? step
          : event.key === "ArrowLeft"
            ? -step
            : 0),
      bounds.height +
        (event.key === "ArrowDown"
          ? step
          : event.key === "ArrowUp"
            ? -step
            : 0),
    );
  });
  // The native overlay uses a 22 px strip along the top of each widget.
  const move = find("#widget-move"),
    stage = find("#stage-surface"),
    toolbar = find("#widget-toolbar");
  let moveDrag = null,
    positionX = 0,
    positionY = 0;
  function positionToolbar() {
    const bounds = host.getBoundingClientRect(),
      area = stage.getBoundingClientRect(),
      { width, height } = toolbar.getBoundingClientRect(),
      gap = 6;
    const left = clamp(
      bounds.right - width,
      area.left,
      Math.max(area.left, area.right - width),
    );
    const above = bounds.top - height - gap,
      below = bounds.bottom + gap;
    let top;
    if (above >= area.top && above + height <= area.bottom) top = above;
    else if (below >= area.top && below + height <= area.bottom) top = below;
    else
      top = clamp(
        bounds.top + gap,
        area.top,
        Math.max(area.top, area.bottom - height),
      );
    top -= bounds.top;
    // Cover the toolbar and its gap without extending across the widget content.
    const bridgeTop = Math.min(top, bounds.height),
      bridgeHeight = Math.max(top + height, 0) - bridgeTop;
    host.style.setProperty("--widget-toolbar-left", `${left - bounds.left}px`);
    host.style.setProperty("--widget-toolbar-top", `${top}px`);
    host.style.setProperty("--widget-toolbar-bridge-top", `${bridgeTop}px`);
    host.style.setProperty("--widget-toolbar-bridge-height", `${bridgeHeight}px`);
  }
  function setPosition(x, y) {
    anchorPosition();
    positionX = x;
    positionY = y;
    host.style.left = `${origin.x + x}px`;
    host.style.top = `${origin.y + y}px`;
    positionToolbar();
    // Keep open controls still: auto-fitting must not move a slider under its pointer.
    // Menus are anchored on opening and viewport resize; moving the widget closes them.
  }
  listen(move, "pointerdown", (event) => {
    if (event.button !== 0 || mode !== "interactive") return;
    event.preventDefault();
    close();
    moveDrag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: positionX,
      top: positionY,
      bounds: host.getBoundingClientRect(),
    };
    view.style.pointerEvents = "none";
    move.setPointerCapture(event.pointerId);
  });
  listen(move, "pointermove", (event) => {
    if (moveDrag?.id !== event.pointerId) return;
    const area = stage.getBoundingClientRect(),
      bounds = moveDrag.bounds;
    setPosition(
      clamp(
        moveDrag.left + event.clientX - moveDrag.x,
        moveDrag.left + area.left - bounds.left,
        moveDrag.left + area.right - bounds.right,
      ),
      clamp(
        moveDrag.top + event.clientY - moveDrag.y,
        moveDrag.top + area.top - bounds.top,
        moveDrag.top + area.bottom - bounds.bottom,
      ),
    );
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    listen(move, type, () => {
      moveDrag = null;
      view.style.pointerEvents = "";
    });
  listen(move, "keydown", (event) => {
    if (mode !== "interactive") return;
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    close();
    const step = event.shiftKey ? 10 : 1,
      area = stage.getBoundingClientRect(),
      bounds = host.getBoundingClientRect();
    const x =
      event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const y =
      event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    setPosition(
      clamp(
        positionX + x,
        positionX + area.left - bounds.left,
        positionX + area.right - bounds.right,
      ),
      clamp(
        positionY + y,
        positionY + area.top - bounds.top,
        positionY + area.bottom - bounds.bottom,
      ),
    );
  });
  function fitToStage() {
    if (host.hidden || !visible) return;
    const bounds = host.getBoundingClientRect(),
      area = stage.getBoundingClientRect();
    if (!area.width || !area.height) return;
    const width = Math.min(bounds.width, area.width),
      height = Math.min(bounds.height, area.height);
    setPosition(
      positionX +
        clamp(bounds.left, area.left, area.right - width) -
        bounds.left,
      positionY +
        clamp(bounds.top, area.top, area.bottom - height) -
        bounds.top,
    );
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    positionToolbar();
  }
  function applyContentSize(reset = false) {
    if (!presentation || sizingMode() === "manual") return;
    if (reset) { lastContentSize = previousContentSize = sizeCycle = null; }
    const content = contentHint ?? presentation.sizing.preferred, scale = settings.scale.value / 100;
    const currentWidth = Number.parseFloat(host.style.width) || presentation.sizing.preferred.width;
    let next = {
      width: sizingMode() === "intrinsic" ? content.width * scale : currentWidth,
      height: content.height * scale,
    };
    next = {width: Math.round(clamp(next.width, minimumWidth, maximumWidth)), height: Math.round(clamp(next.height, minimumHeight, maximumHeight))};
    const near = (a,b) => a && Math.abs(a.width-b.width)<=1 && Math.abs(a.height-b.height)<=1;
    if (sizeCycle && sizeCycle.some(size=>near(size,next))) next={width:Math.max(...sizeCycle.map(size=>size.width)),height:Math.max(...sizeCycle.map(size=>size.height))};
    else if (Date.now()-lastContentAt<=500 && near(previousContentSize,next) && !near(lastContentSize,next)) {
      sizeCycle=[previousContentSize,lastContentSize];next={width:Math.max(...sizeCycle.map(size=>size.width)),height:Math.max(...sizeCycle.map(size=>size.height))};
    } else if (sizeCycle) { sizeCycle=null;previousContentSize=null; }
    if (near(lastContentSize,next)) return;
    previousContentSize=lastContentSize;lastContentSize=next;lastContentAt=Date.now();
    resize(next.width,next.height);
  }
  function reportSize(size) {
    if (!presentation || !size || ![size.width,size.height].every(value=>Number.isInteger(value)&&value>=1&&value<=4096)) return false;
    contentHint={width:size.width,height:size.height};
    if (sizeTimer===null) sizeTimer=setTimeout(()=>{sizeTimer=null;applyContentSize();},100);
    return true;
  }
  function setPresentation(next, values = {}) {
    const changed = JSON.stringify(presentation) !== JSON.stringify(next ?? null);
    const nextValues=JSON.stringify(values);
    if (optionValues!==nextValues) previousContentSize=sizeCycle=null;
    optionValues=nextValues;
    presentation=next ?? null;
    if (!changed) {
      for (const [index,control] of optionControls.entries()) {
        const option=presentation.options[index];
        if (document.activeElement===control) continue;
        const value=Object.hasOwn(values,option.id)?values[option.id]:option.default;
        if (option.type==="boolean") control.checked=value;
        else control.value=String(value);
      }
      syncInteraction();return;
    }
    close();contentHint=null;lastContentSize=previousContentSize=sizeCycle=null;
    if (sizeTimer!==null) { clearTimeout(sizeTimer);sizeTimer=null; }
    minimumWidth=presentation?.sizing.min.width ?? legacyMinimum.width;
    minimumHeight=presentation?.sizing.min.height ?? legacyMinimum.height;
    maximumWidth=presentation?.sizing.max.width ?? 900;
    maximumHeight=presentation?.sizing.max.height ?? 900;
    if (presentation) resize(presentation.sizing.preferred.width,presentation.sizing.preferred.height);
    else resize(480,320);
    for (const remove of optionCleanups) remove();
    optionCleanups=[];optionControls=[];
    if (!nativeOptions && presentation?.options?.length) {
      nativeOptions=document.createElement("div");nativeOptions.className="native-widget-options";menu.append(nativeOptions);
      listen(nativeOptions,"focusin",()=>closeEditor());
      listen(nativeOptions,"pointerenter",()=>closeEditor());
    }
    if (nativeOptions) nativeOptions.replaceChildren();
    for (const option of presentation?.options ?? []) {
      const label=document.createElement("label"),text=document.createElement("span");
      text.textContent=option.label[locale==="en"?"en":"fr"];
      const control=document.createElement(option.type==="enum"?"select":"input");
      control.setAttribute("aria-label",text.textContent);
      const value=Object.hasOwn(values,option.id)?values[option.id]:option.default;
      if (option.type==="boolean") { control.type="checkbox";control.checked=value; }
      else if (option.type==="enum") {
        for (const choice of option.choices) { const item=document.createElement("option");item.value=choice.value;item.textContent=choice.label[locale==="en"?"en":"fr"];control.append(item); }
        control.value=value;
      } else { control.type="number";control.min=String(option.min);control.max=String(option.max);control.step=String(option.step);control.value=String(value); }
      const change=()=>{
        if (mode!=="interactive") return;
        const value=option.type==="boolean"?control.checked:option.type==="number"?Number(control.value):control.value;
        const valid=option.type==="boolean"?typeof value==="boolean":option.type==="enum"?option.choices.some(choice=>choice.value===value):control.value.trim()!==""&&Number.isFinite(value)&&value>=option.min&&value<=option.max;
        if (valid) onOptionChange?.(option.id,value);
      };
      control.addEventListener("change",change);optionCleanups.push(()=>control.removeEventListener("change",change));
      optionControls.push(control);label.append(text,control);nativeOptions.append(label);
    }
    syncInteraction();
    applyContentSize(true);
  }
  if (onClose) {
    const dismiss = find("#widget-close");
    dismiss.removeAttribute("aria-disabled");
    listen(dismiss, "click", () => {
      close();
      onClose();
    });
  }
  menu.hidden = true;
  editor.hidden = true;
  paint();
  setMode("interactive");
  modeSelect.disabled = false;
  positionToolbar();
  return {
    get mode() {
      return mode;
    },
    get showInPassive() {
      return showInPassive;
    },
    get visible() {
      return visible;
    },
    setMode,
    setPresentation,
    reportSize,
    setAutoSize(enabled) {
      autoSize = Boolean(enabled);
      drag = null;
      view.style.pointerEvents = "";
      syncInteraction();
    },
    fitToStage,
    resetGeometry() {
      close();
      origin = null;
      positionX = positionY = 0;
      for (const property of ["left", "top", "width", "height"])
        host.style.removeProperty(property);
      fitToStage();
    },
    dispose() {
      close();
      contentCleanup();
      for (const remove of listeners) remove();
      for (const remove of optionCleanups) remove();
      if (sizeTimer!==null) clearTimeout(sizeTimer);
    },
  };
}
