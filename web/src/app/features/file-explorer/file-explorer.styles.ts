export const FILE_EXPLORER_STYLES = `
  .fx { padding: 1.5rem; max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }
  .fx-head h1 { margin: 0 0 .25rem; font-size: 1.5rem; }
  .fx-crumbs { display: flex; flex-wrap: wrap; gap: .35rem; align-items: center; font-size: .9rem; }
  .fx-crumbs .crumb { color: inherit; }
  .fx-crumbs .current { font-weight: 600; }
  .fx-crumbs .sep { opacity: .5; }
  .fx-toolbar { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; }
  .fx-search { flex: 1 1 220px; padding: .4rem .6rem; }
  .fx-view { display: inline-flex; }
  .fx-view button.active { font-weight: 700; text-decoration: underline; }
  .fx-newfolder { display: inline-flex; gap: .35rem; }
  .fx-upload { display: inline-flex; gap: .35rem; align-items: center; cursor: pointer; }
  .fx-progress { display: flex; gap: .5rem; align-items: center; }
  .fx-progress progress { flex: 1; }
  .fx-error { display: flex; gap: .75rem; align-items: center; padding: .6rem .8rem; border: 1px solid currentColor; border-radius: 6px; }
  .fx-muted { opacity: .7; }
  .link { background: none; border: none; text-decoration: underline; cursor: pointer; padding: 0; }
  .fx-items { display: flex; flex-direction: column; }
  .fx-row { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr 3fr; gap: .5rem; align-items: center; padding: .4rem 0; border-bottom: 1px solid rgba(127,127,127,.25); }
  .fx-row-head { font-weight: 600; }
  .fx-row .actions { display: flex; flex-wrap: wrap; gap: .25rem; justify-content: flex-end; }
  .fx-items.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: .75rem; }
  .fx-items.grid .fx-row { display: flex; flex-direction: column; align-items: flex-start; border: 1px solid rgba(127,127,127,.25); border-radius: 8px; padding: .75rem; }
  .fx-items.grid .fx-row .actions { justify-content: flex-start; }
  .fx-versions { border: 1px solid rgba(127,127,127,.35); border-radius: 8px; padding: .75rem 1rem; }
  .fx-versions header { display: flex; justify-content: space-between; align-items: center; }
  .fx-versions h2 { font-size: 1.05rem; margin: 0; }
`;
