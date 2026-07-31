# postframe

[![build](https://img.shields.io/github/actions/workflow/status/twangodev/postframe/rust.yml?branch=main)](https://github.com/twangodev/postframe/actions/workflows/rust.yml)
[![license](https://img.shields.io/github/license/twangodev/postframe)](LICENSE)

Post-processing built on your JPEGs.

The camera's rendering, measured from each shot's raw/JPEG pair and applied to
anything computed from the raw — HDR exposure merging first.

```sh
postframe probe shot.RAF shot.JPG    # how faithfully can the rendering be recovered?
postframe merge *.RAF -o out.jpg     # one bracket, one Ultra HDR JPEG
postframe batch shoot/ -o merged/    # every bracket on the card
```

A raw file and its straight-out-of-camera JPEG are the same light twice: once
scene-linear, once rendered. Regressing one against the other recovers the
rendering as a measurable function — a small cross-channel mix and per-channel
tone curves — fit fresh for every bracket, because cameras change their
rendering from scene to scene and no fixed profile survives that.

Frames are aligned on their JPEGs, merged in linear space with clipped
photosites excluded, and the merged radiance is rendered through the recovered
function. The Ultra HDR output (ISO 21496-1) ships that rendering as its base
image, so anything that cannot show HDR shows a normal JPEG; displays that can
get the recovered highlights, measured stop for stop. `--tone` rolls those
highlights into an ordinary SDR image instead.

RGGB Bayer sensors, integer alignment, and no deghosting yet: brackets with
subject motion will ghost.

