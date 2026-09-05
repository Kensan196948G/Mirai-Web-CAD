"""Independent, scoped source comparison. Not a CAD/PDF compatibility certificate."""
import json
import math
import sys
from pathlib import Path

import ezdxf
from ezdxf.math import Matrix44
from ezdxf.lldxf.encoding import decode_dxf_unicode

source_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "DXF-Test-Corpus")
output_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/native-block-corpus")
report = json.loads((output_dir / "report.json").read_text())


def equal(a, b):
    if isinstance(a, str) and isinstance(b, str):
        return decode_dxf_unicode(a) == decode_dxf_unicode(b)
    if isinstance(a, (float, int)) and isinstance(b, (float, int)):
        return math.isclose(a, b, rel_tol=0, abs_tol=1e-7)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
    return a == b


def signature(entity):
    kind = entity.dxftype()
    d = entity.dxf
    result = [kind, d.layer]
    if kind == "LINE":
        result += [tuple(d.start), tuple(d.end)]
    elif kind in ("CIRCLE", "ARC"):
        result += [tuple(d.center), d.radius]
        if kind == "ARC":
            result += [d.start_angle % 360, d.end_angle % 360]
    elif kind == "LWPOLYLINE":
        result += [entity.closed, [tuple(point) for point in entity.get_points()]]
    elif kind in ("TEXT", "ATTRIB", "ATTDEF"):
        result += [tuple(d.insert), d.text, d.height, d.get("rotation", 0) % 360]
        if kind != "TEXT":
            result += [d.tag, d.flags]
        if kind == "ATTDEF":
            result += [d.get("prompt", "")]
    elif kind == "INSERT":
        result += [d.name, tuple(d.insert), d.get("rotation", 0) % 360,
                   d.xscale, d.yscale, d.zscale, [signature(a) for a in entity.attribs]]
    else:
        raise AssertionError(f"Unsupported test geometry: {kind}")
    return result


checked = 0
for entry in report["results"]:
    if not entry["accepted"]:
        continue
    source = ezdxf.readfile(source_dir / entry["source"])
    for phase in ("before", "after"):
        actual = ezdxf.readfile(output_dir / f"{phase}-{entry['file']}")
        audit = actual.audit()
        assert not audit.errors and not audit.fixes, (entry["file"], audit.errors, audit.fixes)
        assert source.header["$INSUNITS"] == actual.header["$INSUNITS"]
        expected_entities = [e.copy() for e in source.modelspace()]
        if phase == "after":
            t = report["transform"]
            matrix = Matrix44.chain(Matrix44.scale(t["scale"]), Matrix44.z_rotate(math.radians(t["angle"])), Matrix44.translate(t["dx"], t["dy"], 0))
            for entity in expected_entities:
                if entity.dxftype() == "INSERT":
                    entity.transform(matrix)
                    if entity.attribs:
                        entity.attribs[0].dxf.text += " / edited"
        expected = [signature(e) for e in expected_entities]
        observed = [signature(e) for e in actual.modelspace()]
        assert equal(expected, observed), (entry["file"], phase, expected, observed)
        for block in actual.blocks:
            if block.name.lower().startswith(("*model_space", "*paper_space")):
                continue
            original = source.blocks[block.name]
            assert equal(tuple(original.base_point), tuple(block.base_point))
            assert equal([signature(e) for e in original], [signature(e) for e in block]), (entry["file"], block.name)
        checked += 1
print(f"Independent source geometry/attributes/unit comparison: {checked}/36; zero audit errors/fixes. Not full compatibility.")
assert checked == 36
