#!/usr/bin/env python3
"""Download and convert the CC0 assets used by the Wing D environment kit (js/wingd/kit.js).

Sources (all CC0):
  * Poly Haven models  https://polyhaven.com/models   (glTF, 1k textures)
  * ambientCG materials https://ambientcg.com          (1K/2K JPG PBR sets)

The published build cannot serve .gltf/.bin files, so every model is converted into ONE
glTF JSON file (assets/models/<id>/<id>.json) whose binary buffer is embedded as a base64
data: URI, plus its texture images as separate .jpg files next to it. kit.js decodes the
buffer itself and hands GLTFLoader an in-memory GLB.

The conversion also makes the models cheaper to ship and render:
  * vertex data is quantized with KHR_mesh_quantization (positions int16 + a dequantize
    node transform, normals int8, UVs uint16 when they fit in 0..1), tangents are dropped
    (three.js derives them), indices become uint16 where possible;
  * KHR_materials_specular / spec maps are dropped;
  * textures are downscaled (1024 px for big props, 512 px for small ones) and re-encoded as
    JPEG q82 (the ARM map stays packed: R = AO, G = roughness, B = metalness, which is what
    GLTFLoader expects for occlusion + metallicRoughness).

Material maps from ambientCG are copied to assets/textures/<ID>/{color,normal,roughness,ao,metalness}.jpg.

Every download goes into its own fresh temporary directory and is only parsed as data
(JSON, images, zip entries read in memory). Run with an isolated interpreter:

    python3 -I tools/fetch_kit_assets.py            # fetch what is missing
    python3 -I tools/fetch_kit_assets.py --force    # re-fetch everything
    python3 -I tools/fetch_kit_assets.py --only portable_generator Concrete023
"""
import argparse
import base64
import io
import json
import pathlib
import struct
import sys
import tempfile
import urllib.request
import zipfile

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "assets" / "models"
TEX_DIR = ROOT / "assets" / "textures"
UA = {"User-Agent": "horror-kit-asset-fetch/1.0"}

# Poly Haven model id -> max texture size (px)
MODELS = {
    "portable_generator": 1024,
    "flood_lights": 1024,
    "power_box_01": 1024,
    "metal_office_desk": 1024,
    "metal_tool_chest": 512,
    "cement_bag": 512,
    "cardboard_box_01": 512,
    "plastic_crate_03": 512,
    "ladder_sectioned_01": 512,
    "hand_truck": 512,
    "steel_frame_shelves_01": 512,
    "propane_tank": 512,
    "metal_jerrycan": 512,
    "plastic_jerrycan": 512,
    "sledgehammer_01": 512,
    "crowbar_01": 512,
    "Drill_01": 512,
    "spray_paint_bottles": 512,
    "trashbag": 512,
    "wooden_broom": 512,
    "plastic_monobloc_chair_01": 512,
    "portable_cassette_player": 512,
    "classic_laptop": 512,
    "clipboard": 512,
    "binder_notebook": 512,
    "wall_clock": 512,
    "desk_lamp_arm_01": 512,
    "fire_alarm": 256,
    "caged_hanging_light": 512,
}

# ambientCG material id -> resolution
MATERIALS = {
    "Concrete023": "2K",   # power-trowelled floor slab (swirl marks)
    "Concrete028": "2K",   # cast concrete, board-formed: columns / walls / soffit
    "Concrete036": "1K",   # old dusty concrete with plaster splashes
    "Wood087": "1K",       # plywood face
    "Chipboard004": "1K",  # OSB
    "Plaster002": "1K",    # drywall / gypsum board face
    "Metal055A": "1K",     # galvanised steel (studs, ducts, scaffold tube)
    "Metal021": "1K",      # steel with rust spots (lift frame / doors)
    "DiamondPlate008C": "1K",  # lift car floor
    "Fabric045": "1K",     # mineral wool insulation (tinted)
}
ACG_MAPS = {"Color": "color", "NormalGL": "normal", "Roughness": "roughness", "AmbientOcclusion": "ao", "Metalness": "metalness"}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


# ------------------------------------------------------------------ glTF helpers
COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_accessor(gl, bin_, idx):
    acc = gl["accessors"][idx]
    dt = np.dtype(COMP[acc["componentType"]])
    n = NCOMP[acc["type"]]
    count = acc["count"]
    if "bufferView" not in acc:
        arr = np.zeros((count, n), dt)
    else:
        bv = gl["bufferViews"][acc["bufferView"]]
        off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = bv.get("byteStride", 0) or dt.itemsize * n
        raw = np.frombuffer(bin_, np.uint8, count=(count - 1) * stride + dt.itemsize * n, offset=off)
        arr = np.lib.stride_tricks.as_strided(raw, shape=(count, dt.itemsize * n), strides=(stride, 1)).copy()
        arr = arr.view(dt).reshape(count, n)
    if "sparse" in acc:
        raise ValueError("sparse accessors not supported")
    if acc.get("normalized"):
        if dt == np.uint8: arr = arr.astype(np.float32) / 255
        elif dt == np.uint16: arr = arr.astype(np.float32) / 65535
        elif dt == np.int8: arr = np.maximum(arr.astype(np.float32) / 127, -1)
        elif dt == np.int16: arr = np.maximum(arr.astype(np.float32) / 32767, -1)
    return arr


class BinWriter:
    def __init__(self, gl):
        self.gl = gl
        self.data = bytearray()
        gl["bufferViews"] = []
        gl["accessors"] = []

    def add(self, arr, comp, typ, *, normalized=False, target=None, minmax=False, pad_to=None):
        """arr: (count, n) already in the target dtype. pad_to: element byte size to pad rows to."""
        count, n = arr.shape
        row = arr.tobytes()
        stride = None
        if pad_to and pad_to != arr.itemsize * n:
            padded = np.zeros((count, pad_to), np.uint8)
            padded[:, : arr.itemsize * n] = np.frombuffer(arr.tobytes(), np.uint8).reshape(count, arr.itemsize * n)
            row = padded.tobytes()
            stride = pad_to
        while len(self.data) % 4: self.data.append(0)
        bv = {"buffer": 0, "byteOffset": len(self.data), "byteLength": len(row)}
        if stride: bv["byteStride"] = stride
        if target: bv["target"] = target
        self.data += row
        self.gl["bufferViews"].append(bv)
        acc = {"bufferView": len(self.gl["bufferViews"]) - 1, "componentType": comp, "count": count, "type": typ}
        if normalized: acc["normalized"] = True
        if minmax:
            acc["min"] = [float(v) for v in arr.min(axis=0)]
            acc["max"] = [float(v) for v in arr.max(axis=0)]
            if comp != 5126:
                acc["min"] = [int(v) for v in acc["min"]]; acc["max"] = [int(v) for v in acc["max"]]
        self.gl["accessors"].append(acc)
        return len(self.gl["accessors"]) - 1


def quantize_model(gl, bin_):
    """Rewrite all mesh data with KHR_mesh_quantization; returns the new binary buffer."""
    old = {"accessors": gl["accessors"], "bufferViews": gl["bufferViews"]}
    src = dict(gl); src.update(old)
    skinned_meshes = {n["mesh"] for n in gl.get("nodes", []) if "mesh" in n and "skin" in n}
    # which TEXCOORD sets are referenced by materials
    used_tc = {0}
    for m in gl.get("materials", []):
        def walk(o):
            if isinstance(o, dict):
                if "index" in o and "texCoord" in o: used_tc.add(o["texCoord"])
                for v in o.values(): walk(v)
            elif isinstance(o, list):
                for v in o: walk(v)
        walk(m)
    w = BinWriter(gl)
    cache = {}
    mesh_xf = {}
    for mi, mesh in enumerate(gl.get("meshes", [])):
        mesh.pop("weights", None)  # morph targets are not used by the kit
        for p in mesh["primitives"]: p.pop("targets", None)
        quant_pos = mi not in skinned_meshes
        if quant_pos:
            lo = np.full(3, np.inf); hi = np.full(3, -np.inf)
            for p in mesh["primitives"]:
                pos = read_accessor(src, bin_, p["attributes"]["POSITION"])
                lo = np.minimum(lo, pos.min(0)); hi = np.maximum(hi, pos.max(0))
            c = (lo + hi) / 2
            h = float(max((hi - lo).max() / 2, 1e-6))
            mesh_xf[mi] = (c, h)
        for p in mesh["primitives"]:
            attrs = {}
            for name, ai in p["attributes"].items():
                if name == "TANGENT": continue
                if name.startswith("TEXCOORD_") and int(name.split("_")[1]) not in used_tc: continue
                key = (name, ai, mi if name == "POSITION" else None)
                if key in cache: attrs[name] = cache[key]; continue
                a = read_accessor(src, bin_, ai)
                if name == "POSITION" and quant_pos:
                    c, h = mesh_xf[mi]
                    q = np.clip(np.round((a - c) / h * 32767), -32767, 32767).astype(np.int16)
                    na = w.add(q, 5122, "VEC3", normalized=True, target=34962, minmax=True, pad_to=8)
                elif name == "POSITION":
                    na = w.add(a.astype(np.float32), 5126, "VEC3", target=34962, minmax=True)
                elif name == "NORMAL" and quant_pos:
                    nn = a / np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-8)
                    q = np.clip(np.round(nn * 127), -127, 127).astype(np.int8)
                    na = w.add(q, 5120, "VEC3", normalized=True, target=34962, pad_to=4)
                elif name.startswith("TEXCOORD_") and a.min() >= 0 and a.max() <= 1:
                    q = np.clip(np.round(a * 65535), 0, 65535).astype(np.uint16)
                    na = w.add(q, 5123, "VEC2", normalized=True, target=34962)
                else:
                    acc = src["accessors"][ai]
                    if acc["componentType"] == 5126 or acc.get("normalized"):
                        na = w.add(a.astype(np.float32), 5126, acc["type"], target=34962)
                    else:
                        na = w.add(a.astype(COMP[acc["componentType"]]), acc["componentType"], acc["type"], target=34962)
                cache[key] = na
                attrs[name] = na
            p["attributes"] = attrs
            if "indices" in p:
                key = ("indices", p["indices"], None)
                if key not in cache:
                    ind = read_accessor(src, bin_, p["indices"]).reshape(-1, 1)
                    if ind.max() < 65535:
                        cache[key] = w.add(ind.astype(np.uint16), 5123, "SCALAR", target=34963)
                    else:
                        cache[key] = w.add(ind.astype(np.uint32), 5125, "SCALAR", target=34963)
                p["indices"] = cache[key]
    # skins / animations keep their (float) accessors
    for skin in gl.get("skins", []):
        if "inverseBindMatrices" in skin:
            a = read_accessor(src, bin_, skin["inverseBindMatrices"])
            skin["inverseBindMatrices"] = w.add(a.astype(np.float32), 5126, "MAT4")
    for anim in gl.get("animations", []):
        for s in anim["samplers"]:
            for k in ("input", "output"):
                acc = src["accessors"][s[k]]
                a = read_accessor(src, bin_, s[k])
                s[k] = w.add(a.astype(np.float32), 5126, acc["type"], minmax=(k == "input"))
    # move quantized meshes into child nodes carrying the dequantization transform
    nodes = gl.get("nodes", [])
    for i in range(len(nodes)):
        n = nodes[i]
        if "mesh" in n and n["mesh"] in mesh_xf:
            c, h = mesh_xf[n["mesh"]]
            child = {"name": (n.get("name") or "mesh") + "_q", "mesh": n.pop("mesh"),
                     "translation": [float(v) for v in c], "scale": [h, h, h]}
            nodes.append(child)
            n.setdefault("children", []).append(len(nodes) - 1)
    if mesh_xf:
        for k in ("extensionsUsed", "extensionsRequired"):
            lst = gl.setdefault(k, [])
            if "KHR_mesh_quantization" not in lst: lst.append("KHR_mesh_quantization")
    while len(w.data) % 4: w.data.append(0)
    return bytes(w.data)


def strip_specular(gl):
    for m in gl.get("materials", []):
        ext = m.get("extensions", {})
        ext.pop("KHR_materials_specular", None)
        if not ext: m.pop("extensions", None)
    for k in ("extensionsUsed", "extensionsRequired"):
        if k in gl:
            gl[k] = [e for e in gl[k] if e != "KHR_materials_specular"]
            if not gl[k]: del gl[k]


def prune_textures(gl):
    used = set()
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k.endswith("Texture") and isinstance(v, dict) and "index" in v: used.add(v["index"])
                walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(gl.get("materials", []))
    tex_map, new_tex = {}, []
    for i, t in enumerate(gl.get("textures", [])):
        if i in used: tex_map[i] = len(new_tex); new_tex.append(t)
    def remap(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k.endswith("Texture") and isinstance(v, dict) and "index" in v: v["index"] = tex_map[v["index"]]
                remap(v)
        elif isinstance(o, list):
            for v in o: remap(v)
    remap(gl.get("materials", []))
    gl["textures"] = new_tex
    used_img = sorted({t["source"] for t in new_tex})
    img_map = {o: n for n, o in enumerate(used_img)}
    gl["images"] = [gl["images"][o] for o in used_img]
    for t in new_tex: t["source"] = img_map[t["source"]]


def alpha_images(gl):
    """images used as baseColor of non-opaque materials (must keep their alpha channel)"""
    out = set()
    for m in gl.get("materials", []):
        if m.get("alphaMode", "OPAQUE") != "OPAQUE":
            bc = m.get("pbrMetallicRoughness", {}).get("baseColorTexture")
            if bc: out.add(gl["textures"][bc["index"]]["source"])
    return out


def convert_model(asset, max_px, force=False):
    out_dir = MODELS_DIR / asset
    out_json = out_dir / f"{asset}.json"
    if out_json.exists() and not force:
        print("have", asset); return
    files = json.loads(fetch(f"https://api.polyhaven.com/files/{asset}"))
    entry = files["gltf"]["1k"]["gltf"]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        gl = json.loads(fetch(entry["url"]))
        blobs = {}
        for rel, inc in entry.get("include", {}).items():
            if "_spec_" in rel: continue  # dropped below
            name = pathlib.PurePosixPath(rel).name
            (tmp / name).write_bytes(fetch(inc["url"]))
            blobs[rel] = tmp / name
        bin_ = blobs[gl["buffers"][0]["uri"]].read_bytes()
        strip_specular(gl)
        prune_textures(gl)
        new_bin = quantize_model(gl, bin_)
        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.iterdir(): old.unlink()
        keep_alpha = alpha_images(gl)
        for i, img in enumerate(gl.get("images", [])):
            src = blobs[img["uri"]]
            im = Image.open(src)
            im.load()
            stem = pathlib.PurePosixPath(img["uri"]).stem.replace("_1k", "")
            if im.width > max_px or im.height > max_px:
                s = max_px / max(im.width, im.height)
                im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
            if i in keep_alpha and im.mode in ("RGBA", "LA"):
                name = stem + ".png"
                im.save(out_dir / name, optimize=True)
            else:
                name = stem + ".jpg"
                im.convert("RGB").save(out_dir / name, quality=82, optimize=True, progressive=True)
            img["uri"] = name
            img.pop("mimeType", None)
        gl["buffers"] = [{"byteLength": len(new_bin), "uri": "data:application/octet-stream;base64," + base64.b64encode(new_bin).decode()}]
        out_json.write_text(json.dumps(gl, separators=(",", ":")))
    size = sum(p.stat().st_size for p in out_dir.iterdir())
    print(f"got  {asset:28s} {size / 1e6:6.2f} MB")


def ambientcg(asset, res, force=False):
    out = TEX_DIR / asset
    if out.exists() and any(out.iterdir()) and not force:
        print("have", asset); return
    data = fetch(f"https://ambientcg.com/get?file={asset}_{res}-JPG.zip")
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            name = pathlib.PurePosixPath(info.filename).name  # never use archive paths
            if not name.lower().endswith(".jpg"): continue
            stem = name[:-4]
            for key, short in ACG_MAPS.items():
                if stem.endswith("_" + key):
                    im = Image.open(io.BytesIO(z.read(info)))
                    im.load()
                    mode = "RGB" if short in ("color", "normal") else "L"
                    q = 88 if short == "normal" else 84
                    im.convert(mode).save(out / f"{short}.jpg", quality=q, optimize=True, progressive=True)
    size = sum(p.stat().st_size for p in out.iterdir())
    print(f"got  {asset:28s} {size / 1e6:6.2f} MB  {sorted(p.name for p in out.iterdir())}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    for a, px in MODELS.items():
        if not args.only or a in args.only:
            try: convert_model(a, px, args.force)
            except Exception as e: print("FAIL", a, e, file=sys.stderr)
    for a, r in MATERIALS.items():
        if not args.only or a in args.only:
            try: ambientcg(a, r, args.force)
            except Exception as e: print("FAIL", a, e, file=sys.stderr)
