# -*- coding: utf-8 -*-
"""
DXF-Test-Corpus ビルドスクリプト
主分類10種類・合計100ファイルの ASCII DXF テストコーパスを生成する。

使い方:
    pip install ezdxf
    python build_corpus.py

注意:
    生成されるDXFは「合成(synthetic)図面」であり実CAD出力ではない。
    manifest の cad_name は "synthetic (ezdxf)" と記録される。
    実案件100件の受入用には、実CADから出力したDXFで置き換えること。
"""
import csv
import json
import math
import os
import sys
import hashlib
from collections import Counter
from datetime import datetime

try:
    import ezdxf
    from ezdxf.enums import MTextEntityAlignment
    from ezdxf.lldxf import const
except ImportError:
    sys.exit("ezdxf が必要です: pip install ezdxf")

ROOT = os.path.dirname(os.path.abspath(__file__))
DXF_VER = "R2000"

DOC_COMMON = {
    "units": "m (meters, $INSUNITS=6)",
    "assumed_scale": "1/100",
    "paper_size": "A3 420x297mm (layouts)",
    "encoding": "ASCII DXF with Unicode escapes",
    "fonts": "txt.shx (viewer提供フォントに依存)",
    "cad_name": "synthetic generator (ezdxf %s)" % ezdxf.__version__,
    "dxf_version": "R2000; gradient HATCH uses R2004",
}

MANIFEST = []


def new_doc(version=DXF_VER):
    doc = ezdxf.new(version, setup=True)
    doc.header["$INSUNITS"] = 6
    doc.header["$LTSCALE"] = 1.0
    return doc


def title(msp, text, y=12.0, h=0.5):
    msp.add_text(text, dxfattribs={"height": h}).set_placement((0, y))


def save(doc, cat, fname, summary, features):
    path = os.path.join(ROOT, cat, fname)
    doc.saveas(path, encoding="ascii")
    rel = os.path.relpath(path, ROOT).replace("\\", "/")
    MANIFEST.append({
        "file": rel,
        "category": cat,
        "summary": summary,
        "features": ";".join(features),
        "dxf_version": doc.dxfversion,
        "cad_name": DOC_COMMON["cad_name"],
        "units": DOC_COMMON["units"],
        "assumed_scale": DOC_COMMON["assumed_scale"],
        "paper_size": DOC_COMMON["paper_size"],
        "encoding": DOC_COMMON["encoding"],
        "fonts": DOC_COMMON["fonts"],
        "origin": "synthetic",
        "bucket": "synthetic-regression",
        "anonymized": "yes",
        "reference_pdf": "(未添付: 実CAD版で添付)",
        "external_refs": "",
        "license": "see 00_manifest/LICENSE_AND_USAGE.md",
        "feature_tags_are": "requested scenarios, not proof of coverage; see verification.json",
    })
    print("  +", rel)


# ================================================================ 01 寸法 x15
def gen_dimension(i):
    doc = new_doc()
    msp = doc.modelspace()
    variants = ["linear_h", "linear_v", "aligned", "angular", "radius",
                "diameter", "tolerance", "limits", "precision", "text_style",
                "jis_offset", "multi_segment", "oblique", "baseline", "arrows"]
    v = variants[i]
    doc.styles.add("DIMF", font="txt.shx")
    ds = doc.dimstyles.new("TD%d" % i)
    ds.dxf.dimtxt = 0.35
    ds.dxf.dimasz = 0.25
    ds.dxf.dimtxsty = "DIMF"
    if v == "tolerance":
        ds.dxf.dimtol = 1
        ds.dxf.dimtp = 0.05
        ds.dxf.dimtm = 0.05
    elif v == "limits":
        ds.dxf.dimlim = 1
        ds.dxf.dimtp = 0.2
        ds.dxf.dimtm = 0.1
    elif v == "precision":
        ds.dxf.dimdec = 3
    elif v == "jis_offset":
        ds.dxf.dimexo = 0.5
        ds.dxf.dimexe = 0.5
    doc.layers.add("DIM", color=3)
    attr = {"layer": "DIM"}
    title(msp, "DIMENSION TEST %02d - %s" % (i + 1, v))
    msp.add_line((0, 0), (10, 0))

    if v == "linear_v":
        msp.add_line((0, 0), (0, 8))
        msp.add_linear_dim(base=(1.5, 0), p1=(0, 0), p2=(0, 8), angle=90,
                           dimstyle="TD%d" % i, dxfattribs=attr).render()
    elif v == "aligned":
        msp.add_line((0, 0), (8, 5))
        msp.add_aligned_dim(p1=(0, 0), p2=(8, 5), distance=1.5,
                            dimstyle="TD%d" % i, dxfattribs=attr).render()
    elif v == "angular":
        msp.add_line((0, 0), (10, 0))
        msp.add_line((0, 0), (7, 7))
        msp.add_angular_dim_2l(base=(3, 3),
                                line1=((0, 0), (10, 0)), line2=((0, 0), (7, 7)),
                                dimstyle="TD%d" % i, dxfattribs=attr).render()
    elif v == "radius":
        msp.add_circle((5, 5), 3)
        msp.add_radius_dim(center=(5, 5), angle=45, radius=3,
                           dimstyle="TD%d" % i, dxfattribs=attr).render()
    elif v == "diameter":
        msp.add_circle((5, 5), 3)
        msp.add_diameter_dim(center=(5, 5), radius=3, angle=30,
                             dimstyle="TD%d" % i, dxfattribs=attr).render()
    elif v == "multi_segment":
        for k in range(3):
            msp.add_linear_dim(base=(0, -1.5 - k * 1.2), p1=(k * 3.33, 0),
                               p2=((k + 1) * 3.33, 0), dimstyle="TD%d" % i,
                               dxfattribs=attr).render()
    elif v == "oblique":
        msp.add_line((0, 0), (8, 8))
        msp.add_aligned_dim(p1=(0, 0), p2=(8, 8), distance=1.5,
                            dimstyle="TD%d" % i, dxfattribs=attr).render()
    elif v == "baseline":
        msp.add_linear_dim(base=(0, -1.5), p1=(0, 0), p2=(10, 0),
                           dimstyle="TD%d" % i, dxfattribs=attr).render()
        msp.add_linear_dim(base=(0, -3.0), p1=(0, 0), p2=(6, 0),
                           dimstyle="TD%d" % i, dxfattribs=attr).render()
    elif v == "arrows":
        ds.dxf.dimblk = "OPEN"
        msp.add_linear_dim(base=(0, -1.5), p1=(0, 0), p2=(10, 0),
                           dimstyle="TD%d" % i, dxfattribs=attr).render()
    else:  # linear_h, tolerance, limits, precision, text_style, jis_offset
        msp.add_linear_dim(base=(0, -1.5), p1=(0, 0), p2=(10, 0),
                           dimstyle="TD%d" % i, dxfattribs=attr).render()
    save(doc, "01_dimension", "dim_%02d_%s.dxf" % (i + 1, v),
         "寸法: %s" % v, ["DIMENSION", "DIMSTYLE", v.upper()])


# ================================================================ 02 ハッチ x10
def gen_hatch(i):
    doc = new_doc("R2004" if i == 7 else DXF_VER)
    msp = doc.modelspace()
    variants = ["solid", "pattern", "pattern_multi", "island", "hole",
                "curve_boundary", "associative", "gradient", "boundary_polyline", "complex"]
    v = variants[i]
    title(msp, "HATCH TEST %02d - %s" % (i + 1, v))

    if v == "solid":
        h = msp.add_hatch()
        h.set_solid_fill()
        h.paths.add_polyline_path([(0, 0), (10, 0), (10, 8), (0, 8)], is_closed=True)
    elif v in ("pattern", "island", "hole", "associative", "boundary_polyline", "complex"):
        h = msp.add_hatch()
        h.set_pattern_fill("ANSI31", scale=2.0)
        outer = [(0, 0), (12, 0), (12, 9), (0, 9)]
        h.paths.add_polyline_path(outer, is_closed=True)
        if v in ("island", "complex"):
            h.paths.add_polyline_path([(3, 3), (6, 3), (6, 6), (3, 6)], is_closed=True, flags=0)
        if v == "hole":
            h.paths.add_polyline_path([(4, 3), (8, 3), (8, 6), (4, 6)], is_closed=True, flags=0)
        if v == "associative":
            pl = msp.add_lwpolyline(outer, dxfattribs={"closed": True})
            h.associate(h.paths[0], [pl])
        if v == "boundary_polyline":
            doc.layers.add("BOUNDARY")
            msp.add_lwpolyline(outer, dxfattribs={"closed": True, "layer": "BOUNDARY"})
        if v == "complex":
            h2 = msp.add_hatch()
            h2.set_pattern_fill("ANSI37", scale=1.5, angle=45)
            h2.paths.add_polyline_path([(14, 0), (22, 0), (22, 8), (14, 8)], is_closed=True)
            h2.paths.add_polyline_path([(16, 2), (19, 2), (19, 5), (16, 5)], is_closed=True, flags=0)
    elif v == "pattern_multi":
        for k, (pat, ang) in enumerate([("ANSI31", 0), ("ANSI37", 45), ("LINE", 90)]):
            h = msp.add_hatch()
            h.set_pattern_fill(pat, scale=1.5, angle=ang)
            h.paths.add_polyline_path([(k * 8, 0), (k * 8 + 6, 0), (k * 8 + 6, 6), (k * 8, 6)], is_closed=True)
    elif v == "curve_boundary":
        h = msp.add_hatch()
        h.set_pattern_fill("ANSI38")
        ep = h.paths.add_edge_path()
        ep.add_arc(center=(5, 4), radius=4, start_angle=0, end_angle=360, ccw=True)
        ep2 = h.paths.add_edge_path(flags=0)
        ep2.add_ellipse(center=(5, 4), major_axis=(2, 0), ratio=0.5,
                        start_angle=0, end_angle=360)
    elif v == "gradient":
        h = msp.add_hatch()
        h.set_gradient(name="LINEAR", color1=(255, 0, 0), color2=(0, 0, 255))
        h.paths.add_polyline_path([(0, 0), (10, 0), (10, 8), (0, 8)], is_closed=True)
    save(doc, "02_hatch", "hatch_%02d_%s.dxf" % (i + 1, v),
         "ハッチ: %s" % v, ["HATCH", v.upper()])


# ================================================================ 03 ブロック x10
def gen_block(i):
    doc = new_doc()
    msp = doc.modelspace()
    variants = ["simple", "multi_insert", "rotated", "scaled", "nested",
                "nested_deep", "byblock_color", "array_grid", "mirrored", "mixed"]
    v = variants[i]
    title(msp, "BLOCK TEST %02d - %s" % (i + 1, v))
    blk = doc.blocks.new(name="SYM_A")
    blk.add_lwpolyline([(0, 0), (2, 0), (2, 2), (0, 2)], dxfattribs={"closed": True})
    blk.add_line((0, 0), (2, 2))
    blk.add_circle((1, 1), 0.5)
    if v in ("nested", "nested_deep", "mixed"):
        inner = doc.blocks.new(name="SYM_INNER")
        inner.add_circle((0, 0), 0.4)
        b2 = doc.blocks.new(name="SYM_B")
        b2.add_line((-1, -1), (1, 1))
        b2.add_blockref("SYM_INNER", (0.5, 0.5))
    if v == "simple":
        msp.add_blockref("SYM_A", (5, 5))
    elif v == "multi_insert":
        for k in range(3):
            msp.add_blockref("SYM_A", (2 + k * 4, 5))
    elif v == "rotated":
        msp.add_blockref("SYM_A", (5, 5), dxfattribs={"rotation": 30})
        msp.add_blockref("SYM_A", (10, 5), dxfattribs={"rotation": 90})
    elif v == "scaled":
        msp.add_blockref("SYM_A", (5, 5), dxfattribs={"xscale": 2, "yscale": 2})
        msp.add_blockref("SYM_A", (12, 5), dxfattribs={"xscale": 0.5, "yscale": 0.5})
    elif v == "nested":
        msp.add_blockref("SYM_B", (5, 5))
    elif v == "nested_deep":
        outer = doc.blocks.new(name="SYM_OUTER")
        outer.add_blockref("SYM_B", (0, 0))
        msp.add_blockref("SYM_OUTER", (5, 5), dxfattribs={"rotation": 15})
    elif v == "byblock_color":
        doc.layers.add("BYBLK")
        for entity in blk:
            entity.dxf.color = 0
        msp.add_blockref("SYM_A", (5, 5), dxfattribs={"layer": "BYBLK", "color": 1})
        msp.add_blockref("SYM_A", (10, 5), dxfattribs={"layer": "BYBLK", "color": 5})
    elif v == "array_grid":
        for r in range(3):
            for c in range(4):
                msp.add_blockref("SYM_A", (2 + c * 4, 2 + r * 4))
    elif v == "mirrored":
        msp.add_blockref("SYM_A", (5, 5), dxfattribs={"xscale": -1})
    elif v == "mixed":
        msp.add_blockref("SYM_B", (3, 5), dxfattribs={"rotation": 45, "xscale": 1.5, "yscale": 1.5})
        msp.add_blockref("SYM_A", (9, 5), dxfattribs={"xscale": -2})
    save(doc, "03_block", "block_%02d_%s.dxf" % (i + 1, v),
         "ブロック: %s" % v, ["BLOCK", "INSERT", v.upper()])


# ================================================================ 04 属性付きブロック x10
def gen_attrib(i):
    doc = new_doc()
    msp = doc.modelspace()
    variants = ["basic", "japanese", "hidden_attrib", "multi_values", "preset",
                "constant", "verify", "nested_attrib", "rotated_values", "mixed_lang"]
    v = variants[i]
    title(msp, "ATTRIB TEST %02d - %s" % (i + 1, v))
    doc.layers.add("SYMBOL")
    blk = doc.blocks.new(name="STATION")
    blk.add_circle((0, 0), 1.0, dxfattribs={"layer": "SYMBOL"})
    tags = []
    main_tag = "測点名" if v == "japanese" else "STNAME"
    flags = const.ATTRIB_INVISIBLE if v == "hidden_attrib" else 0
    blk.add_attdef(main_tag, text="ST-000", insert=(0, -2.0),
                   dxfattribs={"height": 0.6, "flags": flags})
    tags.append(main_tag)
    if v in ("multi_values", "nested_attrib", "mixed_lang"):
        sub = "標高" if v == "japanese" else "ELEV"
        blk.add_attdef(sub, text="0.000", insert=(0, -3.2),
                       dxfattribs={"height": 0.5})
        tags.append(sub)
    if v == "preset":
        blk.add_attdef("DATE", text="2026-09-05", insert=(0, -4.0),
                       dxfattribs={"height": 0.5, "flags": const.ATTRIB_IS_PRESET})
        tags.append("DATE")
    if v == "constant":
        blk.add_attdef("FIX", text="固定値", insert=(0, -4.0),
                       dxfattribs={"height": 0.5, "flags": const.ATTRIB_CONST})
    if v == "verify":
        blk.add_attdef("CHK", text="確認済", insert=(0, -4.0),
                       dxfattribs={"height": 0.5, "flags": const.ATTRIB_VERIFY})
        tags.append("CHK")
    if v == "nested_attrib":
        inner = doc.blocks.new(name="ATT_INNER")
        inner.add_circle((0, 0), 0.4)
        inner.add_attdef("DEPTH", text="1.0", insert=(0, -1.5),
                         dxfattribs={"height": 0.5})
        b2 = doc.blocks.new(name="ATT_OUTER")
        b2.add_blockref("ATT_INNER", (0, 0)).add_auto_attribs({"DEPTH": "2.0"})
        msp.add_blockref("ATT_OUTER", (12, 5))
    vals = {
        "STNAME": ["ST-001", "ST-002", "ST-003"],
        "測点名": ["水門", "マンホール", "基準点"],
        "ELEV": ["12.500", "13.250", "14.000"],
        "標高": ["2.150", "3.400", "5.010"],
        "DATE": ["2026-09-01", "2026-09-02", "2026-09-03"],
        "CHK": ["OK", "OK", "NG"],
        "DEPTH": ["1.0", "2.0", "3.0"],
    }
    for k, pos in enumerate([(5, 5), (10, 5), (15, 5)]):
        rot = 15.0 * (k + 1) if v == "rotated_values" else 0.0
        ref = msp.add_blockref("STATION", pos, dxfattribs={"rotation": rot})
        ref.add_auto_attribs({t: vals[t][k] for t in tags if t in vals})
    if v == "mixed_lang":
        msp.add_text("Mixed: 測量記録 No.7", dxfattribs={"height": 0.5}).set_placement((5, 9))
    save(doc, "04_attribute_block", "attrib_%02d_%s.dxf" % (i + 1, v),
         "属性付きブロック: %s" % v, ["ATTDEF", "ATTRIB", v.upper()])


# ================================================================ 05 文字・注記 x10
def gen_text(i):
    doc = new_doc()
    msp = doc.modelspace()
    variants = ["text_plain", "text_japanese", "mtext_multiline", "mtext_width",
                "text_rotated", "style_custom", "leader", "mtext_fields",
                "special_chars", "table_like"]
    v = variants[i]
    title(msp, "TEXT TEST %02d - %s" % (i + 1, v))
    doc.styles.add("NOTES", font="txt.shx")
    if v == "text_plain":
        msp.add_text("Standard TEXT entity 123", dxfattribs={"style": "NOTES", "height": 0.8}).set_placement((2, 6))
    elif v == "text_japanese":
        msp.add_text("日本語文字列：道路改良工区", dxfattribs={"style": "NOTES", "height": 0.8}).set_placement((2, 6))
    elif v == "mtext_multiline":
        mt = msp.add_mtext("1行目: 概要\n2行目: 詳細説明\n3行目: Summary",
                           dxfattribs={"style": "NOTES", "char_height": 0.6})
        mt.set_location((2, 6))
    elif v == "mtext_width":
        mt = msp.add_mtext("折返しテスト: この文字列は定義幅で自動的に折り返されることを確認するための長い文です。",
                           dxfattribs={"style": "NOTES", "char_height": 0.6, "width": 12})
        mt.set_location((2, 6), attachment_point=MTextEntityAlignment.TOP_LEFT)
    elif v == "text_rotated":
        msp.add_text("Rotated 30deg", dxfattribs={"height": 0.8, "rotation": 30}).set_placement((2, 6))
    elif v == "style_custom":
        st = doc.styles.add("WIDE", font="txt.shx")
        st.dxf.width = 1.5
        st.dxf.oblique = 15.0
        msp.add_text("Slanted & Wide", dxfattribs={"style": "WIDE", "height": 0.8}).set_placement((2, 6))
    elif v == "leader":
        msp.add_circle((6, 5), 1.0)
        msp.add_leader([(6.7, 5.7), (9, 8), (12, 8)])
        msp.add_text("半径R=1.0m", dxfattribs={"height": 0.6}).set_placement((12.2, 8))
    elif v == "mtext_fields":
        msp.add_mtext("標高 EL.+12.50m\n備考: 変更後", dxfattribs={"style": "NOTES", "char_height": 0.6}).set_location((2, 6))
    elif v == "special_chars":
        msp.add_text("%%c200 %%p0.05 45%%d", dxfattribs={"style": "NOTES", "height": 0.8}).set_placement((2, 6))
    elif v == "table_like":
        for r in range(4):
            for c, w in enumerate([0, 6, 12]):
                msp.add_text("項目%d-%d" % (r, c), dxfattribs={"style": "NOTES", "height": 0.5}).set_placement((2 + w, 8 - r * 1.2))
        for x in (1.5, 7.5, 13.5):
            msp.add_line((x, 3.4), (x, 9.0))
        for y in (3.4, 9.0):
            msp.add_line((1.5, y), (13.5, y))
    save(doc, "05_text_annotation", "text_%02d_%s.dxf" % (i + 1, v),
         "文字・注記: %s" % v, ["TEXT", "MTEXT", v.upper()])


# ================================================================ 06 レイヤー・表示属性 x10
def gen_layer(i):
    doc = new_doc()
    msp = doc.modelspace()
    variants = ["linetypes", "ltscale", "lineweight", "truecolor", "bylayer",
                "byblock", "frozen_off", "many_layers", "plot_noplot", "mixed_props"]
    v = variants[i]
    title(msp, "LAYER TEST %02d - %s" % (i + 1, v))
    doc.layers.add("CENTER_L", color=1, linetype="CENTER")
    doc.layers.add("DASHED_L", color=2, linetype="DASHED")
    doc.layers.add("THICK_L", color=3, lineweight=70)
    doc.layers.add("TC_L", true_color=ezdxf.rgb2int((0, 120, 255)))
    if v == "linetypes":
        msp.add_line((0, 0), (20, 0), dxfattribs={"layer": "CENTER_L"})
        msp.add_line((0, 2), (20, 2), dxfattribs={"layer": "DASHED_L"})
    elif v == "ltscale":
        for k, sc in enumerate([0.5, 1.0, 2.0]):
            e = msp.add_line((0, k * 2), (20, k * 2), dxfattribs={"layer": "CENTER_L"})
            e.dxf.ltscale = sc
    elif v == "lineweight":
        for lw in (0, 25, 50, 70, 100):
            msp.add_line((0, lw / 50.0), (20, lw / 50.0), dxfattribs={"lineweight": lw})
        msp.add_line((0, 5), (20, 5), dxfattribs={"layer": "THICK_L"})
    elif v == "truecolor":
        msp.add_line((0, 0), (20, 0), dxfattribs={"layer": "TC_L"})
        msp.add_circle((10, 4), 2, dxfattribs={"true_color": ezdxf.rgb2int((255, 0, 128))})
    elif v == "bylayer":
        msp.add_line((0, 0), (20, 0), dxfattribs={"layer": "DASHED_L", "color": 256})
        msp.add_line((0, 2), (20, 2), dxfattribs={"layer": "CENTER_L", "color": 256})
    elif v == "byblock":
        blk = doc.blocks.new(name="BYBLK_SYM")
        blk.add_line((0, 0), (2, 0), dxfattribs={"color": 0})
        blk.add_circle((1, 0), 0.5, dxfattribs={"color": 0})
        msp.add_blockref("BYBLK_SYM", (5, 5), dxfattribs={"color": 1})
        msp.add_blockref("BYBLK_SYM", (10, 5), dxfattribs={"color": 3})
    elif v == "frozen_off":
        doc.layers.add("FROZEN_L", color=5)
        doc.layers.get("FROZEN_L").freeze()
        doc.layers.add("OFF_L", color=6)
        doc.layers.get("OFF_L").off()
        msp.add_line((0, 0), (20, 0), dxfattribs={"layer": "FROZEN_L"})
        msp.add_line((0, 2), (20, 2), dxfattribs={"layer": "OFF_L"})
        msp.add_line((0, 4), (20, 4), dxfattribs={"layer": "DASHED_L"})
    elif v == "many_layers":
        for k in range(20):
            doc.layers.add("L%02d" % k, color=(k % 255) + 1)
            msp.add_line((0, k * 0.8), (20, k * 0.8), dxfattribs={"layer": "L%02d" % k})
    elif v == "plot_noplot":
        doc.layers.add("NOPLOT_L", color=7)
        doc.layers.get("NOPLOT_L").dxf.plot = 0
        msp.add_line((0, 0), (20, 0), dxfattribs={"layer": "NOPLOT_L"})
        msp.add_line((0, 2), (20, 2), dxfattribs={"layer": "DASHED_L"})
    elif v == "mixed_props":
        msp.add_line((0, 0), (20, 0),
                     dxfattribs={"layer": "CENTER_L", "lineweight": 35, "ltscale": 2.0,
                                 "true_color": ezdxf.rgb2int((255, 0, 0))})
        msp.add_line((0, 2), (20, 2), dxfattribs={"layer": "DASHED_L", "color": 256})
    save(doc, "06_layer_display", "layer_%02d_%s.dxf" % (i + 1, v),
         "レイヤー・表示属性: %s" % v, ["LAYER", "LINETYPE", v.upper()])


# ================================================================ 07 レイアウト・印刷 x10
def gen_layout(i):
    doc = new_doc()
    msp = doc.modelspace()
    variants = ["single_viewport", "two_viewports", "scaled_vp", "locked_vp",
                "frame_block", "multi_layout", "a3_a4", "clip_vp", "title_block", "print_setup"]
    v = variants[i]
    title(msp, "LAYOUT TEST %02d - %s" % (i + 1, v))
    msp.add_circle((10, 10), 5)
    msp.add_line((5, 10), (15, 10))
    msp.add_text("Model content", dxfattribs={"height": 1.0}).set_placement((8, 16))
    layout_names = ["Layout1", "Layout2"] if v in ("multi_layout", "a3_a4") else ["Layout1"]
    for lname in layout_names:
        if lname in doc.layouts:
            lay = doc.layouts.get(lname)
        else:
            lay = doc.layouts.new(lname)
        psp = lay
        w, h = (297, 210) if v == "a3_a4" and lname == "Layout2" else (420, 297)
        lay.page_setup(size=(w, h), margins=(0, 0, 0, 0), units="mm", scale=(1, 1), name="CORPUS_A3_PRINT" if v == "print_setup" else "ezdxf")
        psp.add_lwpolyline([(0, 0), (w, 0), (w, h), (0, h)], dxfattribs={"closed": True})
        psp.add_text(lname, dxfattribs={"height": 8}).set_placement((10, h - 15))
        if v == "two_viewports":
            psp.add_viewport(center=(100, 150), size=(160, 200), view_center_point=(7, 10), view_height=20)
            psp.add_viewport(center=(280, 150), size=(160, 200), view_center_point=(13, 10), view_height=20)
        else:
            vp = psp.add_viewport(center=(w / 2, h / 2), size=(w - 40, h - 60), view_center_point=(10, 10), view_height=(h - 60) / 10)
            if v == "scaled_vp":
                vp.dxf.view_height = vp.dxf.height / 5  # meters to paper mm at 1:200
            elif v == "locked_vp":
                vp.dxf.flags |= const.VSF_VIEWPORT_ZOOM_LOCKING
            elif v == "clip_vp":
                boundary = psp.add_lwpolyline([(30, 40), (w - 30, 40), (w - 60, h - 40), (30, h - 40)], close=True)
                vp.dxf.clipping_boundary_handle = boundary.dxf.handle
                vp.dxf.flags |= 65536
        if v == "frame_block":
            fb = doc.blocks.new(name="A3_FRAME")
            fb.add_lwpolyline([(0, 0), (420, 0), (420, 297), (0, 297)], dxfattribs={"closed": True})
            psp.add_blockref("A3_FRAME", (0, 0))
        if v == "title_block":
            psp.add_text("TITLE: DXF-TEST-CORPUS", dxfattribs={"height": 6}).set_placement((20, 260))
            psp.add_text("SCALE 1/100  A3", dxfattribs={"height": 5}).set_placement((20, 248))
    save(doc, "07_layout_print", "layout_%02d_%s.dxf" % (i + 1, v),
         "レイアウト・印刷: %s" % v, ["PAPER_SPACE", "VIEWPORT", v.upper()])


# ================================================================ 08 曲線・精密形状 x10
def gen_curve(i):
    doc = new_doc()
    msp = doc.modelspace()
    variants = ["arc", "ellipse", "spline_fit", "spline_cv", "arc_polyline",
                "big_coords", "ellipse_rotated", "spline_closed", "precise_decimals", "curves_mixed"]
    v = variants[i]
    title(msp, "CURVE TEST %02d - %s" % (i + 1, v))
    if v == "arc":
        msp.add_arc((5, 5), 4, 30, 210)
    elif v == "ellipse":
        msp.add_ellipse((5, 5), major_axis=(6, 0), ratio=0.4)
    elif v == "spline_fit":
        msp.add_spline(fit_points=[(0, 0), (3, 4), (7, 3), (11, 6)], degree=3)
    elif v == "spline_cv":
        msp.add_open_spline(control_points=[(0, 0), (3, 5), (7, -1), (11, 4)], degree=3)
    elif v == "arc_polyline":
        msp.add_lwpolyline([(0, 0, 0), (4, 0, -0.5), (8, 0, 0.5), (12, 0, 0)], format="xyb")
    elif v == "big_coords":
        ox, oy = 100000.0, 50000.0
        msp.add_line((ox, oy), (ox + 250, oy))
        msp.add_circle((ox + 125, oy + 60), 30)
        msp.add_text("座標原点 X=100000 Y=50000", dxfattribs={"height": 5}).set_placement((ox, oy + 100))
    elif v == "ellipse_rotated":
        a30 = math.radians(30)
        msp.add_ellipse((5, 5), major_axis=(6 * math.cos(a30), 6 * math.sin(a30)), ratio=0.35)
    elif v == "spline_closed":
        msp.add_spline().set_closed(control_points=[(5, 2, 0), (9, 5, 0), (5, 8, 0), (1, 5, 0)], degree=3)
    elif v == "precise_decimals":
        msp.add_line((0.123456789, 0.987654321), (10.111111111, 9.888888888))
        msp.add_arc((5.5, 5.5), 2.718281828, 10.5, 199.75)
    elif v == "curves_mixed":
        msp.add_arc((5, 5), 3, 0, 180)
        msp.add_ellipse((5, 5), major_axis=(5, 0), ratio=0.5)
        msp.add_spline(fit_points=[(0, 0), (4, 2), (9, 1), (13, 5)], degree=3)
    save(doc, "08_curve_precision", "curve_%02d_%s.dxf" % (i + 1, v),
         "曲線・精密形状: %s" % v, ["ARC", "ELLIPSE", "SPLINE", "LWPOLYLINE", v.upper()])


# ================================================================ 09 土木複合図面 x10
def gen_civil(i):
    doc = new_doc()
    msp = doc.modelspace()
    variants = ["road_plan", "road_profile", "retaining_wall", "drainage", "temp_works",
                "intersection", "cross_section", "grading", "utility_plan", "combined_sheet"]
    v = variants[i]
    doc.layers.add("CL", color=1, linetype="CENTER")
    doc.layers.add("ROAD", color=3)
    doc.layers.add("DRAIN", color=5, linetype="DASHED")
    doc.layers.add("DIMS", color=2)
    doc.layers.add("NOTES", color=7)
    title(msp, "CIVIL TEST %02d - %s" % (i + 1, v), y=14, h=0.8)
    tattr = {"layer": "NOTES"}

    def dim(p1, p2, base):
        msp.add_linear_dim(base=base, p1=p1, p2=p2, dxfattribs={"layer": "DIMS"}).render()

    if v == "road_plan":
        msp.add_spline(fit_points=[(0, 0), (10, 3), (20, 2), (30, 8)], degree=3, dxfattribs={"layer": "CL"})
        msp.add_lwpolyline([(0, -4), (30, 4)], dxfattribs={"layer": "ROAD"})
        msp.add_lwpolyline([(0, -6), (30, 2)], dxfattribs={"layer": "ROAD"})
        dim((0, -6), (30, 2), (0, -8))
        msp.add_text("道路中心線 杭No.1〜No.4", dxfattribs=dict(tattr, height=0.8)).set_placement((2, 10))
    elif v == "road_profile":
        msp.add_lwpolyline([(0, 0), (5, 0.5), (15, 2.0), (25, 3.5), (35, 4.0)], dxfattribs={"layer": "CL"})
        msp.add_lwpolyline([(0, -3), (35, 1)], dxfattribs={"layer": "ROAD"})
        for x in range(0, 40, 10):
            msp.add_text("STA %d+00" % x, dxfattribs=dict(tattr, height=0.6)).set_placement((x, -4.5))
        dim((0, -3), (35, 1), (0, -6))
    elif v == "retaining_wall":
        pts = [(0, 0), (0, 6), (1, 6), (1, 0.5), (4, 0.5), (4, 0)]
        msp.add_lwpolyline(pts + [pts[0]], dxfattribs={"closed": True, "layer": "ROAD"})
        h = msp.add_hatch()
        h.set_pattern_fill("ANSI31")
        h.paths.add_polyline_path([(0.2, 0.2), (0.8, 0.2), (0.8, 5.8), (0.2, 5.8)], is_closed=True)
        dim((0, 0), (0, 6), (-1.5, 0))
        msp.add_text("擁壁標準断面 H=6.0m", dxfattribs=dict(tattr, height=0.8)).set_placement((6, 7))
    elif v == "drainage":
        for x in range(0, 24, 8):
            msp.add_circle((x + 2, 2), 0.8, dxfattribs={"layer": "DRAIN"})
            msp.add_line((x + 2.8, 2), (x + 9.2, 2), dxfattribs={"layer": "DRAIN"})
        msp.add_text("排水管 管径phi=500 i=1/100", dxfattribs=dict(tattr, height=0.8)).set_placement((2, 6))
    elif v == "temp_works":
        msp.add_lwpolyline([(0, 0), (20, 0), (20, 1), (0, 1)], dxfattribs={"closed": True, "layer": "ROAD"})
        for x in range(2, 20, 4):
            msp.add_line((x, 1), (x, 4), dxfattribs={"layer": "DRAIN"})
        msp.add_text("仮設工事 足場・仮設道路", dxfattribs=dict(tattr, height=0.8)).set_placement((2, 6))
    elif v == "intersection":
        msp.add_arc((10, 10), 8, 0, 90, dxfattribs={"layer": "CL"})
        msp.add_line((10, 10), (22, 10), dxfattribs={"layer": "CL"})
        msp.add_line((10, 10), (10, 22), dxfattribs={"layer": "CL"})
        dim((10, 10), (22, 10), (10, 8))
        msp.add_text("交差点角部 R=8.0m", dxfattribs=dict(tattr, height=0.8)).set_placement((12, 14))
    elif v == "cross_section":
        msp.add_lwpolyline([(0, 0), (5, 3), (10, 3.2), (15, 3), (20, 0)], dxfattribs={"layer": "ROAD"})
        msp.add_lwpolyline([(0, -2), (20, -2)], dxfattribs={"layer": "CL"})
        dim((0, 0), (20, 0), (0, -4))
        msp.add_text("横断測量断面", dxfattribs=dict(tattr, height=0.8)).set_placement((8, 5))
    elif v == "grading":
        for k in range(5):
            msp.add_lwpolyline([(0, k * 2), (25, k * 2 + 1)], dxfattribs={"layer": "ROAD"})
            msp.add_text("+%d.0" % k, dxfattribs=dict(tattr, height=0.5)).set_placement((26, k * 2))
    elif v == "utility_plan":
        msp.add_line((0, 5), (30, 5), dxfattribs={"layer": "DRAIN"})
        msp.add_line((0, 3), (30, 3), dxfattribs={"layer": "CL"})
        for x in (6, 14, 22):
            msp.add_circle((x, 5), 0.6, dxfattribs={"layer": "DRAIN"})
            msp.add_text("MM%d" % x, dxfattribs=dict(tattr, height=0.5)).set_placement((x - 1, 6.2))
    elif v == "combined_sheet":
        msp.add_spline(fit_points=[(0, 12), (10, 14), (20, 13), (30, 15)], degree=3, dxfattribs={"layer": "CL"})
        msp.add_lwpolyline([(0, 6), (30, 8)], dxfattribs={"layer": "ROAD"})
        msp.add_circle((8, 2), 0.8, dxfattribs={"layer": "DRAIN"})
        h = msp.add_hatch()
        h.set_pattern_fill("ANSI37")
        h.paths.add_polyline_path([(18, 0), (26, 0), (26, 3), (18, 3)], is_closed=True)
        dim((0, 6), (30, 8), (0, 4))
        msp.add_text("複合シート: 道路・排水・擁壁", dxfattribs=dict(tattr, height=0.8)).set_placement((2, 17))
    blk = doc.blocks.new(name="CIV_MARK")
    blk.add_lwpolyline([(0, 0), (1, 0), (0.5, 1)], dxfattribs={"closed": True})
    msp.add_blockref("CIV_MARK", (33, 0))
    save(doc, "09_civil_composite", "civil_%02d_%s.dxf" % (i + 1, v),
         "土木複合図面: %s" % v, ["COMPOSITE", "DIMENSION", "HATCH", "SPLINE", "TEXT", v.upper()])


# ================================================================ 10 大規模・特殊 x5
def gen_large(i):
    doc = new_doc()
    msp = doc.modelspace()
    variants = ["large_entity_count", "unknown_appdata", "proxy_entity", "xref_like", "all_special"]
    v = variants[i]
    title(msp, "LARGE/SPECIAL TEST %02d - %s" % (i + 1, v))
    doc.appids.new("CORPUS_UNKNOWN_APP")
    n = 3000 if v in ("large_entity_count", "all_special") else 300
    for k in range(n):
        x = (k % 60) * 2.0
        y = (k // 60) * 2.0
        msp.add_line((x, y), (x + 1.5, y + 1.0))
    if v in ("unknown_appdata", "all_special"):
        e = msp.add_circle((10, 10), 3)
        e.set_xdata("CORPUS_UNKNOWN_APP", [(1000, "unknown-data-保持確認"), (1071, 12345)])
    if v in ("xref_like", "all_special"):
        blk = doc.blocks.new(name="EXT_PART")
        blk.add_circle((0, 0), 1.0)
        msp.add_blockref("EXT_PART", (20, 5))
        msp.add_text("外部参照相当: EXT_PART.dxf (依存ファイルはdependencies/に同梱のこと)",
                     dxfattribs={"height": 0.6}).set_placement((5, 9))
    save(doc, "10_large_special", "large_%02d_%s.dxf" % (i + 1, v),
         "大規模・特殊: %s" % v, ["XDATA", "LARGE", v.upper()])


# ================================================================ マニフェスト出力
def write_manifests():
    man = os.path.join(ROOT, "00_manifest")
    os.makedirs(man, exist_ok=True)
    fields = list(MANIFEST[0].keys())
    with open(os.path.join(man, "corpus_manifest.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(MANIFEST)
    payload = {
        "corpus": "DXF-Test-Corpus",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "total_files": len(MANIFEST),
        "common_metadata": DOC_COMMON,
        "note": "合成(synthetic)コーパス。最終受入用は実CAD出力100件で置換すること。",
        "files": MANIFEST,
    }
    with open(os.path.join(man, "corpus_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print("manifest written: %d files" % len(MANIFEST))


def verify():
    ok = 0
    results = []
    def require(condition, message):
        if not condition:
            raise ValueError(message)

    require(len(MANIFEST) == 100, "Expected exactly 100 manifest rows")
    require(len({r["file"] for r in MANIFEST}) == 100, "Duplicate manifest paths")
    for row in MANIFEST:
        result = {"file": row["file"], "passed": False}
        try:
            filename = os.path.join(ROOT, row["file"])
            d = ezdxf.readfile(filename)
            audit = d.audit()
            require(not audit.errors and not audit.fixes, "DXF audit errors or fixes")
            require(d.units == 6, "INSUNITS must be meters")
            model = Counter(e.dxftype() for e in d.modelspace())
            database = Counter(e.dxftype() for e in d.entitydb.values() if e.is_alive)
            for category, entity_type in [("01_dimension", "DIMENSION"), ("02_hatch", "HATCH"), ("03_block", "INSERT"), ("04_attribute_block", "INSERT")]:
                if row["category"] == category:
                    require(model[entity_type] > 0, "Missing " + entity_type)
            if row["category"] == "04_attribute_block":
                require(database["ATTDEF"] > 0 and database["ATTRIB"] > 0, "Missing attributes")
            if "associative.dxf" in filename:
                hatch = d.modelspace().query("HATCH").first
                require(hatch.dxf.associative == 1 and bool(hatch.paths[0].source_boundary_objects), "Missing hatch association")
            if "gradient.dxf" in filename:
                require(d.modelspace().query("HATCH").first.gradient is not None, "Missing gradient")
            if "hidden_attrib.dxf" in filename:
                require(any(a.is_invisible for e in d.modelspace().query("INSERT") for a in e.attribs), "Invisible flag lost")
            if row["category"] == "07_layout_print":
                viewports = [v for layout in d.layouts if layout.name != "Model" for v in layout.query("VIEWPORT") if v.dxf.id > 1]
                require(bool(viewports), "Missing paper viewport")
                if "locked_vp.dxf" in filename:
                    require(any(v.dxf.flags & const.VSF_VIEWPORT_ZOOM_LOCKING for v in viewports), "Viewport not locked")
                if "clip_vp.dxf" in filename:
                    require(any(v.dxf.clipping_boundary_handle in d.entitydb for v in viewports), "Missing clipping boundary")
            with open(filename, "rb") as f:
                data = f.read()
            data.decode("ascii")
            result.update(passed=True, sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), model_types=dict(model), database_types=dict(database), model_entities=sum(model.values()), dxf_version=d.dxfversion, units=d.units)
            ok += 1
        except Exception as exc:
            result["error"] = str(exc)
            print("VERIFY FAIL:", row["file"], exc)
        results.append(result)
    with open(os.path.join(ROOT, "00_manifest", "verification.json"), "w", encoding="utf-8") as f:
        json.dump({"total": len(results), "passed": ok, "scope": "Synthetic generation, audit and selected feature assertions only; not CAD compatibility", "results": results}, f, ensure_ascii=False, indent=2)
    print("verified %d/%d" % (ok, len(MANIFEST)))
    return ok == len(MANIFEST)


def main():
    MANIFEST.clear()
    plan = [
        ("01_dimension", 15, gen_dimension),
        ("02_hatch", 10, gen_hatch),
        ("03_block", 10, gen_block),
        ("04_attribute_block", 10, gen_attrib),
        ("05_text_annotation", 10, gen_text),
        ("06_layer_display", 10, gen_layer),
        ("07_layout_print", 10, gen_layout),
        ("08_curve_precision", 10, gen_curve),
        ("09_civil_composite", 10, gen_civil),
        ("10_large_special", 5, gen_large),
    ]
    for dirname, count, fn in plan:
        os.makedirs(os.path.join(ROOT, dirname), exist_ok=True)
        print(dirname)
        for i in range(count):
            fn(i)
    write_manifests()
    if not verify():
        sys.exit(1)
    print("DONE: %d DXF files" % len(MANIFEST))


if __name__ == "__main__":
    main()
