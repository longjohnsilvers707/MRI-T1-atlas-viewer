# To-Do — atlas-viewer

Deferred items from the terminal-imaging CLI work (2026-06-29). Knock these out
as we get to them.

## Other atlases (JHU / AICHA / CIT168) — the big one

The CLI's 3-D rendering is **AAL3-only** because that's the only atlas we have
region meshes for (`meshes/*.obj`). Slice rendering is **AAL-only** because
`cache/aal.nii.gz` is the only atlas volume on disk.

To support JHU / AICHA / CIT168 from the terminal:

- [ ] **3-D meshes:** generate per-region OBJ meshes for each atlas (the way
      `aal3_to_obj.py` does for AAL3), or decide these atlases stay slices-only.
- [ ] **Slice volumes:** add each atlas's NIfTI to `cache/` (and to
      `server.py`'s `CACHE_FILES` prefetch) so `--figure` slices work for them.
- [ ] **CLI `--atlas` plumbing:** today `--atlas` accepts `aal`/`aal3`; extend
      the validation + region-name resolution + label files (`labels/jhu.txt`,
      `labels/AICHAhr.txt`, `labels/CIT168.txt`) once meshes/volumes exist.
- [ ] **Browser export:** the "Export CLI command" button already sets
      `meshWarning: true` for non-AAL atlases — drop that once the CLI supports
      them, and map region names correctly per atlas.

## Heads-up: build_brain_bundle.py was rewritten outside this task

While the CLI work was in progress, `build_brain_bundle.py` was changed
(by another session/tool) from the old `LOBE_RULES` + `NETWORK_MAP` pair to a
single explicit `REGION_TAXONOMY` dict — this is exactly the fix `issues.md` C1
recommended (good change). It briefly broke `atlas_cli.py`, which imported the
old names; that import has been updated. No action needed, just be aware:

- [ ] If anyone still references `LOBE_RULES` / `NETWORK_MAP` anywhere, switch
      them to `REGION_TAXONOMY` / the `lobe_for` / `network_for` helpers.
- [ ] Consider deriving the CLI's `VALID_LOBES` / `VALID_NETWORKS`
      (`atlas_cli.py:98`) from `REGION_TAXONOMY` so they can't drift.

## Review / polish (deferred — subagents hit a session limit)

- [ ] Run a proper review pass over `atlas_cli.py`, `brain_render.py`, and the
      `index.html` Export-command additions (the planned code-reviewer agent
      didn't run). `/code-review` is the easy way.
- [ ] Decide whether to keep or delete the `.venv/` created for testing
      (git-ignored either way; deps are now installed in system `python3` too).
- [ ] Manually exercise the **Export CLI command** button in a real browser
      (region selection, colours, slice sliders) and confirm the emitted command
      reproduces the figure — the JS↔Python contract was verified with a
      hand-built preset, not a live browser click.

## Nice-to-haves

- [ ] `favorites export <name> <file.json>` (inverse of `import`) for sharing.
- [ ] More 3-D view presets / a `--rotate` montage option.
- [ ] Per-atlas region volumes (CSV) from the terminal, matching the web
      Gray-matter volume panel (was scoped out of the CLI).
