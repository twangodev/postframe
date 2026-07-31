# postframe

[![build](https://img.shields.io/github/actions/workflow/status/twangodev/postframe/rust.yml?branch=main)](https://github.com/twangodev/postframe/actions/workflows/rust.yml)
[![license](https://img.shields.io/github/license/twangodev/postframe)](LICENSE)

Post-processing built on your JPEGs.

```sh
postframe probe shot.RAF shot.JPG    # measure the camera's rendering
postframe merge *.RAF -o out.jpg     # one bracket, one Ultra HDR JPEG
postframe batch shoot/ -o merged/    # every bracket on the card
```

The camera's rendering is recovered from each shot's raw/JPEG pair and applied
to whatever is computed from the raw — HDR exposure merging first. Non-HDR
viewers see a normal JPEG; HDR displays get the recovered highlights, measured
stop for stop.
