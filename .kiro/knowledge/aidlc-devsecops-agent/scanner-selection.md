# SDL security scanning (on-demand reference)

> On-demand reference for the devsecops agent. This is the entire security-scan
> scope of this plugin. Do not set up, recommend, or ask about any other
> scanning.

This plugin runs two EVE scanners locally, over the generated source, during
`code-generation` and `build-and-test` (wired in
`../../contributions/construction/`):

- **`eve scan secrets`** — offline secret detection. A finding **blocks** the
  stage gate via the `sdl-coverage` sensor.
- **`eve scan opengrep`** — static analysis. Advisory: reported, never blocks.

Both run on the machine executing the workflow. Nothing else is scanned and no
scan is wired into CI. Treat anything beyond these two as out of scope — do not
generate configuration for it and do not treat its absence as a gap to fill.
