function holdVisibleGroup(head, held, cleanup) {
  const group = head?.closest('.activity-run');
  const pane = group?.closest('.panes.chat-scroll.is-following');
  if (!pane || typeof IntersectionObserver !== 'function' || pane.scrollHeight <= pane.clientHeight) return;
  const bounds = pane.getBoundingClientRect();
  const row = group.getBoundingClientRect();
  if (row.bottom <= bounds.top || row.top >= bounds.bottom) return;
  const observer = new IntersectionObserver((entries) => {
    const entry = entries.at(-1);
    if (entry.isIntersecting) return;
    if (!pane.classList.contains('is-following') && entry.boundingClientRect.bottom <= pane.getBoundingClientRect().top) return;
    release();
  }, { root: pane });
  function release() {
    observer.disconnect();
    if (held.value === release) held.value = null;
  }
  held.value = release;
  cleanup(release);
  observer.observe(group);
}

const id = '([\\w$]+)';
const visibility = new RegExp(`const\\{activityRunFolding:${id}\\}=${id}\\(\\),${id}=${id}\\(\\(\\)=>` +
  `${id}\\.forceOpen\\|\\|!\\1\\.value\\|\\|${id}\\.value\\),${id}=${id}\\(\\3\\.value\\)`);
const header = new RegExp(`ref_key:"headEl",ref:${id},class:\\["ar-head"`);
const watcher = new RegExp(`${id}\\(${id},\\(${id},${id},${id}\\)=>\\{if\\(\\3==="running"\\)`);

function unique(text, pattern) {
  const matches = [...text.matchAll(new RegExp(pattern, 'g'))];
  return matches.length === 1 ? matches[0] : null;
}

export function patchActivityFolding(source) {
  const marker = '__name:"ActivityRun"';
  const start = source.indexOf(marker);
  if (start < 0 || source.lastIndexOf(marker) !== start) return source;
  const end = source.indexOf('__name:"', start + marker.length);
  if (end < 0) return source;
  let region = source.slice(start, end);
  const view = unique(region, visibility), head = unique(region, header), status = unique(region, watcher);
  if (!view || !head || !status || region.includes('okwHeld')) return source;
  const [, folding, , , , props, expanded, , ref] = view;
  const [, watch, state, , previous, cleanup] = status;
  const done = `${previous}==="running"&&(${expanded}.value=!1,`;
  const toggle = `${props}.forceOpen||(${expanded}.value=!${expanded}.value,${props}.streaming)`;
  const preference = `${watch}(${folding},()=>{${expanded}.value=${state}.value==="running"})`;
  if (![done, toggle, preference].every((part) => region.split(part).length === 2)) return source;
  region = region.replace(view[0], () => `const okwHeld=${ref}(null);` + view[0].replace(`${expanded}.value)`,
    `${expanded}.value||!!okwHeld.value)`));
  region = region.replace(done, () => `${previous}==="running"&&(${expanded}.value&&${folding}.value&&!${props}.forceOpen&&` +
    `(${holdVisibleGroup})(${head[1]}.value,okwHeld,${cleanup}),${expanded}.value=!1,`);
  region = region.replace(toggle, () => toggle.replace(`!${expanded}.value`,
    `!(${expanded}.value||okwHeld.value),okwHeld.value?.()`));
  region = region.replace(preference, () => preference.replace('()=>{', '()=>{okwHeld.value?.();'));
  return source.slice(0, start) + region + source.slice(end);
}
