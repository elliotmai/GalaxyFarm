#!/usr/bin/env python3
"""
The offline map background: a USDA NAIP aerial of the property, cut, reprojected
and uploaded (spec §8).

Google's satellite layer is what the editor traces over online, and Google's
terms do not permit storing those tiles. So a barn kiosk with no signal draws
the same lat/lng pen rings over an owned image instead — a public-domain USDA
NAIP aerial, reprojected to Web Mercator so an image overlay placed by its
lat/lng corners lands where the ground is.

Committed as a script rather than done once by hand because it is not a
one-off: NAIP reflies on a two-to-three-year cycle, and "which tile, cut where,
in what projection" is exactly the kind of thing nobody can reconstruct from a
JPEG two years later. Run it and the answer is regenerated, with the numbers to
type into Settings printed at the end:

    python3 tools/naip-aerial.py --lat 33.0512 --lon -97.4419
    python3 tools/naip-aerial.py --lat 33.0512 --lon -97.4419 --upload

Needs GDAL on the path (`apt-get install gdal-bin`, `brew install gdal`), and
`boto3` for --upload.

## Where the imagery comes from

Not EarthExplorer, which the spec names and which wants an account. Texas
mirrors the federal NAIP delivery for the whole state, in the open, on S3:

    s3://tnris-data-warehouse/LCD/collection/<collection>/

That is TxGIO/TNRIS redistributing the USDA's own quarter-quads — same public
domain imagery, same 60 cm, no login. Each collection ships a shapefile index
of its tile footprints, which is how the tile covering a coordinate is found
below rather than guessed from the quad-numbering scheme.

**This is a Texas source for a Texas farm.** A second property in another state
needs a different mirror (or an EarthExplorer download by hand), and this script
would need to learn about it — it deliberately does not pretend to be national.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

WAREHOUSE = "https://tnris-data-warehouse.s3.amazonaws.com"
COLLECTION_ROOT = "LCD/collection"

# The newest quarter-quad collection. Newer years exist as county mosaics
# (`-ccm`), but those are MrSID, which needs a proprietary decoder most GDAL
# builds are not compiled with — quarter-quads are JPEG 2000 and open anywhere.
DEFAULT_COLLECTION = "naip-2022-nccir-60cm"

# NAIP quarter-quads are 4-band (natural colour + near infrared). Bands 1-3 are
# the natural colour image; band 4 is the NIR that makes the CIR view and is not
# wanted for a background somebody has to recognise their own pasture in.
RGB_BANDS = (1, 2, 3)

EARTH_RADIUS_M = 6378137.0


# --------------------------------------------------------------------------
# Web Mercator
#
# Held here rather than reached for through pyproj: it is four lines, it is the
# thing this script is actually about, and a projection dependency for a tool
# that already requires the whole of GDAL is a poor trade.
# --------------------------------------------------------------------------


def to_mercator(lon: float, lat: float) -> tuple[float, float]:
    return (
        math.radians(lon) * EARTH_RADIUS_M,
        math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * EARTH_RADIUS_M,
    )


def to_wgs84(x: float, y: float) -> tuple[float, float]:
    return (
        math.degrees(x / EARTH_RADIUS_M),
        math.degrees(2 * math.atan(math.exp(y / EARTH_RADIUS_M)) - math.pi / 2),
    )


def mercator_stretch(lat: float) -> float:
    """
    How much Web Mercator inflates distance at this latitude.

    A metre of Web Mercator is not a metre of ground anywhere but the equator,
    and at 33°N it is about 84 cm of it. Everything the caller asks for is in
    ground metres — a 3 km window means 3 km of Texas — so both the window and
    the pixel size are multiplied through this on the way into GDAL. Skip it and
    a "3 km" window comes out a kilometre short and the pixels are finer than
    the source, which looks like detail and is interpolation.
    """
    return 1 / math.cos(math.radians(lat))


# --------------------------------------------------------------------------
# GDAL
# --------------------------------------------------------------------------


def require_gdal() -> None:
    missing = [tool for tool in ("ogr2ogr", "gdalbuildvrt", "gdalwarp", "gdal_translate", "gdalinfo", "gdalsrsinfo") if shutil.which(tool) is None]
    if missing:
        sys.exit(f"GDAL is not on the path: {', '.join(missing)} not found. Try `apt-get install gdal-bin` or `brew install gdal`.")


def run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"{command[0]} failed:\n{result.stderr.strip()}")
    return result.stdout


def tiles_covering(collection: str, window: tuple[float, float, float, float]) -> list[dict]:
    """
    The quarter-quads overlapping the window, from the collection's own index.

    Read straight out of the zipped shapefile over HTTP — `/vsizip//vsicurl/`
    means GDAL range-requests the parts of it that the spatial filter touches
    rather than pulling five megabytes of Texas to find four tiles.

    The alternative is deriving the tile id from the quad-numbering scheme, and
    it is not worth it: the numbering is a convention about which corner of
    which one-degree block a quad is counted from, getting it wrong yields a
    plausible id for the wrong ground, and the flight date in the filename
    cannot be derived at all.
    """
    index = f"/vsizip//vsicurl/{WAREHOUSE}/{COLLECTION_ROOT}/{collection}/assets/index/{collection}_index.zip"
    minx, miny, maxx, maxy = window
    geojson = run(
        # fmt: off
        [
            "ogr2ogr", "-f", "GeoJSON", "/vsistdout/",
            "-spat", str(minx), str(miny), str(maxx), str(maxy),
            "-select", "TileID,FltDate,CollName,Year,Res",
            index,
        ],
        # fmt: on
    )
    features = json.loads(geojson).get("features", [])
    return sorted((feature["properties"] for feature in features), key=lambda p: p["TileID"])


def fetch(url: str, destination: Path) -> Path:
    """Download once and keep it: reruns at a different window are then free."""
    if destination.exists() and destination.stat().st_size > 0:
        print(f"  cached  {destination.name}")
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"  fetching {destination.name}")
    result = subprocess.run(["curl", "-sS", "--fail", "-m", "900", "-o", str(destination), url])
    if result.returncode != 0:
        destination.unlink(missing_ok=True)
        sys.exit(f"Could not download {url}")
    return destination


def extent_of(raster: Path) -> tuple[float, float, float, float]:
    info = json.loads(run(["gdalinfo", "-json", str(raster)]))
    corners = info["cornerCoordinates"]
    (minx, miny), (maxx, maxy) = corners["lowerLeft"], corners["upperRight"]
    return minx, miny, maxx, maxy


# --------------------------------------------------------------------------


def build(args: argparse.Namespace) -> tuple[Path, dict[str, float]]:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    stretch = mercator_stretch(args.lat)
    centre_x, centre_y = to_mercator(args.lon, args.lat)
    resolution = args.resolution * stretch

    # Snap the window to a whole number of pixels, so its edges land on pixel
    # seams and the extent printed at the end is the extent of the image rather
    # than of a rectangle GDAL had to round.
    half = args.metres / 2 * stretch
    pixels = round(2 * half / resolution)
    half = pixels * resolution / 2
    window = (centre_x - half, centre_y - half, centre_x + half, centre_y + half)

    print(f"Window: {args.metres} m across at {args.lat}, {args.lon} — {pixels}x{pixels} px")

    tiles = tiles_covering(args.collection, window)
    if not tiles:
        sys.exit(
            f"No {args.collection} tile covers {args.lat}, {args.lon}. "
            "Outside Texas, this mirror has nothing — see the note at the top of this file."
        )
    print(f"Tiles: {', '.join(tile['TileID'] for tile in tiles)}")

    cache = out / "tiles"
    sources = [
        fetch(
            f"{WAREHOUSE}/{COLLECTION_ROOT}/{args.collection}/items/nccir/"
            f"{args.collection}_{tile['TileID']}_{tile['FltDate']}.jp2",
            cache / f"{args.collection}_{tile['TileID']}_{tile['FltDate']}.jp2",
        )
        for tile in tiles
    ]

    stem = f"{args.collection}-3857"
    vrt, tif, jpeg = out / f"{stem}.vrt", out / f"{stem}.tif", out / f"{stem}.jpg"

    bands = [arg for band in RGB_BANDS for arg in ("-b", str(band))]
    run(["gdalbuildvrt", "-overwrite", *bands, str(vrt), *[str(path) for path in sources]])

    # fmt: off
    run([
        "gdalwarp", "-overwrite",
        "-t_srs", "EPSG:3857",
        "-te", *[f"{edge:.4f}" for edge in window],
        "-tr", f"{resolution:.6f}", f"{resolution:.6f}",
        "-r", "cubic", "-multi",
        "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES",
        str(vrt), str(tif),
    ])
    # A worldfile beside the JPEG, because the JPEG itself cannot carry a
    # georeference and the extent living only in a settings form is one copy of
    # it. Anything that opens the .jpg finds the .wld and .prj and knows where
    # the image is.
    run([
        "gdal_translate", "-q", "-of", "JPEG",
        "-co", f"QUALITY={args.quality}", "-co", "WORLDFILE=YES",
        "-colorinterp", "red,green,blue",
        str(tif), str(jpeg),
    ])
    # fmt: on
    (out / f"{stem}.prj").write_text(run(["gdalsrsinfo", "-o", "wkt1", "EPSG:3857"]).strip() + "\n")

    minx, miny, maxx, maxy = extent_of(tif)
    west, south = to_wgs84(minx, miny)
    east, north = to_wgs84(maxx, maxy)
    return jpeg, {"south": south, "west": west, "north": north, "east": east}


def upload(jpeg: Path, key_prefix: str) -> str:
    """
    Into R2, unsigned and public — the one object in this project that is.

    Everything else in the bucket is reached through a presigned URL, and this
    one deliberately is not: there is nothing to protect in public-domain
    imagery, and a signed URL expires, which is precisely the wrong thing to
    hand a service worker whose whole job is to still be holding this image in a
    barn with no signal next February.
    """
    try:
        import boto3
    except ImportError:
        sys.exit("--upload needs boto3 (`pip install boto3`).")

    missing = [name for name in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_BUCKET") if not os.environ.get(name)]
    if missing:
        sys.exit(f"Not set: {', '.join(missing)}. R2_PUBLIC_BUCKET is the public bucket, not the private R2_BUCKET photos go in.")

    bucket = os.environ["R2_PUBLIC_BUCKET"]
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    key = f"{key_prefix.strip('/')}/{jpeg.name}"
    for path, content_type in (
        (jpeg, "image/jpeg"),
        (jpeg.with_suffix(".wld"), "text/plain"),
        (jpeg.with_suffix(".prj"), "text/plain"),
    ):
        if not path.exists():
            continue
        client.put_object(
            Bucket=bucket,
            Key=f"{key_prefix.strip('/')}/{path.name}",
            Body=path.read_bytes(),
            ContentType=content_type,
            # The key names the year and the projection, so its bytes never
            # change. A refly gets a new key, never a new body under this one.
            CacheControl="public, max-age=31536000, immutable",
        )
        print(f"  uploaded {bucket}/{key_prefix.strip('/')}/{path.name}")
    return key


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lat", type=float, required=True, help="Property latitude (Settings → Property has it)")
    parser.add_argument("--lon", type=float, required=True, help="Property longitude")
    parser.add_argument("--metres", type=float, default=3000, help="Window across, in ground metres (default 3000)")
    parser.add_argument("--resolution", type=float, default=0.6, help="Ground metres per pixel (default 0.6, NAIP native)")
    parser.add_argument("--collection", default=DEFAULT_COLLECTION, help=f"TNRIS collection (default {DEFAULT_COLLECTION})")
    parser.add_argument("--quality", type=int, default=85, help="JPEG quality (default 85)")
    parser.add_argument("--out", default="build/naip", help="Working directory (default build/naip)")
    parser.add_argument("--upload", action="store_true", help="Put the result in R2 (reads R2_* from the environment)")
    parser.add_argument("--key-prefix", default="imagery/flying-double-m", help="Key prefix in the public bucket")
    args = parser.parse_args()

    require_gdal()
    jpeg, bounds = build(args)

    key = upload(jpeg, args.key_prefix) if args.upload else f"{args.key_prefix.strip('/')}/{jpeg.name}"

    size = jpeg.stat().st_size
    print(f"\n{jpeg} ({size / 1_048_576:.1f} MB)")
    print("\nSettings → Property → the offline background wants:")
    print(f"  key    {key}")
    for edge in ("south", "west", "north", "east"):
        print(f"  {edge:<6} {bounds[edge]:.6f}")
    if not args.upload:
        print("\nNot uploaded (pass --upload).")


if __name__ == "__main__":
    main()
