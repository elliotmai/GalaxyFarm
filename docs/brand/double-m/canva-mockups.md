# Canva mockups — placement spec

Where each mark sits on each of the five photographs in the **Brand Mockups**
Canva design, at what size, and in which colour. Recorded because the placements
are design decisions, not mechanics: they were measured off the photographs
against how big the real thing would be.

The deck is 20 pages — every mark on every photograph, grouped by photograph.
Page size is 1920×1080. **Canva reports positions as `top,left`**, which is the
reverse of how they are written here and in its own API; getting that backwards
puts every mark off the page.

## The marks

Uploaded PNGs, 1024px wide, transparent. Black and white share a filename, so
they are only tellable apart by ID — a white mark's thumbnail looks blank.

| Mark | Black | White | Aspect |
| --- | --- | --- | --- |
| Double M Connected | `MAHSNdDKiS4` | `MAHSNTxi8-Q` | 1024×848 |
| M Bar M | `MAHSNZ4MLsk` | `MAHSNVJ3JY4` | 1024×445 |
| Rocking Double M | `MAHSNYVSkNc` | `MAHSNcAlQNQ` | 1024×780 |
| Flying Double M | `MAHSNXu4a0s` | `MAHSNZJophA` | 1024×551 |

## The photographs

Duplicating a page means re-inserting the fill at exactly these values. Three of
them are cropped and one is flipped; miss that and the mark lands on the wrong
part of the picture.

| # | Page | Page ID | Asset | Left | Top | Width | Height | Also |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gate | 1 | `PBrktsJgZyr4NTTj` | `MAHSNMJ8tu4` | 478.73 | -101.7 | 962.55 | 1283.4 | — |
| Bull | 2 | `PBdz6s7xZr7qBDzb` | `MAHSNAzCQCA` | 241.2 | 0.0 | 1437.6 | 1080.0 | flip horizontal |
| Trailer | 3 | `PBhNh3fBymhRlhCF` | `MAHSNIJjsgw` | 0.0 | -171.31 | 2162.76 | 1340.2 | crop left -260.53 top 0 w 2683.83 h 1340.20 |
| Truck | 4 | `PBLTJl1ywgKvlBpH` | `MAHSNCrgmfQ` | 0.0 | -108.6 | 1920.0 | 1297.19 | crop left 0 top -62.38 w 1920 h 1440 |
| Barn | 5 | `PBbPswJnZvndWfpd` | `MAHSNCJ1nwQ` | 0.0 | -507.49 | 2118.43 | 1925.58 | crop left -385.63 top 0 w 2889.69 h 1925.58 |

## Placement

Each mark is centred on the same point for a given photograph, so the four stay
comparable; only the height differs, because the four are different shapes.
Ink is chosen for the surface — white on everything except the aluminium
trailer, where white would disappear.

| Photo | Mark | Ink | Asset | Left | Top | Width | Height |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Gate | Double M Connected | white | `MAHSNTxi8-Q` | 845.0 | 239.8 | 300 | 248.4 |
| Gate | M Bar M | white | `MAHSNVJ3JY4` | 845.0 | 298.8 | 300 | 130.4 |
| Gate | Rocking Double M | white | `MAHSNcAlQNQ` | 845.0 | 249.7 | 300 | 228.5 |
| Gate | Flying Double M | white | `MAHSNZJophA` | 845.0 | 283.3 | 300 | 161.4 |
| Bull | Double M Connected | white | `MAHSNTxi8-Q` | 942.0 | 425.5 | 180 | 149.1 |
| Bull | M Bar M | white | `MAHSNVJ3JY4` | 942.0 | 460.9 | 180 | 78.2 |
| Bull | Rocking Double M | white | `MAHSNcAlQNQ` | 942.0 | 431.4 | 180 | 137.1 |
| Bull | Flying Double M | white | `MAHSNZJophA` | 942.0 | 451.6 | 180 | 96.9 |
| Trailer | Double M Connected | black | `MAHSNdDKiS4` | 583.0 | 228.3 | 190 | 157.3 |
| Trailer | M Bar M | black | `MAHSNZ4MLsk` | 583.0 | 265.7 | 190 | 82.6 |
| Trailer | Rocking Double M | black | `MAHSNYVSkNc` | 583.0 | 234.6 | 190 | 144.7 |
| Trailer | Flying Double M | black | `MAHSNXu4a0s` | 583.0 | 255.9 | 190 | 102.2 |
| Truck | Double M Connected | white | `MAHSNTxi8-Q` | 1006.0 | 395.9 | 150 | 124.2 |
| Truck | M Bar M | white | `MAHSNVJ3JY4` | 1006.0 | 425.4 | 150 | 65.2 |
| Truck | Rocking Double M | white | `MAHSNcAlQNQ` | 1006.0 | 400.9 | 150 | 114.3 |
| Truck | Flying Double M | white | `MAHSNZJophA` | 1006.0 | 417.6 | 150 | 80.7 |
| Barn | Double M Connected | white | `MAHSNTxi8-Q` | 620.0 | 175.5 | 180 | 149.1 |
| Barn | M Bar M | white | `MAHSNVJ3JY4` | 620.0 | 210.9 | 180 | 78.2 |
| Barn | Rocking Double M | white | `MAHSNcAlQNQ` | 620.0 | 181.4 | 180 | 137.1 |
| Barn | Flying Double M | white | `MAHSNZJophA` | 620.0 | 201.6 | 180 | 96.9 |

## Why the marks are images and not Canva shapes

Canva's `insert_shape` **fills** a path rather than stroking it, so the marks
cannot go in as their own geometry: a bar has no area and vanishes, and every M
fills into a solid blob. Converting the strokes to outlines does work — and
renders identically to the source — but the PNGs are what was asked for, and
they are the same drawing.

Canva can only take images from a public URL, and these are not published
anywhere. That is why the eight PNGs had to be uploaded by hand.
