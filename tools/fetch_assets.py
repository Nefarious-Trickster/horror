#!/usr/bin/env python3
"""Download the CC0 texture/HDRI assets the game uses into assets/.

Sources (all CC0): ambientCG (https://ambientcg.com) and Poly Haven (https://polyhaven.com).
Each download is unpacked into its own fresh temporary directory; only the image maps
the game needs are copied into assets/textures/<Name>/ (1K JPG) and assets/hdri/.

    python3 tools/fetch_assets.py
"""
import io
import json
import pathlib
import shutil
import tempfile
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEX = ROOT / "assets" / "textures"
HDRI = ROOT / "assets" / "hdri"

# ambientCG material id -> what it is used for
AMBIENTCG = {
    "Tiles107": "white ceramic tiles (containment cells)",
    "Terrazzo019S": "speckled institutional floor (lab)",
    "Tiles043": "clean grey floor tiles (corridors)",
    "Metal009": "brushed stainless steel",
    "Metal049A": "clean polished metal",
    "Plastic013A": "white plastic / powder coat",
    "Plaster001": "smooth painted wall plaster",
    "Rubber001": "black rubber floor matting",
}
MAPS = {"Color": "color", "NormalGL": "normal", "Roughness": "roughness", "AmbientOcclusion": "ao", "Metalness": "metalness"}

POLYHAVEN_HDRI = {"childrens_hospital": "1k"}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "horror-asset-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def ambientcg(asset):
    out = TEX / asset
    if out.exists() and any(out.iterdir()):
        print("have", asset); return
    data = fetch(f"https://ambientcg.com/get?file={asset}_1K-JPG.zip")
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                name = pathlib.PurePosixPath(info.filename).name  # flatten, ignore any paths in the archive
                if name.lower().endswith(".jpg"):
                    (pathlib.Path(tmp) / name).write_bytes(z.read(info))
        out.mkdir(parents=True, exist_ok=True)
        for f in pathlib.Path(tmp).iterdir():
            for key, short in MAPS.items():
                if f.stem.endswith("_" + key):
                    shutil.copy(f, out / f"{short}.jpg")
    print("got ", asset, sorted(p.name for p in out.iterdir()))


def polyhaven_hdri(asset, res):
    HDRI.mkdir(parents=True, exist_ok=True)
    out = HDRI / f"{asset}_{res}.hdr"
    if out.exists():
        print("have", out.name); return
    files = json.loads(fetch(f"https://api.polyhaven.com/files/{asset}"))
    url = files["hdri"][res]["hdr"]["url"]
    out.write_bytes(fetch(url))
    print("got ", out.name, out.stat().st_size)


if __name__ == "__main__":
    for a in AMBIENTCG:
        ambientcg(a)
    for a, r in POLYHAVEN_HDRI.items():
        polyhaven_hdri(a, r)
