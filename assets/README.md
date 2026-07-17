# Brand assets

| File | Size | Where it's used |
| --- | --- | --- |
| `Ouro_banner.jpeg` | 1376×768 | The README hero. |
| `Ouro_logo.jpeg` | 1024×1024 | Source artwork for the in-app mark. Not referenced directly — see below. |
| `social-preview.jpeg` | 1280×640 | GitHub social preview. **Uploaded by hand — see below.** |

## The in-app mark is SVG, not these JPEGs

The ouroboros in the dashboard sidebar and the favicon are hand-drawn SVG
(`packages/dashboard/src/components/Logo.jsx` and
`packages/dashboard/public/favicon.svg`), traced from `Ouro_logo.jpeg`.

The JPEG can't do that job: it's opaque, so it lands as a black square seam on
any surface that isn't its own background; it's raster, so a 20px favicon comes
out as artefacts; and it can't be tinted, while the mark has to sit at `--brand`
in the rail and flip to `--bad` the moment the socket drops.

The two SVGs are the same drawing at different detail levels — identical
geometry, with the favicon dropping the circuit traces and tube highlight
because they turn to mud below ~24px. **Change one, change both.**

## Setting the social preview

GitHub has no API for this and it isn't a file the repo can carry — it's a
manual upload, and the only way to set it:

> **Settings → General → Social preview → Edit → Upload an image**
> then choose `assets/social-preview.jpeg`.

`social-preview.jpeg` exists because the card is 1280×640 (2:1) and
`Ouro_logo.jpeg` is square. Upload the square logo and GitHub crops it to 2:1,
which slices the top and bottom off the ring — taking the snake's head with it.
This file is the banner artwork scaled to width and trimmed 37px top and bottom,
which clears the ring entirely. Keep it under GitHub's 1MB limit if you regenerate it.
